const MAX_MODEL_ID_LENGTH: usize = 256;
const EFFORT_LEVELS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];

pub fn normalize_model(value: Option<&str>) -> Result<Option<String>, String> {
    let value = value.unwrap_or_default().trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.len() > MAX_MODEL_ID_LENGTH || value.chars().any(char::is_control) {
        return Err("Model ID is invalid".into());
    }
    Ok(Some(value.to_string()))
}

pub fn normalize_effort(value: Option<&str>) -> Result<Option<String>, String> {
    let value = value.unwrap_or_default().trim().to_ascii_lowercase();
    if value.is_empty() || value == "auto" {
        return Ok(None);
    }
    if !EFFORT_LEVELS.contains(&value.as_str()) {
        return Err("Unsupported Claude effort level".into());
    }
    Ok(Some(value))
}

pub fn with_runtime_overrides(
    args: Vec<String>,
    model: Option<&str>,
    effort: Option<&str>,
) -> Vec<String> {
    let mut filtered = Vec::with_capacity(args.len() + 4);
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        let replaces_model = model.is_some() && (arg == "--model" || arg.starts_with("--model="));
        let replaces_effort =
            effort.is_some() && (arg == "--effort" || arg.starts_with("--effort="));
        if replaces_model || replaces_effort {
            if !arg.contains('=') {
                index += 1;
            }
        } else {
            filtered.push(arg.clone());
        }
        index += 1;
    }
    if let Some(value) = model {
        filtered.extend(["--model".into(), value.into()]);
    }
    if let Some(value) = effort {
        filtered.extend(["--effort".into(), value.into()]);
    }
    filtered
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_model_and_effort_values() {
        assert_eq!(
            normalize_model(Some(" sonnet[1m] ")).unwrap(),
            Some("sonnet[1m]".into())
        );
        assert_eq!(normalize_effort(Some("AUTO")).unwrap(), None);
        assert_eq!(
            normalize_effort(Some("XHIGH")).unwrap(),
            Some("xhigh".into())
        );
        assert!(normalize_model(Some("bad\nmodel")).is_err());
        assert!(normalize_effort(Some("extreme")).is_err());
    }

    #[test]
    fn replaces_only_explicit_runtime_overrides() {
        let args = vec![
            "--model".into(),
            "old".into(),
            "--effort=low".into(),
            "--allowedTools".into(),
            "Read".into(),
        ];
        assert_eq!(
            with_runtime_overrides(args, Some("opus"), Some("high")),
            vec![
                "--allowedTools",
                "Read",
                "--model",
                "opus",
                "--effort",
                "high"
            ]
        );
    }
}
