import { BaseDirectory } from "@tauri-apps/api/path";
import {
  createHistoryPersistence,
  type IHistoryStorageOptions,
} from "./history-storage";

interface ITauriHistoryFs {
  exists: (
    path: string,
    options: { baseDir: BaseDirectory },
  ) => Promise<boolean>;
  readTextFile: (
    path: string,
    options: { baseDir: BaseDirectory },
  ) => Promise<string>;
  writeTextFile: (
    path: string,
    contents: string,
    options: { baseDir: BaseDirectory },
  ) => Promise<void>;
  rename: (
    oldPath: string,
    newPath: string,
    options: {
      oldPathBaseDir: BaseDirectory;
      newPathBaseDir: BaseDirectory;
    },
  ) => Promise<void>;
}

export function createTauriHistoryPersistence(
  fs: ITauriHistoryFs,
  options: IHistoryStorageOptions,
) {
  const baseDir = BaseDirectory.AppLocalData;

  return createHistoryPersistence(
    {
      exists: (path) => fs.exists(path, { baseDir }),
      read: (path) => fs.readTextFile(path, { baseDir }),
      write: (path, contents) => fs.writeTextFile(path, contents, { baseDir }),
      rename: (oldPath, newPath) =>
        fs.rename(oldPath, newPath, {
          oldPathBaseDir: baseDir,
          newPathBaseDir: baseDir,
        }),
    },
    options,
  );
}
