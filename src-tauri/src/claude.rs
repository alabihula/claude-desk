use crate::{context, data, diagnostics, platform, runtime, skills};
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
    time::{sleep, timeout, Duration},
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
    pending_permissions: Arc<Mutex<HashMap<String, PendingPermission>>>,
}

#[derive(Clone)]
struct PendingPermission {
    input: Value,
    tool_name: String,
}

#[derive(Debug, PartialEq, Eq)]
enum ControlRequestDisposition {
    Question,
    AutoApprove,
    Prompt,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PermissionDecision {
    Deny,
    AllowOnce,
    AllowSessionTool,
    AllowProjectTool,
    AllowProjectServer,
    AllowUserTool,
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
    pub skill_path: Option<String>,
    pub model: Option<String>,
    pub context_model: Option<String>,
    pub effort: Option<String>,
    pub operation: Option<String>,
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
    if let Err(error) = platform::ensure_external_command(&resolved) {
        return Ok(ClaudeHealth {
            available: false,
            command,
            resolved_path: Some(resolved.path().to_string_lossy().to_string()),
            version: None,
            detected_path,
            error: Some(error),
        });
    }
    let mut version_command = resolved.command();
    version_command
        .arg("--version")
        .envs(&environment)
        .kill_on_drop(true);
    let output = match timeout(Duration::from_secs(8), version_command.output()).await {
        Ok(result) => result.map_err(|error| error.to_string())?,
        Err(_) => {
            return Ok(ClaudeHealth {
                available: false,
                command,
                resolved_path: Some(resolved.path().to_string_lossy().to_string()),
                version: None,
                detected_path,
                error: Some("Claude Code version check timed out".into()),
            });
        }
    };
    let version_text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let available =
        output.status.success() && version_text.to_ascii_lowercase().contains("claude code");
    let version = available.then_some(version_text);
    let error = (!available).then(|| {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            "The resolved command did not identify itself as Claude Code".into()
        } else {
            stderr
        }
    });
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

fn permission_request(payload: &Value) -> Option<(String, PendingPermission, Value)> {
    if payload.get("type").and_then(Value::as_str) != Some("control_request") {
        return None;
    }
    let request = payload.get("request")?;
    if request.get("subtype").and_then(Value::as_str) != Some("can_use_tool") {
        return None;
    }
    let request_id = payload.get("request_id")?.as_str()?.to_string();
    let input = request
        .get("input")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let tool_name = request
        .get("tool_name")
        .and_then(Value::as_str)
        .unwrap_or("Tool")
        .to_string();
    let event = serde_json::json!({
        "requestId": request_id,
        "toolName": tool_name,
        "displayName": request.get("display_name").and_then(Value::as_str),
        "description": request.get("description").and_then(Value::as_str),
        "decisionReasonType": request.get("decision_reason_type").and_then(Value::as_str),
        "toolUseId": request.get("tool_use_id").and_then(Value::as_str),
        "input": input.clone(),
    });
    Some((request_id, PendingPermission { input, tool_name }, event))
}

fn control_request_disposition(
    request: &PendingPermission,
    auto_approve_tools: bool,
) -> ControlRequestDisposition {
    if request.tool_name == "AskUserQuestion" {
        ControlRequestDisposition::Question
    } else if auto_approve_tools {
        ControlRequestDisposition::AutoApprove
    } else {
        ControlRequestDisposition::Prompt
    }
}

fn mcp_server_rule(tool_name: &str) -> Option<String> {
    let (server, action) = tool_name.strip_prefix("mcp__")?.split_once("__")?;
    (!server.is_empty() && !action.is_empty()).then(|| format!("mcp__{server}__*"))
}

fn permission_update(
    permission: &PendingPermission,
    decision: PermissionDecision,
) -> Result<Option<Value>, String> {
    let destination = match decision {
        PermissionDecision::AllowSessionTool => "session",
        PermissionDecision::AllowProjectTool | PermissionDecision::AllowProjectServer => {
            "localSettings"
        }
        PermissionDecision::AllowUserTool => "userSettings",
        PermissionDecision::Deny | PermissionDecision::AllowOnce => return Ok(None),
    };
    if !permission.tool_name.starts_with("mcp__") {
        return Err("Persistent approval is currently limited to MCP tools".into());
    }
    let tool_name = if decision == PermissionDecision::AllowProjectServer {
        mcp_server_rule(&permission.tool_name).ok_or("The MCP server name is invalid")?
    } else {
        permission.tool_name.clone()
    };
    Ok(Some(serde_json::json!({
        "type": "addRules",
        "rules": [{ "toolName": tool_name }],
        "behavior": "allow",
        "destination": destination,
    })))
}

fn permission_response(
    request_id: &str,
    permission: &PendingPermission,
    decision: PermissionDecision,
) -> Result<Value, String> {
    let response = if decision == PermissionDecision::Deny {
        serde_json::json!({
            "behavior": "deny",
            "message": "The user denied this tool request in Claude Desk.",
            "interrupt": false,
        })
    } else {
        let mut response = serde_json::json!({
            "behavior": "allow",
            "updatedInput": permission.input,
        });
        if let Some(update) = permission_update(permission, decision)? {
            response["updatedPermissions"] = serde_json::json!([update]);
        }
        response
    };
    Ok(serde_json::json!({
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": request_id,
            "response": response,
        }
    }))
}

