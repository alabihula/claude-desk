use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
};
use uuid::Uuid;

#[derive(Default)]
pub struct ClaudeProcesses {
    running: Mutex<HashMap<String, RunningProcess>>,
}

struct RunningProcess {
    pid: u32,
    run_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeRequest {
    pub conversation_id: String,
    pub session_id: String,
    pub project_path: String,
    pub prompt: String,
    pub resume: bool,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<HashMap<String, String>>,
    pub permission_mode: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ClaudeEvent {
    conversation_id: String,
    run_id: String,
    kind: String,
    data: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeHealth {
    available: bool,
    command: String,
    resolved_path: Option<String>,
    version: Option<String>,
    detected_path: String,
    error: Option<String>,
}

async fn login_environment() -> HashMap<String, String> {
    let mut environment = std::env::vars().collect::<HashMap<_, _>>();
    let output = Command::new("/bin/zsh")
        .args(["-l", "-c", "env -0"])
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
    environment
}

fn resolve_command(command: &str, environment: &HashMap<String, String>) -> Option<PathBuf> {
    let path = PathBuf::from(command);
    if path.components().count() > 1 && path.is_file() {
        return Some(path);
    }
    environment
        .get("PATH")?
        .split(':')
        .map(|directory| Path::new(directory).join(command))
        .find(|candidate| candidate.is_file())
}

#[tauri::command]
pub async fn check_claude(
    command: Option<String>,
    env: Option<HashMap<String, String>>,
) -> Result<ClaudeHealth, String> {
    let command = command
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "claude".into());
    let mut environment = login_environment().await;
    if let Some(custom) = env {
        environment.extend(custom);
    }
    let detected_path = environment.get("PATH").cloned().unwrap_or_default();
    let Some(resolved) = resolve_command(&command, &environment) else {
        return Ok(ClaudeHealth {
            available: false,
            command,
            resolved_path: None,
            version: None,
            detected_path,
            error: Some("Claude Code command was not found in the login shell PATH".into()),
        });
    };
    let output = Command::new(&resolved)
        .arg("--version")
        .envs(&environment)
        .output()
        .await
        .map_err(|error| error.to_string())?;
    let available = output.status.success();
    let version = available.then(|| String::from_utf8_lossy(&output.stdout).trim().to_string());
    let error = (!available).then(|| String::from_utf8_lossy(&output.stderr).trim().to_string());
    Ok(ClaudeHealth {
        available,
        command,
        resolved_path: Some(resolved.to_string_lossy().to_string()),
        version,
        detected_path,
        error,
    })
}

fn emit(app: &AppHandle, conversation_id: &str, run_id: &str, kind: &str, data: Value) {
    let _ = app.emit(
        "claude-event",
        ClaudeEvent {
            conversation_id: conversation_id.into(),
            run_id: run_id.into(),
            kind: kind.into(),
            data,
        },
    );
}

#[tauri::command]
pub async fn send_claude(
    app: AppHandle,
    state: State<'_, ClaudeProcesses>,
    request: ClaudeRequest,
) -> Result<String, String> {
    {
        let running = state
            .running
            .lock()
            .map_err(|_| "Claude process state is unavailable")?;
        if running.contains_key(&request.conversation_id) {
            return Err("Claude is already working in this conversation".into());
        }
    }

    let mut environment = login_environment().await;
    if let Some(custom) = &request.env {
        environment.extend(custom.clone());
    }
    let command_name = request
        .command
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "claude".into());
    let resolved = resolve_command(&command_name, &environment).ok_or_else(|| {
        format!(
            "Claude Code not found: `{command_name}`. Detected PATH: {}",
            environment.get("PATH").cloned().unwrap_or_default()
        )
    })?;
    if !Path::new(&request.project_path).is_dir() {
        return Err("The selected project directory no longer exists".into());
    }

    let permission_mode = request.permission_mode.as_deref().unwrap_or("acceptEdits");
    let allowed_modes = [
        "acceptEdits",
        "auto",
        "manual",
        "dontAsk",
        "plan",
        "bypassPermissions",
    ];
    if !allowed_modes.contains(&permission_mode) {
        return Err("Unsupported Claude permission mode".into());
    }

    let mut command = Command::new(resolved);
    command
        .current_dir(&request.project_path)
        .envs(&environment)
        .args(request.args.clone().unwrap_or_default())
        .args([
            "--print",
            "--input-format",
            "text",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
        ]);
    // Attachments are app-owned copies outside the project working directory.
    let attachment_root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("attachments");
    fs::create_dir_all(&attachment_root).map_err(|error| error.to_string())?;
    command.arg("--add-dir").arg(attachment_root);
    if permission_mode == "bypassPermissions" {
        command.arg("--dangerously-skip-permissions");
    } else {
        command.args(["--permission-mode", permission_mode]);
    }
    if request.resume {
        command.args(["--resume", &request.session_id]);
    } else {
        command.args(["--session-id", &request.session_id]);
    }
    command
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    // A dedicated process group lets Stop terminate Claude and any tool process it launched.
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Claude couldn't start: {error}"))?;
    let pid = child
        .id()
        .ok_or("Claude process did not expose a process id")?;
    let run_id = Uuid::new_v4().to_string();
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(request.prompt.as_bytes())
            .await
            .map_err(|error| error.to_string())?;
        stdin.shutdown().await.map_err(|error| error.to_string())?;
    }
    let stdout = child.stdout.take().ok_or("Claude stdout is unavailable")?;
    let stderr = child.stderr.take().ok_or("Claude stderr is unavailable")?;
    state
        .running
        .lock()
        .map_err(|_| "Claude process state is unavailable")?
        .insert(
            request.conversation_id.clone(),
            RunningProcess {
                pid,
                run_id: run_id.clone(),
            },
        );

