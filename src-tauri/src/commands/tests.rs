use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use super::downloads::{classify_error, normalize_reported_path, parse_progress};
use super::manager::{clamp_concurrency, DownloadManager};
use super::process::{
    bounded_text, run_managed_command, run_managed_command_cancelled_after_spawn,
    terminate_managed_child, JobControl,
};
use super::tools::{
    cleanup_update_artifacts, restore_executable_atomically, rollback_staged_executable,
    stage_executable_copy,
};
use super::types::{QueuedDownload, ResolvedTools, YtDlpOperation};
use super::updater::{
    compare_yt_dlp_versions, normalize_release_tag, parse_yt_dlp_date_version,
    run_yt_dlp_update_operation, update_was_applied,
};
use tokio::process::Command;

fn test_tools() -> ResolvedTools {
    ResolvedTools {
        packaged_yt_dlp: PathBuf::from("packaged-yt-dlp.exe"),
        yt_dlp: PathBuf::from("yt-dlp.exe"),
        ffmpeg: PathBuf::from("ffmpeg.exe"),
        deno: PathBuf::from("deno.exe"),
    }
}

#[cfg(windows)]
fn bundled_yt_dlp_for_update_test() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("binaries")
        .join("yt-dlp.exe")
}

#[cfg(windows)]
fn fake_timed_out_yt_dlp_update_command(destination: &std::path::Path) -> Command {
    let mut command = Command::new("cmd");
    let script = format!(
        "echo fake yt-dlp -U & echo invalid>\"{}\" & ping 127.0.0.1 -n 30 > nul",
        destination.display(),
    );
    command.args(["/C", &script]);
    command
}

fn queued_job(id: &str, tools: Option<ResolvedTools>) -> QueuedDownload {
    QueuedDownload {
        id: id.into(),
        url: "https://example.com/video".into(),
        format: "mp4".into(),
        output_dir: "downloads".into(),
        control: Arc::new(JobControl::default()),
        tools,
    }
}

struct TemporaryDirectory(PathBuf);

impl TemporaryDirectory {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("bolt-critical-tests-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).expect("temporary test directory should be created");
        Self(path)
    }

    fn path(&self) -> &std::path::Path {
        &self.0
    }
}

impl Drop for TemporaryDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn clamps_supported_concurrency_range() {
    assert_eq!(clamp_concurrency(0), 1);
    assert_eq!(clamp_concurrency(2), 2);
    assert_eq!(clamp_concurrency(99), 4);
}

#[test]
fn normalizes_github_release_tags() {
    assert_eq!(normalize_release_tag(" v2026.07.04 "), "2026.07.04");
}

#[test]
fn compares_yt_dlp_date_versions_numerically() {
    assert_eq!(
        compare_yt_dlp_versions("2026.07.03", "2026.07.04"),
        Ok("available")
    );
    assert_eq!(
        compare_yt_dlp_versions("2026.07.04", "2026.07.04"),
        Ok("current")
    );
    assert_eq!(
        compare_yt_dlp_versions("2026.07.05", "2026.07.04"),
        Ok("different")
    );
}

#[test]
fn treats_unsupported_local_version_as_different() {
    assert_eq!(
        compare_yt_dlp_versions("nightly", "2026.07.04"),
        Ok("different")
    );
    assert!(parse_yt_dlp_date_version("not-a-version").is_none());
}

#[test]
fn parses_only_download_progress_lines() {
    assert_eq!(
        parse_progress("[download]  42.5% of 10.00MiB at 2.00MiB/s"),
        Some(42.5)
    );
    assert_eq!(parse_progress("  [download] 100% of 10MiB"), Some(100.0));
    assert_eq!(parse_progress("[download] Destination: output.mp4"), None);
    assert_eq!(
        parse_progress("[Merger] Merging formats into output.mp4"),
        None
    );
    assert_eq!(parse_progress("[download] unknown% of 10MiB"), None);
}

