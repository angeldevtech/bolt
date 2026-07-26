import { expect, test } from "bun:test";
import { access, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRoot, onCleanup } from "solid-js";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { BaseDirectory } from "@tauri-apps/api/path";
import {
  normalizeHistory,
  normalizeHistoryItem,
  recoverInterruptedDownloads,
} from "../../src/lib/history";
import { createHistoryPersistence } from "../../src/lib/history-storage";
import { createTauriHistoryPersistence } from "../../src/lib/tauri-history";
import {
  cleanupDownloadListeners,
  createDownloadListenerLifecycle,
  setupDownloadListeners,
  type DownloadEventRegistrar,
} from "../../src/lib/events";
import { createSerializedWriteQueue } from "../../src/lib/serialized-queue";
import { shouldPersistDownloadUpdate } from "../../src/store/download-persistence";
import { reconcilePostUpdateCheck } from "../../src/lib/update-status";
import type { IDownloadItem } from "../../src/types";

test("normalizes valid history, rejects malformed entries, and flags repairs", () => {
  const result = normalizeHistory([
    {
      id: " first ",
      url: " https://example.com/video ",
      title: " Example title ",
      format: "mp4",
      status: "completed",
      progress: 100,
      sizeMB: 12.5,
      errorMsg: " ",
      filePath: " C:\\Downloads\\video.mp4 ",
      ignored: true,
    },
    {
      id: "invalid",
      url: "https://example.com/invalid",
      title: "Invalid",
      format: "mp4",
      status: "completed",
      progress: 101,
    },
  ]);

  expect(result.data).toEqual([
    {
      id: "first",
      url: "https://example.com/video",
      title: "Example title",
      format: "mp4",
      status: "completed",
      progress: 100,
      sizeMB: 12.5,
      filePath: "C:\\Downloads\\video.mp4",
    },
  ]);
  expect(result.wasCorrupted).toBe(true);
  expect(result.wasNormalized).toBe(true);
});

test("rejects non-array history and invalid individual records", () => {
  expect(normalizeHistory({ history: [] })).toEqual({
    data: [],
    wasCorrupted: true,
    wasNormalized: false,
  });
  expect(normalizeHistoryItem(null)).toBeNull();
  expect(
    normalizeHistoryItem({
      id: "id",
      url: "url",
      title: "title",
      format: "wav",
      status: "completed",
      progress: 20,
    }),
  ).toBeNull();
});

test("recovers pending and downloading entries after an interrupted run", () => {
  const history: IDownloadItem[] = [
    {
      id: "pending",
      url: "https://example.com/pending",
      title: "Pending",
      format: "mp4",
      status: "pending",
      progress: 0,
    },
    {
      id: "downloading",
      url: "https://example.com/downloading",
      title: "Downloading",
      format: "mp3",
      status: "downloading",
      progress: 48,
    },
    {
      id: "completed",
      url: "https://example.com/completed",
      title: "Completed",
      format: "mp4-hd",
      status: "completed",
      progress: 100,
    },
  ];

  expect(recoverInterruptedDownloads(history)).toEqual([
    {
      ...history[0],
      status: "error",
      errorMsg: "Descarga interrumpida por cierre de la aplicación.",
    },
    {
      ...history[1],
      status: "error",
      errorMsg: "Descarga interrumpida por cierre de la aplicación.",
    },
    history[2],
  ]);
  expect(history[0].status).toBe("pending");
  expect(history[1].status).toBe("downloading");
});

test("serializes history writes and continues after a failed write", async () => {
  const queue = createSerializedWriteQueue();
  const order: string[] = [];
  let releaseFirst!: () => void;

  const first = queue.enqueue(async () => {
    order.push("first:start");
    await new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    order.push("first:end");
  });
  const second = queue.enqueue(async () => {
    order.push("second");
  });

  await Promise.resolve();
  expect(order).toEqual(["first:start"]);
  releaseFirst();
  await Promise.all([first, second]);
  expect(order).toEqual(["first:start", "first:end", "second"]);

  const failed = queue.enqueue(async () => {
    order.push("failed");
    throw new Error("write failed");
  });
  const afterFailure = queue.enqueue(async () => {
    order.push("after-failure");
  });

  await expect(failed).rejects.toThrow("write failed");
  await afterFailure;
  expect(order.slice(-2)).toEqual(["failed", "after-failure"]);
});

