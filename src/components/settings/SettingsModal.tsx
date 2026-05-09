import { createSignal, createEffect, createMemo, For } from "solid-js";
import { Dialog } from "@kobalte/core/dialog";
import { X, FolderSearch, AlertTriangle, Save } from "lucide-solid";
import { Button } from "../ui/Button";
import { showAlert } from "../ui/Toaster";
import {
  DEFAULT_MAX_CONCURRENT,
  DOWNLOAD_CONCURRENCY_OPTIONS,
} from "../../constants";

// Import our API and Store
import { promptForFolder } from "../../lib/api";
import { settings, updateAllSettings } from "../../store/settings";

interface Props {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

export function SettingsModal(props: Props) {
  // Local "draft" state
  const [audioPath, setAudioPath] = createSignal("");
  const [videoPath, setVideoPath] = createSignal("");
  const [maxConcurrent, setMaxConcurrent] = createSignal(DEFAULT_MAX_CONCURRENT);
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = createSignal(false);

  const draftSettings = createMemo(() => ({
    audioFolder: audioPath(),
    videoFolder: videoPath(),
    maxConcurrent: maxConcurrent(),
  }));

  const hasUnsavedChanges = createMemo(
    () =>
      draftSettings().audioFolder !== settings.audioFolder ||
      draftSettings().videoFolder !== settings.videoFolder ||
      draftSettings().maxConcurrent !== settings.maxConcurrent,
  );

  const changeSummary = createMemo(() => {
    const changes: string[] = [];

    if (draftSettings().audioFolder !== settings.audioFolder) {
      changes.push(
        `Audio: ${settings.audioFolder || "Sin definir"} -> ${draftSettings().audioFolder || "Sin definir"}`,
      );
    }

    if (draftSettings().videoFolder !== settings.videoFolder) {
      changes.push(
        `Video: ${settings.videoFolder || "Sin definir"} -> ${draftSettings().videoFolder || "Sin definir"}`,
      );
    }

    if (draftSettings().maxConcurrent !== settings.maxConcurrent) {
      changes.push(
        `Descargas simultaneas: ${settings.maxConcurrent} -> ${draftSettings().maxConcurrent}`,
      );
    }

    return changes;
  });

  // Sync the global settings to local draft state EVERY TIME the modal opens
  createEffect(() => {
    if (props.isOpen) {
      console.info("[settings] Opening modal with store values", {
        audioFolder: settings.audioFolder,
        videoFolder: settings.videoFolder,
        maxConcurrent: settings.maxConcurrent,
      });
      setAudioPath(settings.audioFolder);
      setVideoPath(settings.videoFolder);
      setMaxConcurrent(settings.maxConcurrent);
      setIsDiscardConfirmOpen(false);
    }
  });

  const closeModal = () => {
    setIsDiscardConfirmOpen(false);
    props.onOpenChange(false);
  };

  const requestClose = () => {
    if (hasUnsavedChanges()) {
      setIsDiscardConfirmOpen(true);
      return;
    }

    closeModal();
  };

  // Handlers for picking folders via Tauri OS Dialog
  const handlePickAudio = async () => {
    const path = await promptForFolder(audioPath());
    if (path) setAudioPath(path);
  };

  const handlePickVideo = async () => {
    const path = await promptForFolder(videoPath());
    if (path) setVideoPath(path);
  };

  // Explicit Save
  const handleSave = async () => {
    // Write draft state to global store and persist to disk
    await updateAllSettings(draftSettings());

    closeModal();
    showAlert(
      "Ajustes Guardados",
      "Los cambios se aplicarán a las nuevas descargas.", // Clear UX feedback
      "success",
    );
  };

  return (
    <Dialog
      open={props.isOpen}
      onOpenChange={(isOpen) => {
        if (isOpen) {
          props.onOpenChange(true);
          return;
        }

        requestClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm data-expanded:animate-in data-closed:animate-out data-[expanded]:fade-in data-[closed]:fade-out" />

        <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Content class="relative bg-surface-low border border-surface-high rounded-3xl w-full max-w-lg shadow-[0_20px_60px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden data-expanded:animate-in data-closed:animate-out data-[expanded]:fade-in data-[closed]:fade-out data-[expanded]:zoom-in-95 data-[closed]:zoom-out-95">
            {/* Header */}
            <div class="flex items-center justify-between px-6 py-4 border-b border-surface-high bg-surface-highest/50">
              <Dialog.Title class="text-lg font-bold tracking-tight text-white">
                Ajustes de la Aplicación
              </Dialog.Title>
              <Dialog.CloseButton class="text-on-surface-muted hover:text-white transition-colors bg-surface-lowest hover:bg-surface-high p-2 rounded-full">
                <X size={18} />
              </Dialog.CloseButton>
            </div>

            {/* Body */}
            <div class="p-6 flex flex-col gap-8">
              {/* Section: Folders */}
              <div class="flex flex-col gap-4">
                <h3 class="text-[0.65rem] font-bold tracking-widest text-primary uppercase">
                  Rutas de Descarga
                </h3>

                {/* Audio Path */}
                <div class="flex flex-col gap-2">
                  <label class="text-xs font-semibold text-on-surface-muted">
                    Carpeta de Audio (MP3)
                  </label>
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={audioPath()}
                      class="flex-1 bg-surface-lowest ghost-border rounded-xl px-4 py-2.5 text-sm text-on-surface outline-none cursor-default"
                    />
                    <button
                      onClick={handlePickAudio}
                      class="bg-surface-highest hover:bg-surface-bright text-white p-2.5 rounded-xl transition-colors shrink-0"
                      title="Cambiar carpeta de audio"
                    >
                      <FolderSearch size={18} />
                    </button>
                  </div>
                </div>

                {/* Video Path */}
                <div class="flex flex-col gap-2">
                  <label class="text-xs font-semibold text-on-surface-muted">
                    Carpeta de Video (MP4)
                  </label>
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={videoPath()}
                      class="flex-1 bg-surface-lowest ghost-border rounded-xl px-4 py-2.5 text-sm text-on-surface outline-none cursor-default"
                    />
                    <button
                      onClick={handlePickVideo}
                      class="bg-surface-highest hover:bg-surface-bright text-white p-2.5 rounded-xl transition-colors shrink-0"
                      title="Cambiar carpeta de video"
                    >
                      <FolderSearch size={18} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Section: Performance */}
              <div class="flex flex-col gap-4">
                <h3 class="text-[0.65rem] font-bold tracking-widest text-primary uppercase">
                  Rendimiento
                </h3>

                <div class="flex flex-col gap-3">
                  <div class="flex items-center justify-between">
                    <label class="text-sm font-semibold text-white">
                      Descargas Simultáneas
                    </label>
                    <div class="flex items-center bg-surface-lowest rounded-lg p-1 ghost-border">
                      <For each={DOWNLOAD_CONCURRENCY_OPTIONS}>
                        {(num) => (
                          <button
                            class={`w-8 h-8 rounded-md flex items-center justify-center text-sm font-bold transition-all ${
                              maxConcurrent() === num
                                ? "bg-primary text-white shadow-md"
                                : "text-on-surface-muted hover:text-white"
                            }`}
                            onClick={() => setMaxConcurrent(num)}
                          >
                            {num}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>

                  <div class="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                    <AlertTriangle
                      size={16}
                      class="text-amber-500 shrink-0 mt-0.5"
                    />
                    <p class="text-[0.7rem] text-amber-200/80 leading-relaxed">
                      Un número alto de descargas simultáneas puede resultar en
                      que el servidor bloquee temporalmente tu IP o restrinja
                      tus descargas. Se recomienda mantener el valor en{" "}
                      <strong>1</strong> o <strong>2</strong>.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-surface-high bg-surface-highest/30">
              <Button
                variant="surface"
                class="px-5 py-2.5 text-xs"
                onClick={requestClose}
              >
                CANCELAR
              </Button>
              <Button
                variant="gradient"
                class="px-6 py-2.5 text-xs"
                onClick={handleSave}
              >
                <Save size={14} /> GUARDAR CAMBIOS
              </Button>
            </div>

            {isDiscardConfirmOpen() && (
              <div class="absolute inset-0 z-10 flex items-center justify-center p-4">
                <div class="absolute inset-0 bg-black/80 backdrop-blur-sm" />
                <div class="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-amber-500/20 bg-surface-low shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
                  <div class="border-b border-surface-high bg-amber-500/10 px-6 py-4">
                    <h3 class="text-lg font-bold tracking-tight text-white">
                      Tienes cambios sin guardar
                    </h3>
                    <p class="mt-1 text-sm text-amber-100/80">
                      Antes de cerrar, elige si quieres guardarlos o descartarlos.
                    </p>
                  </div>

                  <div class="flex flex-col gap-4 px-6 py-5">
                    <div class="rounded-2xl border border-amber-500/15 bg-surface-lowest/70 p-4">
                      <p class="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300/80">
                        Resumen de cambios
                      </p>
                      <div class="mt-3 flex flex-col gap-2 text-sm text-on-surface">
                        <For each={changeSummary()}>
                          {(change) => <p>{change}</p>}
                        </For>
                      </div>
                    </div>

                    <div class="flex items-center justify-end gap-3">
                      <Button
                        variant="surface"
                        class="px-4 py-2.5 text-xs"
                        onClick={() => setIsDiscardConfirmOpen(false)}
                      >
                        SEGUIR EDITANDO
                      </Button>
                      <Button
                        variant="danger"
                        class="px-4 py-2.5 text-xs"
                        onClick={closeModal}
                      >
                        DESCARTAR CAMBIOS
                      </Button>
                      <Button
                        variant="gradient"
                        class="px-4 py-2.5 text-xs"
                        onClick={handleSave}
                      >
                        <Save size={14} /> GUARDAR Y SALIR
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  );
}
