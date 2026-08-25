use crate::{
    data::{insert_attachment, Attachment},
    platform,
};
use chrono::Utc;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFile {
    path: String,
    name: String,
    size: u64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    path: String,
    relative_path: String,
    name: String,
    content: String,
    size: u64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEntry {
    name: String,
    path: String,
    kind: String,
}

const MAX_PREVIEW_BYTES: u64 = 2 * 1024 * 1024;
const PREVIEW_IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif"];

fn has_extension(path: &Path, extensions: &[&str]) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| extensions.contains(&value.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn is_preview_image(path: &Path) -> bool {
    has_extension(path, PREVIEW_IMAGE_EXTENSIONS)
}

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

fn resolve_project_file(project_path: &Path, candidate: &Path) -> Result<PathBuf, String> {
    let project = fs::canonicalize(project_path).map_err(|_| "Project directory is unavailable")?;
    let requested = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        project.join(candidate)
    };
    let resolved = fs::canonicalize(requested).map_err(|_| "File no longer exists")?;
    if !resolved.starts_with(&project) || !resolved.is_file() {
        return Err("Only files inside the active project can be accessed".into());
    }
    Ok(resolved)
}

fn resolve_project_directory(project_path: &Path, candidate: &Path) -> Result<PathBuf, String> {
    let project = fs::canonicalize(project_path).map_err(|_| "Project directory is unavailable")?;
    let requested = if candidate.as_os_str().is_empty() {
        project.clone()
    } else if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        project.join(candidate)
    };
    let resolved = fs::canonicalize(requested).map_err(|_| "Directory no longer exists")?;
    if !resolved.starts_with(&project) || !resolved.is_dir() {
        return Err("Only directories inside the active project can be listed".into());
    }
    Ok(resolved)
}

