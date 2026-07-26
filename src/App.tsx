import { createSignal, onCleanup, onMount, lazy, Suspense } from "solid-js";
import { FileMusic, FilePlay, Hd } from "lucide-solid";
import { UrlInput } from "./components/ui/UrlInput";
import { Button } from "./components/ui/Button";
import { Footer } from "./components/layout/Footer";
import { DownloadList } from "./components/downloads/DownloadList";
import { SettingsModal } from "./components/settings/SettingsModal";
import { GlobalToaster, showAlert } from "./components/ui/Toaster";
import type {
  IActionResult,
  IYtDlpUpdateCheckResult,
  TFormat,
  TYtDlpUpdateCheckStatus,
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
} from "./store/downloads";
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
    const id = crypto.randomUUID();
    const outputDir = format === "mp3" ? settings.audioFolder : settings.videoFolder;
    if (!outputDir) {
      showAlert("Carpeta no configurada", "Configura la carpeta de descarga en Ajustes.", "error");
      return;
    }
    await addDownload({
      id,
      url: currentUrl,
      title: "Cargando...",
      format: format as TFormat,
      status: "pending",
      progress: 0,
    });
    setUrl("");

    const result = await startDownload(id, currentUrl, format as TFormat, outputDir);
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

  return (
    <div class="flex flex-col h-full w-full relative">
      <main class="flex-1 flex flex-col px-6 lg:px-10 xl:px-16 pt-6 pb-0 w-full gap-6 overflow-hidden">
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
