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
