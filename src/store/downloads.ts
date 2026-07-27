import { createStore } from "solid-js/store";
import { loadHistorySafe, saveHistory, startDownload, queuePlaylistBatch, cancelDownload } from "../lib/api";
import { settings } from "./settings";
import { showAlert } from "../components/ui/Toaster";
import type {
  IActionResult,
  IDownloadItem,
  IPlaylistBatchPayload,
  IPlaylistQueueEntry,
} from "../types";
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
  setDownloads((prev) => [item, ...prev]);
  return await persistCurrentHistory();
};

export const addDownloads = async (
  items: IDownloadItem[],
): Promise<IActionResult<boolean>> => {
  setDownloads((prev) => [...items, ...prev]);
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
    url: item.url,
    title: item.title,
    format: item.format,
    status: "pending",
    progress: 0,
    videoId: item.videoId,
    groupId: item.groupId,
    playlistId: item.playlistId,
    playlistTitle: item.playlistTitle,
    playlistDescription: item.playlistDescription,
    playlistThumbnailUrl: item.playlistThumbnailUrl,
  };

  setDownloads((prev) =>
    prev.map((download) => (download.id === id ? newItem : download)),
  );
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

// --- GROUP OPERATIONS ---

export function getGroupedDownloads() {
  const groups = new Map<string, IDownloadItem[]>();
  const ungrouped: IDownloadItem[] = [];

  for (const item of downloads) {
    if (item.groupId) {
      const existing = groups.get(item.groupId);
      if (existing) {
        existing.push(item);
      } else {
        groups.set(item.groupId, [item]);
      }
    } else {
      ungrouped.push(item);
    }
  }

  return { groups, ungrouped };
}

export function getGroupChildren(groupId: string): IDownloadItem[] {
  return downloads.filter((d) => d.groupId === groupId);
}

export async function cancelGroup(
  groupId: string,
): Promise<IActionResult<boolean>> {
  const children = downloads.filter(
    (d) => d.groupId === groupId && (d.status === "pending" || d.status === "downloading"),
  );

  if (children.length === 0) {
    return { success: true, data: true };
  }

  let allSuccess = true;
  for (const child of children) {
    const result = await cancelDownload(child.id);
    if (!result.success) allSuccess = false;
  }

  return { success: allSuccess, data: allSuccess };
}

export async function retryGroup(
  groupId: string,
): Promise<IActionResult<boolean>> {
  const children = downloads.filter(
    (d) => d.groupId === groupId && (d.status === "error" || d.status === "cancelled"),
  );

  if (children.length === 0) {
    return { success: true, data: true };
  }

  const firstChild = children[0];
  const playlistId = firstChild.playlistId;
  if (!playlistId || children.some((item) => !item.videoId || !item.playlistId)) {
    return {
      success: false,
      data: false,
      error: "La playlist no tiene información suficiente para reintentar.",
    };
  }

  const newItems = new Map<string, IDownloadItem>();
  const entries: IPlaylistQueueEntry[] = [];

  for (const item of children) {
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
      url: item.url,
      title: item.title,
      format: item.format,
      status: "pending",
      progress: 0,
      videoId: item.videoId,
      groupId: item.groupId,
      playlistId: item.playlistId,
      playlistTitle: item.playlistTitle,
      playlistDescription: item.playlistDescription,
      playlistThumbnailUrl: item.playlistThumbnailUrl,
    };
    newItems.set(item.id, newItem);
    entries.push({
      id: newId,
      videoId: item.videoId!,
      format: item.format,
      outputDir,
      title: item.title,
    });
  }

  setDownloads((prev) => prev.map((item) => newItems.get(item.id) || item));
  const historyResult = await persistCurrentHistory();

  const result = await queuePlaylistBatch({
    entries,
    groupId,
    playlistId,
    playlistTitle: firstChild.playlistTitle || "Playlist",
    playlistDescription: firstChild.playlistDescription,
    playlistThumbnailUrl: firstChild.playlistThumbnailUrl,
  });

  if (!result.success) {
    const errorMessage = result.error || "No se pudieron reintentar las descargas.";
    setDownloads((prev) =>
      prev.map((item) =>
        newItems.has(item.id) && item.status === "pending"
          ? { ...item, status: "error", errorMsg: errorMessage }
          : item,
      ),
    );
    await persistCurrentHistory();
    showAlert("Error", errorMessage, "error");
  }

  return historyResult.success ? result : historyResult;
}

export async function startPlaylistBatch(
  payload: IPlaylistBatchPayload,
): Promise<IActionResult<boolean>> {
  if (payload.entries.length === 0) {
    return {
      success: false,
      data: false,
      error: "No hay videos disponibles para encolar.",
    };
  }

  const items: IDownloadItem[] = payload.entries.map((entry) => ({
    id: entry.id,
    url: `https://www.youtube.com/watch?v=${entry.videoId}`,
    title: entry.title,
    format: entry.format,
    status: "pending",
    progress: 0,
    videoId: entry.videoId,
    groupId: payload.groupId,
    playlistId: payload.playlistId,
    playlistTitle: payload.playlistTitle,
    playlistDescription: payload.playlistDescription,
    playlistThumbnailUrl: payload.playlistThumbnailUrl,
  }));

  setDownloads((prev) => [...items, ...prev]);
  const historyResult = await persistCurrentHistory();

  const result = await queuePlaylistBatch(payload);
  if (!result.success) {
    const errorMessage = result.error || "Error desconocido";
    setDownloads((prev) =>
      prev.map((item) =>
        items.some((queuedItem) => queuedItem.id === item.id) && item.status === "pending"
          ? { ...item, status: "error", errorMsg: errorMessage }
          : item,
      ),
    );
    await persistCurrentHistory();
    showAlert("Error al encolar playlist", errorMessage, "error");
  }

  return historyResult.success ? result : historyResult;
}
