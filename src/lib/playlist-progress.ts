import type { IDownloadItem } from "../types";

export function calculatePlaylistProgress(
  items: Pick<IDownloadItem, "progress" | "status">[],
): number {
  if (items.length === 0) return 0;

  const total = items.reduce((sum, item) => {
    const progress = item.status === "completed"
      ? 100
      : Math.max(0, Math.min(100, item.progress));
    return sum + progress;
  }, 0);

  return Math.round(total / items.length);
}
