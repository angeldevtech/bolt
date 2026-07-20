use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use log::info;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressPayload {
    pub id: String,
    pub progress: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletePayload {
    pub id: String,
    pub file_path: String,
    pub size_mb: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorPayload {
    pub id: String,
    pub error_msg: String,
}

#[derive(Clone, Serialize)]
pub struct StartDownloadResult {
    id: String,
    title: String,
}

#[derive(Default)]
pub struct DownloadManager {
    pub cancel_flags: HashMap<String, Arc<AtomicBool>>,
}

pub type AppState = Arc<Mutex<DownloadManager>>;

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    url: String,
    format: String,
    output_dir: String,
    state: tauri::State<'_, AppState>,
) -> Result<StartDownloadResult, String> {
    info!("start_download called: url={}, format={}, output_dir={}", url, format, output_dir);

    if !url.starts_with("http://") && !url.starts_with("https://") {
        info!("start_download: invalid URL, returning error");
        return Err("URL inválida. Debe comenzar con http:// o https://".into());
    }

    info!("start_download: checking yt-dlp...");
    let yt_dlp_check = Command::new("yt-dlp")
        .arg("--version")
        .output()
        .await
        .map_err(|_| {
            "yt-dlp no encontrado. Asegúrate de que esté instalado y accesible en PATH.".to_string()
        })?;

    if !yt_dlp_check.status.success() {
        info!("start_download: yt-dlp not found");
        return Err("yt-dlp no encontrado".to_string());
    }

    info!("start_download: checking ffmpeg...");
    let ffmpeg_check = Command::new("ffmpeg")
        .arg("-version")
        .output()
        .await
        .map_err(|_| {
            "ffmpeg no encontrado. Necesario para la conversión de audio/video.".to_string()
        })?;

    if !ffmpeg_check.status.success() {
        info!("start_download: ffmpeg not found");
        return Err("ffmpeg no encontrado".to_string());
    }

    info!("start_download: fetching title...");
    let title = match tokio::time::timeout(
        Duration::from_secs(10),
        Command::new("yt-dlp").arg("--get-title").arg(&url).output(),
    )
    .await
    {
        Ok(Ok(output)) if output.status.success() => {
            let t = String::from_utf8_lossy(&output.stdout).trim().to_string();
            info!("start_download: title fetched: {}", t);
            t
        }
        _ => {
            info!("start_download: title fetch failed or timed out, using url as title");
            url.clone()
        }
    };

    let id = uuid::Uuid::new_v4().to_string();
    info!("start_download: assigned id={}", id);
    let cancel_flag = Arc::new(AtomicBool::new(false));

    {
        let mut manager = state.lock().await;
        manager.cancel_flags.insert(id.clone(), cancel_flag.clone());
    }

    let result = StartDownloadResult {
        id: id.clone(),
        title,
    };

    info!("start_download: spawning download task...");
    spawn_download_task(app, state.inner().clone(), id, url, format, output_dir, cancel_flag);

    Ok(result)
}

fn spawn_download_task(
    app: AppHandle,
    state: AppState,
    id: String,
    url: String,
    format: String,
    output_dir: String,
    cancel_flag: Arc<AtomicBool>,
) {
    info!("spawn_download_task: starting for id={}, format={}", id, format);
    tokio::spawn(async move {
        let (format_selector, extra_args, output_template) = match format.as_str() {
            "mp3" => (
                "bestaudio",
                vec!["-x", "--audio-format", "mp3", "--audio-quality", "0"],
                "%(title)s.%(ext)s",
            ),
            "mp4-hd" => (
                "bestvideo[height>=1080]+bestaudio/best",
                vec!["--merge-output-format", "mp4"],
                "%(title)s [HD].%(ext)s",
            ),
            _ => (
                "bestvideo[height<=1080][height>=720]+bestaudio/best[height<=1080]+bestaudio/best[height<=1080]/best",
                vec!["--merge-output-format", "mp4"],
                "%(title)s.%(ext)s",
            ),
        };

        let output_path = Path::new(&output_dir).join(output_template);
        let output_path_str = output_path.to_string_lossy().to_string();
        info!("spawn_download_task: output template: {}", output_path_str);

let mut cmd = Command::new("yt-dlp");
        cmd.arg("-f")
            .arg(format_selector)
            .arg("--newline")
            .arg("--embed-thumbnail")
            .arg("--add-metadata")
            .arg("-o")
            .arg(&output_path_str)
            .arg("--exec")
            .arg("echo __BOLT_FILE__{}")
            .arg(&url);

        for arg in &extra_args {
            cmd.arg(arg);
        }

        info!("spawn_download_task: spawning yt-dlp process...");
        let mut child = match cmd
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                info!("spawn_download_task: failed to spawn yt-dlp: {}", e);
                let _ = app.emit(
                    "download_error",
                    ErrorPayload {
                        id: id.clone(),
                        error_msg: format!("Error al iniciar yt-dlp: {}", e),
                    },
                );
                let mut manager = state.lock().await;
                manager.cancel_flags.remove(&id);
                return;
            }
        };
        info!("spawn_download_task: yt-dlp process spawned successfully");

        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let mut reader = BufReader::new(stdout).lines();
        let mut stderr_lines = Vec::new();

        let mut output_filename: Option<String> = None;

        loop {
            tokio::select! {
                line = reader.next_line() => {
                    match line {
                        Ok(Some(trimmed)) => {
                            if trimmed.is_empty() {
                                continue;
                            }

                            if let Some(pct) = parse_progress(&trimmed) {
                                let _ = app.emit(
                                    "download_progress",
                                    ProgressPayload {
                                        id: id.clone(),
                                        progress: pct,
                                    },
                                );
                            } else if trimmed.starts_with("__BOLT_FILE__") {
                                let path = trimmed.trim_start_matches("__BOLT_FILE__").to_string();
                                info!("spawn_download_task: captured output filename: {}", path);
                                output_filename = Some(path);
                            }
                        }
                        Ok(None) => break,
                        Err(_) => break,
                    }
                }
                _ = tokio::time::sleep(Duration::from_millis(200)) => {
                    // yield to check cancel flag
                }
            }

            if cancel_flag.load(Ordering::SeqCst) {
                info!("spawn_download_task: cancel requested for id={}", id);
                let _ = child.kill().await;
                let _ = app.emit(
                    "download_error",
                    ErrorPayload {
                        id: id.clone(),
                        error_msg: "Descarga cancelada por el usuario".into(),
                    },
                );
                let mut manager = state.lock().await;
                manager.cancel_flags.remove(&id);
                return;
            }
        }

        let mut stderr_reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = stderr_reader.next_line().await {
            if !line.contains("WARNING") {
                stderr_lines.push(line);
            }
        }

        let status = child.wait().await;
        info!("spawn_download_task: process exited, status={:?}", status);

        match status {
            Ok(exit_status) if exit_status.success() => {
                let size_mb = output_filename
                    .as_ref()
                    .and_then(|p| std::fs::metadata(p).ok())
                    .map(|m| m.len() as f64 / 1_048_576.0)
                    .unwrap_or(0.0);

                info!("spawn_download_task: download complete, file={:?}, size={:.2}MB", output_filename, size_mb);
                let _ = app.emit(
                    "download_complete",
                    CompletePayload {
                        id: id.clone(),
                        file_path: output_filename.unwrap_or_default(),
                        size_mb,
                    },
                );
            }
            _ => {
                let error_msg = if stderr_lines.is_empty() {
                    "Error desconocido durante la descarga".into()
                } else {
                    stderr_lines.join("\n")
                };

                info!("spawn_download_task: download error: {}", error_msg);
                let _ = app.emit(
                    "download_error",
                    ErrorPayload {
                        id: id.clone(),
                        error_msg,
                    },
                );
            }
        }

        let mut manager = state.lock().await;
        manager.cancel_flags.remove(&id);
        info!("spawn_download_task: cleanup done for id={}", id);
    });
}

