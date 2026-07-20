import { type Accessor, For, Show } from "solid-js";
import { Popover } from "@kobalte/core/popover";
import {
  ListFilter,
  X,
  CheckCircle2,
  AlertCircle,
  Clock,
  Ban,
  ArrowDown,
  FileMusic,
  FilePlay,
  Hd,
} from "lucide-solid";
import type { TFormat, TDownloadStatus } from "../../types";

interface IFilterPopoverProps {
  formatFilter: Accessor<Set<TFormat>>;
  statusFilter: Accessor<Set<TDownloadStatus>>;
  onFormatChange: (format: TFormat) => void;
  onStatusChange: (status: TDownloadStatus) => void;
  onClearAll: () => void;
}

const formatOptions: { value: TFormat; label: string; icon: any }[] = [
  { value: "mp3", label: "MP3", icon: FileMusic },
  { value: "mp4", label: "MP4", icon: FilePlay },
  { value: "mp4-hd", label: "MP4 HD", icon: Hd },
];

const statusOptions: { value: TDownloadStatus; label: string; icon: any }[] = [
  { value: "pending", label: "En cola", icon: Clock },
  { value: "downloading", label: "Descargando", icon: ArrowDown },
  { value: "completed", label: "Completado", icon: CheckCircle2 },
  { value: "cancelled", label: "Cancelada", icon: Ban },
  { value: "error", label: "Error", icon: AlertCircle },
];

export function FilterPopover(props: IFilterPopoverProps) {
  const activeCount = () => props.formatFilter().size + props.statusFilter().size;
  const hasActive = () => activeCount() > 0;

  return (
    <Popover>
      <Popover.Trigger class="flex items-center gap-2 bg-surface-highest hover:bg-surface-bright text-white text-xs font-bold tracking-wider px-3 py-1.5 rounded-full transition-colors ui-expanded:bg-primary/20">
        <ListFilter size={14} /> FILTRAR
        <Show when={hasActive()}>
          <span class="bg-primary text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-0.5">
            {activeCount()}
          </span>
        </Show>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="z-50 mt-2 bg-surface-low border border-surface-high rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.5)] p-4 w-64 data-expanded:animate-in data-closed:animate-out data-[expanded]:fade-in data-[closed]:fade-out data-[expanded]:zoom-in-95 data-[closed]:zoom-out-95 origin-top-right">
          {/* Format Section */}
          <div class="mb-4">
            <h4 class="text-[0.65rem] font-bold tracking-widest text-primary uppercase mb-2">
              Formato
            </h4>
            <div class="flex flex-col gap-1">
              <For each={formatOptions}>
                {(opt) => {
                  const Icon = opt.icon;
                  const isSelected = () => props.formatFilter().has(opt.value);
                  return (
                    <button
                      class={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
                        isSelected()
                          ? "bg-primary/20 text-primary"
                          : "text-on-surface-muted hover:bg-surface-highest hover:text-white"
                      }`}
                      onClick={() => props.onFormatChange(opt.value)}
                    >
                      <div
                        class={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                          isSelected()
                            ? "bg-primary border-primary"
                            : "border-surface-bright"
                        }`}
                      >
                        <Show when={isSelected()}>
                          <X size={10} class="text-black" />
                        </Show>
                      </div>
                      <Icon size={14} />
                      {opt.label}
                    </button>
                  );
                }}
              </For>
            </div>
          </div>

          {/* Status Section */}
          <div>
            <h4 class="text-[0.65rem] font-bold tracking-widest text-primary uppercase mb-2">
              Estado
            </h4>
            <div class="flex flex-col gap-1">
              <For each={statusOptions}>
                {(opt) => {
                  const Icon = opt.icon;
                  const isSelected = () => props.statusFilter().has(opt.value);
                  return (
                    <button
                      class={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
                        isSelected()
                          ? "bg-primary/20 text-primary"
                          : "text-on-surface-muted hover:bg-surface-highest hover:text-white"
                      }`}
                      onClick={() => props.onStatusChange(opt.value)}
                    >
                      <div
                        class={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                          isSelected()
                            ? "bg-primary border-primary"
                            : "border-surface-bright"
                        }`}
                      >
                        <Show when={isSelected()}>
                          <X size={10} class="text-black" />
                        </Show>
                      </div>
                      <Icon size={14} />
                      {opt.label}
                    </button>
                  );
                }}
              </For>
            </div>
          </div>

          {/* Clear button */}
          <Show when={hasActive()}>
            <button
              class="w-full text-center text-xs font-semibold text-on-surface-muted hover:text-white py-2 mt-3 rounded-xl hover:bg-surface-highest transition-colors"
              onClick={props.onClearAll}
            >
              Limpiar filtros
            </button>
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
