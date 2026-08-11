use crate::{context, data, platform};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::ChildStdin,
    sync::Mutex as AsyncMutex,
    time::{sleep, Duration},
};
use uuid::Uuid;

#[derive(Default)]
pub struct ClaudeProcesses {
    running: Mutex<HashMap<String, RunningProcess>>,
}

struct RunningProcess {
    pid: u32,
    run_id: String,
    input: Arc<AsyncMutex<Option<ChildStdin>>>,
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

#[tauri::command]
pub async fn check_claude(
    command: Option<String>,
    env: Option<HashMap<String, String>>,
) -> Result<ClaudeHealth, String> {
    let command = command
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "claude".into());
    let mut environment = platform::login_environment().await;
    if let Some(custom) = env {
        environment.extend(custom);
    }
    let detected_path = environment.get("PATH").cloned().unwrap_or_default();
    let Some(resolved) = platform::resolve_command(&command, &environment) else {
        return Ok(ClaudeHealth {
            available: false,
            command,
            resolved_path: None,
            version: None,
            detected_path,
            error: Some("Claude Code command was not found in the detected PATH".into()),
        });
    };
    let output = resolved
        .command()
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
        resolved_path: Some(resolved.path().to_string_lossy().to_string()),
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

async fn write_input(
    input: &Arc<AsyncMutex<Option<ChildStdin>>>,
    message: &Value,
) -> Result<(), String> {
    let mut guard = input.lock().await;
    let stdin = guard
        .as_mut()
        .ok_or("Claude is no longer accepting input")?;
    let mut line = serde_json::to_vec(message).map_err(|error| error.to_string())?;
    line.push(b'\n');
    stdin
        .write_all(&line)
        .await
        .map_err(|error| error.to_string())?;
    stdin.flush().await.map_err(|error| error.to_string())
}

async fn close_input(input: &Arc<AsyncMutex<Option<ChildStdin>>>) {
    let mut guard = input.lock().await;
    if let Some(mut stdin) = guard.take() {
        let _ = stdin.shutdown().await;
    }
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

    let mut environment = platform::login_environment().await;
    if let Some(custom) = &request.env {
        environment.extend(custom.clone());
    }
    let context_config_dir = environment
        .get("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            app.path()
                .home_dir()
                .map(context::default_config_dir)
                .unwrap_or_else(|_| PathBuf::from(".claude"))
        });
    let command_name = request
        .command
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "claude".into());
    let resolved = platform::resolve_command(&command_name, &environment).ok_or_else(|| {
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

    let mut command = resolved.command();
    command
        .current_dir(&request.project_path)
        .envs(&environment)
        .args(request.args.clone().unwrap_or_default())
        .args([
            "--print",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--replay-user-messages",
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
    let input = Arc::new(AsyncMutex::new(Some(
        child.stdin.take().ok_or("Claude stdin is unavailable")?,
    )));
    // Initialize the bidirectional protocol before sending the first user turn.
    write_input(
        &input,
        &serde_json::json!({
            "type": "control_request",
            "request_id": Uuid::new_v4().to_string(),
            "request": { "subtype": "initialize", "hooks": {}, "sdkMcpServers": [] }
        }),
    )
    .await?;
    write_input(
        &input,
        &serde_json::json!({
            "type": "user",
            "message": { "role": "user", "content": request.prompt },
            "parent_tool_use_id": null,
            "uuid": Uuid::new_v4().to_string()
        }),
    )
    .await?;
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
                input: input.clone(),
            },
        );

    let app_for_task = app.clone();
    let conversation_id = request.conversation_id.clone();
    let session_id = request.session_id.clone();
    let run_for_task = run_id.clone();
    let input_for_task = input.clone();
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
        let mut context_window = 0;
        let mut cumulative_tokens = 0;
        while !stdout_done || !stderr_done {
            tokio::select! {
                line = stdout_lines.next_line(), if !stdout_done => match line {
                    Ok(Some(line)) => {
                        let payload = serde_json::from_str(&line).unwrap_or_else(|_| serde_json::json!({ "text": line }));
                        let is_result = payload.get("type").and_then(Value::as_str) == Some("result");
                        if is_result {
                            context_window = context::context_window(payload.get("modelUsage"));
                            cumulative_tokens = context::usage_tokens(payload.get("usage"));
                        }
                        // Successful control responses can contain a large capability payload
                        // that the UI does not render. Only forward normal Claude events.
                        if payload.get("type").and_then(Value::as_str) != Some("control_response") {
                            emit(&app_for_task, &conversation_id, &run_for_task, "stream", payload);
                        }
                        if is_result {
                            close_input(&input_for_task).await;
                        }
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
        let mut context_stats = None;
        for attempt in 0..3 {
            match context::latest_session_usage(&context_config_dir, &session_id) {
                Ok(Some(tokens)) => {
                    let stats = data::ContextStats {
                        conversation_id: conversation_id.clone(),
                        tokens,
                        window: context_window,
                        cumulative_tokens,
                        source: "claude-transcript".into(),
                        updated_at: Utc::now().to_rfc3339(),
                    };
                    if data::save_context_stats(&app_for_task, &stats).is_ok() {
                        context_stats = Some(stats);
                    }
                    break;
                }
                Ok(None) if attempt < 2 => sleep(Duration::from_millis(100)).await,
                Ok(None) | Err(_) => break,
            }
        }
        if context_stats.is_none() && (context_window > 0 || cumulative_tokens > 0) {
            let stats = data::ContextStats {
                conversation_id: conversation_id.clone(),
                tokens: 0,
                window: context_window,
                cumulative_tokens,
                source: "provider-cumulative".into(),
                updated_at: Utc::now().to_rfc3339(),
            };
            if data::save_context_stats(&app_for_task, &stats).is_ok() {
                context_stats = Some(stats);
            }
        }
        if let Some(stats) = context_stats {
            emit(
                &app_for_task,
                &conversation_id,
                &run_for_task,
                "context",
                serde_json::to_value(stats).unwrap_or_else(|_| serde_json::json!({})),
            );
        }
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
pub async fn interrupt_claude(
    state: State<'_, ClaudeProcesses>,
    conversation_id: String,
) -> Result<(), String> {
    let input = {
        let running = state
            .running
            .lock()
            .map_err(|_| "Claude process state is unavailable")?;
        running
            .get(&conversation_id)
            .map(|process| process.input.clone())
            .ok_or("Claude is no longer working in this conversation")?
    };
    write_input(
        &input,
        &serde_json::json!({
            "type": "control_request",
            "request_id": Uuid::new_v4().to_string(),
            "request": { "subtype": "interrupt" }
        }),
    )
    .await
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
    platform::stop_process_tree(process.pid, &process.run_id)
}
