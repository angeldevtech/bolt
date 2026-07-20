import { createSignal, onMount, lazy, Suspense } from "solid-js";
import { FileMusic, FilePlay, Hd } from "lucide-solid";
import { UrlInput } from "./components/ui/UrlInput";
import { Button } from "./components/ui/Button";
import { Footer } from "./components/layout/Footer";
import { DownloadList } from "./components/downloads/DownloadList";
import { SettingsModal } from "./components/settings/SettingsModal";
import { GlobalToaster, showAlert } from "./components/ui/Toaster";
import type { TFormat } from "./types";
import { pasteFromClipboard, checkYtDlpUpdate, startDownload } from "./lib/api";
import { setupDownloadListeners } from "./lib/events";
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
  const [isSettingsModalOpen, setIsSettingsModalOpen] = createSignal(false);
  const [isUpdateAvailable, setIsUpdateAvailable] = createSignal(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = createSignal(false);

  onMount(async () => {
    await initSettings();
    await initDownloads();
    const available = await checkYtDlpUpdate();
    setIsUpdateAvailable(available.success && !!available.data);

    setupDownloadListeners({
      onProgress: (payload) =>
        updateDownloadStatus(payload.id, {
          progress: payload.progress,
          ...(downloads.find(d => d.id === payload.id)?.status === "pending"
            ? { status: "downloading" }
            : {}),
        }),
      onComplete: (payload) =>
        updateDownloadStatus(payload.id, {
          status: "completed",
          filePath: payload.filePath,
          sizeMB: payload.sizeMB,
        }),
      onError: (payload) =>
        updateDownloadStatus(payload.id, {
          status: "error",
          errorMsg: payload.errorMsg,
        }),
    });
  });

  const hasActiveDownloads = () =>
    downloads.some((d) => d.status === "downloading" || d.status === "pending");

  const handlePaste = async () => {
    const result = await pasteFromClipboard();

    console.log(result)

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
    const tempId = crypto.randomUUID();
    const outputDir = format === "mp3" ? settings.audioFolder : settings.videoFolder;
    if (!outputDir) {
      showAlert("Carpeta no configurada", "Configura la carpeta de descarga en Ajustes.", "error");
      return;
    }
    addDownload({
      id: tempId,
      url: currentUrl,
      title: "Cargando...",
      format: format as TFormat,
      status: "pending",
      progress: 0,
    });
    setUrl("");

    const result = await startDownload(currentUrl, format as TFormat, outputDir);
    if (result.id && result.title) {
      updateDownloadStatus(tempId, { id: result.id, title: result.title, status: "downloading" });
    } else {
      updateDownloadStatus(tempId, { status: "error", errorMsg: result.error || "Error desconocido" });
    }
  };

  return (
    <div class="flex flex-col h-full w-full relative">
      <main class="flex-1 flex flex-col px-6 lg:px-10 xl:px-16 pt-6 pb-0 w-full gap-6 overflow-hidden">
        <section class="flex flex-col gap-4 shrink-0">
          <UrlInput value={url()} onInput={setUrl} onPasteClick={handlePaste} />

          <div class="grid grid-cols-3 gap-3">
            <Button variant="gradient" onClick={() => handleDownload("mp3")}>
              <FileMusic
                size={20}
                class="group-hover:scale-110 transition-transform"
              />
              <span class="text-base lg:text-lg font-bold tracking-tight">
                MP3
              </span>
            </Button>

            <Button variant="gradient" onClick={() => handleDownload("mp4")}>
              <FilePlay
                size={20}
                class="group-hover:scale-110 transition-transform"
              />
              <span class="text-base lg:text-lg font-bold tracking-tight">
                MP4
              </span>
            </Button>

            <Button variant="gradient" onClick={() => handleDownload("mp4-hd")}>
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
            onUpdateSuccess={() => setIsUpdateAvailable(false)}
          />
        )}
      </Suspense>

      {/* Footer to open Settings */}
      <Footer
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        isUpdateAvailable={isUpdateAvailable()}
        onOpenUpdate={() => setIsUpdateModalOpen(true)}
      />

      {/* Global Toaster Mount Point */}
      <GlobalToaster />
    </div>
  );
}
