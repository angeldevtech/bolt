use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use log::info;
use serde::Serialize;
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager};
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

const YT_DLP_RESOURCE: &str = "tools/yt-dlp.exe";
const FFMPEG_RESOURCE: &str = "tools/ffmpeg.exe";

fn resolve_tools(app: &AppHandle) -> Result<(std::path::PathBuf, std::path::PathBuf), String> {
    let resource_yt_dlp = app
        .path()
        .resolve(YT_DLP_RESOURCE, BaseDirectory::Resource)
        .map_err(|e| format!("No se pudo localizar yt-dlp incluido: {}", e))?;
    let ffmpeg = app
        .path()
        .resolve(FFMPEG_RESOURCE, BaseDirectory::Resource)
        .map_err(|e| format!("No se pudo localizar ffmpeg incluido: {}", e))?;
    let app_tools = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("No se pudo localizar AppLocalData: {}", e))?
        .join("tools");
    let writable_yt_dlp = app_tools.join("yt-dlp.exe");

    std::fs::create_dir_all(&app_tools)
        .map_err(|e| format!("No se pudo preparar AppLocalData: {}", e))?;
    if !writable_yt_dlp.is_file() {
        std::fs::copy(&resource_yt_dlp, &writable_yt_dlp)
            .map_err(|e| format!("No se pudo restaurar yt-dlp incluido: {}", e))?;
    }

    Ok((writable_yt_dlp, ffmpeg))
}

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    url: String,
    format: String,
    output_dir: String,
    state: tauri::State<'_, AppState>,
) -> Result<StartDownloadResult, String> {
    info!(
        "start_download called: url={}, format={}, output_dir={}",
        url, format, output_dir
    );

    if !url.starts_with("http://") && !url.starts_with("https://") {
        info!("start_download: invalid URL, returning error");
        return Err("URL inválida. Debe comenzar con http:// o https://".into());
    }

    let (yt_dlp_path, ffmpeg_path) = resolve_tools(&app)?;
    info!(
        "start_download: checking bundled yt-dlp at {:?}",
        yt_dlp_path
    );
    let yt_dlp_check = Command::new(&yt_dlp_path)
        .arg("--version")
        .output()
        .await
        .map_err(|_| {
            "yt-dlp incluido no pudo ejecutarse. Revisa el archivo de la aplicación.".to_string()
        })?;

    if !yt_dlp_check.status.success() {
        info!("start_download: yt-dlp not found");
        return Err("yt-dlp no encontrado".to_string());
    }

    info!("start_download: checking ffmpeg...");
    let ffmpeg_check = Command::new(&ffmpeg_path)
        .arg("-version")
        .output()
        .await
        .map_err(|_| {
            "ffmpeg incluido no pudo ejecutarse. Revisa el archivo de la aplicación.".to_string()
        })?;

    if !ffmpeg_check.status.success() {
        info!("start_download: ffmpeg not found");
        return Err("ffmpeg no encontrado".to_string());
    }

    info!("start_download: fetching title...");
    let title = match tokio::time::timeout(
        Duration::from_secs(10),
        Command::new(&yt_dlp_path)
            .arg("--encoding")
            .arg("utf-8")
            .arg("--get-title")
            .arg(&url)
            .output(),
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
    spawn_download_task(
        app,
        state.inner().clone(),
        id,
        url,
        format,
        output_dir,
        cancel_flag,
        yt_dlp_path,
        ffmpeg_path,
    );

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
    yt_dlp_path: std::path::PathBuf,
    ffmpeg_path: std::path::PathBuf,
) {
    info!(
        "spawn_download_task: starting for id={}, format={}",
        id, format
    );
    tokio::spawn(async move {
        let (format_selector, extra_args, output_template) = match format.as_str() {
            "mp3" => (
                "bestaudio",
                vec!["-x", "--audio-format", "mp3", "--audio-quality", "0"],
                "%(title)s.%(ext)s",
            ),
            "mp4-hd" => (
                "(bv*[height>=1080][vcodec~='^((he|a)vc|h26[45])']+ba)/(bv*[height>=1080]+ba)/(bv*+ba/b)",
                vec!["--merge-output-format", "mp4", "--remux-video", "mp4"],
                "%(title)s [HD].%(ext)s",
            ),
            _ => (
                "(bv*[height<=1080][height>=720][vcodec~='^((he|a)vc|h26[45])']+ba)/(bv*[height<=1080][height>=720]+ba)/(bv*+ba/b)",
                vec!["--merge-output-format", "mp4", "--remux-video", "mp4"],
                "%(title)s.%(ext)s",
            ),
        };

        let output_path = Path::new(&output_dir).join(output_template);
        let output_path_str = output_path.to_string_lossy().to_string();
        info!("spawn_download_task: output template: {}", output_path_str);

        let mut cmd = Command::new(&yt_dlp_path);
        cmd.arg("-f")
            .arg(format_selector)
            .arg("--newline")
            .arg("--encoding")
            .arg("utf-8")
            // Keep Unicode title characters and let yt-dlp report final path directly.
            .arg("--no-restrict-filenames")
            .arg("--no-windows-filenames")
            .arg("--ffmpeg-location")
            .arg(ffmpeg_path.parent().unwrap_or(&ffmpeg_path))
            .arg("--embed-thumbnail")
            .arg("--add-metadata")
            .arg("-o")
            .arg(&output_path_str)
            .arg("--print")
            .arg("after_move:__BOLT_FILE__%(filepath)s")
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
                                let path = normalize_reported_path(
                                    trimmed.trim_start_matches("__BOLT_FILE__"),
                                );
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

                info!(
                    "spawn_download_task: download complete, file={:?}, size={:.2}MB",
                    output_filename, size_mb
                );
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

fn normalize_reported_path(path: &str) -> String {
    let path = path.trim();

    // Older yt-dlp/shell based reporting could wrap Windows paths in quotes.
    // Quotes cannot be part of a Windows filename, so remove only matching edges.
    if path.len() >= 2 && path.starts_with('"') && path.ends_with('"') {
        return path[1..path.len() - 1].to_string();
    }

    path.to_string()
}

#[tauri::command]
pub async fn cancel_download(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
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
        let parent = Path::new(path).parent().unwrap_or(Path::new("/"));
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
    trash::delete_all(&[path.as_ref() as &Path])
        .map_err(|e| format!("Error al mover a la papelera: {}", e))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YtDlpUpdateResult {
    pub updated: bool,
    pub output: String,
}

#[tauri::command]
pub async fn perform_yt_dlp_update(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<YtDlpUpdateResult, String> {
    if !state.lock().await.cancel_flags.is_empty() {
        return Err("No se puede actualizar mientras haya descargas activas.".into());
    }

    let (yt_dlp_path, _) = resolve_tools(&app)?;
    let backup_path = yt_dlp_path.with_extension("exe.bak");
    std::fs::copy(&yt_dlp_path, &backup_path)
        .map_err(|e| format!("No se pudo preparar copia de seguridad de yt-dlp: {}", e))?;

    info!("perform_yt_dlp_update: running bundled writable yt-dlp -U");
    let output = tokio::process::Command::new(&yt_dlp_path)
        .arg("-U")
        .arg("--no-color")
        .output()
        .await
        .map_err(|e| format!("Error al ejecutar yt-dlp -U: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = [stdout.as_ref(), stderr.as_ref()]
        .iter()
        .filter(|part| !part.is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join("\n");

    if output.status.success() || combined.to_lowercase().contains("up to date") {
        let _ = std::fs::remove_file(&backup_path);
        info!("perform_yt_dlp_update: success");
        Ok(YtDlpUpdateResult {
            updated: true,
            output: combined.trim().to_string(),
        })
    } else {
        let _ = std::fs::copy(&backup_path, &yt_dlp_path);
        let _ = std::fs::remove_file(&backup_path);
        info!("perform_yt_dlp_update: failed: {}", combined.trim());
        Err(format!("Error al actualizar: {}", combined.trim()))
    }
}
