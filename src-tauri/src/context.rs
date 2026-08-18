use serde_json::Value;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use uuid::Uuid;

const USAGE_FIELDS: [&str; 4] = [
    "input_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
    "output_tokens",
];

pub fn usage_tokens(usage: Option<&Value>) -> i64 {
    let Some(usage) = usage else {
        return 0;
    };
    USAGE_FIELDS.iter().fold(0, |total, field| {
        total.saturating_add(usage.get(field).and_then(Value::as_i64).unwrap_or(0).max(0))
    })
}

pub fn context_window(model_usage: Option<&Value>) -> i64 {
    model_usage
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(_, usage)| usage.get("contextWindow").and_then(Value::as_i64))
        .filter(|window| *window > 0)
        .max()
        .unwrap_or(0)
}

pub fn latest_session_usage(config_dir: &Path, session_id: &str) -> Result<Option<i64>, String> {
    Uuid::parse_str(session_id).map_err(|_| "Invalid Claude session identifier".to_string())?;
    let projects = config_dir.join("projects");
    let projects = match fs::canonicalize(projects) {
        Ok(path) => path,
        Err(_) => return Ok(None),
    };
    let filename = format!("{session_id}.jsonl");

    for entry in fs::read_dir(&projects).map_err(|error| error.to_string())? {
        let candidate = match entry {
            Ok(entry) => entry.path().join(&filename),
            Err(_) => continue,
        };
        let candidate = match fs::canonicalize(candidate) {
            Ok(path) if path.starts_with(&projects) && path.is_file() => path,
            _ => continue,
        };
        return parse_session_usage(&candidate);
    }
    Ok(None)
}

fn parse_session_usage(path: &Path) -> Result<Option<i64>, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut latest = None;
    for line in BufReader::new(file).lines() {
        let Ok(line) = line else {
            continue;
        };
        let Ok(record) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if record.get("subtype").and_then(Value::as_str) == Some("compact_boundary") {
            // Compaction does not emit a normal assistant usage frame. Its
            // postTokens value is the first authoritative size of the new context.
            if let Some(tokens) = record
                .pointer("/compactMetadata/postTokens")
                .and_then(Value::as_i64)
                .filter(|tokens| *tokens >= 0)
            {
                latest = Some(tokens);
            }
            continue;
        }
        if record.get("type").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        let tokens = usage_tokens(record.pointer("/message/usage"));
        if tokens > 0 {
            latest = Some(tokens);
        }
    }
    Ok(latest)
}

pub fn default_config_dir(home_dir: PathBuf) -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir.join(".claude"))
}

#[cfg(test)]
mod tests {
    use super::{context_window, latest_session_usage, parse_session_usage, usage_tokens};
    use serde_json::json;
    use std::fs;

    #[test]
    fn sums_context_usage_fields() {
        let usage = json!({
            "input_tokens": 201,
            "cache_read_input_tokens": 76032,
            "output_tokens": 71
        });
        assert_eq!(usage_tokens(Some(&usage)), 76304);
    }

    #[test]
    fn reads_the_latest_non_zero_transcript_usage() {
        let path = std::env::temp_dir().join(format!(
            "claude-desk-context-{}.jsonl",
            uuid::Uuid::new_v4()
        ));
        fs::write(
            &path,
            concat!(
                "{\"type\":\"assistant\",\"message\":{\"usage\":{\"input_tokens\":0}}}\n",
                "not-json\n",
                "{\"type\":\"assistant\",\"message\":{\"usage\":{\"input_tokens\":201,\"cache_read_input_tokens\":76032,\"output_tokens\":71}}}\n"
            ),
        )
        .unwrap();
        assert_eq!(parse_session_usage(&path).unwrap(), Some(76304));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn uses_post_compaction_tokens_for_manual_and_auto_compaction() {
        for (trigger, pre_tokens, post_tokens) in
            [("manual", 22_724, 571), ("auto", 167_502, 5_540)]
        {
            let path = std::env::temp_dir().join(format!(
                "claude-desk-compaction-{}.jsonl",
                uuid::Uuid::new_v4()
            ));
            fs::write(
                &path,
                format!(
                    "{{\"type\":\"assistant\",\"message\":{{\"usage\":{{\"input_tokens\":{},\"output_tokens\":1}}}}}}\n{{\"type\":\"system\",\"subtype\":\"compact_boundary\",\"compactMetadata\":{{\"trigger\":\"{}\",\"preTokens\":{},\"postTokens\":{}}}}}\n",
                    pre_tokens - 1,
                    trigger,
                    pre_tokens,
                    post_tokens
                ),
            )
            .unwrap();

            assert_eq!(parse_session_usage(&path).unwrap(), Some(post_tokens));
            fs::remove_file(path).unwrap();
        }
    }

    #[test]
    fn later_assistant_usage_replaces_post_compaction_tokens() {
        let path = std::env::temp_dir().join(format!(
            "claude-desk-post-compaction-{}.jsonl",
            uuid::Uuid::new_v4()
        ));
        fs::write(
            &path,
            concat!(
                "{\"type\":\"assistant\",\"message\":{\"usage\":{\"input_tokens\":22000}}}\n",
                "{\"type\":\"system\",\"subtype\":\"compact_boundary\",\"compactMetadata\":{\"trigger\":\"manual\",\"postTokens\":571}}\n",
                "{\"type\":\"assistant\",\"message\":{\"usage\":{\"input_tokens\":900,\"output_tokens\":25}}}\n"
            ),
        )
        .unwrap();

        assert_eq!(parse_session_usage(&path).unwrap(), Some(925));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn finds_a_session_only_inside_the_claude_projects_root() {
        let root =
            std::env::temp_dir().join(format!("claude-desk-projects-{}", uuid::Uuid::new_v4()));
        let session_id = uuid::Uuid::new_v4().to_string();
        let transcript = root
            .join("projects/example")
            .join(format!("{session_id}.jsonl"));
        fs::create_dir_all(transcript.parent().unwrap()).unwrap();
        fs::write(
            &transcript,
            "{\"type\":\"assistant\",\"message\":{\"usage\":{\"input_tokens\":100}}}\n",
        )
        .unwrap();
        assert_eq!(latest_session_usage(&root, &session_id).unwrap(), Some(100));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn takes_the_largest_reported_context_window() {
        let usage = json!({
            "kimi-latest": { "contextWindow": 200000 },
            "fallback": { "contextWindow": 128000 }
        });
        assert_eq!(context_window(Some(&usage)), 200000);
    }
}
