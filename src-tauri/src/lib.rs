use std::sync::Arc;
use tauri_plugin_log::{Target, TargetKind};
use tokio::sync::Mutex;

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = Arc::new(Mutex::new(commands::DownloadManager::default()));
    let exit_state = app_state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::downloads::start_download,
            commands::downloads::cancel_download,
            commands::downloads::set_download_concurrency,
            commands::files::open_file,
            commands::files::open_in_folder,
            commands::files::delete_to_trash,
            commands::updater::check_yt_dlp_update,
            commands::updater::perform_yt_dlp_update,
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if commands::shutdown_complete(&exit_state) {
                    return;
                }

                api.prevent_exit();
                let state = exit_state.clone();
                let app = app.clone();
                let exit_code = code.unwrap_or(0);
                tauri::async_runtime::spawn(async move {
                    if commands::begin_shutdown(&state).await {
                        commands::shutdown_downloads(state).await;
                        app.exit(exit_code);
                    }
                });
            }
        });
}
