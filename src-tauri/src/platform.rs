use std::{
    collections::HashMap,
    env,
    path::{Path, PathBuf},
    process::Command as StdCommand,
};
use tokio::process::Command;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone, Debug)]
pub struct ResolvedCommand {
    path: PathBuf,
    uses_cmd: bool,
}

impl ResolvedCommand {
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn command(&self) -> Command {
        let command = if self.uses_cmd {
            let mut command = Command::new("cmd.exe");
            command.args(["/D", "/C"]).arg(&self.path);
            command
        } else {
            Command::new(&self.path)
        };
        // Claude Desk is a GUI product. Native Claude and npm's claude.cmd must
        // both stay attached to our structured pipes without opening a console.
        #[cfg(windows)]
        {
            let mut command = command;
            command.creation_flags(CREATE_NO_WINDOW);
            command
        }
        #[cfg(not(windows))]
        {
            command
        }
    }
}

pub fn ensure_external_command(command: &ResolvedCommand) -> Result<(), String> {
    let current = env::current_exe().map_err(|error| error.to_string())?;
    if same_executable(command.path(), &current) || is_claude_desk_executable(command.path()) {
        return Err(
            "Claude Code command resolves to Claude Desk itself. Reset the command to `claude` or select the Claude Code executable."
                .into(),
        );
    }
    Ok(())
}

fn is_claude_desk_executable(path: &Path) -> bool {
    path.file_stem()
        .and_then(|name| name.to_str())
        .map(|name| {
            let normalized = name.to_ascii_lowercase().replace([' ', '_'], "-");
            normalized == "claude-desk"
        })
        .unwrap_or(false)
}

fn same_executable(left: &Path, right: &Path) -> bool {
    let left = left.canonicalize().unwrap_or_else(|_| left.to_path_buf());
    let right = right.canonicalize().unwrap_or_else(|_| right.to_path_buf());
    #[cfg(windows)]
    {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

fn executable_candidates(command: &str) -> Vec<String> {
    #[cfg(windows)]
    {
        let path = Path::new(command);
        if path.extension().is_some() {
            return vec![command.to_string()];
        }
        return vec![
            format!("{command}.exe"),
            format!("{command}.cmd"),
            format!("{command}.bat"),
            command.to_string(),
        ];
    }
    #[cfg(not(windows))]
    vec![command.to_string()]
}

fn resolved(path: PathBuf) -> ResolvedCommand {
    let uses_cmd = cfg!(windows)
        && matches!(
            path.extension()
                .and_then(|extension| extension.to_str())
                .map(str::to_ascii_lowercase)
                .as_deref(),
            Some("cmd" | "bat")
        );
    ResolvedCommand { path, uses_cmd }
}

#[cfg(windows)]
fn environment_value<'a>(
    environment: &'a HashMap<String, String>,
    key: &str,
) -> Option<&'a String> {
    environment
        .iter()
        .find(|(candidate, _)| candidate.eq_ignore_ascii_case(key))
        .map(|(_, value)| value)
}

#[cfg(not(windows))]
fn environment_value<'a>(
    environment: &'a HashMap<String, String>,
    key: &str,
) -> Option<&'a String> {
    environment.get(key)
}

pub fn resolve_command(
    command: &str,
    environment: &HashMap<String, String>,
) -> Option<ResolvedCommand> {
    let requested = PathBuf::from(command);
    if requested.components().count() > 1 && requested.is_file() {
        return Some(resolved(requested));
    }
    let path = environment_value(environment, "PATH")?;
    for directory in env::split_paths(path) {
        for candidate in executable_candidates(command) {
            let candidate = directory.join(candidate);
            if candidate.is_file() {
                return Some(resolved(candidate));
            }
        }
    }
    None
}

pub async fn login_environment() -> HashMap<String, String> {
    let mut environment = env::vars().collect::<HashMap<_, _>>();
    #[cfg(target_os = "macos")]
    {
        // GUI apps do not inherit terminal startup files. Interactive mode also
        // loads .zshrc, where tools such as NVM commonly add Claude to PATH.
        let output = Command::new("/bin/zsh")
            .args(["-l", "-i", "-c", "command /usr/bin/env -0"])
            .output()
            .await;
        if let Ok(output) = output {
            for item in output.stdout.split(|byte| *byte == 0) {
                if let Some(position) = item.iter().position(|byte| *byte == b'=') {
                    if let (Ok(key), Ok(value)) = (
                        String::from_utf8(item[..position].to_vec()),
                        String::from_utf8(item[position + 1..].to_vec()),
                    ) {
                        environment.insert(key, value);
                    }
                }
            }
        }
    }
    #[cfg(windows)]
    append_windows_claude_paths(&mut environment);
    environment
}

#[cfg(windows)]
fn append_windows_claude_paths(environment: &mut HashMap<String, String>) {
    let mut paths = environment
        .get("PATH")
        .or_else(|| environment_value(environment, "PATH"))
        .map(env::split_paths)
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    if let Some(profile) = environment_value(environment, "USERPROFILE") {
        paths.push(Path::new(profile).join(".local").join("bin"));
    }
    if let Some(app_data) = environment_value(environment, "APPDATA") {
        paths.push(Path::new(app_data).join("npm"));
    }
    paths.dedup();
    if let Ok(path) = env::join_paths(paths) {
        environment.insert("PATH".into(), path.to_string_lossy().to_string());
    }
}