fn parse_progress(line: &str) -> Option<f64> {
    let line = line.trim();
    if !line.starts_with("[download]") {
        return None;
    }
    let pct_pos = line.find('%')?;
    let before = &line[..pct_pos];
    let num_str = before.split_whitespace().last()?;
    num_str.parse::<f64>().ok()
}

#[tauri::command]
pub async fn cancel_download(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    info!("cancel_download called: id={}", id);
    let mut manager = state.lock().await;
    if let Some(flag) = manager.cancel_flags.remove(&id) {
        info!("cancel_download: flag found, setting cancel");
        flag.store(true, Ordering::SeqCst);
        Ok(())
    } else {
        info!("cancel_download: id not found or already finished");
        Err("Descarga no encontrada o ya finalizada".into())
    }
}

#[tauri::command]
pub async fn open_file(file_path: String) -> Result<(), String> {
    info!("open_file called: path={}", file_path);
    let path = file_path.trim();
    if path.is_empty() {
        return Err("Ruta de archivo vacía".into());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", path])
            .spawn()
            .map_err(|e| format!("Error al abrir archivo: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Error al abrir archivo: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Error al abrir archivo: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn open_in_folder(file_path: String) -> Result<(), String> {
    let path = file_path.trim();
    if path.is_empty() {
        return Err("Ruta de archivo vacía".into());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Error al abrir carpeta: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Error al abrir carpeta: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        let parent = Path::new(path)
            .parent()
            .unwrap_or(Path::new("/"));
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("Error al abrir carpeta: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn delete_to_trash(file_path: String) -> Result<(), String> {
    let path = file_path.trim();
    if path.is_empty() {
        return Err("Ruta de archivo vacía".into());
    }
    trash::delete_all(&[path.as_ref() as &Path]).map_err(|e| format!("Error al mover a la papelera: {}", e))
}

#[tauri::command]
pub async fn check_yt_dlp_update() -> Result<bool, String> {
    info!("check_yt_dlp_update: returning false (stub)");
    Ok(false)
}

#[tauri::command]
pub async fn perform_yt_dlp_update() -> Result<bool, String> {
    info!("perform_yt_dlp_update: running yt-dlp -U");
    let output = tokio::process::Command::new("yt-dlp")
        .arg("-U")
        .arg("--no-color")
        .output()
        .await
        .map_err(|e| format!("Error al ejecutar yt-dlp -U: {}", e))?;

    if output.status.success() {
        info!("perform_yt_dlp_update: success");
        Ok(true)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.to_lowercase().contains("up to date") {
            info!("perform_yt_dlp_update: already up to date");
            Ok(true)
        } else {
            info!("perform_yt_dlp_update: failed: {}", stderr.trim());
            Err(format!("Error al actualizar: {}", stderr.trim()))
        }
    }
}