test("persists terminal transitions and metadata, but not progress ticks", () => {
  expect(shouldPersistDownloadUpdate({ progress: 25 })).toBe(false);
  expect(shouldPersistDownloadUpdate({ status: "downloading" })).toBe(true);
  expect(shouldPersistDownloadUpdate({ status: "completed" })).toBe(true);
  expect(shouldPersistDownloadUpdate({ status: "error" })).toBe(true);
  expect(shouldPersistDownloadUpdate({ status: "cancelled" })).toBe(true);
  expect(shouldPersistDownloadUpdate({ filePath: "C:\\video.mp4", sizeMB: 4 })).toBe(
    true,
  );
  expect(shouldPersistDownloadUpdate({ title: "Resolved title" })).toBe(true);
});

test("reconciles modal state from the post-update check", () => {
  const update = {
    updated: true,
    currentVersion: "2026.07.25",
    output: "Updated yt-dlp",
  };

  expect(
    reconcilePostUpdateCheck(update, {
      success: true,
      data: {
        status: "current",
        currentVersion: "2026.07.25",
        latestVersion: "2026.07.25",
      },
    }),
  ).toEqual({ status: "updated" });

  const stale = reconcilePostUpdateCheck(update, {
    success: true,
    data: {
      status: "available",
      currentVersion: "2026.07.20",
      latestVersion: "2026.07.25",
    },
  });
  expect(stale.status).toBe("error");
  expect(stale.error).toContain("todavía aparece desactualizado");

  expect(
    reconcilePostUpdateCheck(update, {
      success: false,
      error: "GitHub no disponible",
    }),
  ).toEqual({ status: "inconclusive", error: "GitHub no disponible" });
});

test("cleans listeners registered before a later registration fails", async () => {
  const registered: string[] = [];
  const unregistered: string[] = [];
  const registerEvent: DownloadEventRegistrar = async (event, callback) => {
    registered.push(event);
    if (event === "download_complete") {
      throw new Error("registration failed");
    }
    void callback;
    return () => {
      unregistered.push(event);
    };
  };

  await expect(
    setupDownloadListeners(
      {
        onStarted: () => {},
        onProgress: () => {},
        onComplete: () => {},
        onError: () => {},
      },
      registerEvent,
    ),
  ).rejects.toThrow("registration failed");

  expect(registered).toEqual([
    "download_started",
    "download_progress",
    "download_complete",
  ]);
  expect(unregistered).toEqual(["download_started", "download_progress"]);
});

test("releases every registered listener on disposal", async () => {
  const unregistered: string[] = [];
  const listeners = await setupDownloadListeners(
    {
      onStarted: () => {},
      onProgress: () => {},
      onComplete: () => {},
      onError: () => {},
    },
    async (event) => () => {
      unregistered.push(event);
    },
  );

  cleanupDownloadListeners(listeners);
  expect(unregistered).toEqual([
    "download_started",
    "download_progress",
    "download_complete",
    "download_error",
  ]);
});

test("Solid disposal releases listeners after completed registration", async () => {
  const unregistered: string[] = [];
  let disposeRoot!: () => void;
  let start!: Promise<UnlistenFn[]>;

  createRoot((dispose) => {
    const lifecycle = createDownloadListenerLifecycle(async (event) => () => {
      unregistered.push(event);
    });
    onCleanup(lifecycle.dispose);
    disposeRoot = dispose;
    start = lifecycle.start({
      onStarted: () => {},
      onProgress: () => {},
      onComplete: () => {},
      onError: () => {},
    });
  });

  await start;
  disposeRoot();
  expect(unregistered).toEqual([
    "download_started",
    "download_progress",
    "download_complete",
    "download_error",
  ]);
});

