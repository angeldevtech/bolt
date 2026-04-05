import { createSignal } from "solid-js";
import { Dialog } from "@kobalte/core/dialog";
import { X, FolderSearch, AlertTriangle, Save } from "lucide-solid";
import { Button } from "../ui/Button";
import { showAlert } from "../ui/Toaster";

interface Props {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

export function SettingsModal(props: Props) {
  const [audioPath, setAudioPath] = createSignal("C:\\Users\\Usuario\\Music");
  const [videoPath, setVideoPath] = createSignal("C:\\Users\\Usuario\\Videos");
  const [maxConcurrent, setMaxConcurrent] = createSignal(1);

  const handleSave = () => {
    props.onOpenChange(false);
    showAlert(
      "Ajustes Guardados",
      "Tu configuración ha sido actualizada correctamente.",
      "success",
    );
  };

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm data-expanded:animate-in data-closed:animate-out data-[expanded]:fade-in data-[closed]:fade-out" />

        <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Content class="bg-surface-low border border-surface-high rounded-3xl w-full max-w-lg shadow-[0_20px_60px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden data-expanded:animate-in data-closed:animate-out data-[expanded]:fade-in data-[closed]:fade-out data-[expanded]:zoom-in-95 data-[closed]:zoom-out-95">
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
                      class="flex-1 bg-surface-lowest ghost-border rounded-xl px-4 py-2.5 text-sm text-on-surface outline-none"
                    />
                    <button
                      class="bg-surface-highest hover:bg-surface-bright text-white p-2.5 rounded-xl transition-colors shrink-0"
                      title="Explorar"
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
                      class="flex-1 bg-surface-lowest ghost-border rounded-xl px-4 py-2.5 text-sm text-on-surface outline-none"
                    />
                    <button
                      class="bg-surface-highest hover:bg-surface-bright text-white p-2.5 rounded-xl transition-colors shrink-0"
                      title="Explorar"
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
                      {[1, 2, 3, 4].map((num) => (
                        <button
                          class={`w-8 h-8 rounded-md flex items-center justify-center text-sm font-bold transition-all ${maxConcurrent() === num ? "bg-primary text-white shadow-md" : "text-on-surface-muted hover:text-white"}`}
                          onClick={() => setMaxConcurrent(num)}
                        >
                          {num}
                        </button>
                      ))}
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
                onClick={() => props.onOpenChange(false)}
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
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  );
}
