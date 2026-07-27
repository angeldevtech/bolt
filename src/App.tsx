import { createSignal, onCleanup, onMount, lazy, Suspense } from "solid-js";
import { FileMusic, FilePlay, Hd } from "lucide-solid";
import { UrlInput } from "./components/ui/UrlInput";
import { Button } from "./components/ui/Button";
import { Footer } from "./components/layout/Footer";
import { DownloadList } from "./components/downloads/DownloadList";
import { PlaylistModal } from "./components/playlists/PlaylistModal";
import { SettingsModal } from "./components/settings/SettingsModal";
import { GlobalToaster, showAlert } from "./components/ui/Toaster";
import type {
  IActionResult,
  IYtDlpUpdateCheckResult,
  TFormat,
  TYtDlpUpdateCheckStatus,
  IYouTubeSource,
  IPlaylistMetadata,
} from "./types";
import {
  checkYtDlpUpdate,
  pasteFromClipboard,
  startDownload,
} from "./lib/api";
import {
  createDownloadListenerLifecycle,
} from "./lib/events";
import { initSettings, settings } from "./store/settings";
import {
  initDownloads,
  addDownload,
  downloads,
  updateDownloadStatus,
  startPlaylistBatch,
} from "./store/downloads";
import { classifyUrl } from "./lib/youtube";
const UpdateModal = lazy(() => import("./components/update/UpdateModal"));