test("Solid disposal cleans registration that is still awaiting Tauri listeners", async () => {
  const unregistered: string[] = [];
  let releaseFirst!: (unlisten: () => void) => void;
  let disposeRoot!: () => void;
  let start!: Promise<UnlistenFn[]>;

  createRoot((dispose) => {
    const lifecycle = createDownloadListenerLifecycle(async (event) => {
      if (event === "download_started") {
        return await new Promise<() => void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return () => {
        unregistered.push(event);
      };
    });
    onCleanup(lifecycle.dispose);
    disposeRoot = dispose;
    start = lifecycle.start({
      onStarted: () => {},
      onProgress: () => {},
      onComplete: () => {},
      onError: () => {},
    });
  });

  disposeRoot();
  releaseFirst(() => {
    unregistered.push("download_started");
  });
  await start;

  expect(unregistered).toEqual([
    "download_started",
    "download_progress",
    "download_complete",
    "download_error",
  ]);
});

function filesystemHistoryStorage() {
  return {
    exists: async (path: string) => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
    read: (path: string) => readFile(path, "utf8"),
    write: (path: string, contents: string) => writeFile(path, contents, "utf8"),
    rename,
  };
}

test("preserves corrupted history and writes recovered snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bolt-history-"));
  const historyFile = join(directory, "history.json");
  const temporaryFile = join(directory, "history.tmp.json");
  const backupFile = join(directory, "history.corrupt.json");
  const corrupted = "{ invalid history";

  try {
    await writeFile(historyFile, corrupted, "utf8");
    const persistence = createHistoryPersistence(filesystemHistoryStorage(), {
      historyFile,
      temporaryFile,
      createCorruptionBackupPath: () => backupFile,
    });

    const loaded = await persistence.loadHistorySafe();
    expect(loaded.wasCorrupted).toBe(true);
    expect(loaded.corruptionBackupPath).toBe(backupFile);
    expect(await readFile(backupFile, "utf8")).toBe(corrupted);
    expect(JSON.parse(await readFile(historyFile, "utf8"))).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("serializes real history snapshots and leaves no temporary file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bolt-history-"));
  const historyFile = join(directory, "history.json");
  const temporaryFile = join(directory, "history.tmp.json");

  try {
    const persistence = createHistoryPersistence(filesystemHistoryStorage(), {
      historyFile,
      temporaryFile,
      createCorruptionBackupPath: () => join(directory, "history.corrupt.json"),
    });
    const item = (id: string): IDownloadItem => ({
      id,
      url: "https://example.com/video",
      title: id,
      format: "mp4",
      status: "completed",
      progress: 100,
    });

    await Promise.all([
      persistence.saveHistory([item("first")]),
      persistence.saveHistory([item("second")]),
    ]);

    expect(JSON.parse(await readFile(historyFile, "utf8"))).toEqual([item("second")]);
    await expect(access(temporaryFile)).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("routes history persistence through AppLocalData Tauri filesystem options", async () => {
  const calls: Array<{ operation: string; args: unknown[] }> = [];
  const persistence = createTauriHistoryPersistence(
    {
      exists: async (...args) => {
        calls.push({ operation: "exists", args });
        return true;
      },
      readTextFile: async (...args) => {
        calls.push({ operation: "read", args });
        return "not valid json";
      },
      writeTextFile: async (...args) => {
        calls.push({ operation: "write", args });
      },
      rename: async (...args) => {
        calls.push({ operation: "rename", args });
      },
    },
    {
      historyFile: "history.json",
      temporaryFile: "history.tmp.json",
      createCorruptionBackupPath: () => "history.corrupt.json",
    },
  );

  const loaded = await persistence.loadHistorySafe();
  expect(loaded.wasCorrupted).toBe(true);
  expect(calls.map(({ operation }) => operation)).toEqual([
    "exists",
    "read",
    "write",
    "write",
    "rename",
  ]);
  expect(calls[0]?.args[1]).toEqual({ baseDir: BaseDirectory.AppLocalData });
  expect(calls[1]?.args[1]).toEqual({ baseDir: BaseDirectory.AppLocalData });
  expect(calls[2]?.args[2]).toEqual({ baseDir: BaseDirectory.AppLocalData });
  expect(calls[3]?.args[2]).toEqual({ baseDir: BaseDirectory.AppLocalData });
  expect(calls[4]?.args[2]).toEqual({
    oldPathBaseDir: BaseDirectory.AppLocalData,
    newPathBaseDir: BaseDirectory.AppLocalData,
  });
});
