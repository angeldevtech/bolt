import { createSignal } from "solid-js";
import { Button } from "./components/ui/Button";
import { TextInput } from "./components/ui/TextInput";

export default function App() {
  const [url, setUrl] = createSignal("");

  const handleDownload = (format: string) => {
    if (!url()) return;
    console.log(`Starting download for ${url()} as ${format}`);
    setUrl(""); // Clear input after submitting
  };

  return (
    <div class="flex flex-col h-full w-full">
      {/* HEADER */}
      <header class="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/50 backdrop-blur-sm z-10">
        <div class="flex items-center gap-2">
          {/* Simple SVG icon for "Bolt" */}
          <svg
            class="w-6 h-6 text-blue-500"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          <h1 class="text-xl font-bold tracking-wide text-zinc-100">Bolt</h1>
        </div>

        <Button
          variant="ghost"
          size="md"
          onClick={() => console.log("Open Settings")}
        >
          <span class="mr-2 text-lg">⚙</span> Settings
        </Button>
      </header>

      {/* MAIN CONTENT AREA */}
      <main class="flex-1 flex flex-col p-6 max-w-4xl mx-auto w-full gap-8 overflow-hidden">
        {/* INPUT SECTION */}
        <section class="flex flex-col gap-4 shrink-0 mt-4">
          <label for="url-input" class="text-sm font-medium text-zinc-400 ml-1">
            Paste YouTube Link
          </label>
          <TextInput
            id="url-input"
            type="url"
            placeholder="https://www.youtube.com/watch?v=..."
            value={url()}
            onInput={(e) => setUrl(e.currentTarget.value)}
          />

          {/* ACTION BUTTONS */}
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
            <Button
              size="lg"
              variant="secondary"
              disabled={!url()}
              onClick={() => handleDownload("mp3")}
            >
              🎵 Download Audio (MP3)
            </Button>

            <Button
              size="lg"
              variant="primary"
              disabled={!url()}
              onClick={() => handleDownload("mp4")}
            >
              🎬 Download Video
            </Button>

            <Button
              size="lg"
              variant="primary"
              disabled={!url()}
              onClick={() => handleDownload("mp4-hd")}
            >
              ⭐ Download Video (HD)
            </Button>
          </div>
        </section>

        {/* DOWNLOAD LIST PLACEHOLDER */}
        <section class="flex-1 flex flex-col min-h-0 bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden mt-4">
          <div class="px-5 py-3 border-b border-zinc-800 bg-zinc-900/80">
            <h2 class="text-sm font-semibold text-zinc-300 uppercase tracking-wider">
              Downloads
            </h2>
          </div>

          {/* This container will scroll if there are many items */}
          <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            {/* We will map over the downloads store here in the next phase */}

            {/* Empty State visual */}
            <div class="flex-1 flex flex-col items-center justify-center text-zinc-500 gap-3 min-h-50">
              <span class="text-4xl opacity-50">📥</span>
              <p>No active downloads. Paste a link above to start.</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
