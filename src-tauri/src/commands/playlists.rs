use std::sync::Arc;
use std::time::Duration;

use log::info;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::process::Command;

use super::manager::{AppState, DownloadManager};
use super::process::{bounded_text, run_managed_command, JobControl, CANCELLATION_ERROR};
use super::tools::{deno_runtime_arg, resolve_tools};
use super::youtube;

const INSPECTION_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_TITLE_LENGTH: usize = 500;
const MAX_DESCRIPTION_LENGTH: usize = 2000;

#[derive(Debug, Deserialize)]
struct YtDlpPlaylistJson {
    #[serde(default)]
    title: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    thumbnail: Option<String>,
    #[serde(default)]
    thumbnails: Option<Vec<YtDlpThumbnailJson>>,
    #[serde(default)]
    playlist_count: Option<i64>,
    #[serde(default)]
    entries: Option<Vec<Option<YtDlpEntryJson>>>,
}

#[derive(Debug, Deserialize)]
struct YtDlpThumbnailJson {
    #[serde(default)]
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct YtDlpEntryJson {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    #[serde(rename = "_type")]
    entry_type: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlaylistEntry {
    pub video_id: String,
    pub title: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlaylistMetadata {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_url: Option<String>,
    pub total: usize,
    pub entries: Vec<PlaylistEntry>,
    pub unavailable_count: usize,
    pub duplicate_count: usize,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlaylistQueueEntry {
    pub id: String,
    pub video_id: String,
    pub format: String,
    pub output_dir: String,
    pub title: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlaylistBatchPayload {
    pub entries: Vec<PlaylistQueueEntry>,
    pub group_id: String,
    pub playlist_id: String,
    pub playlist_title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playlist_description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playlist_thumbnail_url: Option<String>,
}

impl DownloadManager {
    pub(super) fn begin_playlist_inspection(
        &mut self,
        request_id: &str,
        control: Arc<JobControl>,
    ) -> Result<(), String> {
        if !self.accepting_jobs {
            return Err("La aplicación se está cerrando".into());
        }
        if self.yt_dlp_operation == Some(super::types::YtDlpOperation::Update) {
            return Err("No se puede inspeccionar una playlist mientras se actualiza yt-dlp".into());
        }
        if self.helper_jobs.contains_key(request_id) {
            return Err("Ya hay una inspección activa con ese ID".into());
        }
        self.helper_jobs.insert(request_id.to_string(), control);
        Ok(())
    }

    pub(super) fn finish_playlist_inspection(&mut self, request_id: &str) {
        self.helper_jobs.remove(request_id);
    }
}

async fn inspect_playlist_inner(
    playlist_id: &str,
    app: &AppHandle,
    control: Arc<JobControl>,
) -> Result<PlaylistMetadata, String> {
    if !youtube::validate_playlist_id(playlist_id) {
        return Err("ID de playlist no válido.".into());
    }
    if youtube::is_radio_playlist(playlist_id) {
        return Err("No se puede inspeccionar un mix o radio de YouTube como playlist.".into());
    }

    let tools = resolve_tools(app)?;
    let canonical_url = format!("https://www.youtube.com/playlist?list={}", playlist_id);

    info!("inspect_playlist: inspecting {}", canonical_url);

    if control.is_cancelled() {
        return Err(CANCELLATION_ERROR.into());
    }

    let mut cmd = Command::new(&tools.yt_dlp);
    cmd.arg("--ignore-config")
        .arg("--flat-playlist")
        .arg("--dump-single-json")
        .arg("--skip-download")
        .arg("--no-warnings")
        .arg("--no-color")
        .arg("--encoding")
        .arg("utf-8")
        .arg("--js-runtimes")
        .arg(deno_runtime_arg(&tools.deno))
        .arg(&canonical_url);

    let output = match run_managed_command(cmd, control.clone(), Some(INSPECTION_TIMEOUT)).await {
        Ok(Some(output)) => output,
        Ok(None) => return Err(CANCELLATION_ERROR.into()),
        Err(e) => {
            info!("inspect_playlist: command failed: {}", e);
            return Err(format!("Error al inspeccionar la playlist: {}", e));
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = stderr.trim();
        if detail.is_empty() {
            return Err("yt-dlp no pudo inspeccionar la playlist.".into());
        }
        return Err(format!("yt-dlp: {}", bounded_text(detail)));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json_data: YtDlpPlaylistJson = serde_json::from_str(&stdout)
        .map_err(|e| format!("No se pudo interpretar la respuesta de la playlist: {}", e))?;

    let raw_title = json_data.title.trim();
    if raw_title.is_empty() {
        return Err("La playlist no tiene título.".into());
    }
    let title: String = raw_title.chars().take(MAX_TITLE_LENGTH).collect();

    let description = json_data.description
        .filter(|d| !d.trim().is_empty())
        .map(|d| {
            let trimmed = d.trim();
            if trimmed.chars().count() > MAX_DESCRIPTION_LENGTH {
                format!(
                    "{}...",
                    trimmed
                        .chars()
                        .take(MAX_DESCRIPTION_LENGTH.saturating_sub(3))
                        .collect::<String>()
                )
            } else {
                trimmed.to_string()
            }
        });

    let thumbnail_url = json_data
        .thumbnail
        .filter(|thumbnail| youtube::validate_thumbnail_url(thumbnail))
        .or_else(|| {
            json_data
                .thumbnails
                .as_deref()
                .unwrap_or_default()
                .iter()
                .rev()
                .find_map(|thumbnail| {
                    thumbnail
                        .url
                        .as_deref()
                        .filter(|url| youtube::validate_thumbnail_url(url))
                        .map(str::to_owned)
                })
        });

    let count_from_json = json_data
        .playlist_count
        .filter(|count| *count > 0)
        .and_then(|count| usize::try_from(count).ok())
        .unwrap_or(0);

    let mut seen_ids = std::collections::HashSet::new();
    let mut entries = Vec::new();
    let mut unavailable_count = 0;
    let mut duplicate_count = 0;

    for entry in json_data.entries.unwrap_or_default() {
        let Some(entry) = entry else {
            unavailable_count += 1;
            continue;
        };
        if entry.entry_type.as_deref() == Some("playlist") {
            continue;
        }

        let entry_id = entry.id.as_deref().unwrap_or("");
        let entry_title = entry.title.as_deref().unwrap_or("");

        if entry_id.is_empty() || entry_title.is_empty() {
            unavailable_count += 1;
            continue;
        }

        if !youtube::validate_video_id(entry_id) {
            unavailable_count += 1;
            continue;
        }

        if seen_ids.contains(entry_id) {
            duplicate_count += 1;
            continue;
        }
        seen_ids.insert(entry_id.to_string());

        let bounded_title: String = entry_title.chars().take(200).collect();
        entries.push(PlaylistEntry {
            video_id: entry_id.to_string(),
            title: bounded_title,
        });
    }

    let total = if count_from_json > 0 && count_from_json >= entries.len() {
        count_from_json
    } else {
        entries.len() + unavailable_count + duplicate_count
    };

    if entries.is_empty() {
        return Err("No hay videos disponibles en esta playlist.".into());
    }

    info!(
        "inspect_playlist: title={}, total={}, entries={}, unavailable={}, duplicates={}",
        title,
        total,
        entries.len(),
        unavailable_count,
        duplicate_count
    );

    Ok(PlaylistMetadata {
        title,
        description,
        thumbnail_url,
        total,
        entries,
        unavailable_count,
        duplicate_count,
    })
}

#[tauri::command]
pub async fn inspect_playlist(
    app: AppHandle,
    playlist_id: String,
    request_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<PlaylistMetadata, String> {
    info!("inspect_playlist called: playlist_id={}, request_id={}", playlist_id, request_id);

    if !youtube::validate_playlist_id(&playlist_id) {
        return Err("ID de playlist no válido.".into());
    }

    let control = Arc::new(JobControl::default());
    {
        let mut manager = state.lock().await;
        manager.begin_playlist_inspection(&request_id, control.clone())?;
    }

    let result = inspect_playlist_inner(&playlist_id, &app, control).await;

    {
        let mut manager = state.lock().await;
        manager.finish_playlist_inspection(&request_id);
    }

    result
}

#[tauri::command]
pub async fn cancel_playlist_inspection(
    request_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    info!("cancel_playlist_inspection: request_id={}", request_id);

    let control = {
        let manager = state.lock().await;
        manager.helper_jobs.get(&request_id).cloned()
    };
    if let Some(control) = control {
        control.request_cancellation();
        if let Err(e) = control.terminate_process_tree() {
            info!("cancel_playlist_inspection: terminate error: {}", e);
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn queue_playlist_batch(
    app: AppHandle,
    payload: PlaylistBatchPayload,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    info!("queue_playlist_batch: {} entries for group={}", payload.entries.len(), payload.group_id);

    if payload.entries.is_empty() {
        return Err("No hay entradas para encolar.".into());
    }
    if !youtube::validate_playlist_id(&payload.playlist_id) {
        return Err("ID de playlist no válido.".into());
    }
    if youtube::is_radio_playlist(&payload.playlist_id) {
        return Err("No se puede encolar un mix o radio como playlist.".into());
    }
    if payload.group_id.trim().is_empty() || payload.group_id.len() > 100 {
        return Err("ID de grupo no válido.".into());
    }
    if payload.playlist_title.trim().is_empty()
        || payload.playlist_title.chars().count() > MAX_TITLE_LENGTH
    {
        return Err("Título de playlist no válido.".into());
    }
    if payload
        .playlist_description
        .as_ref()
        .is_some_and(|description| description.chars().count() > MAX_DESCRIPTION_LENGTH)
    {
        return Err("Descripción de playlist demasiado larga.".into());
    }
    if payload
        .playlist_thumbnail_url
        .as_ref()
        .is_some_and(|thumbnail| !youtube::validate_thumbnail_url(thumbnail))
    {
        return Err("Miniatura de playlist no válida.".into());
    }

    let tools = resolve_tools(&app)?;
    let preflight_key = format!("playlist-preflight-{}", uuid::Uuid::new_v4());
    let preflight_control = Arc::new(JobControl::default());

    let mut seen_ids = std::collections::HashSet::new();
    let mut seen_video_ids = std::collections::HashSet::new();

    for entry in &payload.entries {
        if entry.id.trim().is_empty() || entry.id.len() > 100 {
            return Err("ID de entrada vacío en la playlist.".into());
        }
        if !seen_ids.insert(entry.id.clone()) {
            return Err(format!("ID duplicado en la playlist: {}", entry.id));
        }
        if !youtube::validate_video_id(&entry.video_id) {
            return Err(format!("ID de video no válido: {}", entry.video_id));
        }
        if !seen_video_ids.insert(entry.video_id.clone()) {
            return Err(format!("Video duplicado en la playlist: {}", entry.video_id));
        }
        if entry.format != "mp3" && entry.format != "mp4" && entry.format != "mp4-hd" {
            return Err(format!("Formato no válido: {}", entry.format));
        }
        if entry.output_dir.trim().is_empty() || entry.output_dir.len() > 32768 {
            return Err("Directorio de salida vacío para un elemento de la playlist.".into());
        }
        if entry.title.trim().is_empty() || entry.title.chars().count() > MAX_TITLE_LENGTH {
            return Err("Título de video no válido en la playlist.".into());
        }
    }

    {
        let mut manager = state.lock().await;
        if !manager.accepting_jobs {
            return Err("La aplicación se está cerrando".into());
        }
        if manager.yt_dlp_operation == Some(super::types::YtDlpOperation::Update) {
            return Err("No se puede encolar mientras se actualiza yt-dlp".into());
        }
        for entry in &payload.entries {
            if manager.active_jobs.contains_key(&entry.id)
                || manager.queued_jobs.iter().any(|j| j.id == entry.id)
            {
                return Err(format!("Ya existe una descarga activa con ID: {}", entry.id));
            }
        }

        manager
            .helper_jobs
            .insert(preflight_key.clone(), preflight_control.clone());

        for entry in &payload.entries {
            let control = Arc::new(JobControl::default());
            let canonical_url = youtube::canonical_video_url(&entry.video_id);

            let download = super::types::QueuedDownload {
                id: entry.id.clone(),
                url: canonical_url,
                format: entry.format.clone(),
                output_dir: entry.output_dir.clone(),
                control: control.clone(),
                tools: None,
            };

            manager.queued_jobs.push_back(download);
        }
    }

    // Preflight bundled tools once
    let preflight_result = super::tools::preflight_tools(&tools, preflight_control).await;
    match preflight_result {
        Ok(_) => {
            let mut cancelled_ids = Vec::new();
            let mut manager = state.lock().await;
            manager.finish_playlist_inspection(&preflight_key);
            let mut assign_count = 0;
            for entry in &payload.entries {
                if let Some(pos) = manager.queued_jobs.iter().position(|j| j.id == entry.id) {
                    if manager.queued_jobs[pos].control.is_cancelled() {
                        manager.queued_jobs.remove(pos);
                        cancelled_ids.push(entry.id.clone());
                    } else {
                        manager.queued_jobs[pos].tools = Some(tools.clone());
                        assign_count += 1;
                    }
                }
            }
            drop(manager);
            for id in cancelled_ids {
                let _ = app.emit(
                    "download_error",
                    super::types::ErrorPayload {
                        id,
                        error_msg: CANCELLATION_ERROR.into(),
                        cancelled: true,
                    },
                );
            }
            info!("queue_playlist_batch: tools assigned to {} children", assign_count);
        }
        Err(e) => {
            let batch_ids = payload
                .entries
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<std::collections::HashSet<_>>();
            let mut cancelled_ids = Vec::new();
            {
                let mut manager = state.lock().await;
                manager.finish_playlist_inspection(&preflight_key);
                manager.queued_jobs.retain(|job| {
                    if !batch_ids.contains(job.id.as_str()) {
                        return true;
                    }
                    if job.control.is_cancelled() {
                        cancelled_ids.push(job.id.clone());
                    }
                    false
                });
            }

            for entry in &payload.entries {
                if cancelled_ids.contains(&entry.id) {
                    let _ = app.emit(
                        "download_error",
                        super::types::ErrorPayload {
                            id: entry.id.clone(),
                            error_msg: CANCELLATION_ERROR.into(),
                            cancelled: true,
                        },
                    );
                    continue;
                }
                let _ = app.emit(
                    "download_error",
                    super::types::ErrorPayload {
                        id: entry.id.clone(),
                        error_msg: format!("Error al preparar herramientas: {}", e),
                        cancelled: false,
                    },
                );
            }
            super::manager::schedule_downloads(app.clone(), state.inner().clone()).await;
            info!("queue_playlist_batch: preflight failed: {}", e);
            return Err(e);
        }
    }

    super::manager::schedule_downloads(app, state.inner().clone()).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::manager::DownloadManager;
    use crate::commands::process::JobControl;
    use std::sync::Arc;

    #[test]
    fn test_begin_and_finish_playlist_inspection() {
        let mut manager = DownloadManager::default();
        let control = Arc::new(JobControl::default());
        manager
            .begin_playlist_inspection("req-1", control.clone())
            .expect("inspection should start");
        assert!(manager.helper_jobs.contains_key("req-1"));
        manager.finish_playlist_inspection("req-1");
        assert!(!manager.helper_jobs.contains_key("req-1"));
    }

    #[test]
    fn test_begin_playlist_inspection_blocks_update() {
        let mut manager = DownloadManager::default();
        manager.yt_dlp_operation = Some(super::super::types::YtDlpOperation::Update);
        assert!(manager
            .begin_playlist_inspection("req-1", Arc::new(JobControl::default()))
            .is_err());
    }

    #[test]
    fn test_reject_radio_playlist_id() {
        assert!(youtube::is_radio_playlist("RDMMabc"));
        assert!(youtube::is_radio_playlist("RDabc"));
        assert!(!youtube::is_radio_playlist("PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"));
    }

    #[test]
    fn test_validate_playlist_thumbnail_url() {
        assert!(youtube::validate_thumbnail_url("https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg"));
        assert!(!youtube::validate_thumbnail_url("http://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg"));
        assert!(!youtube::validate_thumbnail_url("https://evil.com/vi/dQw4w9WgXcQ/mqdefault.jpg"));
    }

    #[test]
    fn test_playlist_json_accepts_null_entries_and_thumbnails() {
        let parsed: YtDlpPlaylistJson = serde_json::from_str(
            r#"{
                "title": "Playlist",
                "thumbnails": null,
                "entries": [null, {"id": "dQw4w9WgXcQ", "title": "Video"}]
            }"#,
        )
        .expect("playlist JSON with unavailable entries should parse");

        let entries = parsed.entries.expect("entries should be present");
        assert!(entries[0].is_none());
        assert!(entries[1].is_some());
    }
}
