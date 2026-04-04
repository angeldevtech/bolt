import { ListFilter } from "lucide-solid";
import { DownloadItem } from "./DownloadItem";
import { type IDownloadItem } from "../../types";

interface Props {
  downloads: IDownloadItem[];
}

export function DownloadList(props: Props) {
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
        <button class="flex items-center gap-2 bg-surface-highest hover:bg-surface-bright text-white text-xs font-bold tracking-wider px-3 py-1.5 rounded-full transition-colors">
          <ListFilter size={14} /> FILTRAR
        </button>
      </div>

      <div class="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar pb-6 flex flex-col gap-3">
        {props.downloads.map((item) => (
          <DownloadItem item={item} />
        ))}
      </div>
    </section>
  );
}
