import {
  X,
  Play,
  FolderOpen,
  Trash2,
  RotateCw,
  CheckCircle2,
  AlertCircle,
  Clock,
} from "lucide-solid";
import { type IDownloadItem } from "../../types";
import { Button } from "../ui/Button";

interface Props {
  item: IDownloadItem;
}

export function DownloadItem(props: Props) {
  const isPending = () => props.item.status === "pending";
  const isDownloading = () => props.item.status === "downloading";
  const isCompleted = () => props.item.status === "completed";
  const isError = () => props.item.status === "error";

  const formatDisplay = {
    mp3: "MP3",
    mp4: "MP4",
    "mp4-hd": "MP4 HD",
  };

  return (
    <div
      class={`flex items-center gap-4 bg-surface-low rounded-2xl p-2 pr-4 ${isError() ? "opacity-90 grayscale-20" : ""}`}
    >
      {/* Thumbnail Left Side */}
      <div class="relative w-40 h-24 rounded-xl overflow-hidden shrink-0 bg-surface-lowest">
        {(isDownloading() || isPending()) && (
          <>
            <div class="absolute inset-0 bg-linear-to-br from-purple-900/40 to-blue-900/40" />
            <div class="absolute inset-0 flex items-center justify-center glass-panel bg-black/40">
              {isPending() ? (
                <Clock size={32} class="text-white drop-shadow-lg opacity-80" />
              ) : (
                <span class="text-4xl font-bold tracking-tight text-white drop-shadow-lg">
                  {props.item.progress}%
                </span>
              )}
            </div>
          </>
        )}
        {isCompleted() && (
          <>
            <div class="absolute inset-0 bg-linear-to-tr from-blue-900/30 to-zinc-800" />
            <div class="absolute top-2 right-2 bg-surface-highest rounded-full p-1 shadow-md">
              <CheckCircle2 size={14} class="text-primary" />
            </div>
          </>
        )}
        {isError() && (
          <>
            <div class="absolute inset-0 bg-linear-to-b from-zinc-800 to-zinc-950" />
            <div class="absolute inset-0 flex items-center justify-center">
              <div class="bg-surface-highest rounded-full p-2 shadow-md">
                <AlertCircle size={20} class="text-on-surface-muted" />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Item Details Center */}
      <div class="flex-1 flex flex-col justify-center min-w-0 py-1">
        <h3
          class="text-base font-semibold tracking-tight text-white truncate mb-1"
          title={props.item.title}
        >
          {props.item.title}
        </h3>
        <div class="flex items-center gap-2 text-[0.65rem] uppercase tracking-wider font-semibold text-on-surface-muted mb-2">
          <span class={isCompleted() ? "text-white" : "text-primary"}>
            {formatDisplay[props.item.format]}
          </span>
          <span>•</span>
          {props.item.sizeMB && (
            <>
              <span>{props.item.sizeMB} MB</span>
              <span>•</span>
            </>
          )}

          {isPending() && (
            <span class="text-on-surface-muted opacity-80">EN COLA...</span>
          )}
          {isDownloading() && (
            <span class="text-primary opacity-80">DESCARGANDO...</span>
          )}
          {isCompleted() && <span class="text-primary">COMPLETADO</span>}
          {isError() && (
            <span
              class="text-red-400 truncate max-w-50"
              title={props.item.errorMsg || "ERROR"}
            >
              {props.item.errorMsg || "ERROR DE RED"}
            </span>
          )}
        </div>

        {/* Dynamic Bottom Area */}
        {isDownloading() || isPending() ? (
          <div class="h-1.5 w-full bg-surface-highest rounded-full overflow-hidden mt-1">
            <div
              class="h-full bg-primary rounded-full shadow-[0_0_10px_rgba(167,165,255,0.5)] relative transition-all duration-300"
              style={{ width: `${props.item.progress}%` }}
            >
              {isDownloading() && (
                <div class="absolute right-0 top-0 bottom-0 w-4 bg-white/50 blur-[2px]"></div>
              )}
            </div>
          </div>
        ) : (
          <div class="flex flex-wrap items-center gap-2 mt-1">
            {isCompleted() && (
              <>
                <Button
                  variant="surface"
                  onClick={() => console.log("Play", props.item.filePath)}
                >
                  <Play size={12} fill="currentColor" /> REPRODUCIR
                </Button>
                <Button
                  variant="surface"
                  onClick={() => console.log("Open", props.item.filePath)}
                >
                  <FolderOpen size={12} /> ABRIR
                </Button>
              </>
            )}
            {isError() && (
              <Button variant="surface">
                <RotateCw size={12} /> REINTENTAR
              </Button>
            )}
            <Button variant="danger">
              <Trash2 size={12} /> ELIMINAR
            </Button>
          </div>
        )}
      </div>

      {/* Right Cancel Button (For Pending AND Downloading) */}
      {(isDownloading() || isPending()) && (
        <Button variant="icon" class="ml-2">
          <X size={18} />
        </Button>
      )}
    </div>
  );
}
