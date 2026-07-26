use std::path::Path;

use log::info;

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
