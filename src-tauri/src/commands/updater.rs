use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use log::info;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tokio::process::Command;

use super::manager::{finish_yt_dlp_operation, AppState};
use super::process::{
    bounded_text, process_output_detail, run_managed_command, JobControl, CANCELLATION_ERROR,
    TOOL_VALIDATION_TIMEOUT, UPDATE_PROCESS_TIMEOUT,
};
use super::tools::{
    cleanup_update_artifacts, ensure_app_local_yt_dlp, recover_yt_dlp_after_update_failure,
    resolve_tools, resolve_yt_dlp_paths, stage_executable_copy, update_backup_path,
};
use super::types::{ResolvedTools, YtDlpOperation};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YtDlpUpdateResult {
    pub updated: bool,
    pub current_version: String,
    pub output: String,
}

pub(super) fn update_was_applied(output: &str) -> bool {
    output.lines().any(|line| {
        let line = line.to_ascii_lowercase();
        line.contains("updated yt-dlp") || line.contains("successfully updated")
    })
}

async fn read_yt_dlp_version(path: &Path, control: Arc<JobControl>) -> Result<String, String> {
    let mut command = Command::new(path);
    command.arg("--version").arg("--ignore-config");
    let Some(output) = run_managed_command(command, control, Some(TOOL_VALIDATION_TIMEOUT)).await?
    else {
        return Err(CANCELLATION_ERROR.into());
    };

    if !output.status.success() {
        let detail = process_output_detail(&output);
        return Err(format!(
            "yt-dlp no pudo informar su versión ({}): {}",
            output.status,
            if detail.is_empty() {
                "sin salida del proceso"
            } else {
                &detail
            }
        ));
    }

    let version = bounded_text(&String::from_utf8_lossy(&output.stdout));
    if version.is_empty() {
        return Err("yt-dlp devolvió una versión vacía".into());
    }

    Ok(version)
}

const GITHUB_LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const UPDATE_CHECK_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Deserialize)]
struct GithubLatestRelease {
    tag_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YtDlpUpdateCheckResult {
    pub status: String,
    pub current_version: String,
    pub latest_version: String,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub(super) struct YtDlpDateVersion {
    year: u32,
    month: u32,
    day: u32,
}

pub(super) fn normalize_release_tag(tag: &str) -> String {
    tag.trim()
        .strip_prefix('v')
        .unwrap_or(tag.trim())
        .to_string()
}

pub(super) fn parse_yt_dlp_date_version(version: &str) -> Option<YtDlpDateVersion> {
    let version = version.trim().strip_prefix('v').unwrap_or(version.trim());
    let version = version.rsplit('@').next().unwrap_or(version);
    let mut parts = version.split('.');
    let parsed = YtDlpDateVersion {
        year: parts.next()?.parse().ok()?,
        month: parts.next()?.parse().ok()?,
        day: parts.next()?.parse().ok()?,
    };

    if parts.next().is_some()
        || parsed.month == 0
        || parsed.month > 12
        || parsed.day == 0
        || parsed.day > 31
    {
        return None;
    }

    Some(parsed)
}

pub(super) fn compare_yt_dlp_versions(current: &str, latest: &str) -> Result<&'static str, String> {
    let latest_version = parse_yt_dlp_date_version(latest)
        .ok_or_else(|| "GitHub devolvió una versión de yt-dlp no reconocida.".to_string())?;

    let Some(current_version) = parse_yt_dlp_date_version(current) else {
        return Ok("different");
    };

    Ok(match current_version.cmp(&latest_version) {
        std::cmp::Ordering::Equal => "current",
        std::cmp::Ordering::Less => "available",
        std::cmp::Ordering::Greater => "different",
    })
}

async fn fetch_latest_yt_dlp_version() -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Bolt/0.1.0")
        .timeout(UPDATE_CHECK_TIMEOUT)
        .build()
        .map_err(|_| "No se pudo preparar la comprobación de GitHub.".to_string())?;
    let response = client
        .get(GITHUB_LATEST_RELEASE_URL)
        .send()
        .await
        .map_err(|_| {
            "No se pudo conectar con GitHub para comprobar actualizaciones.".to_string()
        })?;

    let status = response.status();
    if !status.is_success() {
        if status == reqwest::StatusCode::FORBIDDEN
            || status == reqwest::StatusCode::TOO_MANY_REQUESTS
        {
            return Err(
                "GitHub limitó temporalmente las comprobaciones. Inténtalo más tarde.".into(),
            );
        }

        return Err(format!(
            "GitHub no pudo comprobar actualizaciones (HTTP {}).",
            status.as_u16()
        ));
    }

    let release = response
        .json::<GithubLatestRelease>()
        .await
        .map_err(|_| "GitHub devolvió una respuesta no válida.".to_string())?;
    let latest_version = normalize_release_tag(&release.tag_name);
    if latest_version.is_empty() {
        return Err("GitHub no devolvió una versión de yt-dlp.".into());
    }

    Ok(latest_version)
}

async fn read_current_yt_dlp_version_for_check(
    packaged_path: &Path,
    writable_path: &Path,
    control: Arc<JobControl>,
) -> Result<String, String> {
    if writable_path.is_file() {
        match read_yt_dlp_version(writable_path, control.clone()).await {
            Ok(version) => return Ok(version),
            Err(error) => info!(
                "read-only update check could not use app-local yt-dlp at {}: {}",
                writable_path.display(),
                error
            ),
        }
    }

    read_yt_dlp_version(packaged_path, control).await
}