    let app_for_task = app.clone();
    let conversation_id = request.conversation_id.clone();
    let run_for_task = run_id.clone();
    tauri::async_runtime::spawn(async move {
        emit(
            &app_for_task,
            &conversation_id,
            &run_for_task,
            "started",
            serde_json::json!({ "pid": pid }),
        );
        let mut stdout_lines = BufReader::new(stdout).lines();
        let mut stderr_lines = BufReader::new(stderr).lines();
        let mut stdout_done = false;
        let mut stderr_done = false;
        while !stdout_done || !stderr_done {
            tokio::select! {
                line = stdout_lines.next_line(), if !stdout_done => match line {
                    Ok(Some(line)) => {
                        let data = serde_json::from_str(&line).unwrap_or_else(|_| serde_json::json!({ "text": line }));
                        emit(&app_for_task, &conversation_id, &run_for_task, "stream", data);
                    }
                    Ok(None) => stdout_done = true,
                    Err(error) => { stdout_done = true; emit(&app_for_task, &conversation_id, &run_for_task, "error", serde_json::json!({ "message": error.to_string() })); }
                },
                line = stderr_lines.next_line(), if !stderr_done => match line {
                    Ok(Some(line)) => emit(&app_for_task, &conversation_id, &run_for_task, "stderr", serde_json::json!({ "message": line })),
                    Ok(None) => stderr_done = true,
                    Err(error) => { stderr_done = true; emit(&app_for_task, &conversation_id, &run_for_task, "error", serde_json::json!({ "message": error.to_string() })); }
                }
            }
        }
        let status = child.wait().await;
        if let Some(state) = app_for_task.try_state::<ClaudeProcesses>() {
            if let Ok(mut running) = state.running.lock() {
                running.remove(&conversation_id);
            }
        }
        match status {
            Ok(status) => emit(
                &app_for_task,
                &conversation_id,
                &run_for_task,
                "exit",
                serde_json::json!({ "success": status.success(), "code": status.code() }),
            ),
            Err(error) => emit(
                &app_for_task,
                &conversation_id,
                &run_for_task,
                "error",
                serde_json::json!({ "message": error.to_string() }),
            ),
        }
    });
    Ok(run_id)
}

#[tauri::command]
pub fn stop_claude(
    state: State<'_, ClaudeProcesses>,
    conversation_id: String,
) -> Result<(), String> {
    let running = state
        .running
        .lock()
        .map_err(|_| "Claude process state is unavailable")?;
    let Some(process) = running.get(&conversation_id) else {
        return Ok(());
    };
    #[cfg(unix)]
    unsafe {
        if libc::kill(-(process.pid as i32), libc::SIGINT) != 0 {
            return Err(format!("Could not stop Claude run {}", process.run_id));
        }
    }
    Ok(())
}
