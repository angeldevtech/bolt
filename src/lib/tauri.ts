// src/lib/tauri.ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { downloadStore } from "../store/downloads";

export const startDownload = async (
  id: string,
  url: string,
  format: string,
) => {
  try {
    // Tell Rust to start downloading
    await invoke("start_download", { id, url, format });
  } catch (error) {
    downloadStore.updateStatus(id, "error", String(error));
  }
};

// Call this ONCE when the App mounts
export const setupEventListeners = async () => {
  await listen("download-progress", (event) => {
    const { id, progress } = event.payload as { id: string; progress: number };
    downloadStore.updateProgress(id, progress);
  });

  await listen("download-complete", (event) => {
    const { id, filePath } = event.payload as { id: string; filePath: string };
    // Update store to complete and save filepath
    downloadStore.updateStatus(id, "completed");
  });
};
