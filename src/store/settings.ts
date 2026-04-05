import { createStore } from "solid-js/store";
import { loadSettingsSafe, saveSettings, promptForFolder } from "../lib/api";
import { showAlert } from "../components/ui/Toaster";
import type { IAppSettings } from "../types";

// Create a global store
export const [settings, setSettings] = createStore<IAppSettings>({
  audioFolder: "",
  videoFolder: "",
  maxConcurrent: 2,
});

export const initSettings = async () => {
  const result = await loadSettingsSafe();
  setSettings(result.data);

  if (result.wasCorrupted) {
    showAlert(
      "Ajustes Restaurados",
      "El archivo de configuración estaba dañado. Se han restaurado las rutas por defecto.",
      "error",
    );
  }
};

export const updateSetting = async <K extends keyof IAppSettings>(
  key: K,
  value: IAppSettings[K],
) => {
  setSettings(key, value);
  await saveSettings(settings); // Assume saveSettings is updated to handle just the save part
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
