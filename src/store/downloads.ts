import { createStore } from "solid-js/store";
import { loadHistorySafe, saveHistory, startDownload } from "../lib/api";
import { settings } from "./settings";
import { showAlert } from "../components/ui/Toaster";
import type { IActionResult, IDownloadItem } from "../types";
import { shouldPersistDownloadUpdate } from "./download-persistence";

export const [downloads, setDownloads] = createStore<IDownloadItem[]>([]);

const HISTORY_NOTICE_DURATION_MS = 5000;
let historyPersistenceNoticeUntil = 0;
let historyPersistenceNoticeTimer: ReturnType<typeof setTimeout> | undefined;

function reportHistoryPersistenceFailure(error?: string): void {
  const now = Date.now();
  if (now < historyPersistenceNoticeUntil) return;

  historyPersistenceNoticeUntil = now + HISTORY_NOTICE_DURATION_MS;
  if (historyPersistenceNoticeTimer) {
    clearTimeout(historyPersistenceNoticeTimer);
  }
  historyPersistenceNoticeTimer = setTimeout(() => {
    historyPersistenceNoticeUntil = 0;
    historyPersistenceNoticeTimer = undefined;
  }, HISTORY_NOTICE_DURATION_MS);

  showAlert(
    "Historial no guardado",
    error || "No se pudo guardar el historial de descargas.",
    "error",
  );
}

async function persistCurrentHistory(): Promise<IActionResult<boolean>> {
  const result = await saveHistory(downloads);
  if (!result.success) {
    reportHistoryPersistenceFailure(result.error);
  }

  // `data` indicates that in-memory state was updated even when disk persistence failed.
  return { ...result, data: true };
}

export const initDownloads = async () => {
  const result = await loadHistorySafe();
  setDownloads(result.data);

  if (result.loadError) {
    showAlert("No se pudo cargar el historial", result.loadError, "error");
  }

  if (result.persistenceError) {
    reportHistoryPersistenceFailure(result.persistenceError);
  }

  if (result.wasCorrupted) {
    const description = result.data.length > 0
      ? result.corruptionBackupPath
        ? "Se conservaron las entradas válidas y una copia del archivo dañado."
        : "Se conservaron las entradas válidas, pero no se pudo guardar una copia del archivo dañado."
      : result.corruptionBackupPath
        ? "El historial se reinició y se conservó una copia del archivo dañado."
        : "El historial se reinició, pero no se pudo guardar una copia del archivo dañado.";
    showAlert(
      "Historial Restaurado",
      description,
      "error",
    );
  }
};

export const addDownload = async (
  item: IDownloadItem,
): Promise<IActionResult<boolean>> => {
  // Put new downloads at the top of the list
  setDownloads((prev) => [item, ...prev]);
  // Save to disk immediately so if it crashes, we don't lose the record
  return await persistCurrentHistory();
};

export const updateDownloadStatus = async (
  id: string,
  updates: Partial<Omit<IDownloadItem, "id">>,
): Promise<IActionResult<boolean>> => {
  const currentDownload = downloads.find((download) => download.id === id);
  if (!currentDownload) {
    if (import.meta.env.DEV) {
      console.warn("[downloads] Ignoring update for unknown download id", {
        id,
        updates,
      });
    }
    return {
      success: false,
      data: false,
      error: "La descarga ya no existe en el historial.",
    };
  }

  setDownloads(
    (d) => d.id === id,
    (d) => ({ ...d, ...updates }),
  );

  // Persist status/title and terminal metadata, but exclude progress-only ticks.
  if (shouldPersistDownloadUpdate(updates)) {
    return await persistCurrentHistory();
  }

  return { success: true, data: true };
};

export const removeDownload = async (
  id: string,
): Promise<IActionResult<boolean>> => {
  if (!downloads.some((download) => download.id === id)) {
    return {
      success: false,
      data: false,
      error: "La descarga ya no existe en el historial.",
    };
  }

  setDownloads((prev) => prev.filter((d) => d.id !== id));
  return await persistCurrentHistory();
};

export const retryDownload = async (
  id: string,
): Promise<IActionResult<boolean>> => {
  const item = downloads.find((d) => d.id === id);
  if (!item) {
    return {
      success: false,
      data: false,
      error: "La descarga ya no existe en el historial.",
    };
  }

  const newId = crypto.randomUUID();
  const outputDir = item.format === "mp3" ? settings.audioFolder : settings.videoFolder;
  if (!outputDir) {
    showAlert("Carpeta no configurada", "Configura la carpeta de descarga en Ajustes.", "error");
    return {
      success: false,
      data: false,
      error: "No hay una carpeta de descarga configurada.",
    };
  }

  const newItem: IDownloadItem = {
    id: newId,
    url: item.url, title: item.title,
    format: item.format, status: "pending", progress: 0,
  };

  // Replace both rows in memory and persist one snapshot, avoiding an intermediate retry state.
  setDownloads((prev) => [newItem, ...prev.filter((download) => download.id !== id)]);
  const historyResult = await persistCurrentHistory();

  const result = await startDownload(newId, item.url, item.format, outputDir);
  let transitionResult: IActionResult<boolean>;
  if (result.id === newId && result.title) {
    transitionResult = await updateDownloadStatus(newId, { title: result.title });
  } else {
    const errorMessage = result.error?.trim() || "Error desconocido";
    if (downloads.find((download) => download.id === newId)?.status === "pending") {
      const isCancellation = errorMessage.toLowerCase().includes("cancelada");
      transitionResult = await updateDownloadStatus(newId, {
        status: isCancellation ? "cancelled" : "error",
        errorMsg: errorMessage,
      });
      if (!isCancellation) {
        showAlert("Error de descarga", errorMessage, "error");
      }
    } else {
      transitionResult = { success: true, data: true };
    }
  }

  return historyResult.success ? transitionResult : historyResult;
};
