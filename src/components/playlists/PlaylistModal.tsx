import {
  createSignal,
  createMemo,
  createEffect,
  For,
  Show,
  onCleanup,
  type Component,
} from "solid-js";
import { X, ListMusic, Radio, AlertCircle, Loader2, Music } from "lucide-solid";
import { Button } from "../ui/Button";
import { classifyUrl, getYouTubeThumbnailUrl } from "../../lib/youtube";
import { inspectPlaylist, cancelPlaylistInspection } from "../../lib/api";
import type {
  IYouTubeSource,
  IPlaylistMetadata,
  TFormat,
} from "../../types";

interface IPlaylistModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  format: TFormat;
  onStartVideo: (format: TFormat) => void;
  onStartPlaylist: (
    source: IYouTubeSource,
    metadata: IPlaylistMetadata,
    format: TFormat,
  ) => void;
}

export const PlaylistModal: Component<IPlaylistModalProps> = (props) => {
  const [error, setError] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [playlistMeta, setPlaylistMeta] = createSignal<IPlaylistMetadata | null>(null);

  const mediaLabel = () => (props.format === "mp3" ? "audio" : "video");
  const formatMediaCount = (count: number) =>
    `${count} ${count === 1 ? mediaLabel() : `${mediaLabel()}s`}`;

  let activeRequestId = "";
  let lastLoadedPlaylistId = "";
  let isFetching = false;
  let requestSequence = 0;

  onCleanup(() => {
    if (activeRequestId) {
      cancelPlaylistInspection(activeRequestId);
    }
  });

  const parsed = createMemo(() => {
    if (!props.isOpen) return null;
    return classifyUrl(props.url);
  });

  const src = createMemo(() => {
    const r = parsed();
    if (!r || "error" in r) return null;
    return r;
  });

  const classificationError = createMemo(() => {
    const r = parsed();
    if (r && "error" in r) return r.error;
    return "";
  });

  createEffect(() => {
    setError(classificationError());
    const p = parsed();
    if (!p) {
      setPlaylistMeta(null);
    } else if ("error" in p) {
      setPlaylistMeta(null);
    } else if (p.type === "video+playlist" || p.type === "radio") {
      setPlaylistMeta(null);
    }
  });

  const handleLoadPlaylist = async () => {
    if (isFetching) return;
    const currentSrc = src();
    if (!currentSrc || !currentSrc.playlistId) return;
    isFetching = true;
    const requestId = crypto.randomUUID();
    const sequence = ++requestSequence;
    activeRequestId = requestId;
    setIsLoading(true);
    setError("");

    const result = await inspectPlaylist(currentSrc.playlistId, requestId);
    isFetching = false;
    if (requestId !== activeRequestId || sequence !== requestSequence) return;

    if (result.success && result.data) {
      setPlaylistMeta(result.data);
    } else {
      setError(result.error || "No se pudo inspeccionar la playlist.");
    }
    setIsLoading(false);
  };

  createEffect(() => {
    const currentSrc = src();
    if (currentSrc?.type === "playlist" && currentSrc.playlistId) {
      if (currentSrc.playlistId !== lastLoadedPlaylistId) {
        if (activeRequestId) {
          requestSequence += 1;
          cancelPlaylistInspection(activeRequestId);
          activeRequestId = "";
          isFetching = false;
        }
        setPlaylistMeta(null);
        lastLoadedPlaylistId = currentSrc.playlistId;
        void handleLoadPlaylist();
      }
    }
  });

  const handleClose = () => {
    requestSequence += 1;
    if (activeRequestId) {
      cancelPlaylistInspection(activeRequestId);
      activeRequestId = "";
    }
    isFetching = false;
    lastLoadedPlaylistId = "";
    setPlaylistMeta(null);
    setError("");
    setIsLoading(false);
    props.onOpenChange(false);
  };

  const handleVideoOnly = () => {
    handleClose();
    props.onStartVideo(props.format);
  };

  const handlePlaylistStart = () => {
    const currentSrc = src();
    const metadata = playlistMeta();
    if (!currentSrc || !metadata || metadata.entries.length === 0) return;
    handleClose();
    props.onStartPlaylist(currentSrc, metadata, props.format);
  };

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div
          role="dialog"
          aria-modal="true"
          class="bg-surface-low rounded-2xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-2xl border border-white/5"
        >
          {/* Header */}
          <div class="flex items-center justify-between px-6 py-4 border-b border-surface-high shrink-0">
            <h2 class="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              <Show when={src()?.type === "playlist" || src()?.type === "video+playlist"}>
                <ListMusic size={20} class="text-primary" />
              </Show>
              <Show when={src()?.type === "radio"}>
                <Radio size={20} class="text-primary" />
              </Show>
              <Show when={src()?.type === "video"}>
                <Music size={20} class="text-primary" />
              </Show>
              {src()?.type === "playlist" ||
               (src()?.type === "video+playlist" && (isLoading() || playlistMeta())) ? "Vista previa de playlist" :
               src()?.type === "video+playlist" ? "¿Qué deseas descargar?" :
               src()?.type === "radio" ? "Mix o radio de YouTube" : "Confirmar descarga"}
            </h2>
            <button
              onClick={handleClose}
              class="w-8 h-8 rounded-full bg-surface-highest text-on-surface-muted hover:bg-surface-bright hover:text-white flex items-center justify-center transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Content */}
          <div class="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar">
            {/* Error */}
            <Show when={error()}>
              <div class="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-4">
                <AlertCircle size={20} class="text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p class="text-sm font-semibold text-red-400">Error</p>
                  <p class="text-sm text-red-300/80 mt-0.5">{error()}</p>
                  <Show
                    when={
                      (src()?.type === "playlist" || src()?.type === "video+playlist") &&
                      !isLoading()
                    }
                  >
                    <Button
                      variant="surface"
                      class="mt-3 text-sm! py-2!"
                      onClick={() => void handleLoadPlaylist()}
                    >
                      Reintentar
                    </Button>
                  </Show>
                </div>
              </div>
            </Show>

            {/* Loading */}
            <Show when={isLoading()}>
              <div class="flex flex-col items-center justify-center py-12 gap-3">
                <Loader2 size={32} class="text-primary animate-spin" />
                <p class="text-sm text-on-surface-muted">Inspeccionando playlist...</p>
              </div>
            </Show>

            {/* Video+Playlist choice */}
            <Show
              when={
                !isLoading() &&
                !error() &&
                !playlistMeta() &&
                src()?.type === "video+playlist"
              }
            >
              <div class="mx-auto w-full max-w-md">
              <p class="text-sm text-on-surface-muted text-center mb-4">
                Este enlace contiene un video y una playlist. ¿Qué deseas descargar?
              </p>
              <div class="flex flex-col gap-3">
                <Button
                  variant="surface"
                  class="w-full min-h-12! py-3! text-sm! rounded-xl! gap-2!"
                  onClick={handleVideoOnly}
                >
                  <Music size={18} />
                   <span>Solo el {mediaLabel()} actual</span>
                </Button>
                <Button
                  variant="surface"
                  class="w-full min-h-12! py-3! text-sm! rounded-xl! gap-2!"
                  onClick={() => {
                    const currentSrc = src();
                    if (currentSrc?.playlistId) handleLoadPlaylist();
                  }}
                >
                  <ListMusic size={18} />
                  La playlist completa
                </Button>
              </div>
              </div>
            </Show>

            {/* Radio explanation */}
            <Show when={!isLoading() && !error() && src()?.type === "radio"}>
              <div class="mx-auto flex w-full max-w-md flex-col items-center text-center">
                <Radio size={36} class="mb-3 text-primary" />
                <p class="text-sm leading-6 text-on-surface-muted mb-5">
                  Este enlace es un mix o radio de YouTube. No tiene una lista de reproducción fija y no se puede descargar como playlist.
                </p>
                <Show when={src()?.videoId}>
                  <Button variant="gradient" class="w-full min-h-12!" onClick={handleVideoOnly}>
                    <Music size={18} />
                     Descargar solo el {mediaLabel()} actual
                  </Button>
                </Show>
                <Show when={!src()?.videoId}>
                  <div class="w-full bg-surface-highest rounded-xl p-4">
                    <p class="text-sm text-on-surface-muted">No se puede descargar este mix de YouTube.</p>
                  </div>
                </Show>
                </div>
            </Show>

            {/* Playlist preview */}
            <Show when={!isLoading() && playlistMeta()}>
              {(() => {
                const meta = playlistMeta()!;
                return (
                  <div class="flex flex-col gap-4">
                    {/* Playlist card */}
                    <div class="flex gap-4 bg-surface-highest rounded-xl p-4">
                      <Show
                        when={meta.thumbnailUrl}
                        fallback={
                          <div class="w-28 h-24 rounded-lg bg-surface-bright flex items-center justify-center shrink-0">
                            <ListMusic size={28} class="text-primary" />
                          </div>
                        }
                      >
                        <img
                          src={meta.thumbnailUrl!}
                          alt={meta.title}
                          class="w-28 h-24 rounded-lg object-cover shrink-0"
                          loading="lazy"
                        />
                      </Show>
                      <div class="flex-1 min-w-0">
                        <h3 class="text-base font-bold text-white line-clamp-2">{meta.title}</h3>
                        <Show when={meta.description}>
                          <p class="text-xs text-on-surface-muted mt-1 line-clamp-2">{meta.description}</p>
                        </Show>
                        <p class="text-xs text-primary font-semibold mt-2">
                           {formatMediaCount(meta.total)}
                          <Show when={meta.entries.length !== meta.total}>
                            {" · "}{meta.entries.length} disponibles
                          </Show>
                          <Show when={meta.unavailableCount > 0}>
                            {" · "}{meta.unavailableCount} no disponible{meta.unavailableCount > 1 ? "s" : ""}
                          </Show>
                        </p>
                      </div>
                    </div>

                    {/* Primary action stays above the optional preview list. */}
                    <Button
                      variant="gradient"
                      disabled={meta.entries.length === 0}
                      onClick={handlePlaylistStart}
                    >
                      <ListMusic size={18} />
                       Descargar playlist ({formatMediaCount(meta.total)})
                    </Button>

                    {/* First entries */}
                    <div class="flex flex-col gap-1.5">
                      <p class="text-xs font-semibold text-on-surface-muted uppercase tracking-wider">
                         {meta.entries.length === 1
                           ? `Primer ${mediaLabel()}`
                           : `Primeros ${Math.min(10, meta.entries.length)} ${mediaLabel()}s`}
                      </p>
                      <For each={meta.entries.slice(0, 10)}>
                        {(entry) => (
                          <div class="flex items-center gap-3 bg-surface-highest/50 rounded-lg px-3 py-2">
                            <img
                              src={getYouTubeThumbnailUrl(entry.videoId)}
                              alt=""
                              class="w-10 h-7 rounded object-cover shrink-0"
                              loading="lazy"
                            />
                            <span class="text-sm text-white truncate">{entry.title}</span>
                          </div>
                        )}
                      </For>
                      <Show when={meta.entries.length > 10}>
                        <p class="text-xs text-on-surface-muted px-3 pt-1">
                           y {meta.entries.length - 10} {mediaLabel()}s más disponibles
                        </p>
                      </Show>
                    </div>

                  </div>
                );
              })()}
            </Show>

            {/* Plain video confirmation */}
            <Show when={!isLoading() && !error() && src()?.type === "video"}>
              <p class="text-sm text-on-surface-muted mb-4">
                 Se descargará el {mediaLabel()} en formato {props.format.toUpperCase()}.
              </p>
              <Button variant="gradient" onClick={handleVideoOnly}>
                <Music size={18} />
                Confirmar descarga
              </Button>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
};
