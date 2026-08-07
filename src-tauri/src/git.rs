use serde::Serialize;
use std::{fs, path::Path, process::Command};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub status: String,
    pub path: String,
}

fn run_git(project_path: &str, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git")
        .arg("-C")
        .arg(project_path)
        .args(args)
        .output()
        .map_err(|error| error.to_string())
}

fn untracked_file_diff(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let Ok(content) = String::from_utf8(bytes) else {
        return Ok(String::new());
    };
    Ok(content
        .lines()
        .map(|line| format!("+{line}"))
        .collect::<Vec<_>>()
        .join("\n"))
}

#[tauri::command]
pub fn git_status(project_path: String) -> Result<Vec<ChangedFile>, String> {
    let output = run_git(
        &project_path,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    if !output.status.success() {
        return Ok(Vec::new());
    }
    let entries = output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
        .collect::<Vec<_>>();
    let mut changes = Vec::new();
    let mut index = 0;
    while index < entries.len() {
        let entry = String::from_utf8_lossy(entries[index]);
        if entry.len() < 4 {
            index += 1;
            continue;
        }
        let status = entry[..2].trim().to_string();
        let mut path = entry[3..].to_string();
        if entry.starts_with('R') || entry.starts_with('C') {
            if let Some(next) = entries.get(index + 1) {
                path = String::from_utf8_lossy(next).to_string();
                index += 1;
            }
        }
        changes.push(ChangedFile {
            status: if status.is_empty() {
                "M".into()
            } else {
                status
            },
            path,
        });
        index += 1;
    }
    Ok(changes)
}

#[tauri::command]
pub fn git_diff(project_path: String, path: String) -> Result<String, String> {
    let status = git_status(project_path.clone())?
        .into_iter()
        .find(|item| item.path == path)
        .map(|item| item.status)
        .unwrap_or_default();
    if status == "??" {
        return untracked_file_diff(&Path::new(&project_path).join(&path));
    }
    let mut output = run_git(
        &project_path,
        &["diff", "--no-ext-diff", "HEAD", "--", &path],
    )?;
    // Repositories without an initial commit have no HEAD; fall back to the working-tree diff.
    if !output.status.success() {
        output = run_git(&project_path, &["diff", "--no-ext-diff", "--", &path])?;
    }
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(test)]
mod tests {
    use super::untracked_file_diff;
    use std::{fs, time::SystemTime};

    fn temp_file(name: &str) -> std::path::PathBuf {
        let suffix = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("claude-desk-{suffix}-{name}"))
    }

    #[test]
    fn renders_untracked_text_and_tolerates_binary_files() {
        let text = temp_file("sample.txt");
        let binary = temp_file("sample.png");
        fs::write(&text, "first\nsecond\n").unwrap();
        fs::write(&binary, [0, 159, 146, 150]).unwrap();

        assert_eq!(untracked_file_diff(&text).unwrap(), "+first\n+second");
        assert_eq!(untracked_file_diff(&binary).unwrap(), "");

        fs::remove_file(text).unwrap();
        fs::remove_file(binary).unwrap();
    }
}
