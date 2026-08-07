mod claude;
mod config;
mod data;
mod files;
mod git;

use claude::ClaudeProcesses;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            data::list_conversations,
            data::create_conversation,
            data::rename_conversation,
            data::touch_conversation,
            data::delete_conversation,
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
            git::git_diff,
            claude::check_claude,
            claude::send_claude,
            claude::interrupt_claude,
            claude::stop_claude,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Claude Desk");
}
