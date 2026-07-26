import type { IDownloadItem } from "../types";

export function shouldPersistDownloadUpdate(
  updates: Partial<Omit<IDownloadItem, "id">>,
): boolean {
  return (
    updates.status !== undefined ||
    updates.title !== undefined ||
    updates.errorMsg !== undefined ||
    updates.filePath !== undefined ||
    updates.sizeMB !== undefined
  );
}
