import { createSignal, Show } from "solid-js";
import { Dialog } from "@kobalte/core/dialog";
import { X, AlertTriangle, DownloadCloud, Loader2 } from "lucide-solid";
import { Button } from "../ui/Button";
import { showAlert } from "../ui/Toaster";
import { performYtDlpUpdate } from "../../lib/api";

interface Props {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  hasActiveDownloads: boolean;
  onUpdateSuccess: () => void;
}

export function UpdateModal(props: Props) {
  const [isUpdating, setIsUpdating] = createSignal(false);

  const handleUpdate = async () => {
    if (props.hasActiveDownloads) return;

    setIsUpdating(true);

    // Call our Rust API
    const result = await performYtDlpUpdate();

    setIsUpdating(false);

    if (result.success) {
      showAlert(
        "Actualización Completa",
        "El motor de descargas está en su última versión.",
        "success",
      );
      props.onUpdateSuccess(); // Tells App.tsx to hide the update button
      props.onOpenChange(false); // Close the modal
    } else {
      showAlert(
        "Error al actualizar",
        result.error || "Ocurrió un problema inesperado.",
        "error",
      );
    }
  };

  return (
    <Dialog
      open={props.isOpen}
      // Prevent closing by clicking outside or pressing ESC if currently updating
      onOpenChange={(open) => {
        if (!isUpdating()) props.onOpenChange(open);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm data-expanded:animate-in data-closed:animate-out data-[expanded]:fade-in data-[closed]:fade-out" />

        <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Content class="bg-surface-low border border-surface-high rounded-3xl w-full max-w-md shadow-[0_20px_60px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden data-expanded:animate-in data-closed:animate-out data-[expanded]:fade-in data-[closed]:fade-out data-[expanded]:zoom-in-95 data-[closed]:zoom-out-95">
            {/* Header */}
            <div class="flex items-center justify-between px-6 py-4 border-b border-surface-high bg-surface-highest/50">
              <Dialog.Title class="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                <DownloadCloud size={20} class="text-primary" />
                Actualizar Motor
              </Dialog.Title>

              {/* Hide close button during update to prevent accidental clicks */}
              <Show when={!isUpdating()}>
                <Dialog.CloseButton class="text-on-surface-muted hover:text-white transition-colors bg-surface-lowest hover:bg-surface-high p-2 rounded-full">
                  <X size={18} />
                </Dialog.CloseButton>
              </Show>
            </div>

            {/* Body */}
            <div class="p-6 flex flex-col gap-6 items-center text-center">
              <Show
                when={!isUpdating()}
                fallback={
                  <div class="flex flex-col items-center gap-4 py-4">
                    <Loader2 size={48} class="text-primary animate-spin" />
                    <p class="text-sm font-semibold text-white">
                      Descargando e instalando actualización...
                    </p>
                    <p class="text-xs text-on-surface-muted">
                      Por favor, no cierres la aplicación.
                    </p>
                  </div>
                }
              >
                <p class="text-sm text-on-surface-muted leading-relaxed">
                  Hay una nueva versión disponible para el motor de descargas.
                  Es recomendable actualizar para asegurar que los enlaces sigan
                  funcionando correctamente.
                </p>

                {/* Warning if downloads are running */}
                <Show when={props.hasActiveDownloads}>
                  <div class="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 w-full text-left">
                    <AlertTriangle
                      size={18}
                      class="text-amber-500 shrink-0 mt-0.5"
                    />
                    <div class="flex flex-col gap-1">
                      <p class="text-[0.75rem] font-bold text-amber-500 uppercase tracking-wide">
                        Descargas Activas
                      </p>
                      <p class="text-[0.75rem] text-amber-200/80 leading-relaxed">
                        No puedes actualizar mientras haya descargas en
                        progreso. Por favor,{" "}
                        <strong>espera a que terminen</strong> o cancélalas para
                        continuar.
                      </p>
                    </div>
                  </div>
                </Show>
              </Show>
            </div>

            {/* Footer */}
            <Show when={!isUpdating()}>
              <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-surface-high bg-surface-highest/30">
                <Button
                  variant="surface"
                  class="px-5 py-2.5 text-xs"
                  onClick={() => props.onOpenChange(false)}
                >
                  MÁS TARDE
                </Button>
                <Button
                  variant="gradient"
                  class="px-6 py-2.5 text-xs opacity-disabled"
                  disabled={props.hasActiveDownloads}
                  onClick={handleUpdate}
                >
                  ACTUALIZAR AHORA
                </Button>
              </div>
            </Show>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  );
}
