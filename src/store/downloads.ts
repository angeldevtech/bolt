import { createStore } from "solid-js/store";
import { loadHistorySafe, saveHistory, startDownload } from "../lib/api";
import { settings } from "./settings";
import { showAlert } from "../components/ui/Toaster";
import type { IDownloadItem } from "../types";

export const [downloads, setDownloads] = createStore<IDownloadItem[]>([]);

export const initDownloads = async () => {
  const result = await loadHistorySafe();
  setDownloads(result.data);

  if (result.wasCorrupted) {
    showAlert(
      "Historial Restaurado",
      "El historial de descargas estaba dañado y ha sido reiniciado.",
      "error",
    );
  }
};

export const addDownload = async (item: IDownloadItem) => {
  // Put new downloads at the top of the list
  setDownloads((prev) => [item, ...prev]);
  // Save to disk immediately so if it crashes, we don't lose the record
  await saveHistory(downloads);
};

export const updateDownloadStatus = async (
  id: string,
  updates: Partial<IDownloadItem>,
) => {
  setDownloads(
    (d) => d.id === id,
    (d) => ({ ...d, ...updates }),
  );

  // Only save to disk on major status changes (completed/error),
  // NOT on every single progress tick (1%, 2%, 3%), to avoid killing the SSD/disk.
  if (updates.status === "completed" || updates.status === "error") {
    await saveHistory(downloads);
  }
};

export const removeDownload = async (id: string) => {
  setDownloads((prev) => prev.filter((d) => d.id !== id));
  await saveHistory(downloads);
};

export const retryDownload = async (id: string) => {
  const item = downloads.find((d) => d.id === id);
  if (!item) return;
  const tempId = crypto.randomUUID();
  const outputDir = item.format === "mp3" ? settings.audioFolder : settings.videoFolder;
  if (!outputDir) {
    showAlert("Carpeta no configurada", "Configura la carpeta de descarga en Ajustes.", "error");
    return;
  }
  const newItem: IDownloadItem = {
    id: tempId,
    url: item.url, title: item.title,
    format: item.format, status: "pending", progress: 0,
  };
  await addDownload(newItem);
  await removeDownload(id);

  const result = await startDownload(item.url, item.format, outputDir);
  if (result.id && result.title) {
    updateDownloadStatus(tempId, { id: result.id, title: result.title, status: "downloading" });
  } else {
    const errorMessage = result.error?.trim() || "Error desconocido";
    updateDownloadStatus(tempId, { status: "error", errorMsg: errorMessage });
    showAlert("Error de descarga", errorMessage, "error");
  }
};
