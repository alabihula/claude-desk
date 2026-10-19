//! Only process configuration controls transport reuse; turns do not.
use crate::claude::ClaudeRequest;
use serde_json::Value;
use std::{fs, path::Path};

// A missing skill on a later turn does not revoke a directory already granted
// to this conversation. A new explicit skill still requires backend validation.
pub fn compatible(existing: &Value, requested: &Value) -> bool {
    let mut requested = requested.clone();
    if requested["skillPath"].is_null() {
        requested["skillPath"] = existing["skillPath"].clone();
    }
    *existing == requested
}

pub fn session_key(request: &ClaudeRequest, config_dir: &Path) -> Value {
    use std::hash::{Hash, Hasher};
    let mut key = serde_json::to_value(request).unwrap_or_default();
    key["args"] = serde_json::json!(request.args.as_deref().unwrap_or_default());
    key["env"] = serde_json::json!(request.env.clone().unwrap_or_default());
    key["command"] = serde_json::json!(request
        .command
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("claude"));
    key["permissionMode"] =
        serde_json::json!(request.permission_mode.as_deref().unwrap_or("acceptEdits"));
    if let Some(fields) = key.as_object_mut() {
        for name in [
            "prompt",
            "resume",
            "recoverMedia",
            "contextModel",
            "operation",
        ] {
            fields.remove(name);
        }
    }
    // Claude reads settings/MCP definitions on startup. Restart at the next turn
    // when their content changes, without persisting secrets in diagnostics.
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    let project = Path::new(&request.project_path);
    for path in [
        config_dir.join("settings.json"),
        project.join(".mcp.json"),
        project.join(".claude/settings.json"),
        project.join(".claude/settings.local.json"),
    ] {
        // Saving the same JSON with different indentation/order is not a
        // configuration change. Invalid or missing files still change the key.
        match fs::read(path) {
            Ok(bytes) => match serde_json::from_slice::<Value>(&bytes) {
                Ok(value) => value.hash(&mut hash),
                Err(_) => bytes.hash(&mut hash),
            },
            Err(_) => Option::<Value>::None.hash(&mut hash),
        }
    }
    // ~/.claude.json also contains counters/timestamps updated by every turn.
    // Only connection definitions participate, otherwise reuse would always miss.
    for path in [
        config_dir.join(".claude.json"),
        config_dir.with_extension("json"),
    ] {
        if let Ok(bytes) = fs::read(path) {
            if let Ok(config) = serde_json::from_slice::<Value>(&bytes) {
                config.get("mcpServers").hash(&mut hash);
                if let Some(project_config) = config
                    .get("projects")
                    .and_then(|projects| projects.get(&request.project_path))
                {
                    for field in [
                        "mcpServers",
                        "enabledMcpjsonServers",
                        "disabledMcpjsonServers",
                    ] {
                        project_config.get(field).hash(&mut hash);
                    }
                }
            }
        }
    }
    key["configurationHash"] = serde_json::json!(hash.finish());
    key
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ordinary_turns_keep_granted_skill_access_but_changes_still_restart() {
        let existing =
            json!({"skillPath":"/enabled/SKILL.md", "model":"same", "sessionId":"session"});
        let next = json!({"skillPath":null, "model":"same", "sessionId":"session"});
        assert!(compatible(&existing, &next));
        for (field, value) in [
            ("skillPath", "/different/SKILL.md"),
            ("model", "different"),
            ("sessionId", "recovered"),
        ] {
            let mut changed = next.clone();
            changed[field] = json!(value);
            assert!(!compatible(&existing, &changed));
        }
    }

    #[test]
    fn defaults_and_json_formatting_do_not_restart_a_transport() {
        let root = std::env::temp_dir().join(format!("claude-key-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let mut request: ClaudeRequest = serde_json::from_value(json!({
            "conversationId":"c", "sessionId":"s", "projectPath":root.to_string_lossy(), "prompt":"hello", "resume":false
        })).unwrap();
        fs::write(root.join("settings.json"), r#"{"model":"test","env":{}}"#).unwrap();
        let before = session_key(&request, &root);
        request.args = Some(vec![]);
        request.env = Some(Default::default());
        request.command = Some("claude".into());
        request.permission_mode = Some("acceptEdits".into());
        request.operation = Some("compact".into());
        fs::write(
            root.join("settings.json"),
            r#"{ "env": {}, "model": "test" }"#,
        )
        .unwrap();
        assert_eq!(before, session_key(&request, &root));
        fs::write(
            root.join("settings.json"),
            r#"{"model":"changed","env":{}}"#,
        )
        .unwrap();
        assert_ne!(before, session_key(&request, &root));
        fs::remove_dir_all(root).unwrap();
    }
}