fn question_response(
    request_id: &str,
    request: &PendingPermission,
    answers: HashMap<String, String>,
    cancelled: bool,
) -> Result<Value, String> {
    if request.tool_name != "AskUserQuestion" {
        return Err("This request is not a Claude question".into());
    }
    let response = if cancelled {
        serde_json::json!({
            "behavior": "deny",
            "message": "The user chose not to answer this question in Claude Desk.",
            "interrupt": false,
        })
    } else {
        let questions = request
            .input
            .get("questions")
            .and_then(Value::as_array)
            .ok_or("Claude sent an invalid question request")?;
        if questions.is_empty() || questions.len() > 4 {
            return Err("Claude sent an unsupported number of questions".into());
        }
        for question in questions {
            let prompt = question
                .get("question")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or("Claude sent a question without prompt text")?;
            if answers
                .get(prompt)
                .is_none_or(|answer| answer.trim().is_empty())
            {
                return Err("Every Claude question requires an answer".into());
            }
        }
        let mut updated_input = request.input.clone();
        let input = updated_input
            .as_object_mut()
            .ok_or("Claude sent an invalid question input")?;
        input.insert(
            "answers".into(),
            serde_json::to_value(answers).map_err(|error| error.to_string())?,
        );
        serde_json::json!({
            "behavior": "allow",
            "updatedInput": updated_input,
        })
    };
    Ok(serde_json::json!({
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": request_id,
            "response": response,
        }
    }))
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
    platform::ensure_external_command(&resolved)?;
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
    let operation = request.operation.as_deref().unwrap_or("chat");
    if !["chat", "compact"].contains(&operation) {
        return Err("Unsupported Claude operation".into());
    }

    let model = runtime::normalize_model(request.model.as_deref())?;
    let context_model = request.context_model.as_deref().unwrap_or_default().trim();
    runtime::normalize_model(Some(context_model))?;
    let context_model = context_model.to_string();
    let effort = runtime::normalize_effort(request.effort.as_deref())?;
    let runtime_args = runtime::with_runtime_overrides(
        request.args.clone().unwrap_or_default(),
        model.as_deref(),
        effort.as_deref(),
    );
    let mut command = resolved.command();
    command
        .current_dir(&request.project_path)
        .envs(&environment)
        .args(runtime_args)
        .args([
            "--print",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--replay-user-messages",
            "--permission-prompt-tool",
            "stdio",
        ]);
    if let Some(skill_path) = request.skill_path.as_deref() {
        // External Codex skills are shown only when the backend can still
        // resolve them from an enabled source at dispatch time.
        let skill_dir = skills::resolve_external_skill(
            &app,
            Path::new(&request.project_path),
            Path::new(skill_path),
        )?;
        command.arg("--add-dir").arg(skill_dir);
    }
    // Attachments are app-owned copies outside the project working directory.
    let attachment_root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("attachments");
    fs::create_dir_all(&attachment_root).map_err(|error| error.to_string())?;
    command.arg("--add-dir").arg(attachment_root);
    // Claude's native bypass mode also auto-answers AskUserQuestion with the
    // first option. Keep the callback channel active and auto-approve only
    // ordinary tool requests so product questions still reach the user.
    let auto_approve_tools = permission_mode == "bypassPermissions";
    let effective_permission_mode = if auto_approve_tools {
        "acceptEdits"
    } else {
        permission_mode
    };
    command.args(["--permission-mode", effective_permission_mode]);
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
    let mut run_diagnostics = diagnostics::RunDiagnostics::new(
        &app,
        diagnostics::RunContext {
            conversation_id: &request.conversation_id,
            run_id: &run_id,
            session_id: &request.session_id,
            resumed: request.resume,
            model: model.clone(),
            effort: effort.clone(),
            permission_mode,
            operation,
        },
    );
    let input = Arc::new(AsyncMutex::new(Some(
        child.stdin.take().ok_or("Claude stdin is unavailable")?,
    )));
    let pending_permissions = Arc::new(Mutex::new(HashMap::new()));
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
                pending_permissions: pending_permissions.clone(),
            },
        );

    let app_for_task = app.clone();
    let conversation_id = request.conversation_id.clone();
    let session_id = request.session_id.clone();
    let run_for_task = run_id.clone();
    let input_for_task = input.clone();
    let permissions_for_task = pending_permissions.clone();
    let context_model_for_task = context_model.clone();
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
                        let parsed = serde_json::from_str(&line);
                        let valid_json = parsed.is_ok();
                        let payload = parsed.unwrap_or_else(|_| serde_json::json!({ "text": line }));
                        run_diagnostics.observe_stdout(&line, &payload, valid_json);
                        if let Some((request_id, permission, event)) = permission_request(&payload) {
                            let disposition = control_request_disposition(&permission, auto_approve_tools);
                            if disposition == ControlRequestDisposition::AutoApprove {
                                match permission_response(&request_id, &permission, PermissionDecision::AllowOnce) {
                                    Ok(response) => {
                                        if let Err(error) = write_input(&input_for_task, &response).await {
                                            emit(&app_for_task, &conversation_id, &run_for_task, "error", serde_json::json!({ "message": error }));
                                            close_input(&input_for_task).await;
                                        }
                                    }
                                    Err(error) => emit(&app_for_task, &conversation_id, &run_for_task, "error", serde_json::json!({ "message": error })),
                                }
                                continue;
                            }
                            if let Ok(mut pending) = permissions_for_task.lock() {
                                pending.insert(request_id, permission);
                            }
                            emit(
                                &app_for_task,
                                &conversation_id,
                                &run_for_task,
                                if disposition == ControlRequestDisposition::Question { "question" } else { "permission" },
                                event,
                            );
                            continue;
                        }
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
                    Ok(Some(line)) => {
                        run_diagnostics.observe_stderr(&line);
                        emit(&app_for_task, &conversation_id, &run_for_task, "stderr", serde_json::json!({ "message": line }));
                    }
                    Ok(None) => stderr_done = true,
                    Err(error) => { stderr_done = true; emit(&app_for_task, &conversation_id, &run_for_task, "error", serde_json::json!({ "message": error.to_string() })); }
                }
            }
        }
        let status = child.wait().await;
        let previous_context = data::read_context_stats(&app_for_task, &conversation_id)
            .ok()
            .flatten();
        // Slash-command results commonly omit modelUsage and run-level usage.
        // Keep the last known metadata instead of making the context meter regress.
        let effective_context_window = context::context_window_for_model(
            context_window,
            previous_context
                .as_ref()
                .map(|stats| stats.window)
                .unwrap_or(0),
            previous_context
                .as_ref()
                .map(|stats| stats.model.as_str())
                .unwrap_or_default(),
            &context_model_for_task,
        );
        let effective_cumulative_tokens = if cumulative_tokens > 0 {
            cumulative_tokens
        } else {
            previous_context
                .as_ref()
                .map(|stats| stats.cumulative_tokens)
                .unwrap_or(0)
        };
        let mut context_stats = None;
        let mut model_windows = previous_context
            .as_ref()
            .map(|stats| stats.model_windows.clone())
            .unwrap_or_default();
        if !context_model_for_task.is_empty() && effective_context_window > 0 {
            model_windows.insert(context_model_for_task.clone(), effective_context_window);
        }
        for attempt in 0..3 {
            match context::latest_session_usage(&context_config_dir, &session_id) {
                Ok(Some(tokens)) => {
                    let stats = data::ContextStats {
                        conversation_id: conversation_id.clone(),
                        tokens,
                        window: effective_context_window,
                        cumulative_tokens: effective_cumulative_tokens,
                        source: "claude-transcript".into(),
                        model: context_model_for_task.clone(),
                        model_windows: model_windows.clone(),
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
                window: effective_context_window,
                cumulative_tokens: effective_cumulative_tokens,
                source: "provider-cumulative".into(),
                model: context_model_for_task,
                model_windows,
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
            Ok(status) => {
                run_diagnostics.finish(status.success(), status.code(), None);
                let _ = diagnostics::save(&app_for_task, &run_diagnostics);
                emit(
                    &app_for_task,
                    &conversation_id,
                    &run_for_task,
                    "exit",
                    serde_json::json!({ "success": status.success(), "code": status.code() }),
                );
            }
            Err(error) => {
                run_diagnostics.finish(false, None, Some(&error.to_string()));
                let _ = diagnostics::save(&app_for_task, &run_diagnostics);
                emit(
                    &app_for_task,
                    &conversation_id,
                    &run_for_task,
                    "error",
                    serde_json::json!({ "message": error.to_string() }),
                );
                emit(
                    &app_for_task,
                    &conversation_id,
                    &run_for_task,
                    "exit",
                    serde_json::json!({ "success": false, "code": null }),
                );
            }
        }
    });
    Ok(run_id)
}

