use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Output;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use log::{error, info};
use serde::Serialize;
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;
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
    #[serde(default)]
    pub cancelled: bool,
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
const DENO_RESOURCE: &str = "tools/deno.exe";

#[derive(Clone)]
struct ResolvedTools {
    packaged_yt_dlp: PathBuf,
    yt_dlp: PathBuf,
    ffmpeg: PathBuf,
    deno: PathBuf,
}

fn configure_child(cmd: &mut Command) {
    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000);
    }
}

fn sanitized_url(url: &str) -> String {
    url.split('?').next().unwrap_or(url).to_string()
}

fn classify_error(text: &str) -> &'static str {
    let lower = text.to_ascii_lowercase();
    if lower.contains("no supported javascript runtime")
        || lower.contains("javascript runtime")
        || lower.contains("js runtime")
    {
        "Falta la dependencia de JavaScript incluida (Deno)."
    } else if lower.contains("403") || lower.contains("forbidden") {
        "Acceso rechazado (403). Actualiza yt-dlp o revisa autenticación."
    } else if lower.contains("expired") || lower.contains("url has expired") {
        "Enlace multimedia caducado. Reintenta la descarga."
    } else if lower.contains("sign in")
        || lower.contains("cookies")
        || lower.contains("authentication")
    {
        "YouTube requiere autenticación o cookies."
    } else if lower.contains("requested format") || lower.contains("format is not available") {
        "Formato no disponible para este video."
    } else if lower.contains("ffmpeg") || lower.contains("post-process") {
        "Falló el procesamiento multimedia. Revisa ffmpeg."
    } else if lower.contains("429")
        || lower.contains("too many requests")
        || lower.contains("rate limit")
    {
        "YouTube limitó las solicitudes. Espera y reintenta."
    } else {
        "No se pudo completar la descarga. Revisa el registro de diagnóstico."
    }
}

fn resolve_resource(app: &AppHandle, resource: &str, label: &str) -> Result<PathBuf, String> {
    let path = app
        .path()
        .resolve(resource, BaseDirectory::Resource)
        .map_err(|error| {
            format!(
                "No se pudo resolver {} incluido ({}) desde recursos de la aplicación: {}",
                label, resource, error
            )
        })?;

    match std::fs::metadata(&path) {
        Ok(metadata) if metadata.is_file() => Ok(path),
        Ok(_) => Err(format!(
            "El recurso {} no es un archivo ejecutable: {}",
            label,
            path.display()
        )),
        Err(error) => Err(format!(
            "No se pudo acceder al recurso {} en {}: {}",
            label,
            path.display(),
            error
        )),
    }
}

fn resolve_tools(app: &AppHandle) -> Result<ResolvedTools, String> {
    let packaged_yt_dlp = resolve_resource(app, YT_DLP_RESOURCE, "yt-dlp")?;
    let ffmpeg = resolve_resource(app, FFMPEG_RESOURCE, "ffmpeg")?;
    let deno = resolve_resource(app, DENO_RESOURCE, "Deno")?;
    let app_tools = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("No se pudo localizar AppLocalData: {}", error))?
        .join("tools");
    let writable_yt_dlp = app_tools.join("yt-dlp.exe");

    std::fs::create_dir_all(&app_tools).map_err(|error| {
        format!(
            "No se pudo preparar la carpeta de herramientas en {}: {}",
            app_tools.display(),
            error
        )
    })?;

    Ok(ResolvedTools {
        packaged_yt_dlp,
        yt_dlp: writable_yt_dlp,
        ffmpeg,
        deno,
    })
}

fn bounded_text(text: &str) -> String {
    const MAX_CHARS: usize = 2_000;
    let trimmed = text.trim();
    let bounded: String = trimmed.chars().take(MAX_CHARS).collect();
    if bounded.chars().count() < trimmed.chars().count() {
        format!("{}...", bounded)
    } else {
        bounded
    }
}

fn process_output_detail(output: &Output) -> String {
    let stderr = bounded_text(&String::from_utf8_lossy(&output.stderr));
    if !stderr.is_empty() {
        return stderr;
    }

    bounded_text(&String::from_utf8_lossy(&output.stdout))
}

async fn verify_executable(path: &Path, label: &str, args: &[&str]) -> Result<(), String> {
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => {}
        Ok(_) => {
            return Err(format!(
                "Dependencia {} inválida: {} no es un archivo",
                label,
                path.display()
            ));
        }
        Err(error) => {
            return Err(format!(
                "Dependencia {} no disponible en {}: {}",
                label,
                path.display(),
                error
            ));
        }
    }

    let mut command = Command::new(path);
    configure_child(&mut command);
    let output = command.args(args).output().await.map_err(|error| {
        format!(
            "Dependencia {} no pudo ejecutarse en {}: {}",
            label,
            path.display(),
            error
        )
    })?;

    if !output.status.success() {
        let detail = process_output_detail(&output);
        let detail = if detail.is_empty() {
            "sin salida del proceso".to_string()
        } else {
            detail
        };
        return Err(format!(
            "Dependencia {} no pudo ejecutarse en {} ({}): {}",
            label,
            path.display(),
            output.status,
            detail
        ));
    }

    Ok(())
}

