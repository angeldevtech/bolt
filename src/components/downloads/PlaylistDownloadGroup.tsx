import { createSignal, createMemo, For, Show } from "solid-js";
import { ChevronDown, ChevronRight, ListMusic, X, RotateCw } from "lucide-solid";
import { DownloadItem } from "./DownloadItem";
import { Button } from "../ui/Button";
import { cancelGroup, retryGroup } from "../../store/downloads";
import { showAlert } from "../ui/Toaster";
import type { IDownloadItem } from "../../types";
import { calculatePlaylistProgress } from "../../lib/playlist-progress";

interface IPlaylistDownloadGroupProps {
  groupId: string;
  children: IDownloadItem[];
  allDownloads: IDownloadItem[];
}

export function PlaylistDownloadGroup(props: IPlaylistDownloadGroupProps) {
  const [isExpanded, setIsExpanded] = createSignal(false);

  const firstChild = createMemo(() => props.children[0]);

  const mediaLabel = createMemo(() =>
    firstChild()?.format === "mp3" ? "audio" : "video",
  );

  const groupSummary = createMemo(() => {
    const total = props.children.length;
    const completed = props.children.filter((d) => d.status === "completed").length;
    const failed = props.children.filter((d) => d.status === "error").length;
    const cancelled = props.children.filter((d) => d.status === "cancelled").length;
    const downloading = props.children.filter((d) => d.status === "downloading").length;
    const pending = props.children.filter((d) => d.status === "pending").length;
    return { total, completed, failed, cancelled, downloading, pending };
  });

  const aggregateProgress = createMemo(() => calculatePlaylistProgress(props.children));

  const hasActive = () =>
    props.children.some((d) => d.status === "downloading" || d.status === "pending");

  const hasRetryable = () =>
    props.children.some((d) => d.status === "error" || d.status === "cancelled");

  const handleCancelGroup = async () => {
    const result = await cancelGroup(props.groupId);
    if (!result.success) {
      showAlert("Error", "No se pudieron cancelar todas las descargas del grupo.", "error");
    }
  };

  const handleRetryGroup = async () => {
    const result = await retryGroup(props.groupId);
    if (!result.success) {
      showAlert("Error", result.error || "No se pudieron reintentar las descargas.", "error");
    }
  };

  return (
    <div class="shrink-0 bg-surface-low rounded-2xl max-h-154 overflow-hidden border border-surface-high">
      {/* Group header */}
      <div
        class="flex items-center gap-3 p-3 cursor-pointer hover:bg-surface-high transition-colors"
        onClick={() => setIsExpanded(!isExpanded())}
      >
        <button class="text-on-surface-muted hover:text-white transition-colors shrink-0">
          {isExpanded() ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>

        <Show when={firstChild()?.playlistThumbnailUrl}>
          <img
            src={firstChild()!.playlistThumbnailUrl!}
            alt=""
            class="w-12 h-12 rounded-lg object-cover shrink-0"
            loading="lazy"
          />
        </Show>

        <div class="flex-1 min-w-0">
          <h3 class="text-sm font-bold text-white truncate">
            {firstChild()?.playlistTitle || "Playlist"}
          </h3>
          <Show when={firstChild()?.playlistDescription}>
            <p class="text-[0.65rem] text-on-surface-muted truncate">
              {firstChild()?.playlistDescription}
            </p>
          </Show>
          <div class="flex items-center gap-2 text-[0.65rem] text-on-surface-muted font-semibold">
            <ListMusic size={12} />
            <span>
              {groupSummary().total} {groupSummary().total === 1 ? mediaLabel() : `${mediaLabel()}s`}
            </span>
            <Show when={groupSummary().completed > 0}>
              <span>|</span>
              <span>{groupSummary().completed} OK</span>
            </Show>
            <Show when={groupSummary().failed > 0}>
              <span>|</span>
              <span class="text-red-400">{groupSummary().failed} error</span>
            </Show>
            <Show when={groupSummary().cancelled > 0}>
              <span>|</span>
              <span class="text-on-surface-muted">{groupSummary().cancelled} cancelado</span>
            </Show>
            <Show when={groupSummary().downloading > 0}>
              <span>|</span>
              <span class="text-primary">{groupSummary().downloading} descargando</span>
            </Show>
            <Show when={groupSummary().pending > 0}>
              <span>|</span>
              <span class="text-on-surface-muted">{groupSummary().pending} en cola</span>
            </Show>
          </div>
        </div>

        {/* Aggregate progress bar */}
        <div class="w-20">
          <div class="h-1.5 w-full bg-surface-highest rounded-full overflow-hidden">
            <div
              class="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${aggregateProgress()}%` }}
            />
          </div>
        </div>

        {/* Group actions */}
        <div class="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <Show when={hasActive()}>
            <Button variant="icon" onClick={handleCancelGroup} title="Cancelar todas">
              <X size={14} />
            </Button>
          </Show>
          <Show when={hasRetryable()}>
            <Button variant="icon" onClick={handleRetryGroup} title="Reintentar fallidas">
              <RotateCw size={14} />
            </Button>
          </Show>
        </div>

        <span class="text-xs font-bold text-on-surface-muted shrink-0 w-10 text-right">
          {aggregateProgress()}%
        </span>
      </div>

      {/* Children */}
      <Show when={isExpanded()}>
        <div class="min-h-0 flex flex-col gap-2 px-3 pb-3 pr-2 max-h-136 overflow-y-auto custom-scrollbar">
          <For each={props.children}>
            {(child) => <DownloadItem item={child} />}
          </For>
        </div>
      </Show>
    </div>
  );
}
