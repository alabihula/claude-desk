use crate::context;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub claude_session_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextStats {
    pub conversation_id: String,
    pub tokens: i64,
    pub window: i64,
    pub cumulative_tokens: i64,
    pub source: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub conversation_id: String,
    pub message_id: Option<String>,
    pub kind: String,
    pub name: String,
    pub path: String,
    pub size: i64,
    pub created_at: String,
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn connect(app: &AppHandle) -> Result<Connection, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let connection =
        Connection::open(dir.join("claude-desk.sqlite3")).map_err(|error| error.to_string())?;
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

fn has_column(connection: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| error.to_string())?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?;
    let found = columns.filter_map(Result::ok).any(|name| name == column);
    Ok(found)
}

pub fn migrate(app: &AppHandle) -> Result<(), String> {
    let connection = connect(app)?;
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS projects (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              path TEXT NOT NULL UNIQUE,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              last_opened_at TEXT NOT NULL,
              sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS conversations (
              id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              title TEXT NOT NULL,
              claude_session_id TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              last_opened_at TEXT NOT NULL,
              sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS conversations_project_idx
              ON conversations(project_id, last_opened_at DESC);
            CREATE TABLE IF NOT EXISTS messages (
              id TEXT PRIMARY KEY,
              conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
              role TEXT NOT NULL,
              content TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS messages_conversation_idx
              ON messages(conversation_id, created_at);
            CREATE TABLE IF NOT EXISTS conversation_context (
              conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
              tokens INTEGER NOT NULL DEFAULT 0,
              context_window INTEGER NOT NULL DEFAULT 0,
              cumulative_tokens INTEGER NOT NULL DEFAULT 0,
              source TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS attachments (
              id TEXT PRIMARY KEY,
              conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
              kind TEXT NOT NULL,
              name TEXT NOT NULL,
              path TEXT NOT NULL,
              size INTEGER NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            ",
        )
        .map_err(|error| error.to_string())?;

    if !has_column(&connection, "attachments", "message_id")? {
        connection
            .execute("ALTER TABLE attachments ADD COLUMN message_id TEXT", [])
            .map_err(|error| error.to_string())?;
    }
    if !has_column(&connection, "projects", "sort_order")? {
        connection
            .execute(
                "ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|error| error.to_string())?;
    }
    if !has_column(&connection, "conversations", "sort_order")? {
        connection
            .execute(
                "ALTER TABLE conversations ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|error| error.to_string())?;
    }

    // Older builds embedded only the filename in the user message. Recover that link once.
    connection
        .execute_batch(
            "
        CREATE INDEX IF NOT EXISTS attachments_message_idx ON attachments(message_id);
        UPDATE attachments
        SET message_id = (
          SELECT messages.id
          FROM messages
          WHERE messages.conversation_id = attachments.conversation_id
            AND messages.role = 'user'
            AND instr(messages.content, attachments.name) > 0
          ORDER BY messages.created_at DESC
          LIMIT 1
        )
        WHERE message_id IS NULL;
        ",
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_projects(app: AppHandle) -> Result<Vec<Project>, String> {
    let connection = connect(&app)?;
    let mut statement = connection
        .prepare("SELECT id, name, path, created_at, updated_at, last_opened_at FROM projects ORDER BY sort_order ASC, last_opened_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                last_opened_at: row.get(5)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn add_project(app: AppHandle, path: String) -> Result<Project, String> {
    let canonical = fs::canonicalize(&path).map_err(|error| error.to_string())?;
    if !canonical.is_dir() {
        return Err("Selected path is not a directory".into());
    }
    let path = canonical.to_string_lossy().to_string();
    let name = canonical
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Project")
        .to_string();
    let timestamp = now();
    let connection = connect(&app)?;
    if let Ok(project) = connection.query_row(
        "SELECT id, name, path, created_at, updated_at, last_opened_at FROM projects WHERE path = ?1",
        [&path],
        |row| Ok(Project { id: row.get(0)?, name: row.get(1)?, path: row.get(2)?, created_at: row.get(3)?, updated_at: row.get(4)?, last_opened_at: row.get(5)? }),
    ) {
        connection.execute("UPDATE projects SET last_opened_at = ?1 WHERE id = ?2", params![timestamp, project.id]).map_err(|error| error.to_string())?;
        return Ok(Project { last_opened_at: timestamp, ..project });
    }
    let project = Project {
        id: Uuid::new_v4().to_string(),
        name,
        path,
        created_at: timestamp.clone(),
        updated_at: timestamp.clone(),
        last_opened_at: timestamp,
    };
    let sort_order = connection
        .query_row(
            "SELECT COALESCE(MIN(sort_order), 0) - 1 FROM projects",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    connection.execute(
        "INSERT INTO projects (id, name, path, created_at, updated_at, last_opened_at, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![project.id, project.name, project.path, project.created_at, project.updated_at, project.last_opened_at, sort_order],
    ).map_err(|error| error.to_string())?;
    Ok(project)
}

#[tauri::command]
pub fn touch_project(app: AppHandle, id: String) -> Result<(), String> {
    connect(&app)?
        .execute(
            "UPDATE projects SET last_opened_at = ?1 WHERE id = ?2",
            params![now(), id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn remove_project(app: AppHandle, id: String) -> Result<(), String> {
    connect(&app)?
        .execute("DELETE FROM projects WHERE id = ?1", [id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn reorder_projects(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    let mut connection = connect(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for (index, id) in ids.iter().enumerate() {
        transaction
            .execute(
                "UPDATE projects SET sort_order = ?1 WHERE id = ?2",
                params![index as i64, id],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_conversations(app: AppHandle, project_id: String) -> Result<Vec<Conversation>, String> {
    let connection = connect(&app)?;
    let mut statement = connection.prepare(
        "SELECT id, project_id, title, claude_session_id, created_at, updated_at, last_opened_at FROM conversations WHERE project_id = ?1 ORDER BY sort_order ASC, last_opened_at DESC"
    ).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([project_id], |row| {
            Ok(Conversation {
                id: row.get(0)?,
                project_id: row.get(1)?,
                title: row.get(2)?,
                claude_session_id: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                last_opened_at: row.get(6)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_conversation(app: AppHandle, project_id: String) -> Result<Conversation, String> {
    let timestamp = now();
    let conversation = Conversation {
        id: Uuid::new_v4().to_string(),
        project_id,
        title: "New Conversation".into(),
        claude_session_id: Uuid::new_v4().to_string(),
        created_at: timestamp.clone(),
        updated_at: timestamp.clone(),
        last_opened_at: timestamp,
    };
    let connection = connect(&app)?;
    let sort_order = connection
        .query_row(
            "SELECT COALESCE(MIN(sort_order), 0) - 1 FROM conversations WHERE project_id = ?1",
            [&conversation.project_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    connection.execute(
        "INSERT INTO conversations (id, project_id, title, claude_session_id, created_at, updated_at, last_opened_at, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![conversation.id, conversation.project_id, conversation.title, conversation.claude_session_id, conversation.created_at, conversation.updated_at, conversation.last_opened_at, sort_order],
    ).map_err(|error| error.to_string())?;
    Ok(conversation)
}

#[tauri::command]
pub fn rename_conversation(app: AppHandle, id: String, title: String) -> Result<(), String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("Conversation title cannot be empty".into());
    }
    connect(&app)?
        .execute(
            "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, now(), id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn touch_conversation(app: AppHandle, id: String) -> Result<(), String> {
    connect(&app)?
        .execute(
            "UPDATE conversations SET last_opened_at = ?1 WHERE id = ?2",
            params![now(), id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_conversation(app: AppHandle, id: String) -> Result<(), String> {
    connect(&app)?
        .execute("DELETE FROM conversations WHERE id = ?1", [id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn reorder_conversations(
    app: AppHandle,
    project_id: String,
    ids: Vec<String>,
) -> Result<(), String> {
    let mut connection = connect(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for (index, id) in ids.iter().enumerate() {
        transaction
            .execute(
                "UPDATE conversations SET sort_order = ?1 WHERE id = ?2 AND project_id = ?3",
                params![index as i64, id, project_id],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

fn context_stats(
    connection: &Connection,
    conversation_id: &str,
) -> Result<Option<ContextStats>, String> {
    connection
        .query_row(
            "SELECT conversation_id, tokens, context_window, cumulative_tokens, source, updated_at FROM conversation_context WHERE conversation_id = ?1",
            [conversation_id],
            |row| {
                Ok(ContextStats {
                    conversation_id: row.get(0)?,
                    tokens: row.get(1)?,
                    window: row.get(2)?,
                    cumulative_tokens: row.get(3)?,
                    source: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())
}

pub fn save_context_stats(app: &AppHandle, stats: &ContextStats) -> Result<(), String> {
    connect(app)?
        .execute(
            "INSERT INTO conversation_context (conversation_id, tokens, context_window, cumulative_tokens, source, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(conversation_id) DO UPDATE SET tokens = excluded.tokens, context_window = excluded.context_window, cumulative_tokens = excluded.cumulative_tokens, source = excluded.source, updated_at = excluded.updated_at",
            params![stats.conversation_id, stats.tokens, stats.window, stats.cumulative_tokens, stats.source, stats.updated_at],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn load_context_stats(
    app: AppHandle,
    conversation_id: String,
) -> Result<Option<ContextStats>, String> {
    context_stats(&connect(&app)?, &conversation_id)
}

#[tauri::command]
pub fn refresh_context_stats(
    app: AppHandle,
    conversation_id: String,
) -> Result<Option<ContextStats>, String> {
    let connection = connect(&app)?;
    let session_id = connection
        .query_row(
            "SELECT claude_session_id FROM conversations WHERE id = ?1",
            [&conversation_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some(session_id) = session_id else {
        return Ok(None);
    };
    let existing = context_stats(&connection, &conversation_id)?;
    let home_dir = app.path().home_dir().map_err(|error| error.to_string())?;
    let config_dir = context::default_config_dir(home_dir);
    let Some(tokens) = context::latest_session_usage(&config_dir, &session_id)? else {
        return Ok(existing);
    };
    let stats = ContextStats {
        conversation_id,
        tokens,
        window: existing.as_ref().map(|item| item.window).unwrap_or(0),
        cumulative_tokens: existing
            .as_ref()
            .map(|item| item.cumulative_tokens)
            .unwrap_or(0),
        source: "claude-transcript".into(),
        updated_at: now(),
    };
    save_context_stats(&app, &stats)?;
    Ok(Some(stats))
}

#[tauri::command]
pub fn list_messages(app: AppHandle, conversation_id: String) -> Result<Vec<Message>, String> {
    let connection = connect(&app)?;
    let mut statement = connection.prepare("SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = ?1 ORDER BY created_at").map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([conversation_id], |row| {
            Ok(Message {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_message(
    app: AppHandle,
    conversation_id: String,
    role: String,
    content: String,
) -> Result<Message, String> {
    if !["user", "assistant", "system"].contains(&role.as_str()) {
        return Err("Invalid message role".into());
    }
    let message = Message {
        id: Uuid::new_v4().to_string(),
        conversation_id,
        role,
        content,
        created_at: now(),
    };
    let connection = connect(&app)?;
    connection.execute("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)", params![message.id, message.conversation_id, message.role, message.content, message.created_at]).map_err(|error| error.to_string())?;
    connection
        .execute(
            "UPDATE conversations SET updated_at = ?1, last_opened_at = ?1 WHERE id = ?2",
            params![message.created_at, message.conversation_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(message)
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<serde_json::Value, String> {
    let connection = connect(&app)?;
    let value = connection
        .query_row("SELECT value FROM settings WHERE key = 'app'", [], |row| {
            row.get::<_, String>(0)
        })
        .unwrap_or_else(|_| "{}".into());
    serde_json::from_str(&value).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: serde_json::Value) -> Result<(), String> {
    let value = serde_json::to_string(&settings).map_err(|error| error.to_string())?;
    connect(&app)?.execute(
        "INSERT INTO settings (key, value) VALUES ('app', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [value],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn insert_attachment(app: &AppHandle, attachment: &Attachment) -> Result<(), String> {
    connect(app)?.execute(
        "INSERT INTO attachments (id, conversation_id, message_id, kind, name, path, size, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![attachment.id, attachment.conversation_id, attachment.message_id, attachment.kind, attachment.name, attachment.path, attachment.size, attachment.created_at],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_attachments(
    app: AppHandle,
    conversation_id: String,
) -> Result<Vec<Attachment>, String> {
    let connection = connect(&app)?;
    let mut statement = connection.prepare(
        "SELECT id, conversation_id, message_id, kind, name, path, size, created_at FROM attachments WHERE conversation_id = ?1 ORDER BY created_at"
    ).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([conversation_id], |row| {
            Ok(Attachment {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                message_id: row.get(2)?,
                kind: row.get(3)?,
                name: row.get(4)?,
                path: row.get(5)?,
                size: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn link_attachments(
    app: AppHandle,
    message_id: String,
    attachment_ids: Vec<String>,
) -> Result<(), String> {
    let mut connection = connect(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for attachment_id in attachment_ids {
        let updated = transaction.execute(
            "UPDATE attachments SET message_id = ?1 WHERE id = ?2 AND conversation_id = (SELECT conversation_id FROM messages WHERE id = ?1)",
            params![&message_id, attachment_id],
        ).map_err(|error| error.to_string())?;
        if updated != 1 {
            return Err("Attachment does not belong to this message's conversation".into());
        }
    }
    transaction.commit().map_err(|error| error.to_string())
}
