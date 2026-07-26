import { createSignal, Match, Show, Switch } from "solid-js";
import { Dialog } from "@kobalte/core/dialog";
import {
  CircleCheck,
  CircleX,
  CloudDownload,
  LoaderCircle,
  TriangleAlert,
  X,
} from "lucide-solid";
import { Button } from "../ui/Button";
import { performYtDlpUpdate } from "../../lib/api";
import { reconcilePostUpdateCheck } from "../../lib/update-status";
import type {
  IActionResult,
  IYtDlpUpdateCheckResult,
  IYtDlpUpdateResult,
  TYtDlpUpdateCheckStatus,
} from "../../types";

interface IUpdateModalProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  hasActiveDownloads: boolean;
  checkStatus: TYtDlpUpdateCheckStatus;
  checkResult?: IYtDlpUpdateCheckResult;
  checkError: string;
  onCheck: () => Promise<IActionResult<IYtDlpUpdateCheckResult>>;
  performUpdate?: () => Promise<IActionResult<IYtDlpUpdateResult>>;
}

type TUpdateOperationStatus =
  | "idle"
  | "updating"
  | "updated"
  | "current"
  | "different"
  | "inconclusive"
  | "error";

export default function UpdateModal(props: IUpdateModalProps) {
  const [operationStatus, setOperationStatus] =
    createSignal<TUpdateOperationStatus>("idle");
  const [errorMessage, setErrorMessage] = createSignal("");
  const [updateOutput, setUpdateOutput] = createSignal("");
  const [updatedVersion, setUpdatedVersion] = createSignal("");
  const [isUpdateRequestPending, setIsUpdateRequestPending] =
    createSignal(false);

  const handleUpdate = async () => {
    if (
      props.hasActiveDownloads ||
      operationStatus() === "updating" ||
      isUpdateRequestPending()
    ) {
      return;
    }

    // Reactive state updates after the current event; keep a synchronous guard
    // so rapid clicks cannot start multiple preliminary checks.
    setIsUpdateRequestPending(true);
    try {
      setOperationStatus("idle");
      const check = await props.onCheck();
      if (!check.success || check.data?.status !== "available") return;

      setOperationStatus("updating");
      setErrorMessage("");
      setUpdateOutput("");
      setUpdatedVersion("");

      const result = await (props.performUpdate || performYtDlpUpdate)();

      if (result.success && result.data) {
        setUpdateOutput(result.data?.output || "Actualización comprobada.");
        setUpdatedVersion(result.data?.currentVersion || "");

        // Refresh global availability after the executable changes.
        const refreshedCheck = await props.onCheck();
        const reconciliation = reconcilePostUpdateCheck(
          result.data,
          refreshedCheck,
        );
        setOperationStatus(reconciliation.status);
        setErrorMessage(reconciliation.error || "");
      } else {
        setOperationStatus("error");
        setErrorMessage(
          result.error || "No se pudo instalar la actualización.",
        );
      }
    } finally {
      setIsUpdateRequestPending(false);
    }
  };

  const handleManualCheck = async () => {
    if (operationStatus() === "updating" || isUpdateRequestPending()) return;
    setOperationStatus("idle");
    await props.onCheck();
  };

  const handleClose = () => {
    if (operationStatus() !== "updating") {
      props.onOpenChange(false);
    }
  };

  const renderVersionDetails = () => (
    <div class="flex flex-col gap-1 rounded-lg bg-surface-lowest px-4 py-3 text-left text-xs w-full">
      <p class="text-on-surface-muted">
        Instalada: <strong class="text-white">{props.checkResult?.currentVersion}</strong>
      </p>
      <p class="text-on-surface-muted">
        Última publicada: <strong class="text-white">{props.checkResult?.latestVersion}</strong>
      </p>
    </div>
  );

  return (
    <Dialog
      open={props.isOpen}
      onOpenChange={(open) => {
        // Checks can finish in the background; only updates lock the modal.
        if (!open) handleClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm data-expanded:animate-in data-closed:animate-out data-[expanded]:fade-in data-[closed]:fade-out" />

        <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Content class="bg-surface-low border border-surface-high rounded-3xl w-full max-w-md shadow-[0_20px_60px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden data-expanded:animate-in data-closed:animate-out data-[expanded]:fade-in data-[closed]:fade-out data-[expanded]:zoom-in-95 data-[closed]:zoom-out-95">
            <div class="flex items-center justify-between px-6 py-4 border-b border-surface-high bg-surface-highest/50">
              <Dialog.Title class="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                <CloudDownload size={20} class="text-primary" />
                Actualizaciones de yt-dlp
              </Dialog.Title>

              <Show when={operationStatus() !== "updating"}>
                <Dialog.CloseButton
                  onClick={handleClose}
                  class="text-on-surface-muted hover:text-white transition-colors bg-surface-lowest hover:bg-surface-high p-2 rounded-full"
                >
                  <X size={18} />
                </Dialog.CloseButton>
              </Show>
            </div>

            <div class="p-6 flex flex-col gap-6 items-center text-center">
      <Switch>
                <Match when={operationStatus() === "updating"}>
                  <div class="flex flex-col items-center gap-4 py-4">
                    <LoaderCircle size={48} class="text-primary animate-spin" />
                    <p class="text-sm font-semibold text-white">
                      Instalando actualización de yt-dlp...
                    </p>
                    <p class="text-xs text-on-surface-muted">
                      No cierres la aplicación ni desconectes internet.
                    </p>
                  </div>
                </Match>

                <Match
                  when={
                    operationStatus() === "updated" ||
                    operationStatus() === "current"
                  }
                >
                  <div class="flex flex-col items-center gap-4 py-4">
                    <CircleCheck
                      size={56}
                      class="text-green-500 animate-in zoom-in"
                    />
                    <div class="space-y-1">
                      <p class="text-base font-bold text-white">
                        {operationStatus() === "updated"
                          ? "yt-dlp actualizado"
                          : "yt-dlp ya está actualizado"}
                      </p>
                      <p class="text-sm text-on-surface-muted">
                        {operationStatus() === "updated"
                          ? "Se instaló la versión más reciente del motor de descargas."
                          : "No hay una versión más reciente disponible."}
                      </p>
                    </div>
                    <Show when={updatedVersion()}>
                      <p class="text-xs text-on-surface-muted">
                        Versión instalada: <strong>{updatedVersion()}</strong>
                      </p>
                    </Show>
                    <Show when={updateOutput()}>
                      <pre class="max-h-32 w-full overflow-auto rounded-lg bg-surface-lowest p-3 text-left text-[0.65rem] text-on-surface-muted whitespace-pre-wrap">
                        {updateOutput()}
                      </pre>
                    </Show>
                  </div>
                </Match>

                <Match
                  when={
                    operationStatus() === "different" ||
                    operationStatus() === "inconclusive"
                  }
                >
                  <div class="flex flex-col items-center gap-4 py-4">
                    <TriangleAlert
                      size={56}
                      class="text-amber-500 animate-in zoom-in"
                    />
                    <div class="space-y-1">
                      <p class="text-base font-bold text-amber-400">
                        Actualización no confirmada
                      </p>
                      <p class="text-sm text-on-surface-muted max-w-70 mx-auto">
                        {errorMessage()}
                      </p>
                    </div>
                    <Show when={updatedVersion()}>
                      <p class="text-xs text-on-surface-muted">
                        Versión instalada: <strong>{updatedVersion()}</strong>
                      </p>
                    </Show>
                  </div>
                </Match>

                <Match when={operationStatus() === "error"}>
                  <div class="flex flex-col items-center gap-4 py-4">
                    <CircleX
                      size={56}
                      class="text-red-500 animate-in zoom-in"
                    />
                    <div class="space-y-1">
                      <p class="text-base font-bold text-red-400">
                        No se pudo actualizar yt-dlp
                      </p>
                      <p class="text-sm text-on-surface-muted max-w-70 mx-auto">
                        {errorMessage()}
                      </p>
                    </div>
                  </div>
                </Match>

                <Match when={props.checkStatus === "checking"}>
                  <div class="flex flex-col items-center gap-4 py-4">
                    <LoaderCircle size={48} class="text-primary animate-spin" />
                    <p class="text-sm font-semibold text-white">
                      Comprobando actualizaciones...
                    </p>
                    <p class="text-xs text-on-surface-muted">
                      La comprobación es de solo lectura y no bloquea las descargas.
                    </p>
                  </div>
                </Match>

                <Match when={props.checkStatus === "available"}>
                  <div class="flex flex-col items-center gap-4 py-4">
                    <CloudDownload size={56} class="text-primary" />
                    <div class="space-y-1">
                      <p class="text-base font-bold text-white">
                        Hay una actualización disponible
                      </p>
                      <p class="text-sm text-on-surface-muted">
                        Comprueba de nuevo antes de instalarla para evitar usar
                        información antigua.
                      </p>
                    </div>
                    {renderVersionDetails()}
                    <Show when={props.hasActiveDownloads}>
                      <div class="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 w-full text-left">
                        <TriangleAlert
                          size={18}
                          class="text-amber-500 shrink-0 mt-0.5"
                        />
                        <div class="flex flex-col gap-1">
                          <p class="text-[0.75rem] font-bold text-amber-500 uppercase tracking-wide">
                            Descargas activas
                          </p>
                          <p class="text-[0.75rem] text-amber-200/80 leading-relaxed">
                            Espera a que terminen o cancélalas para actualizar.
                          </p>
                        </div>
                      </div>
                    </Show>
                  </div>
                </Match>

                <Match when={props.checkStatus === "current"}>
                  <div class="flex flex-col items-center gap-4 py-4">
                    <CircleCheck
                      size={56}
                      class="text-green-500 animate-in zoom-in"
                    />
                    <div class="space-y-1">
                      <p class="text-base font-bold text-white">
                        yt-dlp ya está actualizado
                      </p>
                      <p class="text-sm text-on-surface-muted">
                        No hay una versión más reciente disponible.
                      </p>
                    </div>
                    {renderVersionDetails()}
                  </div>
                </Match>

                <Match when={props.checkStatus === "different"}>
                  <div class="flex flex-col items-center gap-4 py-4">
                    <TriangleAlert size={56} class="text-amber-500" />
                    <div class="space-y-1">
                      <p class="text-base font-bold text-white">
                        Versiones diferentes
                      </p>
                      <p class="text-sm text-on-surface-muted">
                        Bolt no puede confirmar que la versión publicada sea una
                        actualización segura.
                      </p>
                    </div>
                    {renderVersionDetails()}
                  </div>
                </Match>

                <Match when={props.checkStatus === "check-failed"}>
                  <div class="flex flex-col items-center gap-4 py-4">
                    <CircleX size={56} class="text-red-500" />
                    <div class="space-y-1">
                      <p class="text-base font-bold text-red-400">
                        No se pudo comprobar yt-dlp
                      </p>
                      <p class="text-sm text-on-surface-muted max-w-70 mx-auto">
                        {props.checkError}
                      </p>
                    </div>
                  </div>
                </Match>

                <Match when={props.checkStatus === "unchecked"}>
                  <p class="text-sm text-on-surface-muted leading-relaxed">
                    Comprueba si yt-dlp está actualizado. La comprobación necesita
                    conexión a internet y no cambia el ejecutable.
                  </p>
                </Match>
              </Switch>
            </div>

            <Show when={operationStatus() !== "updating"}>
              <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-surface-high bg-surface-highest/30">
                <Switch>
                  <Match when={operationStatus() === "updated" || operationStatus() === "current"}>
                    <Button
                      variant="gradient"
                      class="px-8 py-2.5 text-xs w-full sm:w-auto"
                      onClick={handleClose}
                    >
                      ENTENDIDO
                    </Button>
                  </Match>

                  <Match when={operationStatus() === "error"}>
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
                      disabled={
                        props.hasActiveDownloads || isUpdateRequestPending()
                      }
                    >
                      REINTENTAR
                    </Button>
                  </Match>

                  <Match
                    when={
                      operationStatus() === "different" ||
                      operationStatus() === "inconclusive"
                    }
                  >
                    <Button
                      variant="surface"
                      class="px-5 py-2.5 text-xs"
                      onClick={handleClose}
                    >
                      CERRAR
                    </Button>
                    <Button
                      variant="gradient"
                      class="px-6 py-2.5 text-xs"
                      onClick={handleManualCheck}
                    >
                      COMPROBAR DE NUEVO
                    </Button>
                  </Match>

                  <Match when={props.checkStatus === "available"}>
                    <Button
                      variant="surface"
                      class="px-5 py-2.5 text-xs"
                      onClick={handleManualCheck}
                    >
                      COMPROBAR DE NUEVO
                    </Button>
                    <Button
                       variant="gradient"
                       class="px-6 py-2.5 text-xs"
                       onClick={handleUpdate}
                       disabled={
                         props.hasActiveDownloads || isUpdateRequestPending()
                       }
                    >
                      ACTUALIZAR AHORA
                    </Button>
                  </Match>

                  <Match
                    when={
                      props.checkStatus === "current" ||
                      props.checkStatus === "different" ||
                      props.checkStatus === "check-failed" ||
                      props.checkStatus === "unchecked"
                    }
                  >
                    <Button
                      variant="surface"
                      class="px-5 py-2.5 text-xs"
                      onClick={handleClose}
                    >
                      CERRAR
                    </Button>
                    <Button
                      variant="gradient"
                      class="px-6 py-2.5 text-xs"
                      onClick={handleManualCheck}
                    >
                      COMPROBAR DE NUEVO
                    </Button>
                  </Match>

                  <Match when={props.checkStatus === "checking"}>
                    <Button
                      variant="surface"
                      class="px-5 py-2.5 text-xs"
                      onClick={handleClose}
                    >
                      MÁS TARDE
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
