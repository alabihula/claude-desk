use chrono::Utc;
use serde::Serialize;
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const MAX_STDERR_LINES: usize = 40;
const MAX_LINE_CHARS: usize = 800;
const MAX_RUNS_PER_CONVERSATION: usize = 20;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamSummary {
    stdout_lines: u64,
    invalid_json_lines: u64,
    assistant_frames: u64,
    stream_events: u64,
    text_delta_count: u64,
    text_delta_chars: u64,
    assistant_text_blocks: u64,
    assistant_text_chars: u64,
    thinking_blocks: u64,
    tool_uses: u64,
    result_seen: bool,
    result_is_error: bool,
    result_value_type: String,
    result_text_chars: u64,
    result_error: Option<String>,
    result_subtype: String,
    result_num_turns: Option<u64>,
    result_stop_reason: Option<String>,
    terminal_reason: Option<String>,
    compact_result: String,
    compact_error: Option<String>,
    claude_code_version: Option<String>,
    resolved_model: Option<String>,
    other_event_types: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDiagnostics {
    schema_version: u8,
    app_version: String,
    platform: &'static str,
    architecture: &'static str,
    started_at: String,
    completed_at: Option<String>,
    conversation_id: String,
    run_id: String,
    session_id: String,
    resumed: bool,
    model: Option<String>,
    effort: Option<String>,
    permission_mode: String,
    operation: String,
    stream: StreamSummary,
    stderr: Vec<String>,
    exit_success: Option<bool>,
    exit_code: Option<i32>,
    wait_error: Option<String>,
}

pub struct RunContext<'a> {
    pub conversation_id: &'a str,
    pub run_id: &'a str,
    pub session_id: &'a str,
    pub resumed: bool,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub permission_mode: &'a str,
    pub operation: &'a str,
}

impl RunDiagnostics {
    pub fn new(app: &AppHandle, context: RunContext<'_>) -> Self {
        Self {
            schema_version: 2,
            app_version: app.package_info().version.to_string(),
            platform: std::env::consts::OS,
            architecture: std::env::consts::ARCH,
            started_at: Utc::now().to_rfc3339(),
            completed_at: None,
            conversation_id: context.conversation_id.into(),
            run_id: context.run_id.into(),
            session_id: context.session_id.into(),
            resumed: context.resumed,
            model: context.model,
            effort: context.effort,
            permission_mode: context.permission_mode.into(),
            operation: context.operation.into(),
            stream: StreamSummary::default(),
            stderr: Vec::new(),
            exit_success: None,
            exit_code: None,
            wait_error: None,
        }
    }

    pub fn observe_stdout(&mut self, line: &str, payload: &Value, valid_json: bool) {
        self.stream.stdout_lines += 1;
        if !valid_json {
            self.stream.invalid_json_lines += 1;
            return;
        }
        let event_type = payload
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        match event_type {
            "assistant" => self.observe_assistant(payload),
            "stream_event" => self.observe_stream_event(payload),
            "result" => self.observe_result(payload),
            "system" => self.observe_system(payload),
            "control_request" | "control_response" | "user" => {}
            other
                if !self
                    .stream
                    .other_event_types
                    .iter()
                    .any(|value| value == other) =>
            {
                self.stream.other_event_types.push(other.to_string());
            }
            _ => {}
        }
        let _ = line; // Deliberately never persist raw stdout or conversation content.
    }

