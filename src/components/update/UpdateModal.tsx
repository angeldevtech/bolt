import { createSignal, Show, Switch, Match } from "solid-js";
import { Dialog } from "@kobalte/core/dialog";
import {
  X,
  TriangleAlert,
  CloudDownload,
  LoaderCircle,
  CircleCheck,
  CircleX,
} from "lucide-solid";
import { Button } from "../ui/Button";
import { performYtDlpUpdate } from "../../lib/api";

interface IUpdateModalProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  hasActiveDownloads: boolean;
  onUpdateSuccess: () => void;
}

export default function UpdateModal(props: IUpdateModalProps) {
  const [updateStatus, setUpdateStatus] = createSignal<
    "idle" | "updating" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = createSignal("");
  const [updateOutput, setUpdateOutput] = createSignal("");

  const handleUpdate = async () => {
    if (props.hasActiveDownloads) return;

    setUpdateStatus("updating");
    setErrorMessage("");
    setUpdateOutput("");

    const result = await performYtDlpUpdate();

    if (result.success) {
      setUpdateOutput(result.data?.output || "Actualización comprobada.");
      setUpdateStatus("success");
    } else {
      setUpdateStatus("error");
      setErrorMessage(
        result.error || "Ocurrió un problema inesperado de conexión.",
      );
    }
  };

  const handleClose = () => {
    props.onOpenChange(false);
  };

  const handleSuccessAcknowledge = () => {
    props.onUpdateSuccess();
    handleClose();
  };

  return (
    <Dialog
      open={props.isOpen}
      onOpenChange={(open) => {
        // Prevenir cierre haciendo clic fuera o con ESC si está actualizando o si fue exitoso
        if (updateStatus() !== "updating" && updateStatus() !== "success") {
          if (!open) handleClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm data-expanded:animate-in data-closed:animate-out data-[expanded]:fade-in data-[closed]:fade-out" />

        <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Content class="bg-surface-low border border-surface-high rounded-3xl w-full max-w-md shadow-[0_20px_60px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden data-expanded:animate-in data-closed:animate-out data-[expanded]:fade-in data-[closed]:fade-out data-[expanded]:zoom-in-95 data-[closed]:zoom-out-95">
            {/* Header */}
            <div class="flex items-center justify-between px-6 py-4 border-b border-surface-high bg-surface-highest/50">
              <Dialog.Title class="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                <CloudDownload size={20} class="text-primary" />
                Actualizar yt-dlp
              </Dialog.Title>

              {/* Ocultar botón X si está cargando o si obligamos a leer el éxito */}
              <Show
                when={updateStatus() === "idle" || updateStatus() === "error"}
              >
                <Dialog.CloseButton
                  onClick={handleClose}
                  class="text-on-surface-muted hover:text-white transition-colors bg-surface-lowest hover:bg-surface-high p-2 rounded-full"
                >
                  <X size={18} />
                </Dialog.CloseButton>
              </Show>
            </div>

            {/* Body */}
            <div class="p-6 flex flex-col gap-6 items-center text-center">
              <Switch>
                {/* ESTADO: INICIO */}
                <Match when={updateStatus() === "idle"}>
                  <p class="text-sm text-on-surface-muted leading-relaxed">
                    Comprueba e instala la versión más reciente del motor de
                    descargas. La acción necesita conexión a internet.
                  </p>

                  {/* Warning si hay descargas activas */}
                  <Show when={props.hasActiveDownloads}>
                    <div class="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 w-full text-left">
                      <TriangleAlert
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
                          <strong>espera a que terminen</strong> o cancélalas
                          para continuar.
                        </p>
                      </div>
                    </div>
                  </Show>
                </Match>

                {/* ESTADO: ACTUALIZANDO */}
                <Match when={updateStatus() === "updating"}>
                  <div class="flex flex-col items-center gap-4 py-4">
                    <LoaderCircle size={48} class="text-primary animate-spin" />
                    <p class="text-sm font-semibold text-white">
                      Descargando e instalando actualización...
                    </p>
                    <p class="text-xs text-on-surface-muted">
                      Por favor, no cierres la aplicación ni desconectes el
                      internet.
                    </p>
                  </div>
                </Match>

                {/* ESTADO: ÉXITO */}
                <Match when={updateStatus() === "success"}>
                  <div class="flex flex-col items-center gap-4 py-4">
                    <CircleCheck
                      size={56}
                      class="text-green-500 animate-in zoom-in"
                    />
                    <div class="space-y-1">
                      <p class="text-base font-bold text-white">
                        ¡Actualización Completada!
                      </p>
                      <p class="text-sm text-on-surface-muted">
                        El motor de descargas ya está en su última versión. Todo
                        listo para continuar.
                      </p>
                    </div>
                    <Show when={updateOutput()}>
                      <pre class="max-h-32 w-full overflow-auto rounded-lg bg-surface-lowest p-3 text-left text-[0.65rem] text-on-surface-muted whitespace-pre-wrap">
                        {updateOutput()}
                      </pre>
                    </Show>
                  </div>
                </Match>

                {/* ESTADO: ERROR */}
                <Match when={updateStatus() === "error"}>
                  <div class="flex flex-col items-center gap-4 py-4">
                    <CircleX
                      size={56}
                      class="text-red-500 animate-in zoom-in"
                    />
                    <div class="space-y-1">
                      <p class="text-base font-bold text-red-400">
                        Error al actualizar
                      </p>
                      <p class="text-sm text-on-surface-muted max-w-70 mx-auto">
                        {errorMessage()}
                      </p>
                    </div>
                  </div>
                </Match>
              </Switch>
            </div>

            {/* Footer */}
            <Show when={updateStatus() !== "updating"}>
              <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-surface-high bg-surface-highest/30">
                <Switch>
                  {/* Botones Iniciales */}
                  <Match when={updateStatus() === "idle"}>
                    <Button
                      variant="surface"
                      class="px-5 py-2.5 text-xs"
                      onClick={handleClose}
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
                  </Match>

                  {/* Botón de Éxito */}
                  <Match when={updateStatus() === "success"}>
                    <Button
                      variant="gradient"
                      class="px-8 py-2.5 text-xs w-full sm:w-auto"
                      onClick={handleSuccessAcknowledge}
                    >
                      ENTENDIDO
                    </Button>
                  </Match>

                  {/* Botones de Error */}
                  <Match when={updateStatus() === "error"}>
                    <Button
                      variant="surface"
                      class="px-5 py-2.5 text-xs"
                      onClick={handleClose}
                    >
                      CANCELAR
                    </Button>
                    <Button
                      variant="gradient"
                      class="px-6 py-2.5 text-xs bg-red-500 hover:bg-red-600 border-none"
                      onClick={handleUpdate}
                    >
                      REINTENTAR
                    </Button>
                  </Match>
                </Switch>
              </div>
            </Show>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  );
}
