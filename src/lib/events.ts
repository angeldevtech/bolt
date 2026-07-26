import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  type IProgressPayload,
  type IStartedPayload,
  type ICompletePayload,
  type IErrorPayload,
} from "../types";

export type DownloadEventRegistrar = <T>(
  event: string,
  callback: (event: { payload: T }) => void,
) => Promise<UnlistenFn>;

const defaultRegisterEvent: DownloadEventRegistrar = (event, callback) =>
  listen(event, callback);

export function cleanupDownloadListeners(listeners: UnlistenFn[]): void {
  for (const unlisten of listeners) {
    try {
      unlisten();
    } catch {
      // Cleanup must continue if one listener has already been disposed.
    }
  }
}

export async function setupDownloadListeners(callbacks: {
  onStarted: (payload: IStartedPayload) => void;
  onProgress: (payload: IProgressPayload) => void;
  onComplete: (payload: ICompletePayload) => void;
  onError: (payload: IErrorPayload) => void;
}, registerEvent: DownloadEventRegistrar = defaultRegisterEvent,
): Promise<UnlistenFn[]> {
  const unlistenFns: UnlistenFn[] = [];

  try {
    unlistenFns.push(
      await registerEvent<IStartedPayload>("download_started", (event) =>
        callbacks.onStarted(event.payload),
      ),
    );
    unlistenFns.push(
      await registerEvent<IProgressPayload>("download_progress", (event) =>
        callbacks.onProgress(event.payload),
      ),
    );
    unlistenFns.push(
      await registerEvent<ICompletePayload>("download_complete", (event) =>
        callbacks.onComplete(event.payload),
      ),
    );
    unlistenFns.push(
      await registerEvent<IErrorPayload>("download_error", (event) =>
        callbacks.onError(event.payload),
      ),
    );
  } catch (error) {
    cleanupDownloadListeners(unlistenFns);
    throw error;
  }

  return unlistenFns;
}

export function createDownloadListenerLifecycle(
  registerEvent: DownloadEventRegistrar = defaultRegisterEvent,
) {
  let disposed = false;
  let listeners: UnlistenFn[] = [];
  let registration: Promise<UnlistenFn[]> | undefined;

  const start = (callbacks: {
    onStarted: (payload: IStartedPayload) => void;
    onProgress: (payload: IProgressPayload) => void;
    onComplete: (payload: ICompletePayload) => void;
    onError: (payload: IErrorPayload) => void;
  }): Promise<UnlistenFn[]> => {
    if (disposed) return Promise.resolve([]);
    if (registration) return registration;

    registration = setupDownloadListeners(callbacks, registerEvent).then(
      (registeredListeners) => {
        if (disposed) {
          cleanupDownloadListeners(registeredListeners);
          return [];
        }

        listeners = registeredListeners;
        return registeredListeners;
      },
    );
    return registration;
  };

  const dispose = () => {
    disposed = true;
    cleanupDownloadListeners(listeners);
    listeners = [];
  };

  return { start, dispose };
}
