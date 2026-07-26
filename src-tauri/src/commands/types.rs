use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;

use super::process::JobControl;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProgressPayload {
    pub id: String,
    pub progress: f64,
}

#[derive(Clone, Serialize)]
pub(super) struct StartedPayload {
    pub id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CompletePayload {
    pub id: String,
    pub file_path: String,
    pub size_mb: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ErrorPayload {
    pub id: String,
    pub error_msg: String,
    #[serde(default)]
    pub cancelled: bool,
}

#[derive(Clone, Serialize)]
pub struct StartDownloadResult {
    pub id: String,
    pub title: String,
}

pub(super) struct QueuedDownload {
    pub id: String,
    pub url: String,
    pub format: String,
    pub output_dir: String,
    pub control: Arc<JobControl>,
    pub tools: Option<ResolvedTools>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum YtDlpOperation {
    Check,
    Update,
}

#[derive(Clone)]
pub(super) struct ResolvedTools {
    pub packaged_yt_dlp: PathBuf,
    pub yt_dlp: PathBuf,
    pub ffmpeg: PathBuf,
    pub deno: PathBuf,
}

pub(super) enum DownloadTaskOutcome {
    Completed { file_path: String, size_mb: f64 },
    Cancelled,
    Error(String),
}