fn restore_executable_atomically(source: &Path, destination: &Path) -> Result<(), String> {
    let parent = destination.parent().ok_or_else(|| {
        format!(
            "No se pudo determinar carpeta de destino para {}",
            destination.display()
        )
    })?;
    let temporary = parent.join(format!(".yt-dlp-restore-{}.tmp", uuid::Uuid::new_v4()));

    std::fs::copy(source, &temporary).map_err(|error| {
        let _ = std::fs::remove_file(&temporary);
        format!(
            "No se pudo copiar yt-dlp incluido desde {} a {}: {}",
            source.display(),
            temporary.display(),
            error
        )
    })?;

    let backup = parent.join(format!(".yt-dlp-restore-{}.bak", uuid::Uuid::new_v4()));
    let had_destination = match std::fs::metadata(destination) {
        Ok(metadata) if metadata.is_file() => true,
        Ok(_) => {
            let _ = std::fs::remove_file(&temporary);
            return Err(format!(
                "No se pudo restaurar yt-dlp porque destino no es un archivo: {}",
                destination.display()
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => {
            let _ = std::fs::remove_file(&temporary);
            return Err(format!(
                "No se pudo inspeccionar yt-dlp app-local en {}: {}",
                destination.display(),
                error
            ));
        }
    };

    if had_destination {
        if let Err(error) = std::fs::rename(destination, &backup) {
            let _ = std::fs::remove_file(&temporary);
            return Err(format!(
                "No se pudo apartar yt-dlp inválido en {}: {}",
                destination.display(),
                error
            ));
        }
    }

    if let Err(error) = std::fs::rename(&temporary, destination) {
        let restore_error = if had_destination {
            std::fs::rename(&backup, destination).err()
        } else {
            None
        };
        let _ = std::fs::remove_file(&temporary);
        return Err(match restore_error {
            Some(restore_error) => format!(
                "No se pudo reemplazar yt-dlp en {}: {}; tampoco se pudo restaurar copia anterior: {}",
                destination.display(),
                error,
                restore_error
            ),
            None => format!(
                "No se pudo reemplazar yt-dlp en {}: {}",
                destination.display(),
                error
            ),
        });
    }

    if had_destination {
        let _ = std::fs::remove_file(&backup);
    }

    Ok(())
}

async fn ensure_app_local_yt_dlp(tools: &ResolvedTools) -> Result<(), String> {
    if let Err(original_error) =
        verify_executable(&tools.yt_dlp, "yt-dlp app-local", &["--version"]).await
    {
        info!(
            "yt-dlp app-local inválido en {}: {}; restaurando desde {}",
            tools.yt_dlp.display(),
            original_error,
            tools.packaged_yt_dlp.display()
        );
        restore_executable_atomically(&tools.packaged_yt_dlp, &tools.yt_dlp).map_err(
            |restore_error| {
                format!(
                    "yt-dlp app-local no pudo validarse ({}). No se pudo restaurar desde {} a {}: {}",
                    original_error,
                    tools.packaged_yt_dlp.display(),
                    tools.yt_dlp.display(),
                    restore_error
                )
            },
        )?;

        verify_executable(&tools.yt_dlp, "yt-dlp app-local restaurado", &["--version"])
            .await
            .map_err(|error| {
                format!(
                    "yt-dlp restaurado desde {} no pudo ejecutarse en {}: {}",
                    tools.packaged_yt_dlp.display(),
                    tools.yt_dlp.display(),
                    error
                )
            })?;
    }

    Ok(())
}

async fn preflight_tools(tools: &ResolvedTools) -> Result<(), String> {
    ensure_app_local_yt_dlp(tools).await?;
    verify_executable(&tools.ffmpeg, "ffmpeg incluido", &["-version"]).await?;
    verify_executable(
        &tools.deno,
        "Deno incluido (runtime JavaScript)",
        &["--version"],
    )
    .await
}

fn deno_runtime_arg(path: &Path) -> String {
    format!("deno:{}", path.display())
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
        sanitized_url(&url),
        format,
        output_dir
    );

    if !url.starts_with("http://") && !url.starts_with("https://") {
        info!("start_download: invalid URL, returning error");
        return Err("URL inválida. Debe comenzar con http:// o https://".into());
    }

    let tools = resolve_tools(&app)?;
    preflight_tools(&tools).await?;
    info!(
        "start_download: checking bundled yt-dlp at {:?}",
        tools.yt_dlp
    );

    info!("start_download: fetching title...");
    let title = match tokio::time::timeout(
        Duration::from_secs(10),
        {
            let mut command = Command::new(&tools.yt_dlp);
            configure_child(&mut command);
            command
        }
        .arg("--ignore-config")
        .arg("--js-runtimes")
        .arg(deno_runtime_arg(&tools.deno))
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
        tools,
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
    tools: ResolvedTools,
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

        let mut cmd = Command::new(&tools.yt_dlp);
        configure_child(&mut cmd);
        cmd.arg("-f")
            .arg(format_selector)
            .arg("--newline")
            .arg("--ignore-config")
            .arg("--js-runtimes")
            .arg(deno_runtime_arg(&tools.deno))
            .arg("--encoding")
            .arg("utf-8")
            // Keep Unicode title characters and let yt-dlp report final path directly.
            .arg("--no-restrict-filenames")
            .arg("--no-windows-filenames")
            .arg("--ffmpeg-location")
            .arg(tools.ffmpeg.parent().unwrap_or(&tools.ffmpeg))
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
                        cancelled: false,
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
        let (line_tx, mut line_rx) = mpsc::channel::<(bool, String)>(64);
        let stdout_tx = line_tx.clone();
        let stderr_tx = line_tx.clone();
        let stdout_task = tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if stdout_tx.send((false, line)).await.is_err() {
                    break;
                }
            }
        });
        let stderr_task = tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if stderr_tx.send((true, line)).await.is_err() {
                    break;
                }
            }
        });
        drop(line_tx);
        let mut output_filename: Option<String> = None;
        let mut stderr_tail: Vec<String> = Vec::new();
        let mut stdout_tail: Vec<String> = Vec::new();

        loop {
            tokio::select! {
                line = line_rx.recv() => {
                    let Some((is_stderr, trimmed)) = line else { break; };
                    if trimmed.is_empty() { continue; }
                    let tail = if is_stderr { &mut stderr_tail } else { &mut stdout_tail };
                    tail.push(trimmed.clone());
                    if tail.len() > 40 { tail.remove(0); }
                    if let Some(pct) = parse_progress(&trimmed) {
                        let _ = app.emit("download_progress", ProgressPayload { id: id.clone(), progress: pct });
                    } else if trimmed.starts_with("__BOLT_FILE__") {
                        let path = normalize_reported_path(trimmed.trim_start_matches("__BOLT_FILE__"));
                        info!("download {} output filename: {}", id, path);
                        output_filename = Some(path);
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
                        cancelled: true,
                    },
                );
                let _ = stdout_task.await;
                let _ = stderr_task.await;
                return;
            }
        }

        let _ = stdout_task.await;
        let _ = stderr_task.await;

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
                let diagnostic_tail = if stderr_tail.is_empty() {
                    stdout_tail.join("\n")
                } else {
                    stderr_tail.join("\n")
                };
                let error_msg = if diagnostic_tail.is_empty() {
                    "Error desconocido durante la descarga".into()
                } else {
                    format!("{} {}", classify_error(&diagnostic_tail), diagnostic_tail)
                };

                error!(
                    "download {} failed: status={:?}, stderr_tail={:?}, stdout_tail={:?}",
                    id, status, stderr_tail, stdout_tail
                );
                let _ = app.emit(
                    "download_error",
                    ErrorPayload {
                        id: id.clone(),
                        error_msg,
                        cancelled: false,
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
    let manager = state.lock().await;
    if let Some(flag) = manager.cancel_flags.get(&id) {
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
    let file = Path::new(path);
    if !file.is_file() {
        return Err("El archivo no existe o no es un archivo válido".into());
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        let operation: Vec<u16> = std::ffi::OsStr::new("open")
            .encode_wide()
            .chain(Some(0))
            .collect();
        let wide_path: Vec<u16> = file.as_os_str().encode_wide().chain(Some(0)).collect();
        let result = unsafe {
            windows_sys::Win32::UI::Shell::ShellExecuteW(
                std::ptr::null_mut(),
                operation.as_ptr(),
                wide_path.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL,
            )
        };
        if result as usize <= 32 {
            return Err(format!(
                "Error al abrir archivo (código {})",
                result as usize
            ));
        }
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
    if !Path::new(path).is_file() {
        return Err("El archivo no existe o no es un archivo válido".into());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer.exe")
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

    let tools = resolve_tools(&app)?;
    ensure_app_local_yt_dlp(&tools).await?;
    let yt_dlp_path = tools.yt_dlp;
    let backup_path = yt_dlp_path.with_extension("exe.bak");
    std::fs::copy(&yt_dlp_path, &backup_path)
        .map_err(|e| format!("No se pudo preparar copia de seguridad de yt-dlp: {}", e))?;

    info!("perform_yt_dlp_update: running bundled writable yt-dlp -U");
    let mut update_cmd = tokio::process::Command::new(&yt_dlp_path);
    configure_child(&mut update_cmd);
    let output = update_cmd
        .arg("-U")
        .arg("--ignore-config")
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

    let executable_is_valid = yt_dlp_path.is_file()
        && std::fs::metadata(&yt_dlp_path)
            .map(|metadata| metadata.len() > 0)
            .unwrap_or(false);
    if executable_is_valid
        && (output.status.success() || combined.to_lowercase().contains("up to date"))
    {
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
