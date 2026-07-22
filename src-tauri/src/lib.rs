use std::sync::Arc;
use tauri_plugin_log::{Target, TargetKind};
use tokio::sync::Mutex;

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = Arc::new(Mutex::new(commands::DownloadManager::default()));

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::start_download,
            commands::cancel_download,
            commands::open_file,
            commands::open_in_folder,
            commands::delete_to_trash,
            commands::perform_yt_dlp_update,
        ])
        .setup(|app| {
            let level = if cfg!(feature = "diagnostic") || cfg!(debug_assertions) {
                log::LevelFilter::Info
            } else {
                log::LevelFilter::Error
            };
            let mut log_builder = tauri_plugin_log::Builder::default()
                .level(level)
                .target(Target::new(TargetKind::LogDir { file_name: None }));
            if cfg!(feature = "diagnostic") || cfg!(debug_assertions) {
                log_builder = log_builder.target(Target::new(TargetKind::Stdout));
            }
            app.handle().plugin(log_builder.build())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
