//! Correlated, bounded requests to the MCP client inside an existing Claude run.
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Mutex};
use tokio::sync::oneshot;

#[derive(Default)]
pub struct McpControl {
    pending: Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>,
}

impl McpControl {
    pub fn register(&self, id: String) -> Result<oneshot::Receiver<Result<Value, String>>, String> {
        let (tx, rx) = oneshot::channel();
        let mut pending = self.pending.lock().map_err(|_| "MCP control unavailable")?;
        if pending.len() >= 4 {
            return Err("MCP check already in progress".into());
        }
        pending.insert(id, tx);
        Ok(rx)
    }

    pub fn remove(&self, id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(id);
        }
    }

    pub fn close(&self) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.clear();
        }
    }

    pub fn receive(&self, payload: &Value) {
        if payload["type"] != "control_response" {
            return;
        }
        let response = &payload["response"];
        let Some(id) = response["request_id"].as_str() else {
            return;
        };
        let sender = self
            .pending
            .lock()
            .ok()
            .and_then(|mut pending| pending.remove(id));
        if let Some(sender) = sender {
            let result = if response["subtype"] == "success" {
                Ok(response["response"].clone())
            } else {
                // Do not expose arbitrary CLI output/configuration (which may contain tokens).
                Err("MCP control request rejected; check Claude Code version and server configuration".into())
            };
            let _ = sender.send(result);
        }
    }
}

pub fn server_status(value: &Value) -> Result<Value, String> {
    let servers = value["mcpServers"]
        .as_array()
        .ok_or("Unsupported MCP status response")?;
    let servers: Vec<Value> = servers
        .iter()
        .filter_map(|server| {
            let name = server["name"].as_str()?;
            Some(json!({
                "name": name,
                "status": server["status"].as_str().unwrap_or("unknown"),
                // Older Claude versions omit tools; absence is unknown, NOT zero.
                "toolCount": server["tools"].as_array().map(Vec::len),
                "message": server["error"].as_str().map(crate::diagnostics::redact_line),
            }))
        })
        .collect();
    Ok(json!({ "servers": servers, "source": "live" }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn correlates_responses_and_cancels_on_exit() {
        let control = McpControl::default();
        let first = control.register("one".into()).unwrap();
        let second = control.register("two".into()).unwrap();
        control.receive(&json!({"type":"control_response", "response":{"request_id":"one", "subtype":"success", "response":{"mcpServers":[]}}}));
        assert!(first.await.unwrap().is_ok());
        control.close();
        assert!(second.await.is_err());
        control.receive(&json!({"type":"control_response", "response":{"request_id":"two"}}));
    }

    #[test]
    fn status_distinguishes_missing_tools_and_strips_secrets() {
        let value = server_status(&json!({"mcpServers":[
            {"name":"old", "status":"connected", "config":{"token":"secret"}},
            {"name":"empty", "status":"connected", "tools":[]},
            {"name":"ready", "status":"connected", "tools":[{"name":"read", "description":"private"}]}
        ]})).unwrap();
        assert!(value["servers"][0]["toolCount"].is_null());
        assert_eq!(value["servers"][1]["toolCount"], 0);
        assert_eq!(value["servers"][2]["toolCount"], 1);
        assert!(!value.to_string().contains("secret"));
        assert!(!value.to_string().contains("private"));
        assert!(server_status(&json!({})).is_err());
    }
}