#[test]
fn normalizes_reported_paths_without_damaging_filenames() {
    assert_eq!(
        normalize_reported_path(r#"  "C:\Downloads\video.mp4"  "#),
        r#"C:\Downloads\video.mp4"#
    );
    assert_eq!(normalize_reported_path(" output.mp4 "), "output.mp4");
    assert_eq!(
        normalize_reported_path(r#""unmatched.mp4"#),
        r#""unmatched.mp4"#
    );
}

#[test]
fn classifies_known_download_failures_before_fallback() {
    assert_eq!(
        classify_error("No supported JavaScript runtime was found"),
        "Falta la dependencia de JavaScript incluida (Deno)."
    );
    assert_eq!(
        classify_error("HTTP Error 403: Forbidden"),
        "Acceso rechazado (403). Actualiza yt-dlp o revisa autenticación."
    );
    assert_eq!(
        classify_error("The URL has expired"),
        "Enlace multimedia caducado. Reintenta la descarga."
    );
    assert_eq!(
        classify_error("Please sign in to confirm your age"),
        "YouTube requiere autenticación o cookies."
    );
    assert_eq!(
        classify_error("Requested format is not available"),
        "Formato no disponible para este video."
    );
    assert_eq!(
        classify_error("Post-process failed because ffmpeg is missing"),
        "Falló el procesamiento multimedia. Revisa ffmpeg."
    );
    assert_eq!(
        classify_error("HTTP Error 429: Too Many Requests"),
        "YouTube limitó las solicitudes. Espera y reintenta."
    );
    assert_eq!(
        classify_error("unexpected downloader failure"),
        "No se pudo completar la descarga. Revisa el registro de diagnóstico."
    );
}

#[test]
fn terminal_cleanup_releases_active_job_and_slot() {
    let mut manager = DownloadManager::default();
    manager.max_concurrent = 1;
    manager
        .queued_jobs
        .push_back(queued_job("next", Some(test_tools())));
    manager
        .active_jobs
        .insert("finished".into(), Arc::new(JobControl::default()));

    assert!(manager.release_active_job("finished"));
    assert!(!manager.release_active_job("finished"));

    let next = manager.reserve_ready_jobs();
    assert_eq!(next.len(), 1);
    assert_eq!(next[0].id, "next");
}

#[test]
fn queued_cancellation_removes_ready_job_and_preserves_preparation_cancellation() {
    let mut manager = DownloadManager::default();
    let ready = queued_job("ready", Some(test_tools()));
    let preparing = queued_job("preparing", None);
    let preparing_control = preparing.control.clone();
    manager.queued_jobs.push_back(ready);
    manager.queued_jobs.push_back(preparing);

    assert_eq!(manager.cancel_queued_job("ready"), Some((true, true)));
    assert!(manager.queued_jobs.iter().all(|job| job.id != "ready"));

    assert_eq!(manager.cancel_queued_job("preparing"), Some((false, false)));
    assert!(preparing_control.is_cancelled());
    assert!(manager.queued_jobs.iter().any(|job| job.id == "preparing"));
}

#[test]
fn ready_queue_respects_concurrency_limit_and_skips_cancelled_jobs() {
    let mut manager = DownloadManager::default();
    manager.max_concurrent = 2;
    let cancelled = queued_job("cancelled", Some(test_tools()));
    cancelled.control.request_cancellation();
    manager.queued_jobs.push_back(cancelled);
    manager
        .queued_jobs
        .push_back(queued_job("first", Some(test_tools())));
    manager
        .queued_jobs
        .push_back(queued_job("second", Some(test_tools())));

    let reserved = manager.reserve_ready_jobs();
    assert_eq!(
        reserved
            .iter()
            .map(|job| job.id.as_str())
            .collect::<Vec<_>>(),
        vec!["first", "second"]
    );
    assert_eq!(manager.active_jobs.len(), 2);
    assert!(manager.queued_jobs.is_empty());
}

#[test]
fn preparation_order_blocks_ready_job_from_overtaking() {
    let mut manager = DownloadManager::default();
    let first = queued_job("first", None);
    manager.queued_jobs.push_back(first);
    manager
        .queued_jobs
        .push_back(queued_job("second", Some(test_tools())));

    assert!(manager.reserve_ready_jobs().is_empty());
    assert!(manager.active_jobs.is_empty());

    manager.queued_jobs[0].tools = Some(test_tools());
    let reserved = manager.reserve_ready_jobs();
    assert_eq!(reserved.len(), 1);
    assert_eq!(reserved[0].id, "first");
}

#[test]
fn updater_observes_preparing_and_cancelling_downloads() {
    let mut manager = DownloadManager::default();
    let preparing = queued_job("preparing", None);
    preparing.control.request_cancellation();
    manager.queued_jobs.push_back(preparing);

    assert!(manager
        .begin_yt_dlp_operation(
            YtDlpOperation::Update,
            "update".into(),
            Arc::new(JobControl::default()),
        )
        .is_err());

    manager.queued_jobs.clear();
    manager
        .begin_yt_dlp_operation(
            YtDlpOperation::Check,
            "check".into(),
            Arc::new(JobControl::default()),
        )
        .expect("first updater operation should be accepted");
    assert!(manager
        .begin_yt_dlp_operation(
            YtDlpOperation::Update,
            "second-update".into(),
            Arc::new(JobControl::default()),
        )
        .is_err());
    manager.finish_yt_dlp_operation(YtDlpOperation::Check, "check");
    assert_eq!(manager.yt_dlp_operation, None);
}

#[test]
fn updater_blocks_active_playlist_inspection() {
    let mut manager = DownloadManager::default();
    manager
        .helper_jobs
        .insert("playlist-inspection".into(), Arc::new(JobControl::default()));

    assert!(manager
        .begin_yt_dlp_operation(
            YtDlpOperation::Update,
            "update".into(),
            Arc::new(JobControl::default()),
        )
        .is_err());
}

#[test]
fn updater_observes_download_registered_before_preparation() {
    let mut manager = DownloadManager::default();
    manager.queued_jobs.push_back(queued_job("preparing", None));

    manager
        .begin_yt_dlp_operation(
            YtDlpOperation::Check,
            "check".into(),
            Arc::new(JobControl::default()),
        )
        .expect("read-only checks should not block preparing downloads");
    manager.finish_yt_dlp_operation(YtDlpOperation::Check, "check");
}

#[test]
fn read_only_check_does_not_block_ready_downloads() {
    let mut manager = DownloadManager::default();
    manager
        .queued_jobs
        .push_back(queued_job("ready", Some(test_tools())));

    manager
        .begin_yt_dlp_operation(
            YtDlpOperation::Check,
            "check".into(),
            Arc::new(JobControl::default()),
        )
        .expect("read-only check should be accepted with queued work");

    let reserved = manager.reserve_ready_jobs();
    assert_eq!(reserved.len(), 1);
    assert_eq!(reserved[0].id, "ready");
    manager.finish_yt_dlp_operation(YtDlpOperation::Check, "check");
}

#[test]
fn updater_ownership_blocks_process_reservation() {
    let mut manager = DownloadManager::default();
    manager
        .begin_yt_dlp_operation(
            YtDlpOperation::Update,
            "update".into(),
            Arc::new(JobControl::default()),
        )
        .expect("update should own the tool");
    manager
        .queued_jobs
        .push_back(queued_job("ready", Some(test_tools())));

    assert!(manager.reserve_ready_jobs().is_empty());
    manager.finish_yt_dlp_operation(YtDlpOperation::Update, "update");
    assert_eq!(manager.reserve_ready_jobs().len(), 1);
}

#[test]
fn restores_staged_executable_atomically() {
    let directory = TemporaryDirectory::new();
    let source = directory.path().join("packaged.exe");
    let destination = directory.path().join("app-local.exe");
    fs::write(&source, b"new executable").expect("source should be writable");
    fs::write(&destination, b"old executable").expect("destination should be writable");

    restore_executable_atomically(&source, &destination).expect("restore should succeed");

    assert_eq!(fs::read(&destination).unwrap(), b"new executable");
    assert_eq!(fs::read(&source).unwrap(), b"new executable");
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 2);
}

#[test]
fn rolls_back_staged_update_and_removes_backup() {
    let directory = TemporaryDirectory::new();
    let backup = directory.path().join("yt-dlp.exe.bak");
    let destination = directory.path().join("yt-dlp.exe");
    fs::write(&backup, b"known-good executable").expect("backup should be writable");
    fs::write(&destination, b"partially-updated executable")
        .expect("destination should be writable");

    rollback_staged_executable(&backup, &destination).expect("rollback should succeed");

    assert_eq!(fs::read(&destination).unwrap(), b"known-good executable");
    assert!(!backup.exists());
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[test]
fn stages_update_backup_on_destination_filesystem_and_cleans_it() {
    let directory = TemporaryDirectory::new();
    let source = directory.path().join("yt-dlp.exe");
    let backup = directory.path().join(".yt-dlp-update-test.bak");
    fs::write(&source, b"known-good executable").expect("source should be writable");

    stage_executable_copy(&source, &backup).expect("backup should be staged");
    assert_eq!(backup.parent(), source.parent());
    assert_eq!(fs::read(&backup).unwrap(), b"known-good executable");

    cleanup_update_artifacts(&backup).expect("backup should be cleaned");
    assert!(!backup.exists());
}

#[cfg(windows)]
#[test]
fn timed_out_update_rolls_back_and_releases_updater_lock() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("test runtime should be created");

    runtime.block_on(async {
        let directory = TemporaryDirectory::new();
        let bundled = bundled_yt_dlp_for_update_test();
        assert!(
            bundled.is_file(),
            "bundled yt-dlp should exist for update test"
        );

        let packaged = directory.path().join("packaged-yt-dlp.exe");
        let destination = directory.path().join("yt-dlp.exe");
        fs::copy(&bundled, &packaged).expect("packaged yt-dlp should be copied");
        let original = fs::read(&packaged).expect("packaged yt-dlp should be readable");
        let tools = ResolvedTools {
            packaged_yt_dlp: packaged,
            yt_dlp: destination.clone(),
            ffmpeg: PathBuf::from("ffmpeg.exe"),
            deno: PathBuf::from("deno.exe"),
        };

        let state = Arc::new(tokio::sync::Mutex::new(DownloadManager::default()));
        let helper_key = "timed-out-update";
        let control = Arc::new(JobControl::default());
        let result = run_yt_dlp_update_operation(
            &state,
            helper_key.into(),
            control,
            move || Ok(tools),
            Duration::from_millis(100),
            Some(fake_timed_out_yt_dlp_update_command(&destination)),
        )
        .await;
        let error = match result {
            Ok(_) => panic!("timed-out update should fail"),
            Err(error) => error,
        };

        assert!(error.contains("tiempo límite"));
        assert!(error.contains("Se restauró la copia anterior"));
        assert_eq!(
            fs::read(&destination).expect("restored yt-dlp should exist"),
            original
        );
        assert!(fs::read_dir(directory.path())
            .expect("update directory should be readable")
            .all(|entry| {
                !entry
                    .expect("directory entry should be readable")
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".yt-dlp-update-")
            }));

        let mut manager = state.lock().await;
        assert_eq!(manager.yt_dlp_operation, None);
        assert!(manager.helper_jobs.is_empty());
        manager
            .begin_yt_dlp_operation(
                YtDlpOperation::Update,
                "next-update".into(),
                Arc::new(JobControl::default()),
            )
            .expect("updater lock should be available after rollback");
    });
}

