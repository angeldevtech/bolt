use std::io;
use std::process::{ExitStatus, Output, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};
use tokio::sync::Notify;

pub(super) const CANCELLATION_ERROR: &str = "Descarga cancelada por el usuario";
pub(super) const CANCELLATION_GRACE: Duration = Duration::from_millis(500);
pub(super) const FORCE_TERMINATION_TIMEOUT: Duration = Duration::from_secs(2);
pub(super) const OUTPUT_READER_TIMEOUT: Duration = Duration::from_secs(2);
pub(super) const TOOL_VALIDATION_TIMEOUT: Duration = Duration::from_secs(15);
pub(super) const UPDATE_PROCESS_TIMEOUT: Duration = Duration::from_secs(90);
pub(super) const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(3);

#[cfg(windows)]
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle};

#[cfg(windows)]
pub(super) struct ProcessOwner {
    job: OwnedHandle,
}

#[cfg(not(windows))]
// Process-group containment remains deferred until non-Windows sidecars ship.
pub(super) struct ProcessOwner;

impl ProcessOwner {
    pub(super) fn for_child(child: &Child) -> Result<Arc<Self>, String> {
        #[cfg(windows)]
        {
            use windows_sys::Win32::Foundation::HANDLE;
            use windows_sys::Win32::System::JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            };

            let process_handle = child
                .raw_handle()
                .ok_or_else(|| "El proceso hijo ya no tiene un identificador válido".to_string())?;
            let job_handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if job_handle.is_null() {
                return Err(format!(
                    "No se pudo crear Job Object para el proceso hijo: {}",
                    io::Error::last_os_error()
                ));
            }

            let job = unsafe { OwnedHandle::from_raw_handle(job_handle as RawHandle) };
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let limits_result = unsafe {
                SetInformationJobObject(
                    job.as_raw_handle() as HANDLE,
                    JobObjectExtendedLimitInformation,
                    &limits as *const _ as *const std::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            };
            if limits_result == 0 {
                return Err(format!(
                    "No se pudo configurar Job Object para el proceso hijo: {}",
                    io::Error::last_os_error()
                ));
            }

            let assign_result = unsafe {
                AssignProcessToJobObject(job.as_raw_handle() as HANDLE, process_handle as HANDLE)
            };
            if assign_result == 0 {
                return Err(format!(
                    "No se pudo asociar proceso hijo a Job Object: {}",
                    io::Error::last_os_error()
                ));
            }

            resume_suspended_process(child.id().ok_or_else(|| {
                "El proceso hijo ya no tiene un identificador válido".to_string()
            })?)
            .map_err(|error| format!("No se pudo reanudar proceso hijo: {}", error))?;

            return Ok(Arc::new(Self { job }));
        }

        #[cfg(not(windows))]
        {
            let _ = child;
            Ok(Arc::new(Self))
        }
    }

    fn terminate(&self) -> io::Result<()> {
        #[cfg(windows)]
        {
            use windows_sys::Win32::Foundation::HANDLE;
            use windows_sys::Win32::System::JobObjects::TerminateJobObject;

            let result = unsafe { TerminateJobObject(self.job.as_raw_handle() as HANDLE, 1) };
            if result == 0 {
                return Err(io::Error::last_os_error());
            }
        }

        Ok(())
    }
}

#[cfg(windows)]
fn resume_suspended_process(process_id: u32) -> io::Result<()> {
    use windows_sys::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
    };
    use windows_sys::Win32::System::Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME};

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    let snapshot = unsafe { OwnedHandle::from_raw_handle(snapshot as RawHandle) };

    let mut entry: THREADENTRY32 = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
    let mut has_process_thread = false;
    let mut found = unsafe { Thread32First(snapshot.as_raw_handle() as HANDLE, &mut entry) };

    while found != 0 {
        if entry.th32OwnerProcessID == process_id {
            has_process_thread = true;
            let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) };
            if thread.is_null() {
                return Err(io::Error::last_os_error());
            }
            let thread = unsafe { OwnedHandle::from_raw_handle(thread as RawHandle) };
            if unsafe { ResumeThread(thread.as_raw_handle() as HANDLE) } == u32::MAX {
                return Err(io::Error::last_os_error());
            }
        }

        found = unsafe { Thread32Next(snapshot.as_raw_handle() as HANDLE, &mut entry) };
    }

    if !has_process_thread {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "no se encontró el hilo principal del proceso hijo",
        ));
    }

    Ok(())
}

#[cfg(windows)]
fn terminate_unowned_process_tree(process_id: Option<u32>) -> io::Result<()> {
    use std::os::windows::process::CommandExt;

    let Some(process_id) = process_id else {
        return Ok(());
    };

    let status = std::process::Command::new("taskkill")
        .args(["/PID", &process_id.to_string(), "/T", "/F"])
        .creation_flags(0x08000000)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()?;
    if status.success() {
        return Ok(());
    }

    Err(io::Error::new(
        io::ErrorKind::Other,
        format!("taskkill terminó con estado {}", status),
    ))
}

