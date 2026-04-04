import { createSignal } from "solid-js";
import { FileAudio, FileVideo, MonitorPlay } from "lucide-solid";
import { UrlInput } from "./components/ui/UrlInput";
import { Button } from "./components/ui/Button";
import { Footer } from "./components/layout/Footer";
import { DownloadList } from "./components/downloads/DownloadList";
import { type IDownloadItem } from "./types";

export default function App() {
  const [url, setUrl] = createSignal("");

  // Updated Mock Data featuring all 4 states and the new fields
  const mockDownloads: IDownloadItem[] = [
    {
      id: "1",
      url: "https://youtu.be/...",
      title: "Cyberpunk 2077 - Official Cinematic Trailer (HD)",
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

  return (
    <div class="flex flex-col h-full w-full">
      <main class="flex-1 flex flex-col px-6 lg:px-10 xl:px-16 pt-6 pb-0 w-full gap-6 overflow-hidden">
        <section class="flex flex-col gap-4 shrink-0">
          <UrlInput
            value={url()}
            onInput={setUrl}
            onPasteClick={() => console.log("Paste clicked")}
          />

          <div class="grid grid-cols-3 gap-3">
            <Button
              variant="gradient"
              onClick={() => console.log("Download MP3", url())}
            >
              <FileAudio
                size={20}
                class="group-hover:scale-110 transition-transform"
              />
              <span class="text-base lg:text-lg font-bold tracking-tight">
                MP3
              </span>
            </Button>

            <Button
              variant="gradient"
              onClick={() => console.log("Download MP4", url())}
            >
              <FileVideo
                size={20}
                class="group-hover:scale-110 transition-transform"
              />
              <span class="text-base lg:text-lg font-bold tracking-tight">
                MP4
              </span>
            </Button>

            <Button
              variant="gradient"
              onClick={() => console.log("Download MP4 HD", url())}
            >
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

        <DownloadList downloads={mockDownloads} />
      </main>

      <Footer />
    </div>
  );
}
