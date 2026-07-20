import { createSignal, createMemo, For, Show } from "solid-js";
import { X } from "lucide-solid";
import { DownloadItem } from "./DownloadItem";
import { FilterPopover } from "./FilterPopover";
import { type IDownloadItem, type TFormat, type TDownloadStatus } from "../../types";

interface IDownloadListProps {
  downloads: IDownloadItem[];
}

const formatLabels: Record<TFormat, string> = {
  mp3: "MP3",
  mp4: "MP4",
  "mp4-hd": "MP4 HD",
};

const statusLabels: Record<TDownloadStatus, string> = {
  pending: "En cola",
  downloading: "Descargando",
  completed: "Completado",
  cancelled: "Cancelada",
  error: "Error",
};

export function DownloadList(props: IDownloadListProps) {
  const [formatFilter, setFormatFilter] = createSignal<Set<TFormat>>(new Set());
  const [statusFilter, setStatusFilter] = createSignal<Set<TDownloadStatus>>(
    new Set(),
  );

  const filteredDownloads = createMemo(() =>
    props.downloads.filter((d) => {
      const formats = formatFilter();
      const statuses = statusFilter();
      if (formats.size > 0 && !formats.has(d.format)) return false;
      if (statuses.size > 0 && !statuses.has(d.status)) return false;
      return true;
    }),
  );

  const hasAnyFilter = () => formatFilter().size > 0 || statusFilter().size > 0;

  const handleFormatChange = (format: TFormat) =>
    setFormatFilter((prev) => {
      const next = new Set(prev);
      if (next.has(format)) next.delete(format);
      else next.add(format);
      return next;
    });

  const handleStatusChange = (status: TDownloadStatus) =>
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });

  const clearAll = () => {
    setFormatFilter(new Set<TFormat>());
    setStatusFilter(new Set<TDownloadStatus>());
  };

  const removeFormat = (format: TFormat) =>
    setFormatFilter((prev) => {
      const next = new Set(prev);
      next.delete(format);
      return next;
    });

  const removeStatus = (status: TDownloadStatus) =>
    setStatusFilter((prev) => {
      const next = new Set(prev);
      next.delete(status);
      return next;
    });

  const formatChips = () =>
    Array.from(formatFilter()).map((f) => ({
      type: "format" as const,
      value: f,
      label: formatLabels[f],
    }));

  const statusChips = () =>
    Array.from(statusFilter()).map((s) => ({
      type: "status" as const,
      value: s,
      label: statusLabels[s],
    }));

  const allChips = () => [...formatChips(), ...statusChips()];

  return (
    <section class="flex-1 flex flex-col min-h-0">
      <div class="flex items-center justify-between pb-3 shrink-0 border-b border-surface-low mb-3">
        <div class="flex items-center gap-3">
          <h2 class="text-xl font-bold tracking-tight text-white">
            Historial de Descargas
          </h2>
          <span class="bg-surface-highest text-on-surface-muted text-xs font-semibold px-2.5 py-0.5 rounded-full">
            {props.downloads.length} items
          </span>
        </div>
        <FilterPopover
          formatFilter={formatFilter}
          statusFilter={statusFilter}
          onFormatChange={handleFormatChange}
          onStatusChange={handleStatusChange}
          onClearAll={clearAll}
        />
      </div>

      <Show when={hasAnyFilter()}>
        <div class="flex items-center gap-1.5 pb-3 shrink-0 flex-wrap">
          <For each={allChips()}>
            {(chip) => (
              <button
                class="flex items-center gap-1 bg-surface-highest hover:bg-surface-bright text-white text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors"
                onClick={() => {
                  if (chip.type === "format") removeFormat(chip.value);
                  else removeStatus(chip.value);
                }}
              >
                {chip.label}
                <X size={12} />
              </button>
            )}
          </For>
          <button
            class="text-[11px] font-semibold text-on-surface-muted hover:text-white px-2.5 py-1 rounded-full hover:bg-surface-highest transition-colors"
            onClick={clearAll}
          >
            Limpiar todo
          </button>
        </div>
      </Show>

      <div class="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar pb-6 flex flex-col gap-3">
        <Show
          when={filteredDownloads().length > 0}
          fallback={
            <Show when={hasAnyFilter()}>
              <div class="flex-1 flex items-center justify-center h-full">
                <div class="text-center">
                  <p class="text-sm text-on-surface-muted mb-2">
                    No hay descargas con estos filtros
                  </p>
                  <button
                    class="text-xs font-semibold text-primary hover:underline"
                    onClick={clearAll}
                  >
                    Limpiar filtros
                  </button>
                </div>
              </div>
            </Show>
          }
        >
          <For each={filteredDownloads()}>
            {(item) => <DownloadItem item={item} />}
          </For>
        </Show>
      </div>
    </section>
  );
}