pub(super) struct JobControl {
    cancel_requested: AtomicBool,
    cancel_notify: Notify,
    process_owner: std::sync::Mutex<Option<Arc<ProcessOwner>>>,
}

impl Default for JobControl {
    fn default() -> Self {
        Self {
            cancel_requested: AtomicBool::new(false),
            cancel_notify: Notify::new(),
            process_owner: std::sync::Mutex::new(None),
        }
    }
}

impl JobControl {
    pub(super) fn is_cancelled(&self) -> bool {
        self.cancel_requested.load(Ordering::SeqCst)
    }

    pub(super) fn request_cancellation(&self) -> bool {
        let first_request = !self.cancel_requested.swap(true, Ordering::SeqCst);
        self.cancel_notify.notify_waiters();
        first_request
    }

    pub(super) fn set_process_owner(&self, owner: Arc<ProcessOwner>) {
        if let Ok(mut process_owner) = self.process_owner.lock() {
            *process_owner = Some(owner);
        }
    }

    pub(super) fn clear_process_owner(&self) {
        if let Ok(mut process_owner) = self.process_owner.lock() {
            *process_owner = None;
        }
    }

    pub(super) fn terminate_process_tree(&self) -> io::Result<()> {
        let owner = self
            .process_owner
            .lock()
            .ok()
            .and_then(|process_owner| process_owner.clone());
        if let Some(owner) = owner {
            owner.terminate()?;
        }

        Ok(())
    }
}

pub(super) fn configure_child(cmd: &mut Command) {
    #[cfg(windows)]
    {
        // Keep process suspended until its Job Object owns it. This closes the
        // window where yt-dlp could create uncontained helper processes.
        cmd.creation_flags(0x08000000 | 0x00000004);
    }
}

pub(super) fn bounded_text(text: &str) -> String {
    const MAX_CHARS: usize = 2_000;
    let trimmed = text.trim();
    let bounded: String = trimmed.chars().take(MAX_CHARS).collect();
    if bounded.chars().count() < trimmed.chars().count() {
        format!("{}...", bounded)
    } else {
        bounded
    }
}

pub(super) fn process_output_detail(output: &Output) -> String {
    let stderr = bounded_text(&String::from_utf8_lossy(&output.stderr));
    if !stderr.is_empty() {
        return stderr;
    }

    bounded_text(&String::from_utf8_lossy(&output.stdout))
}

pub(super) async fn wait_for_cancellation(control: Arc<JobControl>) {
    let notified = control.cancel_notify.notified();
    if control.is_cancelled() {
        return;
    }
    notified.await;
}

pub(super) async fn terminate_managed_child(
    child: &mut Child,
    control: &JobControl,
) -> Result<ExitStatus, String> {
    match tokio::time::timeout(CANCELLATION_GRACE, child.wait()).await {
        Ok(Ok(status)) => {
            if let Err(error) = control.terminate_process_tree() {
                return Err(format!(
                    "No se pudo terminar el árbol de procesos: {}",
                    error
                ));
            }
            return Ok(status);
        }
        Ok(Err(error)) => {
            return Err(format!(
                "No se pudo esperar al proceso cancelado: {}",
                error
            ))
        }
        Err(_) => {}
    }

    let had_process_owner = control
        .process_owner
        .lock()
        .map(|process_owner| process_owner.is_some())
        .unwrap_or(false);
    let process_tree_error = control.terminate_process_tree().err();
    #[cfg(windows)]
    let process_tree_error = if had_process_owner {
        process_tree_error
    } else {
        terminate_unowned_process_tree(child.id()).err()
    };
    let direct_kill_error = child.start_kill().err();
    let status = tokio::time::timeout(FORCE_TERMINATION_TIMEOUT, child.wait())
        .await
        .map_err(|_| "El proceso no terminó después de la cancelación".to_string())?
        .map_err(|error| format!("No se pudo recoger el proceso cancelado: {}", error))?;

    if let Some(error) = process_tree_error {
        return Err(format!(
            "No se pudo terminar el árbol de procesos: {}",
            error
        ));
    }
    if !had_process_owner {
        if let Some(error) = direct_kill_error {
            return Err(format!("No se pudo terminar el proceso: {}", error));
        }
    }

    Ok(status)
}

pub(super) async fn collect_process_output(
    mut reader_task: tokio::task::JoinHandle<(io::Result<usize>, Vec<u8>)>,
    stream_name: &str,
) -> Result<Vec<u8>, String> {
    match tokio::time::timeout(OUTPUT_READER_TIMEOUT, &mut reader_task).await {
        Ok(Ok((Ok(_), output))) => Ok(output),
        Ok(Ok((Err(error), _))) => Err(format!(
            "No se pudo leer {} del proceso: {}",
            stream_name, error
        )),
        Ok(Err(error)) => Err(format!(
            "La tarea de lectura de {} terminó inesperadamente: {}",
            stream_name, error
        )),
        Err(_) => {
            reader_task.abort();
            let _ = reader_task.await;
            Err(format!(
                "La lectura de {} no terminó después de cerrar el proceso",
                stream_name
            ))
        }
    }
}

