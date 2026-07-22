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

export interface IYtDlpUpdateResult {
  updated: boolean;
  output: string;
}
