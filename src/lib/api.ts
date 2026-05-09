import { invoke } from "@tauri-apps/api/core";
import {
  appLocalDataDir,
  audioDir,
  BaseDirectory,
  downloadDir,
  videoDir,
} from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { load } from "@tauri-apps/plugin-store";
import {
  type TFormat,
  type IAppSettings,
  type IActionResult,
  type IDownloadItem,
  type TDownloadStatus,
} from "../types";
import { DEFAULT_MAX_CONCURRENT } from "../constants";

const SETTINGS_FILE = "settings.json";
const HISTORY_FILE = "history.json";

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

// --- SETTINGS PERSISTENCE (plugin-store) ---
async function getSettingsStore() {
  return await load(SETTINGS_FILE, { autoSave: true, defaults: {} });
}

export async function getDefaultSettings(): Promise<IAppSettings> {
  try {
    const audio = await audioDir();
    const video = await videoDir();
    console.info("[settings] OS default directories resolved", {
      audio,
      video,
    });
    return {
      audioFolder: audio,
      videoFolder: video,
      maxConcurrent: DEFAULT_MAX_CONCURRENT,
    };
  } catch (error) {
    console.warn(
      "[settings] Failed to get OS native dirs, falling back to Downloads",
      error,
    );
    try {
      const fallback = await downloadDir();
      console.info("[settings] Download fallback directory resolved", {
        fallback,
      });
      return {
        audioFolder: fallback,
        videoFolder: fallback,
        maxConcurrent: DEFAULT_MAX_CONCURRENT,
      };
    } catch {
      console.error(
        "[settings] Failed to resolve OS directories and download fallback",
      );
      return {
        audioFolder: "",
        videoFolder: "",
        maxConcurrent: DEFAULT_MAX_CONCURRENT,
      };
    }
  }
}

function normalizeSettings(
  stored: Partial<IAppSettings> | null | undefined,
  defaults: IAppSettings,
): IAppSettings {
  return {
    audioFolder: stored?.audioFolder?.trim() || defaults.audioFolder,
    videoFolder: stored?.videoFolder?.trim() || defaults.videoFolder,
    maxConcurrent:
      typeof stored?.maxConcurrent === "number" && stored.maxConcurrent > 0
        ? stored.maxConcurrent
        : defaults.maxConcurrent,
  };
}

async function readStoredSettings(): Promise<Partial<IAppSettings> | null> {
  const store = await getSettingsStore();
  const audioFolder = await store.get<string>("audioFolder");
  const videoFolder = await store.get<string>("videoFolder");
  const maxConcurrent = await store.get<number>("maxConcurrent");

  if (audioFolder != null || videoFolder != null || maxConcurrent != null) {
    return {
      audioFolder: audioFolder ?? undefined,
      videoFolder: videoFolder ?? undefined,
      maxConcurrent: maxConcurrent ?? undefined,
    };
  }

  return null;
}

export async function loadSettingsSafe(): Promise<{
  data: IAppSettings;
  wasCorrupted: boolean;
}> {
  const defaults = await getDefaultSettings();
  console.info("[settings] Computed runtime defaults", defaults);

  try {
    const store = await getSettingsStore();
    const storedSettings = await readStoredSettings();
    console.info("[settings] Raw store value", storedSettings);

    if (!storedSettings) {
      console.info(
        "[settings] No stored settings found, creating settings.json",
      );
      await saveSettings(defaults);
      return { data: defaults, wasCorrupted: false };
    }

    const normalizedSettings = normalizeSettings(storedSettings, defaults);
    console.info("[settings] Normalized store value", normalizedSettings);

    if (JSON.stringify(normalizedSettings) !== JSON.stringify(storedSettings)) {
      console.info("[settings] Persisting normalized settings back to store");
    }

    await store.set("audioFolder", normalizedSettings.audioFolder);
    await store.set("videoFolder", normalizedSettings.videoFolder);
    await store.set("maxConcurrent", normalizedSettings.maxConcurrent);

    return { data: normalizedSettings, wasCorrupted: false };
  } catch (error) {
    console.error(
      "[settings] Failed to load settings store. Using runtime defaults.",
      error,
    );
    return { data: defaults, wasCorrupted: true };
  }
}

export async function saveSettings(
  settings: IAppSettings,
): Promise<IActionResult> {
  try {
    const store = await getSettingsStore();
    await store.set("audioFolder", settings.audioFolder);
    await store.set("videoFolder", settings.videoFolder);
    await store.set("maxConcurrent", settings.maxConcurrent);
    return { success: true };
  } catch (error) {
    console.error("[settings] Failed to save settings", error);
    return { success: false, error: "No se pudieron guardar los ajustes." };
  }
}

// --- HISTORY PERSISTENCE (plugin-fs) ---
function recoverInterruptedDownloads(
  history: IDownloadItem[],
): IDownloadItem[] {
  return history.map((item) => {
    if (item.status === "downloading" || item.status === "pending") {
      return {
        ...item,
        status: "error" as TDownloadStatus,
        errorMsg: "Descarga interrumpida por cierre de la aplicación.",
      };
    }

    return item;
  });
}

export async function getHistoryPath(): Promise<string> {
  const base = await appLocalDataDir();
  return `${base}${base.endsWith("\\") || base.endsWith("/") ? "" : "\\"}${HISTORY_FILE}`;
}

export async function loadHistorySafe(): Promise<{
  data: IDownloadItem[];
  wasCorrupted: boolean;
}> {
  try {
    const historyExists = await exists(HISTORY_FILE, {
      baseDir: BaseDirectory.AppLocalData,
    });

    if (!historyExists) {
      console.info("[history] No history.json found in AppLocalData");
      return { data: [], wasCorrupted: false };
    }

    const rawHistory = await readTextFile(HISTORY_FILE, {
      baseDir: BaseDirectory.AppLocalData,
    });
    const history = JSON.parse(rawHistory) as IDownloadItem[];
    const recoveredHistory = recoverInterruptedDownloads(history);

    if (JSON.stringify(recoveredHistory) !== JSON.stringify(history)) {
      await saveHistory(recoveredHistory);
    }

    console.info("[history] Loaded history from AppLocalData", {
      path: await getHistoryPath(),
      count: recoveredHistory.length,
    });

    return { data: recoveredHistory, wasCorrupted: false };
  } catch (error) {
    console.error("[history] History file corrupted. Resetting...", error);
    await saveHistory([]);
    return { data: [], wasCorrupted: true };
  }
}

export async function saveHistory(history: IDownloadItem[]): Promise<void> {
  try {
    await writeTextFile(HISTORY_FILE, JSON.stringify(history, null, 2), {
      baseDir: BaseDirectory.AppLocalData,
    });
  } catch (error) {
    console.error("[history] Failed to save history", error);
  }
}
