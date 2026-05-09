import { Toast, toaster } from "@kobalte/core/toast";
import { X, CircleAlert, CircleCheck, Info } from "lucide-solid";

export function showAlert(
  title: string,
  description?: string,
  type: "success" | "error" | "info" = "info",
) {
  toaster.show((props) => (
    <Toast
      toastId={props.toastId}
      class="relative overflow-hidden bg-surface-low border border-surface-high rounded-xl p-4 shadow-[0_8px_32px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.06)] flex items-start gap-3 w-80 data-opened:animate-in data-closed:animate-out data-[opened]:fade-in data-[closed]:fade-out data-[opened]:slide-in-from-bottom-5"
    >
      <div class="shrink-0 mt-0.5 z-10">
        {type === "success" && <CircleCheck size={18} class="text-primary" />}
        {type === "error" && <CircleAlert size={18} class="text-red-400" />}
        {type === "info" && <Info size={18} class="text-blue-400" />}
      </div>

      <div class="flex-1 min-w-0 flex flex-col gap-1 z-10 pb-1">
        <Toast.Title class="text-sm font-bold text-white tracking-tight">
          {title}
        </Toast.Title>
        {description && (
          <Toast.Description class="text-xs text-on-surface-muted leading-relaxed">
            {description}
          </Toast.Description>
        )}
      </div>

      <Toast.CloseButton class="shrink-0 text-on-surface-muted hover:text-white transition-colors z-10">
        <X size={16} />
      </Toast.CloseButton>

      <Toast.ProgressTrack class="absolute bottom-0 left-0 right-0 h-1 w-full bg-surface-highest">
        <Toast.ProgressFill
          class="h-full bg-primary transition-[width] duration-100 ease-linear"
          style={{ width: "var(--kb-toast-progress-fill-width)" }}
        />
      </Toast.ProgressTrack>
    </Toast>
  ));
}

export function GlobalToaster() {
  return (
    <Toast.Region duration={5000} limit={3}>
      <Toast.List class="fixed bottom-4 right-4 z-50 flex flex-col gap-3 outline-none" />
    </Toast.Region>
  );
}
