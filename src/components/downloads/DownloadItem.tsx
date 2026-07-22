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
import { confirm } from "@tauri-apps/plugin-dialog";
import { createMemo } from "solid-js";
import { type IDownloadItem } from "../../types";
import { Button } from "../ui/Button";
import { openFile, openInFolder, deleteToTrash, cancelDownload } from "../../lib/api";
import { retryDownload, removeDownload } from "../../store/downloads";
import { showAlert } from "../ui/Toaster";

function getYouTubeThumbnail(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return `https://img.youtube.com/vi/${m[1]}/mqdefault.jpg`;
  }
  return null;
}

interface IDownloadItemProps {
  item: IDownloadItem;
}

export function DownloadItem(props: IDownloadItemProps) {
  const isPending = () => props.item.status === "pending";
  const isDownloading = () => props.item.status === "downloading";
  const isCompleted = () => props.item.status === "completed";
  const isError = () => props.item.status === "error";
  const isCancelled = () => props.item.status === "cancelled";

  const formatDisplay = {
    mp3: "MP3",
    mp4: "MP4",
    "mp4-hd": "MP4 HD",
  };

  const handleDeleteCompleted = async () => {
    const confirmed = await confirm(
      "¿Eliminar archivo? Se moverá a la papelera.",
      { title: "Eliminar archivo", kind: "warning" },
    );
    if (!confirmed) return;
    const result = await deleteToTrash(props.item.filePath!);
    if (result.success) {
      await removeDownload(props.item.id);
      showAlert("Archivo eliminado", "El archivo se ha movido a la papelera.", "success");
    } else {
      showAlert("Error", result.error, "error");
    }
  };

  const handleOpen = async () => {
    if (!props.item.filePath) {
      showAlert("Archivo no disponible", "No hay una ruta válida para esta descarga.", "error");
      return;
    }
    const result = await openInFolder(props.item.filePath);
    if (!result.success) showAlert("No se pudo abrir la carpeta", result.error, "error");
  };

  const handleCancel = async () => {
    const result = await cancelDownload(props.item.id);
    if (result.success) {
      showAlert("Cancelación solicitada", "La descarga se marcará como cancelada cuando termine el proceso.", "info");
    } else {
      showAlert("No se pudo cancelar", result.error, "error");
    }
  };

  const thumbnailUrl = createMemo(() => getYouTubeThumbnail(props.item.url));

  return (
    <div
      class={`flex items-center gap-4 bg-surface-low rounded-2xl p-2 pr-4 ${isError() || isCancelled() ? "opacity-90 grayscale-20" : ""}`}
    >
      {/* Thumbnail Left Side */}
      <div class="relative w-40 h-24 rounded-xl overflow-hidden shrink-0 bg-surface-lowest">
        {thumbnailUrl() && (
          <img
            src={thumbnailUrl()!}
            alt=""
            class="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
        )}
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
        {(isError() || isCancelled()) && (
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
          {isCancelled() && (
            <span class="text-on-surface-muted">CANCELADA</span>
          )}
          {isError() && (
            <span
              class="text-red-400 truncate max-w-full"
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
                   onClick={async () => {
                     if (!props.item.filePath) {
                       showAlert("Archivo no disponible", "No hay una ruta válida para esta descarga.", "error");
                       return;
                     }
                     const result = await openFile(props.item.filePath);
                     if (!result.success) showAlert("No se pudo abrir el archivo", result.error, "error");
                   }}
                >
                  <Play size={12} fill="currentColor" /> REPRODUCIR
                </Button>
                <Button
                  variant="surface"
                  onClick={handleOpen}
                >
                  <FolderOpen size={12} /> ABRIR
                </Button>
                <Button
                  variant="danger"
                  onClick={handleDeleteCompleted}
                >
                  <Trash2 size={12} /> ELIMINAR
                </Button>
              </>
            )}
            {(isError() || isCancelled()) && (
              <>
                <Button
                  variant="surface"
                  onClick={() => retryDownload(props.item.id)}
                >
                  <RotateCw size={12} /> REINTENTAR
                </Button>
                <Button
                  variant="danger"
                  onClick={() => removeDownload(props.item.id)}
                >
                  <Trash2 size={12} /> ELIMINAR
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Right Cancel Button (For Pending AND Downloading) */}
      {(isDownloading() || isPending()) && (
        <Button variant="icon" class="ml-2" onClick={handleCancel}>
          <X size={18} />
        </Button>
      )}
    </div>
  );
}
