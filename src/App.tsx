import { createSignal, onMount } from "solid-js";
import { FileAudio, FileVideo, MonitorPlay } from "lucide-solid";
import { UrlInput } from "./components/ui/UrlInput";
import { Button } from "./components/ui/Button";
import { Footer } from "./components/layout/Footer";
import { DownloadList } from "./components/downloads/DownloadList";
import { SettingsModal } from "./components/settings/SettingsModal";
import { GlobalToaster, showAlert } from "./components/ui/Toaster";
import { type IDownloadItem } from "./types";
import { pasteFromClipboard, checkYtDlpUpdate } from "./lib/api";
import { UpdateModal } from "./components/update/UpdateModal";
import { initSettings } from "./store/settings";
import { initDownloads, downloads } from "./store/downloads";

export default function App() {
  const [url, setUrl] = createSignal("");
  const [isSettingsOpen, setIsSettingsOpen] = createSignal(false);
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

  const mockDownloads: IDownloadItem[] = [
    {
      id: "1",
      url: "https://youtu.be/...",
      title: "Cyberpunk 2077 - Trailer",
      format: "mp4-hd",
      sizeMB: 142,
      status: "downloading",
      progress: 74,
    },
    {
      id: "4",
      url: "https://youtu.be/...",
      title: "Interstellar Main Theme - Hans Zimmer",
      format: "mp3",
      status: "pending",
      progress: 0,
    },
    {
      id: "2",
      url: "https://youtu.be/...",
      title: "Lo-fi Hip Hop Radio - Beats to relax/study to",
      format: "mp3",
      sizeMB: 85,
      status: "completed",
      progress: 100,
      filePath: "/Users/parents/Music/lofi.mp3",
    },
    {
      id: "3",
      url: "https://youtu.be/...",
      title: "Nature Documentaries - Episode 04 (HD)",
      format: "mp4",
      status: "error",
      progress: 0,
      errorMsg: "Error de yt-dlp: Sign in to confirm you're not a bot",
    },
  ];

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
              <FileAudio
                size={20}
                class="group-hover:scale-110 transition-transform"
              />
              <span class="text-base lg:text-lg font-bold tracking-tight">
                MP3
              </span>
            </Button>

            <Button variant="gradient" onClick={() => handleDownload("mp4")}>
              <FileVideo
                size={20}
                class="group-hover:scale-110 transition-transform"
              />
              <span class="text-base lg:text-lg font-bold tracking-tight">
                MP4
              </span>
            </Button>

            <Button variant="gradient" onClick={() => handleDownload("mp4-hd")}>
              <MonitorPlay
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

      {/* Render Settings Dialog & pass the signal state */}
      <SettingsModal
        isOpen={isSettingsOpen()}
        onOpenChange={setIsSettingsOpen}
      />

      <UpdateModal
        isOpen={isUpdateModalOpen()}
        onOpenChange={setIsUpdateModalOpen}
        hasActiveDownloads={hasActiveDownloads()}
        onUpdateSuccess={() => setIsUpdateAvailable(false)} // Hides button after success
      />

      {/* Footer to open Settings */}
      <Footer
        onOpenSettings={() => setIsSettingsOpen(true)}
        isUpdateAvailable={isUpdateAvailable()}
        onOpenUpdate={() => setIsUpdateModalOpen(true)}
      />

      {/* Global Toaster Mount Point */}
      <GlobalToaster />
    </div>
  );
}