#[test]
fn rejects_directory_destination_without_losing_staged_source() {
    let directory = TemporaryDirectory::new();
    let source = directory.path().join("packaged.exe");
    let destination = directory.path().join("app-local.exe");
    fs::write(&source, b"new executable").expect("source should be writable");
    fs::create_dir(&destination).expect("destination directory should be created");

    assert!(restore_executable_atomically(&source, &destination).is_err());
    assert_eq!(fs::read(&source).unwrap(), b"new executable");
    assert!(destination.is_dir());
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 2);
}

#[test]
fn identifies_update_output_without_treating_unrelated_success_as_updated() {
    assert!(update_was_applied(
        "Downloading update\nUpdated yt-dlp to 2026.07.04"
    ));
    assert!(update_was_applied("Successfully updated yt-dlp"));
    assert!(!update_was_applied("yt-dlp is up to date"));
}

#[test]
fn bounds_user_facing_diagnostics() {
    let bounded = bounded_text(&"x".repeat(2_500));
    assert!(bounded.chars().count() <= 2_003);
    assert!(bounded.ends_with("..."));
}

#[cfg(windows)]
fn fake_command(exit_code: u8) -> Command {
    let mut command = Command::new("cmd");
    let script = if exit_code == 0 {
        "echo fake-stdout & echo fake-stderr 1>&2"
    } else {
        "echo fake-stdout & echo fake-stderr 1>&2 & exit /B 7"
    };
    command.args(["/C", script]);
    command
}

