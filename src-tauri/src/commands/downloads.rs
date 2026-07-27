use std::path::Path;
use std::process::{ExitStatus, Stdio};
use std::sync::Arc;
use std::time::Duration;

use log::{error, info};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

use super::manager::{
    clamp_concurrency, discard_queued_job, release_active_job, schedule_downloads, AppState,
};
use super::process::{
    configure_child, finish_line_reader, run_managed_command, terminate_managed_child,
    wait_for_cancellation, JobControl, CANCELLATION_ERROR,
};
use super::tools::{deno_runtime_arg, preflight_tools, resolve_tools};
use super::types::{
    CompletePayload, DownloadTaskOutcome, ErrorPayload, ProgressPayload, QueuedDownload,
    ResolvedTools, StartDownloadResult, StartedPayload,
};
use super::youtube;

fn sanitized_url(url: &str) -> String {
    url.split('?').next().unwrap_or(url).to_string()
}

pub(super) fn classify_error(text: &str) -> &'static str {
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

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    id: String,
    url: String,
    format: String,
    output_dir: String,
    state: tauri::State<'_, AppState>,
) -> Result<StartDownloadResult, String> {
    info!(
        "start_download called: id={}, url={}, format={}, output_dir={}",
        id,
        sanitized_url(&url),
        format,
        output_dir
    );

    if id.trim().is_empty() {
        return Err("ID de descarga vacío".into());
    }

    if format != "mp3" && format != "mp4" && format != "mp4-hd" {
        return Err("Formato de descarga no válido".into());
    }
    if output_dir.trim().is_empty() {
        return Err("Directorio de salida vacío".into());
    }

    // Validate and canonicalize YouTube URLs at the Rust boundary.
    let canonical_url = match youtube::classify_url(&url) {
        Ok(source) => {
            match source.source_type {
                youtube::YouTubeSourceType::Generic => source.canonical_url,
                youtube::YouTubeSourceType::Radio => {
                    return Err("No se puede descargar un mix o radio de YouTube.".into());
                }
                youtube::YouTubeSourceType::Playlist => {
                    return Err("Usa la función de playlist para descargar una lista de reproducción.".into());
                }
                youtube::YouTubeSourceType::VideoPlusPlaylist | youtube::YouTubeSourceType::Video => {
                    source.canonical_url
                }
            }
        }
        Err(error) => return Err(error),
    };

    let control = Arc::new(JobControl::default());
    {
        let mut manager = state.lock().await;
        if !manager.accepting_jobs {
            return Err("La aplicación se está cerrando".into());
        }
        if manager.yt_dlp_operation == Some(super::types::YtDlpOperation::Update) {
            return Err("No se puede iniciar una descarga mientras se actualiza yt-dlp".into());
        }
        if manager.active_jobs.contains_key(&id)
            || manager.queued_jobs.iter().any(|job| job.id == id)
        {
            info!("start_download: duplicate active id rejected: {}", id);
            return Err("Ya existe una descarga activa con ese ID".into());
        }
        manager.queued_jobs.push_back(QueuedDownload {
            id: id.clone(),
            url: canonical_url.clone(),
            format: format.clone(),
            output_dir: output_dir.clone(),
            control: control.clone(),
            tools: None,
        });
        info!("download {} registered", id);
    }

    let preparation = async {
        let tools = resolve_tools(&app)?;
        if control.is_cancelled() {
            return Err(CANCELLATION_ERROR.into());
        }
        preflight_tools(&tools, control.clone()).await?;
        if control.is_cancelled() {
            return Err(CANCELLATION_ERROR.into());
        }

        info!(
            "start_download: checking bundled yt-dlp at {:?}",
            tools.yt_dlp
        );
        info!("start_download: fetching title...");
        let mut command = Command::new(&tools.yt_dlp);
        command
            .arg("--ignore-config")
            .arg("--js-runtimes")
            .arg(deno_runtime_arg(&tools.deno))
            .arg("--encoding")
            .arg("utf-8")
            .arg("--no-playlist")
            .arg("--get-title")
            .arg(&canonical_url);
        let title = match run_managed_command(
            command,
            control.clone(),
            Some(Duration::from_secs(10)),
        )
        .await
        {
            Ok(Some(output)) if output.status.success() => {
                let title = String::from_utf8_lossy(&output.stdout).trim().to_string();
                info!("start_download: title fetched: {}", title);
                if title.is_empty() {
                    url.clone()
                } else {
                    title
                }
            }
            Ok(None) if control.is_cancelled() => return Err(CANCELLATION_ERROR.into()),
            Ok(None) => {
                info!("start_download: title process ended without output, using url as title");
                url.clone()
            }
            Ok(Some(_)) | Err(_) => {
                info!("start_download: title fetch failed or timed out, using url as title");
                url.clone()
            }
        };

        Ok::<_, String>((tools, title))
    }
    .await;

    let (tools, title) = match preparation {
        Ok(result) => result,
        Err(error) => {
            let cancelled = control.is_cancelled();
            discard_queued_job(&app, state.inner(), &id).await;
            if cancelled {
                emit_cancelled_download(&app, &id);
                return Err(CANCELLATION_ERROR.into());
            }
            return Err(error);
        }
    };

    let (cancelled, should_emit_cancellation) = {
        let mut manager = state.lock().await;
        match manager.queued_jobs.iter().position(|job| job.id == id) {
            None => (true, false),
            Some(index) if control.is_cancelled() => {
                manager.queued_jobs.remove(index);
                (true, true)
            }
            Some(index) => {
                manager.queued_jobs[index].tools = Some(tools);
                (false, false)
            }
        }
    };

    if cancelled {
        if should_emit_cancellation {
            emit_cancelled_download(&app, &id);
        }
        schedule_downloads(app.clone(), state.inner().clone()).await;
        return Err(CANCELLATION_ERROR.into());
    }

    let result = StartDownloadResult {
        id: id.clone(),
        title,
    };

    schedule_downloads(app, state.inner().clone()).await;

    Ok(result)
}

