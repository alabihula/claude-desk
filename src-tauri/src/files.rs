use crate::data::{insert_attachment, Attachment};
use chrono::Utc;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

fn attachment_dir(app: &AppHandle, conversation_id: &str) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("attachments")
        .join(conversation_id);
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn safe_name(name: &str) -> String {
    Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("attachment")
        .to_string()
}

fn attachment_kind(name: &str) -> String {
    match Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" | "jpg" | "jpeg" | "webp" | "gif" => "image".into(),
        _ => "file".into(),
    }
}

fn build_attachment(
    app: &AppHandle,
    conversation_id: String,
    name: String,
    path: PathBuf,
) -> Result<Attachment, String> {
    let attachment = Attachment {
        id: Uuid::new_v4().to_string(),
        conversation_id,
        message_id: None,
        kind: attachment_kind(&name),
        name,
        size: fs::metadata(&path)
            .map_err(|error| error.to_string())?
            .len() as i64,
        path: path.to_string_lossy().to_string(),
        created_at: Utc::now().to_rfc3339(),
    };
    insert_attachment(app, &attachment)?;
    Ok(attachment)
}

#[tauri::command]
pub fn copy_attachment(
    app: AppHandle,
    conversation_id: String,
    source_path: String,
) -> Result<Attachment, String> {
    let source = PathBuf::from(&source_path);
    if !source.is_file() {
        return Err("Attachment is not a readable file".into());
    }
    let name = safe_name(&source_path);
    let destination =
        attachment_dir(&app, &conversation_id)?.join(format!("{}_{}", Uuid::new_v4(), name));
    fs::copy(source, &destination).map_err(|error| error.to_string())?;
    build_attachment(&app, conversation_id, name, destination)
}

#[tauri::command]
pub fn save_clipboard_image(
    app: AppHandle,
    conversation_id: String,
    bytes: Vec<u8>,
    extension: String,
) -> Result<Attachment, String> {
    if bytes.is_empty() {
        return Err("Clipboard image is empty".into());
    }
    let extension = match extension.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => "jpg",
        "webp" => "webp",
        _ => "png",
    };
    let name = format!(
        "screenshot-{}.{}",
        Utc::now().format("%Y%m%d-%H%M%S"),
        extension
    );
    let destination =
        attachment_dir(&app, &conversation_id)?.join(format!("{}_{}", Uuid::new_v4(), name));
    fs::write(&destination, bytes).map_err(|error| error.to_string())?;
    build_attachment(&app, conversation_id, name, destination)
}

#[tauri::command]
pub fn open_in_editor(
    path: String,
    line: Option<u32>,
    editor: Option<String>,
) -> Result<(), String> {
    let editor = editor.unwrap_or_else(|| "vscode".into());
    let target = if editor == "system" {
        path
    } else {
        match line {
            Some(line) => format!("{}:{}", path, line),
            None => path,
        }
    };
    let output = if editor == "system" {
        Command::new("open").arg(target).output()
    } else {
        let application = if editor == "cursor" {
            "Cursor"
        } else {
            "Visual Studio Code"
        };
        Command::new("open")
            .args(["-a", application, "--args", "-g"])
            .arg(target)
            .output()
    }
    .map_err(|error| format!("Could not open editor: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    Command::new("open")
        .arg("-R")
        .arg(path)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn open_terminal(path: String) -> Result<(), String> {
    Command::new("open")
        .arg("-a")
        .arg("Terminal")
        .arg(path)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}
