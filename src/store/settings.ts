import { createStore } from "solid-js/store";
import { loadSettingsSafe, saveSettings, promptForFolder } from "../lib/api";
import { showAlert } from "../components/ui/Toaster";
import type { IAppSettings } from "../types";

// Create a global store
export const [settings, setSettings] = createStore<IAppSettings>({
  audioFolder: "",
  videoFolder: "",
  maxConcurrent: 1,
});

export const initSettings = async () => {
  const result = await loadSettingsSafe();
  console.log(result);
  setSettings(result.data);

  if (result.wasCorrupted) {
    showAlert(
      "Ajustes Restaurados",
      "El archivo de configuración estaba dañado. Se han restaurado las rutas por defecto.",
      "error",
    );
  }
};

export const updateAllSettings = async (newSettings: IAppSettings) => {
  setSettings(newSettings);
  const result = await saveSettings(newSettings);

  if (!result.success) {
    showAlert("Error al guardar", result.error, "error");
  }
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
