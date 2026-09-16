use serde_json::{json, Value};
use std::{fs, io::Write, path::Path};
use uuid::Uuid;

pub const RECOVERY_GUIDANCE: &str = "The previous provider request rejected image/document input. Historical media has been replaced with text placeholders in a recovered session; the original transcript and attachments are preserved. Continue with the user's text. Do not reopen historical images, PDFs or screenshots, or claim to have seen them. If visual information is needed, ask for a text description or a vision-capable model.";

fn unsupported_media(text: &str) -> bool {
    let text = text.to_ascii_lowercase();
    text.contains("only support text input")
        || text.contains("only supports text input")
        || text.contains("does not support image")
        || text.contains("doesn't support image")
        || text.contains("image input is not supported")
        || text.contains("does not support multimodal")
}

fn media_error(record: &Value) -> bool {
    if record["type"] != "assistant"
        || (record["isApiErrorMessage"] != true
            && !record.get("error").is_some_and(|error| {
                error.as_str().is_some_and(|text| !text.is_empty()) || error == true
            }))
    {
        return false;
    }
    record
        .pointer("/message/content")
        .and_then(Value::as_array)
        .is_some_and(|blocks| {
            blocks.iter().any(|b| {
                b["type"] == "text" && unsupported_media(b["text"].as_str().unwrap_or_default())
            })
        })
}

// Only visit protocol content, never tool inputs or arbitrary user JSON.
fn replace_media(content: &mut Value) -> usize {
    let Some(blocks) = content.as_array_mut() else {
        return 0;
    };
    let mut count = 0;
    for block in blocks {
        match block["type"].as_str() {
            Some("image" | "document") => {
                *block = json!({"type": "text", "text": "[Historical media omitted: the provider rejected non-text input. Do not reopen this file; ask the user for a text description if needed.]"});
                count += 1;
            }
            Some("tool_result") => count += replace_media(&mut block["content"]),
            _ => {}
        }
    }
    count
}

fn recovered_transcript(source: &str, session_id: &str) -> Result<Option<String>, String> {
    let mut records = source
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(serde_json::from_str::<Value>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| {
            "Cannot recover an incomplete Claude transcript; the original was preserved".to_string()
        })?;
    // A quoted error in user text, or an older failure followed by success, is not evidence.
    if !records
        .iter()
        .rev()
        .find(|r| r["type"] == "assistant")
        .is_some_and(media_error)
    {
        return Ok(None);
    }
    let mut replaced = 0;
    for record in &mut records {
        if matches!(record["type"].as_str(), Some("user" | "assistant")) {
            if let Some(content) = record.pointer_mut("/message/content") {
                let count = replace_media(content);
                replaced += count;
                // Read also caches the original image in toolUseResult metadata.
                if count > 0 {
                    record.as_object_mut().unwrap().remove("toolUseResult");
                }
            }
        }
        if record.get("sessionId").is_some() {
            record["sessionId"] = json!(session_id);
        }
    }
    if replaced == 0 {
        return Ok(None);
    }
    let mut output = String::new();
    for record in records {
        output.push_str(&serde_json::to_string(&record).map_err(|e| e.to_string())?);
        output.push('\n');
    }
    Ok(Some(output))
}

