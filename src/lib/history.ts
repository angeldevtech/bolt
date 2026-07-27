import type { IDownloadItem, TDownloadStatus, TFormat } from "../types";
import { classifyUrl } from "./youtube";

const DOWNLOAD_FORMATS = ["mp3", "mp4", "mp4-hd"] as const;
const DOWNLOAD_STATUSES = [
  "pending",
  "downloading",
  "completed",
  "error",
  "cancelled",
] as const;

const YOUTUBE_IMAGE_HOSTS = [
  "img.youtube.com",
  "i.ytimg.com",
];
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);
const SAFE_YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{2,100}$/;
const SAFE_VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

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

function isValidPlaylistThumbnailUrl(url: unknown): string | undefined {
  if (typeof url !== "string" || !url.trim()) return undefined;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:") return undefined;
    if (parsed.username || parsed.password || parsed.port) return undefined;
    if (!YOUTUBE_IMAGE_HOSTS.includes(parsed.hostname.toLowerCase())) return undefined;
    if (parsed.pathname.length >= 200) return undefined;
    return url.trim();
  } catch {
    return undefined;
  }
}

function isYouTubeUrl(url: string): boolean {
  try {
    return YOUTUBE_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
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

  const videoId = typeof value.videoId === "string" ? value.videoId.trim() : undefined;
  if (videoId && SAFE_VIDEO_ID_RE.test(videoId)) {
    item.videoId = videoId;
  }

  if (/^https?:\/\//i.test(url)) {
    const source = classifyUrl(url);
    if ("error" in source) {
      if (isYouTubeUrl(url)) return null;
    } else if (source.type === "playlist" || (source.type === "radio" && !source.videoId)) {
      return null;
    } else {
      item.url = source.canonicalUrl;
      if (source.videoId) item.videoId = source.videoId;
    }
  }

  if (typeof value.groupId === "string" && value.groupId.trim()) {
    item.groupId = value.groupId.trim();
  }

  if (
    typeof value.playlistId === "string" &&
    SAFE_YOUTUBE_ID_RE.test(value.playlistId.trim())
  ) {
    item.playlistId = value.playlistId.trim();
  }

  if (typeof value.playlistTitle === "string" && value.playlistTitle.trim()) {
    item.playlistTitle = value.playlistTitle.trim();
  }

  if (typeof value.playlistDescription === "string" && value.playlistDescription.trim()) {
    item.playlistDescription = value.playlistDescription.trim();
  }

  const thumbnail = isValidPlaylistThumbnailUrl(value.playlistThumbnailUrl);
  if (thumbnail) {
    item.playlistThumbnailUrl = thumbnail;
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
