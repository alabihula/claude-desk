mod claude;
mod config;
mod context;
mod data;
mod files;
mod git;
mod platform;
mod skills;

use claude::ClaudeProcesses;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Register this first so an accidental recursive launch cannot create
        // another webview or repeat Claude health detection.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ClaudeProcesses::default())
        .setup(|app| {
            data::migrate(app.handle())
                .map_err(|error| -> Box<dyn std::error::Error> { error.into() })?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            data::list_projects,
            data::add_project,
            data::touch_project,
            data::remove_project,
            data::reorder_projects,
            data::list_conversations,
            data::create_conversation,
            data::rename_conversation,
            data::touch_conversation,
            data::delete_conversation,
            data::reorder_conversations,
            data::load_context_stats,
            data::refresh_context_stats,
            data::list_messages,
            data::save_message,
            data::list_attachments,
            data::link_attachments,
            data::load_settings,
            data::save_settings,
            config::load_claude_settings,
            config::save_claude_settings,
            files::copy_attachment,
            files::save_clipboard_image,
            files::resolve_local_files,
            files::download_file,
            files::read_project_file,
            files::open_in_editor,
            files::reveal_path,
            files::open_terminal,
            git::git_status,
            git::git_environment,
            git::git_diff,
            git::git_commit,
            skills::list_claude_skills,
            claude::check_claude,
            claude::send_claude,
            claude::interrupt_claude,
            claude::stop_claude,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Claude Desk");
}