fn emit_cancelled_download(app: &AppHandle, id: &str) {
    let _ = app.emit(
        "download_error",
        ErrorPayload {
            id: id.to_string(),
            error_msg: CANCELLATION_ERROR.into(),
            cancelled: true,
        },
    );
}

pub(super) fn spawn_download_task(
    app: AppHandle,
    state: AppState,
    id: String,
    url: String,
    format: String,
    output_dir: String,
    control: Arc<JobControl>,
    tools: ResolvedTools,
) {
    info!(
        "spawn_download_task: starting for id={}, format={}",
        id, format
    );
    tokio::spawn(async move {
        let outcome = async {
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

            if control.is_cancelled() {
                return DownloadTaskOutcome::Cancelled;
            }

            let mut cmd = Command::new(&tools.yt_dlp);
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
                .arg("--no-playlist")
                .arg(&url);

            for arg in &extra_args {
                cmd.arg(arg);
            }
            configure_child(&mut cmd);

            info!("spawn_download_task: spawning yt-dlp process...");
            let mut child = match cmd
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
            {
                Ok(child) => child,
                Err(error) => {
                    info!("spawn_download_task: failed to spawn yt-dlp: {}", error);
                    return DownloadTaskOutcome::Error(format!(
                        "Error al iniciar yt-dlp: {}",
                        error
                    ));
                }
            };
            let owner = match super::process::ProcessOwner::for_child(&child) {
                Ok(owner) => owner,
                Err(error) => {
                    let _ = terminate_managed_child(&mut child, &control).await;
                    return DownloadTaskOutcome::Error(error);
                }
            };
            control.set_process_owner(owner);
            if control.is_cancelled() {
                let outcome = match terminate_managed_child(&mut child, &control).await {
                    Ok(_) => DownloadTaskOutcome::Cancelled,
                    Err(error) => DownloadTaskOutcome::Error(error),
                };
                control.clear_process_owner();
                return outcome;
            }
            info!("spawn_download_task: yt-dlp process spawned successfully");
            let _ = app.emit("download_started", StartedPayload { id: id.clone() });

            let stdout = match child.stdout.take() {
                Some(stdout) => stdout,
                None => {
                    let error = terminate_managed_child(&mut child, &control)
                        .await
                        .err()
                        .unwrap_or_else(|| "El proceso no expuso stdout".into());
                    control.clear_process_owner();
                    return DownloadTaskOutcome::Error(error);
                }
            };
            let stderr = match child.stderr.take() {
                Some(stderr) => stderr,
                None => {
                    let error = terminate_managed_child(&mut child, &control)
                        .await
                        .err()
                        .unwrap_or_else(|| "El proceso no expuso stderr".into());
                    control.clear_process_owner();
                    return DownloadTaskOutcome::Error(error);
                }
            };
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
            let mut termination_status: Option<Result<ExitStatus, String>> = None;

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
                    _ = wait_for_cancellation(control.clone()) => {
                        info!("spawn_download_task: cancel requested for id={}", id);
                        line_rx.close();
                        termination_status = Some(terminate_managed_child(&mut child, &control).await);
                        break;
                    }
                }
            }

            let stdout_result = finish_line_reader(stdout_task, "stdout").await;
            if let Err(error) = stdout_result {
                line_rx.close();
                let termination_error = if let Some(status) = &termination_status {
                    status.as_ref().err().cloned()
                } else {
                    terminate_managed_child(&mut child, &control).await.err()
                };
                let _ = finish_line_reader(stderr_task, "stderr").await;
                control.clear_process_owner();
                return DownloadTaskOutcome::Error(match termination_error {
                    Some(termination_error) => format!("{} ({})", error, termination_error),
                    None => error,
                });
            }
            let stderr_result = finish_line_reader(stderr_task, "stderr").await;
            if let Err(error) = stderr_result {
                line_rx.close();
                let termination_error = if let Some(status) = &termination_status {
                    status.as_ref().err().cloned()
                } else {
                    terminate_managed_child(&mut child, &control).await.err()
                };
                control.clear_process_owner();
                return DownloadTaskOutcome::Error(match termination_error {
                    Some(termination_error) => format!("{} ({})", error, termination_error),
                    None => error,
                });
            }

            let status = match termination_status {
                Some(status) => status,
                None => tokio::select! {
                    status = child.wait() => status
                        .map_err(|error| format!("No se pudo esperar a yt-dlp: {}", error)),
                    _ = wait_for_cancellation(control.clone()) => {
                        info!("spawn_download_task: cancel requested while waiting for id={}", id);
                        terminate_managed_child(&mut child, &control).await
                    }
                },
            };
            info!("spawn_download_task: process exited, status={:?}", status);
            control.clear_process_owner();

            let status = match status {
                Ok(status) => status,
                Err(error) => return DownloadTaskOutcome::Error(error),
            };
            if control.is_cancelled() {
                return DownloadTaskOutcome::Cancelled;
            }

            if status.success() {
                let file_path = output_filename.unwrap_or_default();
                let size_mb = if file_path.is_empty() {
                    0.0
                } else {
                    std::fs::metadata(&file_path)
                        .map(|metadata| metadata.len() as f64 / 1_048_576.0)
                        .unwrap_or(0.0)
                };
                return DownloadTaskOutcome::Completed { file_path, size_mb };
            }

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
            DownloadTaskOutcome::Error(error_msg)
        }
        .await;

        let active_job_removed = release_active_job(&state, &id).await;
        match outcome {
            DownloadTaskOutcome::Completed { file_path, size_mb } => {
                info!(
                    "spawn_download_task: download complete, file={}, size={:.2}MB",
                    file_path, size_mb
                );
                let _ = app.emit(
                    "download_complete",
                    CompletePayload {
                        id: id.clone(),
                        file_path,
                        size_mb,
                    },
                );
            }
            DownloadTaskOutcome::Cancelled => {
                emit_cancelled_download(&app, &id);
            }
            DownloadTaskOutcome::Error(error_msg) => {
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

        if active_job_removed {
            schedule_downloads(app, state.clone()).await;
        }
    });
}