#[cfg(not(windows))]
fn fake_command(exit_code: u8) -> Command {
    let mut command = Command::new("sh");
    let script = if exit_code == 0 {
        "printf 'fake-stdout\\n'; printf 'fake-stderr\\n' >&2"
    } else {
        "printf 'fake-stdout\\n'; printf 'fake-stderr\\n' >&2; exit 7"
    };
    command.args(["-c", script]);
    command
}

#[test]
fn managed_command_collects_fake_process_success_and_failure() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("test runtime should be created");

    runtime.block_on(async {
        let success = run_managed_command(fake_command(0), Arc::new(JobControl::default()), None)
            .await
            .expect("successful fake process should be collected")
            .expect("successful process should return output");
        assert!(success.status.success());
        assert!(String::from_utf8_lossy(&success.stdout).contains("fake-stdout"));
        assert!(String::from_utf8_lossy(&success.stderr).contains("fake-stderr"));

        let failure = run_managed_command(fake_command(7), Arc::new(JobControl::default()), None)
            .await
            .expect("failing fake process should still be collected")
            .expect("failing process should return output");
        assert!(!failure.status.success());
        assert!(String::from_utf8_lossy(&failure.stderr).contains("fake-stderr"));
    });
}

#[cfg(windows)]
fn hanging_command() -> Command {
    let mut command = Command::new("cmd");
    command.args(["/C", "ping 127.0.0.1 -n 30 > nul"]);
    command
}