fn project_entries(project_path: &Path, directory: &Path) -> Result<Vec<ProjectEntry>, String> {
    let project = fs::canonicalize(project_path).map_err(|_| "Project directory is unavailable")?;
    let directory = resolve_project_directory(&project, directory)?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let Ok(path) = fs::canonicalize(entry.path()) else {
            continue;
        };
        if !path.starts_with(&project) {
            continue;
        }
        let kind = if path.is_dir() {
            "directory"
        } else if path.is_file() {
            "file"
        } else {
            continue;
        };
        let relative = path
            .strip_prefix(&project)
            .map_err(|error| error.to_string())?;
        entries.push(ProjectEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: relative.to_string_lossy().to_string(),
            kind: kind.into(),
        });
    }
    entries.sort_by(|left, right| {
        let left_rank = if left.kind == "directory" { 0 } else { 1 };
        let right_rank = if right.kind == "directory" { 0 } else { 1 };
        left_rank
            .cmp(&right_rank)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
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

fn project_local_files(
    project_path: &str,
    candidates: Vec<String>,
) -> Result<Vec<LocalFile>, String> {
    let project = PathBuf::from(project_path);
    let mut files = Vec::new();
    for candidate in candidates.into_iter().take(20) {
        let Ok(path) = resolve_project_file(&project, Path::new(&candidate)) else {
            continue;
        };
        if files
            .iter()
            .any(|file: &LocalFile| file.path == path.to_string_lossy())
        {
            continue;
        }
        let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
        files.push(LocalFile {
            name: path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("file")
                .to_string(),
            path: path.to_string_lossy().to_string(),
            size: metadata.len(),
        });
    }
    Ok(files)
}

#[tauri::command]
pub fn resolve_local_files(
    app: AppHandle,
    project_path: String,
    candidates: Vec<String>,
) -> Result<Vec<LocalFile>, String> {
    let files = project_local_files(&project_path, candidates)?;
    for file in &files {
        if is_preview_image(Path::new(&file.path)) {
            app.asset_protocol_scope()
                .allow_file(&file.path)
                .map_err(|error| format!("Could not prepare image preview: {error}"))?;
        }
    }
    Ok(files)
}

fn resolve_project_html(project_path: &str, source_path: &str) -> Result<PathBuf, String> {
    let path = resolve_project_file(Path::new(project_path), Path::new(source_path))?;
    if !has_extension(&path, &["html", "htm"]) {
        return Err("Only HTML files can be opened in the browser".into());
    }
    Ok(path)
}

#[tauri::command]
pub fn open_project_html(project_path: String, source_path: String) -> Result<(), String> {
    let path = resolve_project_html(&project_path, &source_path)?;
    platform::open_in_editor(&path.to_string_lossy(), None, "system")
}

#[tauri::command]
pub fn reveal_project_file(project_path: String, source_path: String) -> Result<(), String> {
    let path = resolve_project_file(Path::new(&project_path), Path::new(&source_path))?;
    platform::reveal_path(&path.to_string_lossy())
}

#[tauri::command]
pub fn download_file(
    project_path: String,
    source_path: String,
    destination_path: String,
) -> Result<u64, String> {
    let source = resolve_project_file(Path::new(&project_path), Path::new(&source_path))?;
    let destination = PathBuf::from(destination_path);
    if destination.as_os_str().is_empty() {
        return Err("Choose where to save the file".into());
    }
    if destination.exists() {
        let existing = fs::canonicalize(&destination).map_err(|error| error.to_string())?;
        if existing == source {
            return Err("Choose a different destination for the download".into());
        }
    }
    fs::copy(source, destination).map_err(|error| format!("Could not save file: {error}"))
}

#[tauri::command]
pub fn read_project_file(project_path: String, source_path: String) -> Result<ProjectFile, String> {
    let project =
        fs::canonicalize(&project_path).map_err(|_| "Project directory is unavailable")?;
    let path = resolve_project_file(&project, Path::new(&source_path))?;
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_PREVIEW_BYTES {
        return Err("File preview is limited to 2 MB".into());
    }
    let bytes = fs::read(&path).map_err(|error| format!("Could not read file: {error}"))?;
    let content =
        String::from_utf8(bytes).map_err(|_| "Binary files cannot be previewed".to_string())?;
    Ok(ProjectFile {
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("file")
            .to_string(),
        path: path.to_string_lossy().to_string(),
        relative_path: path
            .strip_prefix(project)
            .map_err(|error| error.to_string())?
            .to_string_lossy()
            .to_string(),
        content,
        size: metadata.len(),
    })
}

#[tauri::command]
pub fn list_project_directory(
    project_path: String,
    directory: Option<String>,
) -> Result<Vec<ProjectEntry>, String> {
    project_entries(
        Path::new(&project_path),
        Path::new(directory.as_deref().unwrap_or("")),
    )
}

#[tauri::command]
pub fn open_in_editor(
    path: String,
    line: Option<u32>,
    editor: Option<String>,
) -> Result<(), String> {
    platform::open_in_editor(&path, line, editor.as_deref().unwrap_or("vscode"))
}

#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    platform::reveal_path(&path)
}

#[tauri::command]
pub fn open_terminal(path: String) -> Result<(), String> {
    platform::open_terminal(&path)
}

#[cfg(test)]
mod tests {
    use super::{
        download_file, is_preview_image, project_entries, project_local_files, read_project_file,
        resolve_project_file, resolve_project_html,
    };
    use std::{fs, path::Path};
    use uuid::Uuid;

    #[test]
    fn only_resolves_files_inside_the_project() {
        let root = std::env::temp_dir().join(format!("claude-desk-files-{}", Uuid::new_v4()));
        let outside = std::env::temp_dir().join(format!("claude-desk-outside-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("report.md"), "report").unwrap();
        fs::write(&outside, "secret").unwrap();

        assert_eq!(
            resolve_project_file(&root, Path::new("report.md")).unwrap(),
            fs::canonicalize(root.join("report.md")).unwrap()
        );
        assert!(resolve_project_file(&root, &outside).is_err());
        assert!(resolve_project_file(&root, Path::new("missing.md")).is_err());

        fs::remove_file(outside).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn classifies_only_supported_raster_images_for_internal_preview() {
        assert!(is_preview_image(Path::new("panel.PNG")));
        assert!(is_preview_image(Path::new("photo.webp")));
        assert!(!is_preview_image(Path::new("diagram.svg")));
        assert!(!is_preview_image(Path::new("report.pdf")));
    }

    #[test]
    fn resolves_local_files_and_rejects_html_outside_the_project() {
        let root = std::env::temp_dir().join(format!("claude-desk-links-{}", Uuid::new_v4()));
        let outside =
            std::env::temp_dir().join(format!("claude-desk-outside-{}.html", Uuid::new_v4()));
        fs::create_dir_all(root.join("exports")).unwrap();
        fs::write(root.join("exports/panel.html"), "<h1>Preview</h1>").unwrap();
        fs::write(root.join("exports/panel.png"), [0_u8, 1, 2]).unwrap();
        fs::write(root.join("exports/report.pdf"), b"pdf").unwrap();
        fs::write(&outside, "outside").unwrap();

        let files = project_local_files(
            root.to_string_lossy().as_ref(),
            vec![
                "./exports/panel.png".into(),
                "./exports/panel.png".into(),
                outside.to_string_lossy().to_string(),
            ],
        )
        .unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "panel.png");
        assert!(
            resolve_project_html(root.to_string_lossy().as_ref(), "./exports/panel.html").is_ok()
        );
        assert!(
            resolve_project_html(root.to_string_lossy().as_ref(), "./exports/report.pdf").is_err()
        );
        assert!(resolve_project_html(
            root.to_string_lossy().as_ref(),
            outside.to_string_lossy().as_ref()
        )
        .is_err());

        fs::remove_file(outside).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn copies_a_project_file_to_the_selected_destination() {
        let root = std::env::temp_dir().join(format!("claude-desk-download-{}", Uuid::new_v4()));
        let destination =
            std::env::temp_dir().join(format!("claude-desk-saved-{}.md", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("report.md");
        fs::write(&source, "report").unwrap();

        assert_eq!(
            download_file(
                root.to_string_lossy().to_string(),
                source.to_string_lossy().to_string(),
                destination.to_string_lossy().to_string(),
            )
            .unwrap(),
            6
        );
        assert_eq!(fs::read_to_string(&destination).unwrap(), "report");
        assert!(download_file(
            root.to_string_lossy().to_string(),
            source.to_string_lossy().to_string(),
            source.to_string_lossy().to_string(),
        )
        .is_err());

        fs::remove_file(destination).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reads_a_project_text_file_for_preview() {
        let root = std::env::temp_dir().join(format!("claude-desk-preview-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("preview.md"), "# Preview").unwrap();

        let file = read_project_file(root.to_string_lossy().to_string(), "preview.md".to_string())
            .unwrap();
        assert_eq!(file.name, "preview.md");
        assert_eq!(file.relative_path, "preview.md");
        assert_eq!(file.content, "# Preview");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn lists_project_entries_without_leaving_the_project() {
        let root = std::env::temp_dir().join(format!("claude-desk-tree-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("README.md"), "readme").unwrap();
        fs::write(root.join("src/main.js"), "main").unwrap();

        let entries = project_entries(&root, Path::new("")).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "src");
        assert_eq!(entries[0].kind, "directory");
        assert_eq!(entries[1].name, "README.md");
        assert_eq!(entries[1].kind, "file");
        assert!(project_entries(&root, Path::new("..")).is_err());

        fs::remove_dir_all(root).unwrap();
    }
}
