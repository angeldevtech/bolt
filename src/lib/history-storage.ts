import type { IActionResult, IDownloadItem } from "../types";
import { normalizeHistory, recoverInterruptedDownloads } from "./history";
import { createSerializedWriteQueue } from "./serialized-queue";

export interface IHistoryStorage {
  exists: (path: string) => Promise<boolean>;
  read: (path: string) => Promise<string>;
  write: (path: string, contents: string) => Promise<void>;
  rename: (oldPath: string, newPath: string) => Promise<void>;
}

export interface IHistoryStorageOptions {
  historyFile: string;
  temporaryFile: string;
  createCorruptionBackupPath: () => string;
}

export function createHistoryPersistence(
  storage: IHistoryStorage,
  options: IHistoryStorageOptions,
) {
  const writeQueue = createSerializedWriteQueue();

  async function preserveCorruptedHistory(
    rawHistory: string,
  ): Promise<IActionResult<string>> {
    const backupFile = options.createCorruptionBackupPath();
    try {
      await storage.write(backupFile, rawHistory);
      console.warn("[history] Preserved corrupted history", { backupFile });
      return { success: true, data: backupFile };
    } catch (error) {
      console.error("[history] Failed to preserve corrupted history", error);
      return {
        success: false,
        error: "No se pudo conservar una copia del historial dañado.",
      };
    }
  }

  function saveHistory(
    history: IDownloadItem[],
  ): Promise<IActionResult<boolean>> {
    let serializedHistory: string;

    try {
      const serialized = JSON.stringify(history, null, 2);
      if (serialized === undefined) {
        return Promise.resolve({
          success: false,
          error: "No se pudo serializar el historial de descargas.",
        });
      }
      serializedHistory = serialized;
    } catch (error) {
      console.error("[history] Failed to serialize history", error);
      return Promise.resolve({
        success: false,
        error: "No se pudo preparar el historial de descargas para guardarlo.",
      });
    }

    return writeQueue.enqueue(async () => {
      try {
        // Write a complete snapshot before replacing the visible file.
        await storage.write(options.temporaryFile, serializedHistory);
        await storage.rename(options.temporaryFile, options.historyFile);
        return { success: true, data: true };
      } catch (error) {
        console.error("[history] Failed to save history", error);
        return {
          success: false,
          error: "No se pudo guardar el historial de descargas.",
        };
      }
    });
  }

  async function loadHistorySafe(): Promise<{
    data: IDownloadItem[];
    wasCorrupted: boolean;
    corruptionBackupPath?: string;
    loadError?: string;
    persistenceError?: string;
  }> {
    let historyExists: boolean;

    try {
      historyExists = await storage.exists(options.historyFile);
    } catch (error) {
      console.error("[history] Failed to check history file", error);
      return {
        data: [],
        wasCorrupted: false,
        loadError: "No se pudo comprobar el historial de descargas.",
      };
    }

    if (!historyExists) {
      console.info("[history] No history.json found in AppLocalData");
      return { data: [], wasCorrupted: false };
    }

    let rawHistory: string;
    try {
      rawHistory = await storage.read(options.historyFile);
    } catch (error) {
      console.error("[history] Failed to read history file", error);
      return {
        data: [],
        wasCorrupted: false,
        loadError: "No se pudo leer el historial de descargas.",
      };
    }

    let parsedHistory: unknown;
    let parseFailed = false;
    try {
      parsedHistory = JSON.parse(rawHistory);
    } catch (error) {
      parseFailed = true;
      console.error("[history] History JSON is invalid", error);
    }

    const normalizedHistory = parseFailed
      ? { data: [], wasCorrupted: true, wasNormalized: false }
      : normalizeHistory(parsedHistory);
    const recoveredHistory = recoverInterruptedDownloads(normalizedHistory.data);
    const needsSave =
      normalizedHistory.wasCorrupted ||
      normalizedHistory.wasNormalized ||
      JSON.stringify(recoveredHistory) !== JSON.stringify(normalizedHistory.data);
    const persistenceErrors: string[] = [];
    let corruptionBackupPath: string | undefined;

    if (normalizedHistory.wasCorrupted) {
      const backupResult = await preserveCorruptedHistory(rawHistory);
      if (backupResult.success) {
        corruptionBackupPath = backupResult.data;
      } else if (backupResult.error) {
        persistenceErrors.push(backupResult.error);
      }
    }

    if (needsSave) {
      const saveResult = await saveHistory(recoveredHistory);
      if (!saveResult.success && saveResult.error) {
        persistenceErrors.push(saveResult.error);
      }
    }

    console.info("[history] Loaded history", {
      count: recoveredHistory.length,
      wasCorrupted: normalizedHistory.wasCorrupted,
      corruptionBackupPath,
    });

    return {
      data: recoveredHistory,
      wasCorrupted: normalizedHistory.wasCorrupted,
      corruptionBackupPath,
      persistenceError:
        persistenceErrors.length > 0 ? persistenceErrors.join(" ") : undefined,
    };
  }

  return { loadHistorySafe, saveHistory };
}
