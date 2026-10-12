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

pub fn context_window_for_model(
    reported_window: i64,
    previous_window: i64,
    previous_model: &str,
    current_model: &str,
) -> i64 {
    if reported_window > 0 {
        reported_window
    } else if previous_model == current_model {
        previous_window.max(0)
    } else {
        // Slash commands can omit modelUsage. Reusing another model's limit
        // here would make the frontend compact against the wrong capacity.
        0
    }
}

// A compaction without postTokens invalidates the old measurement; it does
// not mean zero tokens. Keep its identity to reject a transcript not yet flushed.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SessionUsage {
    pub tokens: Option<i64>,
    pub compacted: bool,
    boundary_id: Option<String>,
    measured_at: Option<chrono::DateTime<chrono::FixedOffset>>,
}

impl SessionUsage {
    pub fn observe(&mut self, record: &Value) {
        let timestamp = record
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok());
        if record.get("type").and_then(Value::as_str) == Some("system") {
            if record.get("subtype").and_then(Value::as_str) == Some("compact_boundary") {
                self.compacted = true;
                self.measured_at = timestamp;
                self.boundary_id = record
                    .get("uuid")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                self.tokens = record
                    .pointer("/compactMetadata/postTokens")
                    .or_else(|| record.pointer("/compact_metadata/post_tokens"))
                    .and_then(Value::as_i64)
                    .filter(|tokens| *tokens >= 0);
            } else if record.get("compact_result").and_then(Value::as_str) == Some("success")
                && !self.compacted
            {
                self.compacted = true;
                self.tokens = None;
            }
        } else if record.get("type").and_then(Value::as_str) == Some("assistant") {
            let tokens = usage_tokens(record.pointer("/message/usage"));
            if tokens > 0 {
                self.tokens = Some(tokens);
                self.measured_at = timestamp;
            }
        }
    }

    pub fn newer_than(&self, timestamp: &str) -> bool {
        self.measured_at
            .zip(chrono::DateTime::parse_from_rfc3339(timestamp).ok())
            .is_some_and(|(measured, saved)| measured > saved)
    }

    pub fn source(&self) -> &'static str {
        if self.tokens.is_none() && self.compacted {
            "compacted-pending"
        } else {
            "claude-transcript"
        }
    }

    pub fn resolve(self, transcript: Option<Self>) -> Option<Self> {
        if self.compacted {
            // A live boundary is newer than an old on-disk assistant record.
            // Prefer postTokens from disk only when it belongs to this boundary.
            if self.tokens.is_none() {
                if let Some(saved) = transcript.filter(|saved| {
                    self.boundary_id.is_some() && saved.boundary_id == self.boundary_id
                }) {
                    return Some(saved);
                }
            }
            Some(self)
        } else if self.tokens.is_some() {
            Some(self)
        } else {
            transcript
        }
    }
}

pub fn latest_session_usage(
    config_dir: &Path,
    session_id: &str,
) -> Result<Option<SessionUsage>, String> {
    session_path(config_dir, session_id)?
        .map(|path| parse_session_usage(&path))
        .transpose()
        .map(Option::flatten)
}

pub fn session_path(config_dir: &Path, session_id: &str) -> Result<Option<PathBuf>, String> {
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
        return Ok(Some(candidate));
    }
    Ok(None)
}

fn parse_session_usage(path: &Path) -> Result<Option<SessionUsage>, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut usage = SessionUsage::default();
    for line in BufReader::new(file).lines() {
        let Ok(line) = line else {
            continue;
        };
        let Ok(record) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        usage.observe(&record);
    }
    let latest = (usage.tokens.is_some() || usage.compacted).then_some(usage);
    Ok(latest)
}

pub fn default_config_dir(home_dir: PathBuf) -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir.join(".claude"))
}

#[cfg(test)]
mod tests {
    use super::{
        context_window, context_window_for_model, latest_session_usage, parse_session_usage,
        usage_tokens,
    };
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
        assert_eq!(
            parse_session_usage(&path)
                .unwrap()
                .and_then(|usage| usage.tokens),
            Some(76304)
        );
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

            assert_eq!(
                parse_session_usage(&path)
                    .unwrap()
                    .and_then(|usage| usage.tokens),
                Some(post_tokens)
            );
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

