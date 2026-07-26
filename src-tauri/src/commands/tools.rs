use std::path::{Path, PathBuf};
use std::sync::Arc;

use log::info;
use tauri::{path::BaseDirectory, AppHandle, Manager};
use tokio::process::Command;

use super::process::{
    bounded_text, process_output_detail, run_managed_command, JobControl, CANCELLATION_ERROR,
    TOOL_VALIDATION_TIMEOUT,
};
use super::types::ResolvedTools;

const YT_DLP_RESOURCE: &str = "tools/yt-dlp.exe";
const FFMPEG_RESOURCE: &str = "tools/ffmpeg.exe";
const DENO_RESOURCE: &str = "tools/deno.exe";

pub(super) fn resolve_resource(
    app: &AppHandle,
    resource: &str,
    label: &str,
) -> Result<PathBuf, String> {
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

pub(super) fn resolve_yt_dlp_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let packaged_yt_dlp = resolve_resource(app, YT_DLP_RESOURCE, "yt-dlp")?;
    let app_tools = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("No se pudo localizar AppLocalData: {}", error))?
        .join("tools");
    let writable_yt_dlp = app_tools.join("yt-dlp.exe");

    Ok((packaged_yt_dlp, writable_yt_dlp))
}

pub(super) fn resolve_tools(app: &AppHandle) -> Result<ResolvedTools, String> {
    let (packaged_yt_dlp, writable_yt_dlp) = resolve_yt_dlp_paths(app)?;
    let ffmpeg = resolve_resource(app, FFMPEG_RESOURCE, "ffmpeg")?;
    let deno = resolve_resource(app, DENO_RESOURCE, "Deno")?;
    let app_tools = writable_yt_dlp.parent().ok_or_else(|| {
        format!(
            "No se pudo determinar carpeta de herramientas para {}",
            writable_yt_dlp.display()
        )
    })?;

    std::fs::create_dir_all(app_tools).map_err(|error| {
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

pub(super) async fn verify_executable(
    path: &Path,
    label: &str,
    args: &[&str],
    control: Arc<JobControl>,
) -> Result<(), String> {
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
    command.args(args);
    let Some(output) = run_managed_command(command, control, Some(TOOL_VALIDATION_TIMEOUT)).await?
    else {
        return Err(CANCELLATION_ERROR.into());
    };

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

pub(super) fn update_backup_path(destination: &Path) -> Result<PathBuf, String> {
    let parent = destination.parent().ok_or_else(|| {
        format!(
            "No se pudo determinar carpeta de destino para {}",
            destination.display()
        )
    })?;

    Ok(parent.join(format!(".yt-dlp-update-{}.bak", uuid::Uuid::new_v4())))
}

pub(super) fn stage_executable_copy(source: &Path, destination: &Path) -> Result<(), String> {
    let parent = destination.parent().ok_or_else(|| {
        format!(
            "No se pudo determinar carpeta de destino para {}",
            destination.display()
        )
    })?;
    let temporary = parent.join(format!(".yt-dlp-stage-{}.tmp", uuid::Uuid::new_v4()));

    if let Err(error) = std::fs::copy(source, &temporary) {
        let _ = std::fs::remove_file(&temporary);
        return Err(format!(
            "No se pudo preparar copia de yt-dlp desde {} a {}: {}",
            source.display(),
            destination.display(),
            error
        ));
    }

    if let Err(error) = std::fs::rename(&temporary, destination) {
        let _ = std::fs::remove_file(&temporary);
        return Err(format!(
            "No se pudo confirmar copia de yt-dlp en {}: {}",
            destination.display(),
            error
        ));
    }

    Ok(())
}

pub(super) fn cleanup_update_artifacts(backup: &Path) -> Result<(), String> {
    match std::fs::remove_file(backup) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "No se pudo limpiar copia temporal de yt-dlp en {}: {}",
            backup.display(),
            error
        )),
    }
}

pub(super) fn restore_executable_atomically(
    source: &Path,
    destination: &Path,
) -> Result<(), String> {
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
        std::fs::remove_file(&backup).map_err(|error| {
            format!(
                "No se pudo limpiar copia temporal de yt-dlp en {}: {}",
                backup.display(),
                error
            )
        })?;
    }

    Ok(())
}

