import { createStore, produce } from "solid-js/store";
import type { DownloadItem, Format } from "../types";

const [downloads, setDownloads] = createStore<DownloadItem[]>([]);

export const downloadStore = {
  downloads,

  addDownload: (url: string, format: Format) => {
    const id = crypto.randomUUID();
    setDownloads(
      produce((list) => {
        list.push({
          id,
          url,
          title: "Fetching info...",
          format,
          status: "pending",
          progress: 0,
        });
      }),
    );
    return id;
  },

  updateProgress: (id: string, progress: number) => {
    setDownloads((d) => d.id === id, "progress", progress);
    setDownloads((d) => d.id === id, "status", "downloading");
  },

  updateStatus: (
    id: string,
    status: DownloadItem["status"],
    errorMsg?: string,
  ) => {
    setDownloads((d) => d.id === id, "status", status);
    if (errorMsg) setDownloads((d) => d.id === id, "errorMsg", errorMsg);
  },

  removeDownload: (id: string) => {
    setDownloads(downloads.filter((d) => d.id !== id));
  },
};
