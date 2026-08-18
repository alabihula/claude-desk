use crate::platform;
use serde::Serialize;
use std::{collections::HashMap, path::Path};
use tokio::time::{timeout, Duration};

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    name: String,
    detail: String,
    status: String,
    message: String,
}

fn strip_ansi(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut characters = value.chars();
    while let Some(character) = characters.next() {
        if character != '\u{1b}' {
            result.push(character);
            continue;
        }
        if characters.next() != Some('[') {
            continue;
        }
        for sequence_character in characters.by_ref() {
            if sequence_character.is_ascii_alphabetic() {
                break;
            }
        }
    }
    result
}

fn status_key(value: &str) -> &'static str {
    let normalized = value.to_ascii_lowercase();
    if value.contains('✘')
        || normalized.contains("failed")
        || normalized.contains("disconnected")
        || normalized.contains("not connected")
    {
        "failed"
    } else if value.contains('⏸') || normalized.contains("pending") {
        "pending"
    } else if normalized.contains("authentication") || normalized.contains("login") {
        "authRequired"
    } else if normalized.contains("disabled") {
        "disabled"
    } else if value.contains('✓') || normalized.contains("connected") {
        "connected"
    } else {
        "unknown"
    }
}

fn parse_server_line(line: &str) -> Option<McpServer> {
    let (identity, state) = line.rsplit_once(" - ")?;
    let (name, detail) = identity.split_once(':')?;
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    let (summary, message) = state
        .split_once(" — ")
        .map(|(summary, message)| (summary, message.trim()))
        .unwrap_or((state, ""));
    Some(McpServer {
        name: name.into(),
        detail: detail.trim().into(),
        status: status_key(summary).into(),
        message: message.into(),
    })
}

fn parse_mcp_list(value: &str) -> Option<Vec<McpServer>> {
    let output = strip_ansi(value);
    if output.contains("No MCP servers configured.") {
        return Some(Vec::new());
    }
    let servers = output
        .lines()
        .filter_map(|line| parse_server_line(line.trim()))
        .collect::<Vec<_>>();
    (!servers.is_empty()).then_some(servers)
}

#[tauri::command]
pub async fn list_mcp_servers(
    project_path: String,
    command: Option<String>,
    env: Option<HashMap<String, String>>,
) -> Result<Vec<McpServer>, String> {
    if !Path::new(&project_path).is_dir() {
        return Err("The selected project directory no longer exists".into());
    }
    let mut environment = platform::login_environment().await;
    if let Some(custom) = env {
        environment.extend(custom);
    }
    let command_name = command
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "claude".into());
    let resolved = platform::resolve_command(&command_name, &environment)
        .ok_or_else(|| format!("Claude Code not found: `{command_name}`"))?;
    platform::ensure_external_command(&resolved)?;

    // MCP health inspection is a bounded background capability and must use
    // the same console-free resolved command path as structured Claude runs.
    let mut list = resolved.command();
    list.current_dir(&project_path)
        .envs(&environment)
        .args(["mcp", "list"])
        .kill_on_drop(true);
    let output = match timeout(Duration::from_secs(30), list.output()).await {
        Ok(result) => result.map_err(|error| format!("Could not inspect MCP servers: {error}"))?,
        Err(_) => return Err("MCP server status check timed out".into()),
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(if message.is_empty() {
            "Claude Code could not list MCP servers".into()
        } else {
            message.into()
        });
    }
    parse_mcp_list(&stdout)
        .ok_or_else(|| "Claude Code returned an unrecognized MCP server list".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_connected_failed_and_pending_servers() {
        let servers = parse_mcp_list(
            "Checking MCP server health…\n\nfilesystem: node server.js /tmp - ✓ Connected\n\
             sentry: https://mcp.example.test (HTTP) - ✘ Failed to connect — Connection refused\n\
             project-tools: node tools.js - ⏸ Pending approval\n",
        )
        .unwrap();
        assert_eq!(
            servers,
            vec![
                McpServer {
                    name: "filesystem".into(),
                    detail: "node server.js /tmp".into(),
                    status: "connected".into(),
                    message: "".into()
                },
                McpServer {
                    name: "sentry".into(),
                    detail: "https://mcp.example.test (HTTP)".into(),
                    status: "failed".into(),
                    message: "Connection refused".into()
                },
                McpServer {
                    name: "project-tools".into(),
                    detail: "node tools.js".into(),
                    status: "pending".into(),
                    message: "".into()
                },
            ]
        );
    }

    #[test]
    fn recognizes_an_empty_configuration() {
        assert_eq!(
            parse_mcp_list("No MCP servers configured. Use `claude mcp add` to add a server."),
            Some(Vec::new())
        );
    }

    #[test]
    fn rejects_unrecognized_success_output_instead_of_hiding_it_as_empty() {
        assert_eq!(parse_mcp_list("MCP status format changed"), None);
    }

    #[test]
    fn does_not_treat_disconnected_text_as_connected() {
        assert_eq!(status_key("Not connected"), "failed");
        assert_eq!(status_key("Disconnected"), "failed");
    }

    #[test]
    fn strips_terminal_color_sequences() {
        let servers =
            parse_mcp_list("\u{1b}[32mfilesystem\u{1b}[0m: node server.js - ✓ Connected").unwrap();
        assert_eq!(servers[0].name, "filesystem");
        assert_eq!(servers[0].status, "connected");
    }
}
