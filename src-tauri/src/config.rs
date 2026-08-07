use serde::Serialize;
use serde_json::Value;
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSettingsFile {
    path: String,
    content: String,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .home_dir()
        .map_err(|error| error.to_string())?
        .join(".claude")
        .join("settings.json"))
}

fn settings_file(path: PathBuf) -> Result<ClaudeSettingsFile, String> {
    let content = if path.exists() {
        fs::read_to_string(&path).map_err(|error| error.to_string())?
    } else {
        "{}\n".into()
    };
    Ok(ClaudeSettingsFile {
        path: path.to_string_lossy().to_string(),
        content,
    })
}

#[tauri::command]
pub fn load_claude_settings(app: AppHandle) -> Result<ClaudeSettingsFile, String> {
    settings_file(settings_path(&app)?)
}

#[tauri::command]
pub fn save_claude_settings(app: AppHandle, content: String) -> Result<ClaudeSettingsFile, String> {
    let parsed: Value = serde_json::from_str(&content)
        .map_err(|error| format!("Invalid Claude settings JSON: {error}"))?;
    if !parsed.is_object() {
        return Err("Claude settings must be a JSON object".into());
    }
    let normalized = format!(
        "{}\n",
        serde_json::to_string_pretty(&parsed).map_err(|error| error.to_string())?
    );
    let path = settings_path(&app)?;
    let directory = path
        .parent()
        .ok_or("Claude settings directory is unavailable")?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;

    // Keep the first pre-Claude-Desk copy so a malformed manual edit remains recoverable.
    if path.exists() {
        let backup = directory.join("settings.json.claude-desk.bak");
        if !backup.exists() {
            fs::copy(&path, &backup).map_err(|error| error.to_string())?;
            #[cfg(unix)]
            fs::set_permissions(&backup, fs::Permissions::from_mode(0o600))
                .map_err(|error| error.to_string())?;
        }
    }

    let temporary = directory.join(format!(".settings-{}.tmp", Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    file.write_all(normalized.as_bytes())
        .map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    fs::rename(&temporary, &path).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
        .map_err(|error| error.to_string())?;
    settings_file(path)
}