pub(super) fn parse_progress(line: &str) -> Option<f64> {
    let line = line.trim();
    if !line.starts_with("[download]") {
        return None;
    }
    let pct_pos = line.find('%')?;
    let before = &line[..pct_pos];
    let num_str = before.split_whitespace().last()?;
    num_str.parse::<f64>().ok()
}

pub(super) fn normalize_reported_path(path: &str) -> String {
    let path = path.trim();

    // Older yt-dlp/shell based reporting could wrap Windows paths in quotes.
    // Quotes cannot be part of a Windows filename, so remove only matching edges.
    if path.len() >= 2 && path.starts_with('"') && path.ends_with('"') {
        return path[1..path.len() - 1].to_string();
    }

    path.to_string()
}

#[tauri::command]
pub async fn cancel_download(
    app: AppHandle,
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    info!("cancel_download called: id={}", id);
    let (emit_cancelled, schedule_after_removal) = {
        let mut manager = state.lock().await;
        if let Some((emit_cancelled, schedule_after_removal)) = manager.cancel_queued_job(&id) {
            if schedule_after_removal {
                info!("cancel_download: queued job removed");
            } else {
                info!("cancel_download: cancellation recorded for preparing job");
            }
            (emit_cancelled, schedule_after_removal)
        } else if let Some(control) = manager.active_jobs.get(&id) {
            if control.request_cancellation() {
                info!("cancel_download: active job cancellation requested");
            } else {
                info!("cancel_download: cancellation already requested");
            }
            (false, false)
        } else {
            info!("cancel_download: id not found or already finished");
            return Err("Descarga no encontrada o ya finalizada".into());
        }
    };

    if emit_cancelled {
        emit_cancelled_download(&app, &id);
    }
    if schedule_after_removal {
        schedule_downloads(app, state.inner().clone()).await;
    }

    Ok(())
}

#[tauri::command]
pub async fn set_download_concurrency(
    app: AppHandle,
    max_concurrent: u32,
    state: tauri::State<'_, AppState>,
) -> Result<u32, String> {
    let limit = clamp_concurrency(max_concurrent);
    {
        let mut manager = state.lock().await;
        manager.max_concurrent = limit;
        info!("download concurrency limit set to {}", limit);
    }

    schedule_downloads(app, state.inner().clone()).await;
    Ok(limit as u32)
}
