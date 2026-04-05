export type TDownloadStatus = "pending" | "downloading" | "completed" | "error";
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
}

// A standard response wrapper for API calls
export interface IActionResult {
  success: boolean;
  error?: string;
}