#[cfg(not(windows))]
fn hanging_command() -> Command {
    let mut command = Command::new("sh");
    command.args(["-c", "sleep 30"]);
    command
}

#[test]
fn managed_command_terminates_hanging_executable_at_timeout() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("test runtime should be created");

    runtime.block_on(async {
        let result = run_managed_command(
            hanging_command(),
            Arc::new(JobControl::default()),
            Some(Duration::from_millis(50)),
        )
        .await;

        assert_eq!(
            result.expect_err("hanging process should hit timeout"),
            "El proceso auxiliar superó el tiempo límite"
        );
    });
}

#[cfg(windows)]
fn process_snapshot() -> Vec<(u32, u32)> {
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle};

    use windows_sys::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32First, Process32Next, PROCESSENTRY32, TH32CS_SNAPPROCESS,
    };

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Vec::new();
    }
    let snapshot = unsafe { OwnedHandle::from_raw_handle(snapshot as RawHandle) };
    let mut entry: PROCESSENTRY32 = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32>() as u32;
    let mut processes = Vec::new();
    let mut found = unsafe { Process32First(snapshot.as_raw_handle() as HANDLE, &mut entry) };

    while found != 0 {
        processes.push((entry.th32ProcessID, entry.th32ParentProcessID));
        found = unsafe { Process32Next(snapshot.as_raw_handle() as HANDLE, &mut entry) };
    }

    processes
}

#[cfg(windows)]
fn descendant_process_ids(root_pid: u32) -> Vec<u32> {
    let processes = process_snapshot();
    let mut parents = vec![root_pid];
    let mut descendants = Vec::new();

    while let Some(parent_pid) = parents.pop() {
        for (pid, process_parent_pid) in &processes {
            if *process_parent_pid == parent_pid && *pid != root_pid && !descendants.contains(pid) {
                descendants.push(*pid);
                parents.push(*pid);
            }
        }
    }

    descendants
}

