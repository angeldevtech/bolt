export type TDownloadStatus = "pending" | "downloading" | "completed" | "error" | "cancelled";
export type TFormat = "mp3" | "mp4" | "mp4-hd";

export interface IDownloadItem {
  id: string;
  url: string;
  title: string;
  format: TFormat;
  sizeMB?: number;
  status: TDownloadStatus;
  progress: number;
  errorMsg?: string;
  filePath?: string;
  videoId?: string;
  groupId?: string;
  playlistId?: string;
  playlistTitle?: string;
  playlistDescription?: string;
  playlistThumbnailUrl?: string;
}

export interface IAppSettings {
  videoFolder: string;
  audioFolder: string;
  maxConcurrent: number;
}

export interface IProgressPayload {
  id: string;
  progress: number;
}

export interface IStartedPayload {
  id: string;
}

export interface ICompletePayload {
  id: string;
  filePath: string;
  sizeMB: number;
}

export interface IErrorPayload {
  id: string;
  errorMsg: string;
  cancelled?: boolean;
}

// A standard response wrapper for API calls
export interface IActionResult<T> {
  success: boolean;
  error?: string;
  data?: T;
}

export type TYtDlpCheckResultStatus = "current" | "available" | "different";
export type TYtDlpUpdateCheckStatus =
  | "unchecked"
  | "checking"
  | TYtDlpCheckResultStatus
  | "check-failed";

export interface IYtDlpUpdateCheckResult {
  status: TYtDlpCheckResultStatus;
  currentVersion: string;
  latestVersion: string;
}

export interface IYtDlpUpdateResult {
  updated: boolean;
  currentVersion: string;
  output: string;
}

// --- YouTube source classification ---

export type TYouTubeSourceType =
  | "video"
  | "playlist"
  | "video+playlist"
  | "radio"
  | "generic";

export interface IYouTubeSource {
  type: TYouTubeSourceType;
  canonicalUrl: string;
  videoId?: string;
  playlistId?: string;
}

export interface IPlaylistEntry {
  videoId: string;
  title: string;
}

export interface IPlaylistMetadata {
  title: string;
  description?: string;
  thumbnailUrl?: string;
  total: number;
  entries: IPlaylistEntry[];
  unavailableCount: number;
  duplicateCount: number;
}

export interface IPlaylistQueueEntry {
  id: string;
  videoId: string;
  format: TFormat;
  outputDir: string;
  title: string;
}

export interface IPlaylistBatchPayload {
  entries: IPlaylistQueueEntry[];
  groupId: string;
  playlistId: string;
  playlistTitle: string;
  playlistDescription?: string;
  playlistThumbnailUrl?: string;
}