#[tauri::command]
pub async fn respond_claude_permission(
    state: State<'_, ClaudeProcesses>,
    conversation_id: String,
    run_id: String,
    request_id: String,
    decision: PermissionDecision,
) -> Result<(), String> {
    let (input, pending_permissions) = {
        let running = state
            .running
            .lock()
            .map_err(|_| "Claude process state is unavailable")?;
        let process = running
            .get(&conversation_id)
            .ok_or("Claude is no longer waiting for this permission")?;
        if process.run_id != run_id {
            return Err("This permission request belongs to an older Claude run".into());
        }
        (process.input.clone(), process.pending_permissions.clone())
    };
    // Taking the request before the async write makes repeated button clicks idempotent.
    let permission = {
        let mut pending = pending_permissions
            .lock()
            .map_err(|_| "Claude permission state is unavailable")?;
        let permission = pending
            .get(&request_id)
            .ok_or("This permission request is no longer pending")?;
        if permission.tool_name == "AskUserQuestion" {
            return Err("Claude questions require a structured answer".into());
        }
        pending
            .remove(&request_id)
            .expect("pending request disappeared")
    };
    let response = permission_response(&request_id, &permission, decision)?;
    write_input(&input, &response).await
}

#[tauri::command]
pub async fn respond_claude_question(
    state: State<'_, ClaudeProcesses>,
    conversation_id: String,
    run_id: String,
    request_id: String,
    answers: HashMap<String, String>,
    cancelled: bool,
) -> Result<(), String> {
    let (input, pending_permissions) = {
        let running = state
            .running
            .lock()
            .map_err(|_| "Claude process state is unavailable")?;
        let process = running
            .get(&conversation_id)
            .ok_or("Claude is no longer waiting for this answer")?;
        if process.run_id != run_id {
            return Err("This question belongs to an older Claude run".into());
        }
        (process.input.clone(), process.pending_permissions.clone())
    };
    let response = {
        let mut pending = pending_permissions
            .lock()
            .map_err(|_| "Claude question state is unavailable")?;
        let request = pending
            .get(&request_id)
            .ok_or("This question is no longer pending")?;
        if request.tool_name != "AskUserQuestion" {
            return Err("This request requires a permission decision".into());
        }
        let response = question_response(&request_id, request, answers, cancelled)?;
        pending
            .remove(&request_id)
            .expect("pending question disappeared");
        response
    };
    write_input(&input, &response).await
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

#[cfg(test)]
mod tests {
    use super::{
        control_request_disposition, permission_request, permission_response, question_response,
        ControlRequestDisposition, PendingPermission, PermissionDecision,
    };
    use serde_json::json;
    use std::collections::HashMap;

    #[test]
    fn extracts_tool_permission_requests_for_the_product_ui() {
        let payload = json!({
            "type": "control_request",
            "request_id": "permission-1",
            "request": {
                "subtype": "can_use_tool",
                "tool_name": "mcp__github__create_issue",
                "display_name": "Create issue",
                "input": { "title": "Bug" },
                "description": "Create an issue",
                "tool_use_id": "tool-1"
            }
        });
        let (request_id, pending, event) = permission_request(&payload).unwrap();

        assert_eq!(request_id, "permission-1");
        assert_eq!(pending.input, json!({ "title": "Bug" }));
        assert_eq!(pending.tool_name, "mcp__github__create_issue");
        assert_eq!(event["toolName"], "mcp__github__create_issue");
        assert_eq!(event["requestId"], "permission-1");
    }

    #[test]
    fn preserves_questions_while_auto_approving_full_access_tools() {
        let question = PendingPermission {
            tool_name: "AskUserQuestion".into(),
            input: json!({}),
        };
        let command = PendingPermission {
            tool_name: "Bash".into(),
            input: json!({}),
        };
        assert_eq!(
            control_request_disposition(&question, true),
            ControlRequestDisposition::Question
        );
        assert_eq!(
            control_request_disposition(&command, true),
            ControlRequestDisposition::AutoApprove
        );
        assert_eq!(
            control_request_disposition(&command, false),
            ControlRequestDisposition::Prompt
        );
    }

    #[test]
    fn builds_allow_and_deny_control_responses() {
        let (_, permission, _) = permission_request(&json!({
            "type": "control_request",
            "request_id": "permission-1",
            "request": { "subtype": "can_use_tool", "input": { "path": "README.md" } }
        }))
        .unwrap();

        let allow = permission_response("permission-1", &permission, PermissionDecision::AllowOnce)
            .unwrap();
        assert_eq!(allow["response"]["response"]["behavior"], "allow");
        assert_eq!(
            allow["response"]["response"]["updatedInput"]["path"],
            "README.md"
        );
        let deny =
            permission_response("permission-1", &permission, PermissionDecision::Deny).unwrap();
        assert_eq!(deny["response"]["response"]["behavior"], "deny");
        assert_eq!(deny["response"]["response"]["interrupt"], false);
    }

    #[test]
    fn builds_structured_question_answers_and_cancellation() {
        let (_, request, _) = permission_request(&json!({
            "type": "control_request",
            "request_id": "question-1",
            "request": {
                "subtype": "can_use_tool",
                "tool_name": "AskUserQuestion",
                "input": {
                    "questions": [{
                        "question": "Which framework?",
                        "header": "Framework",
                        "options": [
                            { "label": "Vue", "description": "Use Vue" },
                            { "label": "React", "description": "Use React" }
                        ],
                        "multiSelect": false
                    }]
                }
            }
        }))
        .unwrap();
        let answers = HashMap::from([("Which framework?".into(), "Vue".into())]);
        let answered = question_response("question-1", &request, answers, false).unwrap();
        assert_eq!(
            answered["response"]["response"]["updatedInput"]["answers"]["Which framework?"],
            "Vue"
        );

        let cancelled = question_response("question-1", &request, HashMap::new(), true).unwrap();
        assert_eq!(cancelled["response"]["response"]["behavior"], "deny");
        assert_eq!(cancelled["response"]["response"]["interrupt"], false);
    }

    #[test]
    fn rejects_incomplete_structured_question_answers() {
        let request = PendingPermission {
            tool_name: "AskUserQuestion".into(),
            input: json!({ "questions": [{ "question": "Choose one" }] }),
        };
        assert!(question_response("question-1", &request, HashMap::new(), false).is_err());
    }

    #[test]
    fn scopes_persistent_mcp_permissions_without_frontend_rule_input() {
        let (_, permission, _) = permission_request(&json!({
            "type": "control_request",
            "request_id": "permission-1",
            "request": {
                "subtype": "can_use_tool",
                "tool_name": "mcp__github__create_issue",
                "input": { "title": "Bug" }
            }
        }))
        .unwrap();

        let project_tool = permission_response(
            "permission-1",
            &permission,
            PermissionDecision::AllowProjectTool,
        )
        .unwrap();
        let update = &project_tool["response"]["response"]["updatedPermissions"][0];
        assert_eq!(update["destination"], "localSettings");
        assert_eq!(update["rules"][0]["toolName"], "mcp__github__create_issue");

        let session_tool = permission_response(
            "permission-1",
            &permission,
            PermissionDecision::AllowSessionTool,
        )
        .unwrap();
        assert_eq!(
            session_tool["response"]["response"]["updatedPermissions"][0]["destination"],
            "session"
        );

        let project_server = permission_response(
            "permission-1",
            &permission,
            PermissionDecision::AllowProjectServer,
        )
        .unwrap();
        assert_eq!(
            project_server["response"]["response"]["updatedPermissions"][0]["rules"][0]["toolName"],
            "mcp__github__*"
        );

        let global_tool = permission_response(
            "permission-1",
            &permission,
            PermissionDecision::AllowUserTool,
        )
        .unwrap();
        assert_eq!(
            global_tool["response"]["response"]["updatedPermissions"][0]["destination"],
            "userSettings"
        );
    }

    #[test]
    fn refuses_to_persist_broad_non_mcp_rules() {
        let permission = PendingPermission {
            input: json!({ "command": "pnpm test" }),
            tool_name: "Bash".into(),
        };
        assert!(permission_response(
            "permission-1",
            &permission,
            PermissionDecision::AllowProjectTool,
        )
        .is_err());
    }

    #[test]
    fn deserializes_only_known_permission_decisions() {
        assert_eq!(
            serde_json::from_value::<PermissionDecision>(json!("allowProjectTool")).unwrap(),
            PermissionDecision::AllowProjectTool
        );
        assert!(serde_json::from_value::<PermissionDecision>(json!("allowEverything")).is_err());
    }

    #[test]
    fn ignores_unrelated_control_messages() {
        assert!(permission_request(&json!({
            "type": "control_request",
            "request_id": "interrupt-1",
            "request": { "subtype": "interrupt" }
        }))
        .is_none());
    }
}