#[cfg(windows)]
fn wait_for_processes_to_disappear(process_ids: &[u32]) -> bool {
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while std::time::Instant::now() < deadline {
        let running = process_snapshot();
        if process_ids
            .iter()
            .all(|pid| !running.iter().any(|(running_pid, _)| running_pid == pid))
        {
            return true;
        }

        std::thread::sleep(Duration::from_millis(25));
    }

    false
}

#[cfg(windows)]
#[test]
fn process_tree_helper_child() {
    if std::env::var_os("BOLT_PROCESS_TREE_HELPER").is_none() {
        return;
    }

    let mut child = std::process::Command::new("ping")
        .args(["127.0.0.1", "-n", "30"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("process-tree helper child should spawn");
    let _ = child.wait();
}

#[cfg(windows)]
#[test]
fn unowned_process_fallback_terminates_windows_descendants() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("test runtime should be created");

    runtime.block_on(async {
        let test_executable =
            std::env::current_exe().expect("test executable path should be available");
        let mut command = Command::new(test_executable);
        command
            .args([
                "--exact",
                "commands::tests::process_tree_helper_child",
                "--nocapture",
            ])
            .env("BOLT_PROCESS_TREE_HELPER", "1")
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = command.spawn().expect("fallback test process should spawn");
        let root_pid = child.id().expect("fallback test process should have a PID");
        tokio::time::sleep(Duration::from_millis(100)).await;
        let descendants = descendant_process_ids(root_pid);
        assert!(
            !descendants.is_empty(),
            "fallback test should have a live descendant process"
        );

        let result = terminate_managed_child(&mut child, &JobControl::default()).await;
        assert!(
            result.is_ok(),
            "unowned process tree should terminate: {result:?}"
        );
        assert!(
            wait_for_processes_to_disappear(&descendants),
            "descendant processes should disappear independently of termination result"
        );
    });
}

#[cfg(windows)]
#[test]
fn cancellation_during_suspended_spawn_is_reaped_after_job_ownership() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("test runtime should be created");

    runtime.block_on(async {
        let pid_slot = Arc::new(AtomicU32::new(0));
        let result = run_managed_command_cancelled_after_spawn(
            hanging_command(),
            Arc::new(JobControl::default()),
            None,
            pid_slot.clone(),
        )
        .await
        .expect("cancellation should complete cleanly");

        assert!(
            result.is_none(),
            "cancelled helper should not return output"
        );
        let pid = pid_slot.load(Ordering::SeqCst);
        assert_ne!(pid, 0, "spawn hook should observe child PID");
        assert!(
            wait_for_processes_to_disappear(&[pid]),
            "suspended child should be gone after ownership handoff cancellation"
        );
    });
}

// --- YouTube URL validation tests ---

use super::youtube;