pub(super) async fn run_managed_command(
    command: Command,
    control: Arc<JobControl>,
    timeout: Option<Duration>,
) -> Result<Option<Output>, String> {
    run_managed_command_inner(command, control, timeout, |_, _| {}).await
}

#[cfg(test)]
pub(super) async fn run_managed_command_cancelled_after_spawn(
    command: Command,
    control: Arc<JobControl>,
    timeout: Option<Duration>,
    pid_slot: Arc<std::sync::atomic::AtomicU32>,
) -> Result<Option<Output>, String> {
    run_managed_command_inner(command, control, timeout, move |child, control| {
        pid_slot.store(child.id().unwrap_or(0), Ordering::SeqCst);
        control.request_cancellation();
    })
    .await
}

async fn run_managed_command_inner<F>(
    mut command: Command,
    control: Arc<JobControl>,
    timeout: Option<Duration>,
    after_spawn: F,
) -> Result<Option<Output>, String>
where
    F: FnOnce(&Child, &Arc<JobControl>),
{
    if control.is_cancelled() {
        return Ok(None);
    }

    configure_child(&mut command);
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("No se pudo iniciar proceso auxiliar: {}", error))?;
    after_spawn(&child, &control);
    let owner = match ProcessOwner::for_child(&child) {
        Ok(owner) => owner,
        Err(error) => {
            let _ = terminate_managed_child(&mut child, &control).await;
            return Err(error);
        }
    };
    control.set_process_owner(owner);

    let mut stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            let _ = terminate_managed_child(&mut child, &control).await;
            control.clear_process_owner();
            return Err("El proceso auxiliar no expuso stdout".into());
        }
    };
    let mut stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            let _ = terminate_managed_child(&mut child, &control).await;
            control.clear_process_owner();
            return Err("El proceso auxiliar no expuso stderr".into());
        }
    };

    let stdout_task = tokio::spawn(async move {
        let mut output = Vec::new();
        let result = stdout.read_to_end(&mut output).await;
        (result, output)
    });
    let stderr_task = tokio::spawn(async move {
        let mut output = Vec::new();
        let result = stderr.read_to_end(&mut output).await;
        (result, output)
    });

    let wait_result = match timeout {
        Some(timeout) => {
            tokio::select! {
                status = child.wait() => (
                    status.map_err(|error| format!("No se pudo esperar al proceso auxiliar: {}", error)),
                    false,
                    false,
                ),
                _ = wait_for_cancellation(control.clone()) => {
                    let status = terminate_managed_child(&mut child, &control).await;
                    (status, true, false)
                }
                _ = tokio::time::sleep(timeout) => {
                    let status = terminate_managed_child(&mut child, &control).await;
                    (status, false, true)
                }
            }
        }
        None => {
            tokio::select! {
                status = child.wait() => (
                    status.map_err(|error| format!("No se pudo esperar al proceso auxiliar: {}", error)),
                    false,
                    false,
                ),
                _ = wait_for_cancellation(control.clone()) => {
                    let status = terminate_managed_child(&mut child, &control).await;
                    (status, true, false)
                }
            }
        }
    };

    let stdout = match collect_process_output(stdout_task, "stdout").await {
        Ok(output) => output,
        Err(error) => {
            let termination_error = terminate_managed_child(&mut child, &control).await.err();
            let _ = collect_process_output(stderr_task, "stderr").await;
            control.clear_process_owner();
            return Err(match termination_error {
                Some(termination_error) => format!("{} ({})", error, termination_error),
                None => error,
            });
        }
    };

    let stderr = match collect_process_output(stderr_task, "stderr").await {
        Ok(output) => output,
        Err(error) => {
            let termination_error = terminate_managed_child(&mut child, &control).await.err();
            control.clear_process_owner();
            return Err(match termination_error {
                Some(termination_error) => format!("{} ({})", error, termination_error),
                None => error,
            });
        }
    };
    control.clear_process_owner();

    let (status, cancelled, timed_out) = wait_result;
    let status = status?;
    if cancelled || control.is_cancelled() {
        return Ok(None);
    }
    if timed_out {
        return Err("El proceso auxiliar superó el tiempo límite".into());
    }

    Ok(Some(Output {
        status,
        stdout,
        stderr,
    }))
}

pub(super) async fn finish_line_reader(
    mut reader_task: tokio::task::JoinHandle<()>,
    stream_name: &str,
) -> Result<(), String> {
    match tokio::time::timeout(OUTPUT_READER_TIMEOUT, &mut reader_task).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(error)) => Err(format!(
            "La tarea de lectura de {} terminó inesperadamente: {}",
            stream_name, error
        )),
        Err(_) => {
            reader_task.abort();
            let _ = reader_task.await;
            Err(format!(
                "La lectura de {} no terminó después de cerrar el proceso",
                stream_name
            ))
        }
    }
}