fn combine_update_output(output: &std::process::Output) -> (bool, String) {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = [stdout.as_ref(), stderr.as_ref()]
        .iter()
        .filter(|part| !part.trim().is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join("\n");

    (update_was_applied(&combined), bounded_text(&combined))
}

async fn run_yt_dlp_update_attempt(
    tools: &ResolvedTools,
    backup: &Path,
    control: Arc<JobControl>,
    update_timeout: Duration,
    update_command: Option<Command>,
) -> Result<YtDlpUpdateResult, String> {
    ensure_app_local_yt_dlp(tools, control.clone()).await?;
    stage_executable_copy(&tools.yt_dlp, backup).map_err(|error| {
        format!(
            "No se pudo preparar copia de seguridad de yt-dlp: {}",
            error
        )
    })?;

    info!("perform_yt_dlp_update: running bundled writable yt-dlp -U");
    let update_cmd = update_command.unwrap_or_else(|| {
        let mut command = Command::new(&tools.yt_dlp);
        command.arg("-U").arg("--ignore-config").arg("--no-color");
        command
    });
    let output = match run_managed_command(update_cmd, control.clone(), Some(update_timeout)).await
    {
        Ok(Some(output)) => output,
        Ok(None) => return Err(CANCELLATION_ERROR.into()),
        Err(error) => return Err(format!("Error al ejecutar yt-dlp -U: {}", error)),
    };

    let (updated, update_output) = combine_update_output(&output);
    if !output.status.success() {
        return Err(if update_output.is_empty() {
            "Error al actualizar yt-dlp.".into()
        } else {
            format!("Error al actualizar yt-dlp: {}", update_output)
        });
    }

    let current_version = read_yt_dlp_version(&tools.yt_dlp, control).await?;
    info!(
        "perform_yt_dlp_update: executable validated at {}",
        current_version
    );

    Ok(YtDlpUpdateResult {
        updated,
        current_version,
        output: update_output,
    })
}

async fn finalize_yt_dlp_update(
    tools: &ResolvedTools,
    backup: &Path,
    attempt: Result<YtDlpUpdateResult, String>,
) -> Result<YtDlpUpdateResult, String> {
    let mut result = match attempt {
        Ok(result) => Ok(result),
        Err(error) => Err(recover_yt_dlp_after_update_failure(tools, backup, error).await),
    };

    if let Err(error) = cleanup_update_artifacts(backup) {
        match &mut result {
            Ok(_) => info!(
                "perform_yt_dlp_update: cleanup warning: {}",
                bounded_text(&error)
            ),
            Err(message) => {
                *message = bounded_text(&format!("{} {}", message, error));
            }
        }
    }

    result
}

pub(super) async fn execute_yt_dlp_update(
    tools: &ResolvedTools,
    control: Arc<JobControl>,
    update_timeout: Duration,
    update_command: Option<Command>,
) -> Result<YtDlpUpdateResult, String> {
    let backup_path = update_backup_path(&tools.yt_dlp)?;
    let attempt =
        run_yt_dlp_update_attempt(tools, &backup_path, control, update_timeout, update_command)
            .await;
    let result = finalize_yt_dlp_update(tools, &backup_path, attempt).await;
    if result.is_ok() {
        info!("perform_yt_dlp_update: success");
    }
    result
}

pub(super) async fn run_yt_dlp_update_operation<F>(
    state: &AppState,
    helper_key: String,
    control: Arc<JobControl>,
    resolve_tools_fn: F,
    update_timeout: Duration,
    update_command: Option<Command>,
) -> Result<YtDlpUpdateResult, String>
where
    F: FnOnce() -> Result<ResolvedTools, String>,
{
    {
        let mut manager = state.lock().await;
        manager.begin_yt_dlp_operation(
            YtDlpOperation::Update,
            helper_key.clone(),
            control.clone(),
        )?;
    }

    let result = async {
        let tools = resolve_tools_fn()?;
        execute_yt_dlp_update(&tools, control, update_timeout, update_command).await
    }
    .await;

    finish_yt_dlp_operation(state, YtDlpOperation::Update, &helper_key).await;
    result
}

#[tauri::command]
pub async fn check_yt_dlp_update(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<YtDlpUpdateCheckResult, String> {
    let control = Arc::new(JobControl::default());
    let helper_key = format!("yt-dlp-check-{}", uuid::Uuid::new_v4());
    {
        let mut manager = state.lock().await;
        manager.begin_yt_dlp_operation(
            YtDlpOperation::Check,
            helper_key.clone(),
            control.clone(),
        )?;
    }

    let result: Result<YtDlpUpdateCheckResult, String> = async {
        let (packaged_path, writable_path) = resolve_yt_dlp_paths(&app)?;
        let current_version =
            read_current_yt_dlp_version_for_check(&packaged_path, &writable_path, control.clone())
                .await?;
        if control.is_cancelled() {
            return Err(CANCELLATION_ERROR.into());
        }
        let latest_version = fetch_latest_yt_dlp_version().await?;
        let status = compare_yt_dlp_versions(&current_version, &latest_version)?;

        Ok(YtDlpUpdateCheckResult {
            status: status.to_string(),
            current_version,
            latest_version,
        })
    }
    .await;

    finish_yt_dlp_operation(state.inner(), YtDlpOperation::Check, &helper_key).await;
    result.map_err(|error| bounded_text(&error))
}

#[tauri::command]
pub async fn perform_yt_dlp_update(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<YtDlpUpdateResult, String> {
    let control = Arc::new(JobControl::default());
    let helper_key = format!("yt-dlp-update-{}", uuid::Uuid::new_v4());
    let result = run_yt_dlp_update_operation(
        state.inner(),
        helper_key,
        control,
        move || resolve_tools(&app),
        UPDATE_PROCESS_TIMEOUT,
        None,
    )
    .await;
    result.map_err(|error| bounded_text(&error))
}
