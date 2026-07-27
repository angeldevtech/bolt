use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::{Duration, Instant};

use log::info;
use tauri::AppHandle;
use tokio::sync::Mutex;

use super::downloads::spawn_download_task;
use super::process::{JobControl, SHUTDOWN_TIMEOUT};
use super::types::{QueuedDownload, YtDlpOperation};

const DEFAULT_MAX_CONCURRENT: usize = 1;
const MAX_SUPPORTED_CONCURRENT: usize = 4;

pub struct DownloadManager {
    pub(super) queued_jobs: VecDeque<QueuedDownload>,
    pub(super) active_jobs: HashMap<String, Arc<JobControl>>,
    pub(super) helper_jobs: HashMap<String, Arc<JobControl>>,
    pub(super) max_concurrent: usize,
    pub(super) yt_dlp_operation: Option<YtDlpOperation>,
    pub(super) accepting_jobs: bool,
    pub(super) shutdown_in_progress: bool,
    pub(super) shutdown_complete: bool,
}

pub type AppState = Arc<Mutex<DownloadManager>>;

impl Default for DownloadManager {
    fn default() -> Self {
        Self {
            queued_jobs: VecDeque::new(),
            active_jobs: HashMap::new(),
            helper_jobs: HashMap::new(),
            max_concurrent: DEFAULT_MAX_CONCURRENT,
            yt_dlp_operation: None,
            accepting_jobs: true,
            shutdown_in_progress: false,
            shutdown_complete: false,
        }
    }
}

impl DownloadManager {
    fn has_download_activity(&self) -> bool {
        !self.queued_jobs.is_empty() || !self.active_jobs.is_empty()
    }

    pub(super) fn begin_yt_dlp_operation(
        &mut self,
        operation: YtDlpOperation,
        helper_key: String,
        control: Arc<JobControl>,
    ) -> Result<(), String> {
        if !self.accepting_jobs {
            return Err("La aplicación se está cerrando".into());
        }

        if let Some(current) = self.yt_dlp_operation {
            return Err(match (current, operation) {
                (YtDlpOperation::Check, YtDlpOperation::Check) => {
                    "Ya hay una comprobación de yt-dlp en progreso.".into()
                }
                (YtDlpOperation::Update, YtDlpOperation::Check) => {
                    "No se puede comprobar mientras se actualiza yt-dlp.".into()
                }
                (YtDlpOperation::Check, YtDlpOperation::Update) => {
                    "No se puede actualizar mientras se comprueba yt-dlp.".into()
                }
                (YtDlpOperation::Update, YtDlpOperation::Update) => {
                    "Ya hay una actualización de yt-dlp en progreso.".into()
                }
            });
        }

        if operation == YtDlpOperation::Update && self.has_download_activity() {
            return Err("No se puede actualizar mientras haya descargas activas.".into());
        }
        if operation == YtDlpOperation::Update && !self.helper_jobs.is_empty() {
            return Err("No se puede actualizar mientras haya operaciones de yt-dlp activas.".into());
        }

        self.yt_dlp_operation = Some(operation);
        self.helper_jobs.insert(helper_key, control);
        Ok(())
    }

    pub(super) fn finish_yt_dlp_operation(&mut self, operation: YtDlpOperation, helper_key: &str) {
        self.helper_jobs.remove(helper_key);
        if self.yt_dlp_operation == Some(operation) {
            self.yt_dlp_operation = None;
        }
    }

    pub(super) fn reserve_ready_jobs(&mut self) -> Vec<QueuedDownload> {
        let mut jobs = Vec::new();

        while self.accepting_jobs
            && self.yt_dlp_operation != Some(YtDlpOperation::Update)
            && self.active_jobs.len() < self.max_concurrent
        {
            // A cancelled ready job is already logically removed. Drop it here
            // so it cannot leave stale entries ahead of later work.
            self.queued_jobs
                .retain(|job| !(job.control.is_cancelled() && job.tools.is_some()));

            let Some(index) = self
                .queued_jobs
                .iter()
                .position(|job| !job.control.is_cancelled())
            else {
                break;
            };

            // Preparation runs concurrently, but execution remains FIFO. A
            // later job cannot overtake an earlier job still being prepared.
            if self.queued_jobs[index].tools.is_none() {
                break;
            }

            let job = self
                .queued_jobs
                .remove(index)
                .expect("queued download index must remain valid");
            self.active_jobs.insert(job.id.clone(), job.control.clone());
            jobs.push(job);
        }

        jobs
    }

    pub(super) fn release_active_job(&mut self, id: &str) -> bool {
        self.active_jobs.remove(id).is_some()
    }

