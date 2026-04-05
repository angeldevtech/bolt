import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  type IProgressPayload,
  type ICompletePayload,
  type IErrorPayload,
} from "../types";

export async function setupDownloadListeners(callbacks: {
  onProgress: (payload: IProgressPayload) => void;
  onComplete: (payload: ICompletePayload) => void;
  onError: (payload: IErrorPayload) => void;
}): Promise<UnlistenFn[]> {
  const unlistenProgress = await listen<IProgressPayload>(
    "download_progress",
    (event) => callbacks.onProgress(event.payload),
  );

  const unlistenComplete = await listen<ICompletePayload>(
    "download_complete",
    (event) => callbacks.onComplete(event.payload),
  );

  const unlistenError = await listen<IErrorPayload>("download_error", (event) =>
    callbacks.onError(event.payload),
  );

  return [unlistenProgress, unlistenComplete, unlistenError];
}