export default function App() {
  const [url, setUrl] = createSignal("");
  const [isReady, setIsReady] = createSignal(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = createSignal(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = createSignal(false);
  const [updateCheckStatus, setUpdateCheckStatus] =
    createSignal<TYtDlpUpdateCheckStatus>("unchecked");
  const [updateCheckResult, setUpdateCheckResult] =
    createSignal<IYtDlpUpdateCheckResult>();
  const [updateCheckError, setUpdateCheckError] = createSignal("");
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = createSignal(false);
  const [pendingFormat, setPendingFormat] = createSignal<TFormat>("mp3");
  const [pendingSource, setPendingSource] = createSignal<IYouTubeSource | null>(null);
  let isDisposed = false;
  const listenerLifecycle = createDownloadListenerLifecycle();

  onCleanup(() => {
    isDisposed = true;
    listenerLifecycle.dispose();
  });

  const runUpdateCheck = async (): Promise<
    IActionResult<IYtDlpUpdateCheckResult>
  > => {
    setUpdateCheckStatus("checking");
    setUpdateCheckError("");

    const result = await checkYtDlpUpdate();
    if (result.success && result.data) {
      setUpdateCheckResult(result.data);
      setUpdateCheckStatus(result.data.status);
    } else {
      setUpdateCheckResult(undefined);
      setUpdateCheckStatus("check-failed");
      setUpdateCheckError(
        result.error || "No se pudo comprobar la versión de yt-dlp.",
      );
    }

    return result;
  };

  onMount(async () => {
    await initSettings();
    if (isDisposed) return;

    await initDownloads();
    if (isDisposed) return;

    await listenerLifecycle.start({
      onStarted: (payload) => {
        if (isDisposed) return;
        if (downloads.find((download) => download.id === payload.id)?.status === "pending") {
          void updateDownloadStatus(payload.id, { status: "downloading" });
        }
      },
      onProgress: (payload) => {
        if (isDisposed) return;
        const status = downloads.find((download) => download.id === payload.id)?.status;
        if (status === "pending" || status === "downloading") {
          void updateDownloadStatus(payload.id, {
            progress: payload.progress,
            ...(status === "pending" ? { status: "downloading" } : {}),
          });
        }
      },
      onComplete: (payload) => {
        if (isDisposed) return;
        const status = downloads.find((download) => download.id === payload.id)?.status;
        if (status === "pending" || status === "downloading") {
          void updateDownloadStatus(payload.id, {
            status: "completed",
            progress: 100,
            filePath: payload.filePath,
            sizeMB: payload.sizeMB,
          });
        }
      },
      onError: async (payload) => {
        if (isDisposed) return;
        const status = downloads.find((download) => download.id === payload.id)?.status;
        if (status !== "pending" && status !== "downloading") return;
        const updated = await updateDownloadStatus(payload.id, {
          status: payload.cancelled ? "cancelled" : "error",
          errorMsg: payload.errorMsg,
        });
        if (isDisposed) return;
        if (updated.data && !payload.cancelled) {
          showAlert("Error de descarga", payload.errorMsg, "error");
        }
      },
    });

    if (isDisposed) {
      return;
    }

    setIsReady(true);

    if (isDisposed) return;
    void runUpdateCheck();
  });

  const hasActiveDownloads = () =>
    downloads.some((d) => d.status === "downloading" || d.status === "pending");

  const handleOpenUpdate = () => {
    setIsUpdateModalOpen(true);
    if (
      updateCheckStatus() !== "available" &&
      updateCheckStatus() !== "checking"
    ) {
      void runUpdateCheck();
    }
  };

  const handlePaste = async () => {
    const result = await pasteFromClipboard();

    if (result.success && result.data) {
      setUrl(result.data);
    } else {
      showAlert("Error al pegar", result.error, "error");
    }
  };

  const doSingleDownload = async (id: string, url: string, format: TFormat, outputDir: string) => {
    const result = await startDownload(id, url, format as TFormat, outputDir);
    if (result.id === id && result.title) {
      void updateDownloadStatus(id, { title: result.title });
    } else {
      const errorMessage = result.error?.trim() || "Error desconocido";
      const isCancellation = errorMessage.toLowerCase().includes("cancelada");
      if (downloads.find((download) => download.id === id)?.status === "pending") {
        if (isCancellation) {
          void updateDownloadStatus(id, {
            status: "cancelled",
            errorMsg: errorMessage,
          });
          return;
        }
        void updateDownloadStatus(id, { status: "error", errorMsg: errorMessage });
        showAlert("Error de descarga", errorMessage, "error");
      }
    }
  };

  const handleDownload = async (format: string) => {
    const currentUrl = url();
    if (!currentUrl) {
      showAlert(
        "Enlace requerido",
        "Por favor ingresa un enlace de YouTube válido.",
        "error",
      );
      return;
    }

    const parsed = classifyUrl(currentUrl);
    if ("error" in parsed) {
      showAlert("URL inválida", parsed.error, "error");
      return;
    }

    // For plain video or generic URLs, use the existing single-item flow.
    if (parsed.type === "video" || parsed.type === "generic") {
      const id = crypto.randomUUID();
      const outputDir = format === "mp3" ? settings.audioFolder : settings.videoFolder;
      if (!outputDir) {
        showAlert("Carpeta no configurada", "Configura la carpeta de descarga en Ajustes.", "error");
        return;
      }

      await addDownload({
        id,
        url: parsed.canonicalUrl || currentUrl,
        title: "Cargando...",
        format: format as TFormat,
        status: "pending",
        progress: 0,
        videoId: parsed.videoId,
      });
      setUrl("");

      await doSingleDownload(id, parsed.canonicalUrl, format as TFormat, outputDir);
      return;
    }

    // For playlist/radio/ambiguous, show the modal.
    setPendingFormat(format as TFormat);
    setPendingSource(parsed);
    setIsPlaylistModalOpen(true);
  };

  const handleStartVideoOnly = async (format: TFormat) => {
    const currentUrl = url();
    const parsed = pendingSource();
    if (!parsed) return;

    const videoUrl = parsed.canonicalUrl || currentUrl;
    const id = crypto.randomUUID();
    const outputDir = format === "mp3" ? settings.audioFolder : settings.videoFolder;
    if (!outputDir) {
      showAlert("Carpeta no configurada", "Configura la carpeta de descarga en Ajustes.", "error");
      return;
    }

    await addDownload({
      id,
      url: videoUrl,
      title: "Cargando...",
      format,
      status: "pending",
      progress: 0,
      videoId: parsed.videoId,
    });
    setUrl("");

    await doSingleDownload(id, videoUrl, format, outputDir);
  };

  const handleStartPlaylist = async (
    source: IYouTubeSource,
    metadata: IPlaylistMetadata,
    format: TFormat,
  ) => {
    if (!source.playlistId) return;

    if (metadata.entries.length === 0) {
      showAlert(
        "Playlist sin videos disponibles",
        "No hay videos disponibles para descargar en esta playlist.",
        "error",
      );
      return;
    }

    const outputDir = format === "mp3" ? settings.audioFolder : settings.videoFolder;
    if (!outputDir) {
      showAlert("Carpeta no configurada", "Configura la carpeta de descarga en Ajustes.", "error");
      return;
    }

    const groupId = crypto.randomUUID();

    const result = await startPlaylistBatch({
      entries: metadata.entries.map((entry) => ({
        id: crypto.randomUUID(),
        videoId: entry.videoId,
        format,
        outputDir,
        title: entry.title,
      })),
      groupId,
      playlistId: source.playlistId,
      playlistTitle: metadata.title,
      playlistDescription: metadata.description,
      playlistThumbnailUrl: metadata.thumbnailUrl,
    });

    if (!result.success) {
      showAlert("Error", result.error || "No se pudo iniciar la playlist.", "error");
      return;
    }

    setUrl("");
  };

  return (
    <div class="flex flex-col h-full w-full relative">
      <main class="min-h-0 flex-1 flex flex-col px-6 lg:px-10 xl:px-16 pt-6 pb-0 w-full gap-6 overflow-hidden">
        <section class="flex flex-col gap-4 shrink-0">
          <UrlInput value={url()} onInput={setUrl} onPasteClick={handlePaste} />

          <div class="grid grid-cols-3 gap-3">
            <Button
              variant="gradient"
              disabled={!isReady()}
              onClick={() => handleDownload("mp3")}
            >
              <FileMusic
                size={20}
                class="group-hover:scale-110 transition-transform"
              />
              <span class="text-base lg:text-lg font-bold tracking-tight">
                MP3
              </span>
            </Button>

            <Button
              variant="gradient"
              disabled={!isReady()}
              onClick={() => handleDownload("mp4")}
            >
              <FilePlay
                size={20}
                class="group-hover:scale-110 transition-transform"
              />
              <span class="text-base lg:text-lg font-bold tracking-tight">
                MP4
              </span>
            </Button>

            <Button
              variant="gradient"
              disabled={!isReady()}
              onClick={() => handleDownload("mp4-hd")}
            >
              <Hd
                size={20}
                class="group-hover:scale-110 transition-transform"
              />
              <span class="text-base lg:text-lg font-bold tracking-tight">
                MP4 HD
              </span>
            </Button>
          </div>
        </section>

        <DownloadList downloads={downloads} />
      </main>

      {/* Playlist Modal */}
      <PlaylistModal
        isOpen={isPlaylistModalOpen()}
        onOpenChange={setIsPlaylistModalOpen}
        url={url()}
        format={pendingFormat()}
        onStartVideo={handleStartVideoOnly}
        onStartPlaylist={handleStartPlaylist}
      />

      {/* Render Settings Modal */}
      <SettingsModal
        isOpen={isSettingsModalOpen()}
        onOpenChange={setIsSettingsModalOpen}
      />

      {/* Render Update Modal */}
      <Suspense>
        {isUpdateModalOpen() && (
          <UpdateModal
            isOpen={isUpdateModalOpen()}
            onOpenChange={setIsUpdateModalOpen}
            hasActiveDownloads={hasActiveDownloads()}
            checkStatus={updateCheckStatus()}
            checkResult={updateCheckResult()}
            checkError={updateCheckError()}
            onCheck={runUpdateCheck}
          />
        )}
      </Suspense>

      {/* Footer to open Settings */}
      <Footer
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        updateStatus={updateCheckStatus()}
        onOpenUpdate={handleOpenUpdate}
      />

      {/* Global Toaster Mount Point */}
      <GlobalToaster />
    </div>
  );
}
