import { createSignal, onMount, lazy, Suspense } from "solid-js";
import { FileMusic, FilePlay, Hd } from "lucide-solid";
import { UrlInput } from "./components/ui/UrlInput";
import { Button } from "./components/ui/Button";
import { Footer } from "./components/layout/Footer";
import { DownloadList } from "./components/downloads/DownloadList";
import { SettingsModal } from "./components/settings/SettingsModal";
import { GlobalToaster, showAlert } from "./components/ui/Toaster";
import { pasteFromClipboard, checkYtDlpUpdate } from "./lib/api";
import { initSettings } from "./store/settings";
import { initDownloads, downloads } from "./store/downloads";
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
    setIsUpdateAvailable(available);
  });

  const hasActiveDownloads = () =>
    downloads.some((d) => d.status === "downloading" || d.status === "pending");

  const handlePaste = async () => {
    const result = await pasteFromClipboard();

    if (result.success && result.text) {
      setUrl(result.text);
    } else {
      showAlert("Error al pegar", result.error, "error");
    }
  };

  const handleDownload = (format: string) => {
    if (!url()) {
      showAlert(
        "Enlace requerido",
        "Por favor ingresa un enlace de YouTube válido.",
        "error",
      );
      return;
    }
    // TODO replace with the actual code
    showAlert(
      "Descarga Iniciada",
      `Añadido a la cola en formato ${format.toUpperCase()}`,
      "success",
    );
    setUrl("");
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
