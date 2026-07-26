import type { IDownloadItem, TDownloadStatus, TFormat } from "../types";

const DOWNLOAD_FORMATS = ["mp3", "mp4", "mp4-hd"] as const;
const DOWNLOAD_STATUSES = [
  "pending",
  "downloading",
  "completed",
  "error",
  "cancelled",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDownloadFormat(value: unknown): value is TFormat {
  return (
    typeof value === "string" &&
    DOWNLOAD_FORMATS.includes(value as (typeof DOWNLOAD_FORMATS)[number])
  );
}

function isDownloadStatus(value: unknown): value is TDownloadStatus {
  return (
    typeof value === "string" &&
    DOWNLOAD_STATUSES.includes(value as (typeof DOWNLOAD_STATUSES)[number])
  );
}

export function normalizeHistoryItem(value: unknown): IDownloadItem | null {
  if (!isRecord(value)) return null;

  const id = typeof value.id === "string" ? value.id.trim() : "";
  const url = typeof value.url === "string" ? value.url.trim() : "";
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const progress = value.progress;

  if (
    !id ||
    !url ||
    !title ||
    !isDownloadFormat(value.format) ||
    !isDownloadStatus(value.status) ||
    typeof progress !== "number" ||
    !Number.isFinite(progress) ||
    progress < 0 ||
    progress > 100
  ) {
    return null;
  }

  const item: IDownloadItem = {
    id,
    url,
    title,
    format: value.format,
    status: value.status,
    progress,
  };

  if (
    typeof value.sizeMB === "number" &&
    Number.isFinite(value.sizeMB) &&
    value.sizeMB >= 0
  ) {
    item.sizeMB = value.sizeMB;
  }

  if (typeof value.errorMsg === "string" && value.errorMsg.trim()) {
    item.errorMsg = value.errorMsg.trim();
  }

  if (typeof value.filePath === "string" && value.filePath.trim()) {
    item.filePath = value.filePath.trim();
  }

  return item;
}

export function normalizeHistory(value: unknown): {
  data: IDownloadItem[];
  wasCorrupted: boolean;
  wasNormalized: boolean;
} {
  if (!Array.isArray(value)) {
    return { data: [], wasCorrupted: true, wasNormalized: false };
  }

  const data: IDownloadItem[] = [];
  let wasCorrupted = false;
  let wasNormalized = false;

  for (const entry of value) {
    const item = normalizeHistoryItem(entry);
    if (!item) {
      wasCorrupted = true;
      continue;
    }

    if (JSON.stringify(item) !== JSON.stringify(entry)) {
      wasNormalized = true;
    }
    data.push(item);
  }

  return { data, wasCorrupted, wasNormalized };
}

export function recoverInterruptedDownloads(
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
