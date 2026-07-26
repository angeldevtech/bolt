import { invoke } from "@tauri-apps/api/core";
import {
  appLocalDataDir,
  audioDir,
  BaseDirectory,
  downloadDir,
  join,
  videoDir,
} from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import {
  exists,
  readTextFile,
  rename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { load } from "@tauri-apps/plugin-store";
import {
  type TFormat,
  type IAppSettings,
  type IActionResult,
  type IYtDlpUpdateCheckResult,
  type IYtDlpUpdateResult,
} from "../types";
import {
  DEFAULT_MAX_CONCURRENT,
  DOWNLOAD_CONCURRENCY_OPTIONS,
} from "../constants";
import { createTauriHistoryPersistence } from "./tauri-history";

const SETTINGS_FILE = "settings.json";
const HISTORY_FILE = "history.json";
const HISTORY_TEMP_FILE = "history.tmp.json";

// --- CLIPBOARD ---
export async function pasteFromClipboard(): Promise<IActionResult<string>> {
  try {
    const text = await readText();

    if (!text || text.trim() === "") {
      return {
        success: false,
        error: "El portapapeles está vacío o no contiene texto válido.",
      };
    }

    return { success: true, data: text.trim() };
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
let activeYtDlpCheck:
  | Promise<IActionResult<IYtDlpUpdateCheckResult>>
  | undefined;

export function checkYtDlpUpdate(): Promise<IActionResult<IYtDlpUpdateCheckResult>> {
  if (activeYtDlpCheck) return activeYtDlpCheck;

  const request = invoke<IYtDlpUpdateCheckResult>("check_yt_dlp_update")
    .then((result) => ({ success: true, data: result }))
    .catch((error) => ({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }));

  activeYtDlpCheck = request;
  void request.then(
    () => {
      if (activeYtDlpCheck === request) activeYtDlpCheck = undefined;
    },
    () => {
      if (activeYtDlpCheck === request) activeYtDlpCheck = undefined;
    },
  );

  return request;
}

export async function performYtDlpUpdate(): Promise<IActionResult<IYtDlpUpdateResult>> {
  try {
    const result = await invoke<IYtDlpUpdateResult>("perform_yt_dlp_update");
    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
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
  id: string,
  url: string,
  format: TFormat,
  outputDir: string,
): Promise<{ id?: string; title?: string; error?: string }> {
  try {
    const result = await invoke<{ id: string; title: string }>("start_download", {
      id,
      url,
      format,
      outputDir,
    });
    return { id: result.id, title: result.title };
  } catch (error) {
    return { id, error: String(error) };
  }
}

export async function setDownloadConcurrency(
  maxConcurrent: number,
): Promise<IActionResult<number>> {
  try {
    const limit = await invoke<number>("set_download_concurrency", {
      maxConcurrent,
    });
    return { success: true, data: limit };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function cancelDownload(
  id: string,
): Promise<IActionResult<boolean>> {
  try {
    await invoke("cancel_download", { id });
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function openFile(
  filePath: string,
): Promise<IActionResult<boolean>> {
  try {
    await invoke("open_file", { filePath });
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function deleteToTrash(
  filePath: string,
): Promise<IActionResult<boolean>> {
  try {
    await invoke("delete_to_trash", { filePath });
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function openInFolder(
  filePath: string,
): Promise<IActionResult<boolean>> {
  try {
    await invoke("open_in_folder", { filePath });
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
  const maxConcurrent = normalizeMaxConcurrent(
    stored?.maxConcurrent,
    defaults.maxConcurrent,
  );

  return {
    audioFolder: stored?.audioFolder?.trim() || defaults.audioFolder,
    videoFolder: stored?.videoFolder?.trim() || defaults.videoFolder,
    maxConcurrent,
  };
}

function normalizeMaxConcurrent(value: unknown, fallback: number): number {
  const minimum = DOWNLOAD_CONCURRENCY_OPTIONS[0];
  const maximum = DOWNLOAD_CONCURRENCY_OPTIONS[DOWNLOAD_CONCURRENCY_OPTIONS.length - 1];
  const fallbackValue = Number.isFinite(fallback)
    ? Math.min(maximum, Math.max(minimum, Math.trunc(fallback)))
    : minimum;

  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallbackValue;
  }

  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
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
): Promise<IActionResult<boolean>> {
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

export async function getHistoryPath(): Promise<string> {
  const base = await appLocalDataDir();
  return await join(base, HISTORY_FILE);
}

const historyPersistence = createTauriHistoryPersistence(
  {
    exists: (path) =>
      exists(path, {
        baseDir: BaseDirectory.AppLocalData,
      }),
    readTextFile: (path) =>
      readTextFile(path, {
        baseDir: BaseDirectory.AppLocalData,
      }),
    writeTextFile: (path, contents) =>
      writeTextFile(path, contents, {
        baseDir: BaseDirectory.AppLocalData,
      }),
    rename: (oldPath, newPath) =>
      rename(oldPath, newPath, {
        oldPathBaseDir: BaseDirectory.AppLocalData,
        newPathBaseDir: BaseDirectory.AppLocalData,
      }),
  },
  {
    historyFile: HISTORY_FILE,
    temporaryFile: HISTORY_TEMP_FILE,
    createCorruptionBackupPath: () =>
      `history.corrupt-${Date.now()}-${crypto.randomUUID()}.json`,
  },
);

export const loadHistorySafe = historyPersistence.loadHistorySafe;
export const saveHistory = historyPersistence.saveHistory;
