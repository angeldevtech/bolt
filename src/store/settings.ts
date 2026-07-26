import { createStore } from "solid-js/store";
import {
  loadSettingsSafe,
  saveSettings,
  promptForFolder,
  setDownloadConcurrency,
} from "../lib/api";
import { showAlert } from "../components/ui/Toaster";
import type { IActionResult, IAppSettings } from "../types";
import { DOWNLOAD_CONCURRENCY_OPTIONS } from "../constants";

// Create a global store
export const [settings, setSettings] = createStore<IAppSettings>({
  audioFolder: "",
  videoFolder: "",
  maxConcurrent: 1,
});

export const initSettings = async () => {
  const result = await loadSettingsSafe();
  console.info("[settings] initSettings result", result);
  setSettings(result.data);

  const backendResult = await setDownloadConcurrency(result.data.maxConcurrent);
  if (!backendResult.success) {
    showAlert("Error de configuración", backendResult.error, "error");
  }

  if (result.wasCorrupted) {
    showAlert(
      "Ajustes Restaurados",
      "El archivo de configuración estaba dañado. Se han restaurado las rutas por defecto.",
      "error",
    );
  }
};

export const updateAllSettings = async (
  newSettings: IAppSettings,
): Promise<IActionResult<boolean>> => {
  const minimum = DOWNLOAD_CONCURRENCY_OPTIONS[0];
  const maximum =
    DOWNLOAD_CONCURRENCY_OPTIONS[DOWNLOAD_CONCURRENCY_OPTIONS.length - 1];
  const requestedMax = Number.isFinite(newSettings.maxConcurrent)
    ? Math.trunc(newSettings.maxConcurrent)
    : minimum;
  const normalizedSettings = {
    ...newSettings,
    maxConcurrent: Math.min(
      maximum,
      Math.max(minimum, requestedMax),
    ),
  };

  console.info("[settings] updateAllSettings", normalizedSettings);
  setSettings(normalizedSettings);
  const [result, backendResult] = await Promise.all([
    saveSettings(normalizedSettings),
    setDownloadConcurrency(normalizedSettings.maxConcurrent),
  ]);

  if (!result.success) {
    showAlert("Error al guardar", result.error, "error");
  }
  if (!backendResult.success) {
    showAlert("Error de configuración", backendResult.error, "error");
  }

  const errors = [result.error, backendResult.error].filter(
    (error): error is string => Boolean(error),
  );
  return {
    success: result.success && backendResult.success,
    data: true,
    error: errors.length > 0 ? errors.join(" ") : undefined,
  };
};

export const updateSetting = async <K extends keyof IAppSettings>(
  key: K,
  value: IAppSettings[K],
) => {
  await updateAllSettings({
    ...settings,
    [key]: value,
  });
};

// Expose a helper for the UI folder buttons
export const pickFolder = async (type: "audio" | "video") => {
  const currentPath =
    type === "audio" ? settings.audioFolder : settings.videoFolder;
  const newPath = await promptForFolder(currentPath);

  if (newPath) {
    if (type === "audio") await updateSetting("audioFolder", newPath);
    if (type === "video") await updateSetting("videoFolder", newPath);
  }
};