    fn observe_assistant(&mut self, payload: &Value) {
        self.stream.assistant_frames += 1;
        for block in payload
            .pointer("/message/content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            match block.get("type").and_then(Value::as_str) {
                Some("text") => {
                    self.stream.assistant_text_blocks += 1;
                    self.stream.assistant_text_chars += string_chars(block.get("text"));
                }
                Some("thinking") | Some("redacted_thinking") => self.stream.thinking_blocks += 1,
                Some("tool_use") => self.stream.tool_uses += 1,
                _ => {}
            }
        }
    }

    fn observe_stream_event(&mut self, payload: &Value) {
        self.stream.stream_events += 1;
        let event = payload.get("event").unwrap_or(&Value::Null);
        if event.pointer("/delta/type").and_then(Value::as_str) == Some("text_delta") {
            self.stream.text_delta_count += 1;
            self.stream.text_delta_chars += string_chars(event.pointer("/delta/text"));
        }
        if event.get("type").and_then(Value::as_str) == Some("content_block_start") {
            match event.pointer("/content_block/type").and_then(Value::as_str) {
                Some("thinking") | Some("redacted_thinking") => self.stream.thinking_blocks += 1,
                Some("tool_use") => self.stream.tool_uses += 1,
                _ => {}
            }
        }
    }

    fn observe_result(&mut self, payload: &Value) {
        self.stream.result_seen = true;
        self.stream.result_is_error = payload
            .get("is_error")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        self.stream.result_value_type = value_type(payload.get("result")).into();
        self.stream.result_text_chars = string_chars(payload.get("result"));
        self.stream.result_error = payload
            .get("error")
            .and_then(Value::as_str)
            .map(redact_line);
        self.stream.result_subtype = payload
            .get("subtype")
            .and_then(Value::as_str)
            .unwrap_or("")
            .into();
        self.stream.result_num_turns = payload.get("num_turns").and_then(Value::as_u64);
        self.stream.result_stop_reason = payload
            .get("stop_reason")
            .and_then(Value::as_str)
            .map(str::to_owned);
        self.stream.terminal_reason = payload
            .get("terminal_reason")
            .and_then(Value::as_str)
            .map(str::to_owned);
    }

    fn observe_system(&mut self, payload: &Value) {
        match payload.get("subtype").and_then(Value::as_str) {
            Some("init") => {
                self.stream.claude_code_version = payload
                    .get("claude_code_version")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                self.stream.resolved_model = payload
                    .get("model")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
            }
            Some("status") if payload.get("compact_result").is_some() => {
                self.stream.compact_result = payload
                    .get("compact_result")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .into();
                self.stream.compact_error = payload
                    .get("compact_error")
                    .and_then(Value::as_str)
                    .map(redact_line);
            }
            _ => {}
        }
    }

    pub fn observe_stderr(&mut self, line: &str) {
        if self.stderr.len() < MAX_STDERR_LINES {
            self.stderr.push(redact_line(line));
        }
    }

    pub fn finish(&mut self, success: bool, code: Option<i32>, wait_error: Option<&str>) {
        self.completed_at = Some(Utc::now().to_rfc3339());
        self.exit_success = Some(success);
        self.exit_code = code;
        self.wait_error = wait_error.map(redact_line);
    }
}

fn string_chars(value: Option<&Value>) -> u64 {
    value
        .and_then(Value::as_str)
        .map(|text| text.chars().count() as u64)
        .unwrap_or(0)
}

fn value_type(value: Option<&Value>) -> &'static str {
    match value {
        None => "missing",
        Some(Value::Null) => "null",
        Some(Value::Bool(_)) => "boolean",
        Some(Value::Number(_)) => "number",
        Some(Value::String(_)) => "string",
        Some(Value::Array(_)) => "array",
        Some(Value::Object(_)) => "object",
    }
}

fn redact_line(line: &str) -> String {
    let mut redacted = line.chars().take(MAX_LINE_CHARS).collect::<String>();
    if let Some(home) = dirs::home_dir().and_then(|path| path.to_str().map(str::to_owned)) {
        redacted = redacted.replace(&home, "<HOME>");
        redacted = redacted.replace(&home.replace('\\', "/"), "<HOME>");
    }
    for marker in [
        "sk-ant-",
        "Bearer ",
        "ANTHROPIC_API_KEY=",
        "ANTHROPIC_AUTH_TOKEN=",
    ] {
        redact_after_marker(&mut redacted, marker);
    }
    redacted
}

fn redact_after_marker(value: &mut String, marker: &str) {
    let mut search_from = 0;
    while let Some(offset) = value[search_from..].find(marker) {
        let secret_start = search_from + offset + marker.len();
        let secret_end = value[secret_start..]
            .find(|character: char| {
                character.is_whitespace() || matches!(character, '"' | '\'' | ',')
            })
            .map(|end| secret_start + end)
            .unwrap_or(value.len());
        value.replace_range(secret_start..secret_end, "<REDACTED>");
        search_from = secret_start + "<REDACTED>".len();
    }
}

fn safe_id(value: &str) -> Result<&str, String> {
    if !value.is_empty()
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        Ok(value)
    } else {
        Err("Invalid diagnostic identifier".into())
    }
}

fn diagnostics_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("diagnostics"))
}

pub fn save(app: &AppHandle, diagnostics: &RunDiagnostics) -> Result<(), String> {
    let conversation_id = safe_id(&diagnostics.conversation_id)?;
    let run_id = safe_id(&diagnostics.run_id)?;
    let directory = diagnostics_root(app)?.join(conversation_id);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let content = serde_json::to_vec_pretty(diagnostics).map_err(|error| error.to_string())?;
    fs::write(directory.join(format!("{run_id}.json")), content)
        .map_err(|error| error.to_string())?;
    prune_old_runs(&directory)
}