pub fn stop_process_tree(pid: u32, run_id: &str) -> Result<(), String> {
    #[cfg(unix)]
    unsafe {
        if libc::kill(-(pid as i32), libc::SIGINT) != 0 {
            return Err(format!("Could not stop Claude run {run_id}"));
        }
    }
    #[cfg(windows)]
    {
        let output = StdCommand::new("taskkill.exe")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output()
            .map_err(|error| format!("Could not stop Claude run {run_id}: {error}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
    }
    Ok(())
}

pub fn open_in_editor(path: &str, line: Option<u32>, editor: &str) -> Result<(), String> {
    let target = line
        .map(|line| format!("{path}:{line}"))
        .unwrap_or_else(|| path.to_string());
    let output = open_editor_command(path, &target, editor)
        .output()
        .map_err(|error| format!("Could not open editor: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn open_editor_command(path: &str, target: &str, editor: &str) -> StdCommand {
    if editor == "system" {
        let mut command = StdCommand::new("open");
        command.arg(path);
        return command;
    }
    let (application, cli) = if editor == "cursor" {
        (
            "Cursor",
            "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
        )
    } else {
        (
            "Visual Studio Code",
            "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
        )
    };
    if Path::new(cli).is_file() {
        let mut command = StdCommand::new(cli);
        command.args(["--goto", target]);
        command
    } else {
        let mut command = StdCommand::new("open");
        command.args(["-a", application]).arg(path);
        command
    }
}

#[cfg(windows)]
fn open_editor_command(path: &str, target: &str, editor: &str) -> StdCommand {
    if editor != "system" {
        if let Some(executable) = windows_editor_path(editor) {
            let mut command = StdCommand::new(executable);
            command.args(["--goto", target]);
            return command;
        }
    }
    let mut command = StdCommand::new("explorer.exe");
    command.arg(path);
    command
}

#[cfg(windows)]
fn windows_editor_path(editor: &str) -> Option<PathBuf> {
    let (folder, executable) = if editor == "cursor" {
        ("Cursor", "Cursor.exe")
    } else {
        ("Microsoft VS Code", "Code.exe")
    };
    ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"]
        .into_iter()
        .filter_map(env::var_os)
        .map(PathBuf::from)
        .flat_map(|root| {
            [
                root.join("Programs").join(folder).join(executable),
                root.join(folder).join(executable),
            ]
        })
        .find(|path| path.is_file())
}

#[cfg(not(any(target_os = "macos", windows)))]
fn open_editor_command(path: &str, _target: &str, _editor: &str) -> StdCommand {
    let mut command = StdCommand::new("xdg-open");
    command.arg(path);
    command
}

pub fn reveal_path(path: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let result = StdCommand::new("open").arg("-R").arg(path).spawn();
    #[cfg(windows)]
    let result = StdCommand::new("explorer.exe")
        .arg("/select,")
        .arg(path)
        .spawn();
    #[cfg(not(any(target_os = "macos", windows)))]
    let result = StdCommand::new("xdg-open").arg(path).spawn();
    result.map(|_| ()).map_err(|error| error.to_string())
}

pub fn open_terminal(path: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let result = StdCommand::new("open")
        .arg("-a")
        .arg("Terminal")
        .arg(path)
        .spawn();
    #[cfg(windows)]
    let result = StdCommand::new("wt.exe")
        .args(["-d", path])
        .spawn()
        .or_else(|_| {
            StdCommand::new("powershell.exe")
                .args(["-NoExit", "-Command", "Set-Location", "-LiteralPath"])
                .arg(path)
                .spawn()
        });
    #[cfg(not(any(target_os = "macos", windows)))]
    let result = StdCommand::new("x-terminal-emulator")
        .current_dir(path)
        .spawn();
    result.map(|_| ()).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{is_claude_desk_executable, resolve_command, same_executable};
    use std::{collections::HashMap, fs};
    use uuid::Uuid;

    #[test]
    fn resolves_an_executable_from_platform_path_entries() {
        let root = std::env::temp_dir().join(format!("claude-desk-platform-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let executable = root.join("claude");
        fs::write(&executable, "test").unwrap();
        let mut environment = HashMap::new();
        environment.insert("PATH".into(), root.to_string_lossy().to_string());

        assert_eq!(
            resolve_command("claude", &environment).unwrap().path(),
            executable
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn compares_canonical_executable_paths() {
        let root = std::env::temp_dir().join(format!("claude-desk-platform-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("nested")).unwrap();
        let executable = root.join("claude-desk");
        fs::write(&executable, "test").unwrap();

        assert!(same_executable(
            &root.join("nested").join("..").join("claude-desk"),
            &executable
        ));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_current_and_previous_claude_desk_binary_names() {
        assert!(is_claude_desk_executable(std::path::Path::new(
            "claude-desk.exe"
        )));
        assert!(is_claude_desk_executable(std::path::Path::new(
            "Claude Desk.exe"
        )));
        assert!(!is_claude_desk_executable(std::path::Path::new(
            "claude.exe"
        )));
    }
}