        assert_eq!(
            parse_session_usage(&path)
                .unwrap()
                .and_then(|usage| usage.tokens),
            Some(925)
        );
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
        assert_eq!(
            latest_session_usage(&root, &session_id)
                .unwrap()
                .and_then(|usage| usage.tokens),
            Some(100)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn missing_post_tokens_invalidates_old_usage_and_next_reply_restores_it() {
        let mut usage = super::SessionUsage::default();
        usage.observe(&json!({"type":"assistant","message":{"usage":{"input_tokens":190000}}}));
        usage.observe(&json!({"type":"system","subtype":"compact_boundary","uuid":"new","compactMetadata":{"preTokens":190000}}));
        assert_eq!(usage.tokens, None);
        assert_eq!(usage.source(), "compacted-pending");
        // Neither cumulative billing usage nor a duplicate status is a new size.
        usage.observe(&json!({"type":"result","usage":{"input_tokens":190000}}));
        usage.observe(&json!({"type":"system","subtype":"status","compact_result":"success"}));
        assert_eq!(usage.tokens, None);
        usage.observe(&json!({"type":"assistant","message":{"usage":{"input_tokens":1200}}}));
        assert_eq!(usage.tokens, Some(1200));
        assert_eq!(usage.source(), "claude-transcript");
    }

    #[test]
    fn live_compaction_rejects_stale_transcript_but_accepts_matching_boundary() {
        let mut live = super::SessionUsage::default();
        live.observe(&json!({"type":"system","subtype":"compact_boundary","uuid":"new","compact_metadata":{"pre_tokens":190000}}));
        let mut stale = super::SessionUsage::default();
        stale.observe(&json!({"type":"system","subtype":"compact_boundary","uuid":"old","compactMetadata":{"postTokens":180000}}));
        assert_eq!(
            live.clone().resolve(Some(stale)).unwrap().source(),
            "compacted-pending"
        );
        let mut saved = super::SessionUsage::default();
        saved.observe(&json!({"type":"system","subtype":"compact_boundary","uuid":"new","compactMetadata":{"postTokens":1200}}));
        assert_eq!(live.resolve(Some(saved)).unwrap().tokens, Some(1200));
    }

    #[test]
    fn refresh_requires_a_measurement_newer_than_persisted_compaction() {
        let mut usage = super::SessionUsage::default();
        usage.observe(&json!({"type":"assistant","timestamp":"2026-10-12T10:00:00Z","message":{"usage":{"input_tokens":190000}}}));
        assert!(!usage.newer_than("2026-10-12T10:01:00Z"));
        usage.observe(&json!({"type":"assistant","timestamp":"2026-10-12T10:02:00Z","message":{"usage":{"input_tokens":12000}}}));
        assert!(usage.newer_than("2026-10-12T10:01:00Z"));
    }

    #[test]
    fn stream_post_tokens_survive_duplicate_success_and_failed_compact_keeps_usage() {
        let mut usage = super::SessionUsage::default();
        usage.observe(&json!({"type":"system","subtype":"compact_boundary","compact_metadata":{"post_tokens":0}}));
        usage.observe(&json!({"type":"system","subtype":"status","compact_result":"success"}));
        assert_eq!(usage.tokens, Some(0));
        usage.observe(&json!({"type":"assistant","message":{"usage":{"input_tokens":1500}}}));
        usage.observe(&json!({"type":"system","subtype":"status","compact_result":"failed"}));
        assert_eq!(usage.tokens, Some(1500));
    }

    #[test]
    fn takes_the_largest_reported_context_window() {
        let usage = json!({
            "kimi-latest": { "contextWindow": 200000 },
            "fallback": { "contextWindow": 128000 }
        });
        assert_eq!(context_window(Some(&usage)), 200000);
    }

    #[test]
    fn reuses_a_missing_window_only_for_the_same_model() {
        assert_eq!(
            context_window_for_model(0, 200_000, "model-a", "model-a"),
            200_000
        );
        assert_eq!(
            context_window_for_model(0, 200_000, "model-a", "model-b"),
            0
        );
        assert_eq!(
            context_window_for_model(1_000_000, 200_000, "model-a", "model-b"),
            1_000_000
        );
    }
}