/// Fork only a confirmed poisoned session. Never rewrite Claude's original history.
pub fn recover(config_dir: &Path, session_id: &str) -> Result<Option<String>, String> {
    let Some(source_path) = crate::context::session_path(config_dir, session_id)? else {
        return Ok(None);
    };
    if fs::metadata(&source_path).map_err(|e| e.to_string())?.len() > 128 * 1024 * 1024 {
        return Err(
            "Claude transcript is too large to inspect safely; start a new conversation".into(),
        );
    }
    let source = fs::read_to_string(&source_path).map_err(|e| e.to_string())?;
    let new_id = Uuid::new_v4().to_string();
    let Some(output) = recovered_transcript(&source, &new_id)? else {
        return Ok(None);
    };
    let destination = source_path.with_file_name(format!("{new_id}.jsonl"));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&destination).map_err(|e| e.to_string())?;
    if let Err(error) = file
        .write_all(output.as_bytes())
        .and_then(|_| file.sync_all())
    {
        drop(file);
        let _ = fs::remove_file(destination);
        return Err(error.to_string());
    }
    Ok(Some(new_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn transcript() -> String {
        [
            json!({"type":"user","uuid":"u1","sessionId":"old","message":{"content":[{"type":"text","text":"如图"},{"type":"image","source":{"data":"PRIVATE_BASE64"}}]}}),
            json!({"type":"assistant","uuid":"a1","parentUuid":"u1","sessionId":"old","message":{"content":[{"type":"tool_use","id":"tool1","name":"Read","input":{"file_path":"old.png"}}]}}),
            json!({"type":"user","uuid":"u2","parentUuid":"a1","sessionId":"old","message":{"content":[{"type":"tool_result","tool_use_id":"tool1","content":[{"type":"image","source":{"data":"PRIVATE_BASE64"}},{"type":"text","text":"Keep tool text"}]}]}}),
            json!({"type":"assistant","sessionId":"old","isApiErrorMessage":true,"message":{"content":[{"type":"text","text":"API Error: 400 Model only support text input"}]}}),
        ].iter().map(Value::to_string).collect::<Vec<_>>().join("\n")
    }

    #[test]
    fn removes_direct_and_tool_media_but_preserves_text_and_tool_links() {
        let output = recovered_transcript(&transcript(), "new").unwrap().unwrap();
        assert!(!output.contains("PRIVATE_BASE64"));
        for text in [
            "Keep tool text",
            "tool1",
            "parentUuid",
            "如图",
            "old.png",
            "Do not reopen",
        ] {
            assert!(output.contains(text));
        }
        assert!(!output.contains("\"sessionId\":\"old\""));
        // Retrying a recovered session never forks again without new rejected media.
        assert!(recovered_transcript(&output, "another").unwrap().is_none());
    }

    #[test]
    fn does_not_recover_quotes_successful_vision_or_unrelated_errors() {
        for tail in [
            json!({"type":"assistant","message":{"content":[{"type":"text","text":"This documentation says Model only support text input"}]}}),
            json!({"type":"assistant","error":null,"message":{"content":[{"type":"text","text":"This documentation says Model only support text input"}]}}),
            json!({"type":"assistant","isApiErrorMessage":true,"message":{"content":[{"type":"text","text":"API Error: 429 rate limited"}]}}),
        ] {
            assert!(
                recovered_transcript(&format!("{}\n{tail}", transcript()), "new")
                    .unwrap()
                    .is_none()
            );
        }
        assert!(recovered_transcript("broken json", "new").is_err());
    }

    #[test]
    fn removes_document_and_read_cache_without_interpreting_tool_inputs_as_media() {
        let mut records = transcript()
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).unwrap())
            .collect::<Vec<_>>();
        records[0]["message"]["content"][1]["type"] = json!("document");
        records[1]["message"]["content"][0]["input"] =
            json!({"type":"image","content":"keep this ordinary tool argument"});
        records[2]["toolUseResult"] = json!({"file":{"base64":"PRIVATE_CACHE"}});
        let source = records
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        let output = recovered_transcript(&source, "new").unwrap().unwrap();
        assert!(!output.contains("PRIVATE_CACHE"));
        assert!(!output.contains("PRIVATE_BASE64"));
        assert!(output.contains("keep this ordinary tool argument"));
    }

    #[test]
    fn missing_transcript_does_not_invent_a_recovery() {
        let root = std::env::temp_dir().join(Uuid::new_v4().to_string());
        assert!(recover(&root, &Uuid::new_v4().to_string())
            .unwrap()
            .is_none());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_transcript_symlink_outside_the_configured_projects() {
        let root = std::env::temp_dir().join(Uuid::new_v4().to_string());
        let project = root.join("projects/test");
        fs::create_dir_all(&project).unwrap();
        let id = Uuid::new_v4().to_string();
        let outside = root.join("outside.jsonl");
        fs::write(&outside, transcript()).unwrap();
        std::os::unix::fs::symlink(&outside, project.join(format!("{id}.jsonl"))).unwrap();
        assert!(recover(&root, &id).unwrap().is_none());
        assert_eq!(fs::read_to_string(outside).unwrap(), transcript());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn fork_preserves_original_and_rejects_path_escape() {
        let root = std::env::temp_dir().join(Uuid::new_v4().to_string());
        let project = root.join("projects/test");
        fs::create_dir_all(&project).unwrap();
        let id = Uuid::new_v4().to_string();
        let source = project.join(format!("{id}.jsonl"));
        fs::write(&source, transcript()).unwrap();
        let recovered = recover(&root, &id).unwrap().unwrap();
        assert_eq!(fs::read_to_string(source).unwrap(), transcript());
        assert!(
            !fs::read_to_string(project.join(format!("{recovered}.jsonl")))
                .unwrap()
                .contains("PRIVATE_BASE64")
        );
        assert!(recover(&root, "../../outside").is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