    pub(super) fn cancel_queued_job(&mut self, id: &str) -> Option<(bool, bool)> {
        let index = self.queued_jobs.iter().position(|job| job.id == id)?;
        let (control, is_ready) = {
            let job = &self.queued_jobs[index];
            (job.control.clone(), job.tools.is_some())
        };
        let first_request = control.request_cancellation();

        if is_ready {
            self.queued_jobs.remove(index);
        }

        Some((first_request && is_ready, is_ready))
    }
}

pub(super) fn clamp_concurrency(value: u32) -> usize {
    (value as usize).clamp(DEFAULT_MAX_CONCURRENT, MAX_SUPPORTED_CONCURRENT)
}

async fn remove_queued_job(state: &AppState, id: &str) -> bool {
    let mut manager = state.lock().await;
    if let Some(index) = manager.queued_jobs.iter().position(|job| job.id == id) {
        manager.queued_jobs.remove(index);
        info!("download {} removed from queue", id);
        return true;
    }

    false
}

pub(super) async fn schedule_downloads(app: AppHandle, state: AppState) {
    let jobs = {
        let mut manager = state.lock().await;
        manager.reserve_ready_jobs()
    };

    for job in jobs {
        let tools = job
            .tools
            .expect("ready queued download must have resolved tools");
        spawn_download_task(
            app.clone(),
            state.clone(),
            job.id,
            job.url,
            job.format,
            job.output_dir,
            job.control,
            tools,
        );
    }
}

pub(super) async fn release_active_job(state: &AppState, id: &str) -> bool {
    let removed = {
        let mut manager = state.lock().await;
        manager.release_active_job(id)
    };

    if removed {
        info!("download {} deregistered", id);
    }

    removed
}

pub(super) async fn discard_queued_job(app: &AppHandle, state: &AppState, id: &str) {
    if remove_queued_job(state, id).await {
        schedule_downloads(app.clone(), state.clone()).await;
    }
}

pub(super) async fn finish_yt_dlp_operation(
    state: &AppState,
    operation: YtDlpOperation,
    helper_key: &str,
) {
    let removed = {
        let mut manager = state.lock().await;
        let was_registered = manager.helper_jobs.contains_key(helper_key);
        manager.finish_yt_dlp_operation(operation, helper_key);
        was_registered
    };
    if removed {
        info!("yt-dlp operation {} deregistered", helper_key);
    }
}

pub fn shutdown_complete(state: &AppState) -> bool {
    state
        .try_lock()
        .map(|manager| manager.shutdown_complete)
        .unwrap_or(false)
}

fn request_control_shutdown(controls: Vec<(String, Arc<JobControl>)>) {
    for (label, control) in controls {
        control.request_cancellation();
        if let Err(error) = control.terminate_process_tree() {
            info!(
                "shutdown: could not terminate {} process tree: {}",
                label, error
            );
        }
    }
}

pub async fn begin_shutdown(state: &AppState) -> bool {
    let controls = {
        let mut manager = state.lock().await;
        if manager.shutdown_complete || manager.shutdown_in_progress {
            return false;
        }

        manager.accepting_jobs = false;
        manager.shutdown_in_progress = true;
        let mut controls = manager
            .queued_jobs
            .drain(..)
            .map(|job| (format!("download {}", job.id), job.control))
            .collect::<Vec<_>>();
        controls.extend(
            manager
                .active_jobs
                .iter()
                .map(|(id, control)| (format!("download {}", id), control.clone())),
        );
        controls.extend(
            manager
                .helper_jobs
                .iter()
                .map(|(key, control)| (format!("helper {}", key), control.clone())),
        );
        info!(
            "shutdown: stopping new jobs and cancelling {} owned processes",
            controls.len()
        );
        controls
    };

    request_control_shutdown(controls);
    true
}

pub async fn shutdown_downloads(state: AppState) {
    let deadline = Instant::now() + SHUTDOWN_TIMEOUT;
    loop {
        let controls = {
            let manager = state.lock().await;
            if manager.active_jobs.is_empty() && manager.helper_jobs.is_empty() {
                Vec::new()
            } else {
                manager
                    .active_jobs
                    .iter()
                    .map(|(id, control)| (format!("download {}", id), control.clone()))
                    .chain(
                        manager
                            .helper_jobs
                            .iter()
                            .map(|(key, control)| (format!("helper {}", key), control.clone())),
                    )
                    .collect::<Vec<_>>()
            }
        };
        if controls.is_empty() {
            break;
        }

        request_control_shutdown(controls);
        if Instant::now() >= deadline {
            info!("shutdown: bounded wait expired with owned jobs still registered");
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    let mut manager = state.lock().await;
    manager.shutdown_complete = true;
    info!(
        "shutdown: cleanup finished; active_jobs={}, helper_jobs={}",
        manager.active_jobs.len(),
        manager.helper_jobs.len()
    );
}
