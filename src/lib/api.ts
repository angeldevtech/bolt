import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { load } from "@tauri-apps/plugin-store";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { audioDir, videoDir, downloadDir } from "@tauri-apps/api/path";
import {
  type TFormat,
  type IAppSettings,
  type IActionResult,
  type IDownloadItem,
  type TDownloadStatus,
} from "../types";
import { DEFAULT_SETTINGS } from "../constants";

// --- CLIPBOARD ---
export async function pasteFromClipboard(): Promise<{
  success: boolean;
  text?: string;
  error?: string;
}> {
  try {
    const text = await readText();

    if (!text || text.trim() === "") {
      return {
        success: false,
        error: "El portapapeles está vacío o no contiene texto válido.",
      };
    }

    return { success: true, text: text.trim() };
  } catch (error) {
    console.error("Clipboard error:", error);
    return {
      success: false,
      error:
        "No se pudo leer el portapapeles. Asegúrate de haber copiado un texto.",
    };
  }
}

// --- UPDATES (yt-dlp) ---
export async function checkYtDlpUpdate(): Promise<boolean> {
  try {
    return await invoke<boolean>("check_yt_dlp_update");
  } catch (error) {
    return true;
  }
}

export async function performYtDlpUpdate(): Promise<IActionResult> {
  try {
    await invoke("perform_yt_dlp_update");
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// --- DIALOGS (Folder Selection) ---
export async function promptForFolder(
  defaultPath?: string,
): Promise<string | null> {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath,
      title: "Seleccionar carpeta de descarga",
    });
    return selected as string | null;
  } catch (error) {
    console.error("Dialog error:", error);
    return null;
  }
}

// --- DOWNLOAD COMMANDS ---
export async function startDownload(
  url: string,
  format: TFormat,
  outputDir: string,
): Promise<{ id?: string; error?: string }> {
  try {
    const id = await invoke<string>("start_download", {
      url,
      format,
      outputDir,
    });
    return { id };
  } catch (error) {
    return { error: String(error) };
  }
}

export async function cancelDownload(id: string): Promise<IActionResult> {
  try {
    await invoke("cancel_download", { id });
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function openInFolder(filePath: string): Promise<IActionResult> {
  try {
    await invoke("open_in_folder", { filePath });
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function deleteFile(filePath: string): Promise<IActionResult> {
  try {
    await invoke("delete_file", { filePath });
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// --- DYNAMIC OS PATHS ---
export async function getDefaultSettings(): Promise<IAppSettings> {
  try {
    const audio = await audioDir();
    const video = await videoDir();
    return {
      audioFolder: audio,
      videoFolder: video,
      maxConcurrent: 2,
    };
  } catch (error) {
    console.warn(
      "Failed to get OS native dirs, falling back to Downloads",
      error,
    );
    try {
      const fallback = await downloadDir();
      return { audioFolder: fallback, videoFolder: fallback, maxConcurrent: 2 };
    } catch {
      return { audioFolder: "", videoFolder: "", maxConcurrent: 2 };
    }
  }
}

export async function loadSettingsSafe(): Promise<{
  data: IAppSettings;
  wasCorrupted: boolean;
}> {
  const defaults = await getDefaultSettings();
  try {
    const store = await load("settings.json", {
      autoSave: false,
      defaults: {},
    });
    const settings = await store.get<IAppSettings>("app_settings");
    if (settings) {
      return { data: settings, wasCorrupted: false };
    } else {
      await store.set("app_settings", defaults);
      await store.save();
      return { data: defaults, wasCorrupted: false };
    }
  } catch (error) {
    console.error("Settings file corrupted. Resetting...", error);
    const store = await load("settings.json", {
      autoSave: false,
      defaults: {},
    });
    await store.set("app_settings", defaults);
    await store.save();
    return { data: defaults, wasCorrupted: true };
  }
}

export async function saveSettings(
  settings: IAppSettings,
): Promise<IActionResult> {
  try {
    const store = await load("settings.json", {
      autoSave: false,
      defaults: {
        app_settings: DEFAULT_SETTINGS,
      },
    });
    await store.set("app_settings", settings);
    await store.save();
    return { success: true };
  } catch (error) {
    return { success: false, error: "No se pudieron guardar los ajustes." };
  }
}

// --- PERSISTENCE: HISTORY ---
export async function loadHistorySafe(): Promise<{
  data: IDownloadItem[];
  wasCorrupted: boolean;
}> {
  try {
    const store = await load("history.json", { autoSave: false, defaults: {} });
    const history = await store.get<IDownloadItem[]>("download_history");
    if (history) {
      const recoveredHistory: IDownloadItem[] = history.map((item) => {
        if (item.status === "downloading" || item.status === "pending") {
          return {
            ...item,
            status: "error" as TDownloadStatus,
            errorMsg: "Descarga interrumpida por cierre de la aplicación.",
          };
        }
        return item;
      });
      await store.set("download_history", recoveredHistory);
      await store.save();
      return { data: recoveredHistory, wasCorrupted: false };
    } else {
      await store.set("download_history", []);
      await store.save();
      return { data: [], wasCorrupted: false };
    }
  } catch (error) {
    console.error("History file corrupted. Resetting...", error);
    const store = await load("history.json", { autoSave: false, defaults: {} });
    await store.set("download_history", []);
    await store.save();
    return { data: [], wasCorrupted: true };
  }
}

export async function saveHistory(history: IDownloadItem[]): Promise<void> {
  try {
    const store = await load("history.json", { autoSave: false, defaults: {} });
    await store.set("download_history", history);
    await store.save();
  } catch (error) {
    console.error("Failed to save history", error);
  }
}