#[cfg(test)]
pub(super) fn rollback_staged_executable(backup: &Path, destination: &Path) -> Result<(), String> {
    restore_executable_atomically(backup, destination)?;
    std::fs::remove_file(backup).map_err(|error| {
        format!(
            "No se pudo eliminar copia de seguridad de yt-dlp en {}: {}",
            backup.display(),
            error
        )
    })
}

pub(super) async fn ensure_app_local_yt_dlp(
    tools: &ResolvedTools,
    control: Arc<JobControl>,
) -> Result<(), String> {
    if let Err(original_error) = verify_executable(
        &tools.yt_dlp,
        "yt-dlp app-local",
        &["--version"],
        control.clone(),
    )
    .await
    {
        if control.is_cancelled() {
            return Err(CANCELLATION_ERROR.into());
        }
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

        verify_executable(
            &tools.yt_dlp,
            "yt-dlp app-local restaurado",
            &["--version"],
            control,
        )
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

pub(super) async fn restore_and_validate_yt_dlp(
    source: &Path,
    destination: &Path,
    label: &str,
    control: Arc<JobControl>,
) -> Result<(), String> {
    restore_executable_atomically(source, destination)?;
    verify_executable(destination, label, &["--version"], control).await
}

pub(super) async fn recover_yt_dlp_after_update_failure(
    tools: &ResolvedTools,
    backup: &Path,
    failure: String,
) -> String {
    let recovery_control = Arc::new(JobControl::default());
    let mut diagnostics = Vec::new();

    match restore_and_validate_yt_dlp(
        backup,
        &tools.yt_dlp,
        "yt-dlp restaurado desde copia anterior",
        recovery_control.clone(),
    )
    .await
    {
        Ok(()) => {
            return format!(
                "{} Se restauró la copia anterior de yt-dlp.",
                bounded_text(&failure)
            );
        }
        Err(error) => diagnostics.push(format!("copia anterior: {}", bounded_text(&error))),
    }

    match verify_executable(
        &tools.yt_dlp,
        "yt-dlp app-local conservado",
        &["--version"],
        recovery_control.clone(),
    )
    .await
    {
        Ok(()) => {
            return format!(
                "{} La copia actual de yt-dlp sigue siendo válida.",
                bounded_text(&failure)
            );
        }
        Err(error) => diagnostics.push(format!("copia actual: {}", bounded_text(&error))),
    }

    match restore_and_validate_yt_dlp(
        &tools.packaged_yt_dlp,
        &tools.yt_dlp,
        "yt-dlp incluido restaurado",
        recovery_control,
    )
    .await
    {
        Ok(()) => {
            return format!(
                "{} Se restauró la versión incluida de yt-dlp.",
                bounded_text(&failure)
            );
        }
        Err(error) => diagnostics.push(format!("versión incluida: {}", bounded_text(&error))),
    }

    let diagnostics = bounded_text(&diagnostics.join(" "));
    format!(
        "{} No se pudo recuperar una copia ejecutable de yt-dlp. {}",
        bounded_text(&failure),
        diagnostics
    )
}

pub(super) async fn preflight_tools(
    tools: &ResolvedTools,
    control: Arc<JobControl>,
) -> Result<(), String> {
    ensure_app_local_yt_dlp(tools, control.clone()).await?;
    verify_executable(
        &tools.ffmpeg,
        "ffmpeg incluido",
        &["-version"],
        control.clone(),
    )
    .await?;
    verify_executable(
        &tools.deno,
        "Deno incluido (runtime JavaScript)",
        &["--version"],
        control,
    )
    .await
}

pub(super) fn deno_runtime_arg(path: &Path) -> String {
    format!("deno:{}", path.display())
}