fn prune_old_runs(directory: &Path) -> Result<(), String> {
    let mut files = fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().and_then(|value| value.to_str()) == Some("json"))
        .collect::<Vec<_>>();
    files.sort_by_key(|entry| {
        entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
    });
    let remove_count = files.len().saturating_sub(MAX_RUNS_PER_CONVERSATION);
    for entry in files.into_iter().take(remove_count) {
        fs::remove_file(entry.path()).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn export_run_diagnostic(
    app: AppHandle,
    conversation_id: String,
    run_id: String,
    destination_path: String,
) -> Result<(), String> {
    let source = diagnostics_root(&app)?
        .join(safe_id(&conversation_id)?)
        .join(format!("{}.json", safe_id(&run_id)?));
    if !source.is_file() {
        return Err("The diagnostic record for this run is unavailable".into());
    }
    let destination = PathBuf::from(destination_path);
    if destination == source {
        return Err("Choose a different destination for the diagnostic export".into());
    }
    fs::copy(source, destination)
        .map(|_| ())
        .map_err(|error| format!("Could not export diagnostic record: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{redact_line, value_type, RunDiagnostics};
    use serde_json::json;

    #[test]
    fn summarizes_text_without_persisting_content() {
        let mut diagnostics = RunDiagnostics {
            schema_version: 1,
            app_version: "test".into(),
            platform: "test",
            architecture: "test",
            started_at: "now".into(),
            completed_at: None,
            conversation_id: "conversation-1".into(),
            run_id: "run-1".into(),
            session_id: "session-1".into(),
            resumed: false,
            model: None,
            effort: None,
            permission_mode: "acceptEdits".into(),
            operation: "chat".into(),
            stream: Default::default(),
            stderr: vec![],
            exit_success: None,
            exit_code: None,
            wait_error: None,
        };
        let payload = json!({
            "type": "assistant",
            "message": { "content": [{ "type": "text", "text": "private source code" }] }
        });
        diagnostics.observe_stdout("private source code", &payload, true);
        let serialized = serde_json::to_string(&diagnostics).unwrap();

        assert!(serialized.contains("assistantTextChars\":19"));
        assert!(!serialized.contains("private source code"));
    }

    #[test]
    fn records_runtime_and_compaction_outcomes_without_raw_content() {
        let mut diagnostics = RunDiagnostics {
            schema_version: 2,
            app_version: "test".into(),
            platform: "test",
            architecture: "test",
            started_at: "now".into(),
            completed_at: None,
            conversation_id: "conversation-1".into(),
            run_id: "run-1".into(),
            session_id: "session-1".into(),
            resumed: true,
            model: Some("sonnet[1m]".into()),
            effort: Some("medium".into()),
            permission_mode: "acceptEdits".into(),
            operation: "compact".into(),
            stream: Default::default(),
            stderr: vec![],
            exit_success: None,
            exit_code: None,
            wait_error: None,
        };
        diagnostics.observe_stdout(
            "init",
            &json!({ "type": "system", "subtype": "init", "claude_code_version": "2.1.224", "model": "claude-sonnet-5[1m]" }),
            true,
        );
        diagnostics.observe_stdout(
            "status",
            &json!({ "type": "system", "subtype": "status", "compact_result": "failed", "compact_error": "Not enough messages to compact." }),
            true,
        );
        diagnostics.observe_stdout(
            "result",
            &json!({ "type": "result", "subtype": "success", "result": "", "num_turns": 0, "terminal_reason": "completed" }),
            true,
        );

        let value = serde_json::to_value(&diagnostics).unwrap();
        assert_eq!(value["operation"], "compact");
        assert_eq!(value["stream"]["claudeCodeVersion"], "2.1.224");
        assert_eq!(value["stream"]["resolvedModel"], "claude-sonnet-5[1m]");
        assert_eq!(value["stream"]["compactResult"], "failed");
        assert_eq!(value["stream"]["resultNumTurns"], 0);
    }

    #[test]
    fn redacts_common_credentials_and_bounds_stderr() {
        let redacted =
            redact_line("Bearer secret-token ANTHROPIC_API_KEY=abc123 Bearer another-token");
        assert_eq!(
            redacted,
            "Bearer <REDACTED> ANTHROPIC_API_KEY=<REDACTED> Bearer <REDACTED>"
        );
        assert_eq!(value_type(Some(&json!({}))), "object");
        assert_eq!(value_type(None), "missing");
    }
}