#[test]
fn test_youtube_classify_video() {
    let source = youtube::classify_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ").unwrap();
    assert_eq!(source.source_type, youtube::YouTubeSourceType::Video);
    assert_eq!(source.canonical_url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
}

#[test]
fn test_youtube_classify_playlist() {
    let source = youtube::classify_url("https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf").unwrap();
    assert_eq!(source.source_type, youtube::YouTubeSourceType::Playlist);
    assert_eq!(
        source.canonical_url,
        "https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"
    );
}

#[test]
fn test_youtube_classify_video_plus_playlist() {
    let source = youtube::classify_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf").unwrap();
    assert_eq!(source.source_type, youtube::YouTubeSourceType::VideoPlusPlaylist);
    assert_eq!(source.canonical_url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
}

#[test]
fn test_youtube_classify_radio() {
    let source = youtube::classify_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDMMabc").unwrap();
    assert_eq!(source.source_type, youtube::YouTubeSourceType::Radio);
    assert_eq!(source.canonical_url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
}

#[test]
fn test_youtube_classify_youtu_be() {
    let source = youtube::classify_url("https://youtu.be/dQw4w9WgXcQ").unwrap();
    assert_eq!(source.source_type, youtube::YouTubeSourceType::Video);
    assert_eq!(source.canonical_url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
}

#[test]
fn test_youtube_classify_shorts() {
    let source = youtube::classify_url("https://www.youtube.com/shorts/dQw4w9WgXcQ").unwrap();
    assert_eq!(source.source_type, youtube::YouTubeSourceType::Video);
    assert_eq!(source.canonical_url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
}

#[test]
fn test_youtube_classify_embed() {
    let source = youtube::classify_url("https://www.youtube.com/embed/dQw4w9WgXcQ").unwrap();
    assert_eq!(source.source_type, youtube::YouTubeSourceType::Video);
    assert_eq!(source.canonical_url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
}

#[test]
fn test_youtube_classify_generic() {
    let source = youtube::classify_url("https://vimeo.com/123456").unwrap();
    assert_eq!(source.source_type, youtube::YouTubeSourceType::Generic);
}

#[test]
fn test_youtube_music_host() {
    let source = youtube::classify_url("https://music.youtube.com/watch?v=dQw4w9WgXcQ").unwrap();
    assert_eq!(source.source_type, youtube::YouTubeSourceType::Video);
}

#[test]
fn test_youtube_reject_duplicate_params() {
    assert!(youtube::classify_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ&v=abc").is_err());
    assert!(youtube::classify_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=a&list=b").is_err());
}

#[test]
fn test_youtube_reject_invalid_video_id() {
    assert!(youtube::classify_url("https://www.youtube.com/watch?v=tooshort").is_err());
}

#[test]
fn test_youtube_reject_credentials() {
    assert!(youtube::classify_url("https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ").is_err());
}

#[test]
fn test_youtube_validate_playlist_id() {
    assert!(youtube::validate_playlist_id("PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"));
    assert!(youtube::validate_playlist_id("RDMMabc"));
    assert!(youtube::validate_playlist_id("RDabc"));
    assert!(!youtube::validate_playlist_id(""));
    assert!(!youtube::validate_playlist_id("invalid id with spaces"));
}

#[test]
fn test_youtube_canonical_video_url() {
    assert_eq!(
        youtube::canonical_video_url("dQw4w9WgXcQ"),
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
}

#[test]
fn test_youtube_strips_index_and_tracking() {
    let source = youtube::classify_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ&index=2&si=abc123&pp=ygUJdGVzdF9pZHg%3D").unwrap();
    assert_eq!(source.source_type, youtube::YouTubeSourceType::Video);
    assert_eq!(source.canonical_url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
}

// --- Playlist management tests ---

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
fn test_begin_playlist_inspection_rejects_update_blocked() {
    let mut manager = DownloadManager::default();
    manager.yt_dlp_operation = Some(super::types::YtDlpOperation::Update);
    assert!(manager
        .begin_playlist_inspection("req-1", Arc::new(JobControl::default()))
        .is_err());
}

#[test]
fn test_begin_playlist_inspection_rejects_duplicate_request_id() {
    let mut manager = DownloadManager::default();
    let control = Arc::new(JobControl::default());
    manager
        .begin_playlist_inspection("req-1", control.clone())
        .expect("first inspection should start");
    assert!(manager
        .begin_playlist_inspection("req-1", Arc::new(JobControl::default()))
        .is_err());
}

#[test]
fn test_validate_thumbnail_url() {
    assert!(youtube::validate_thumbnail_url("https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg"));
    assert!(youtube::validate_thumbnail_url("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"));
    assert!(!youtube::validate_thumbnail_url("http://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg"));
    assert!(!youtube::validate_thumbnail_url("https://evil.com/vi/dQw4w9WgXcQ/mqdefault.jpg"));
}

#[test]
fn test_playlist_batch_payload_validation() {
    assert!(youtube::validate_video_id("dQw4w9WgXcQ"));
    assert!(!youtube::validate_video_id(""));
    assert!(!youtube::validate_video_id("tooshort"));
    assert!(!youtube::validate_video_id("invalid!id@123"));
}

#[test]
fn test_http_canonicalized_to_https() {
    let source = youtube::classify_url("http://www.youtube.com/watch?v=dQw4w9WgXcQ").unwrap();
    assert_eq!(source.source_type, youtube::YouTubeSourceType::Video);
    assert_eq!(source.canonical_url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
}
