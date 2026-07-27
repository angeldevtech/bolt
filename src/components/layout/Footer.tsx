import { ArrowDownToLine, RefreshCw, Settings } from "lucide-solid";
import type { TYtDlpUpdateCheckStatus } from "../../types";

interface IFooterProps {
  onOpenSettings: () => void;
  updateStatus: TYtDlpUpdateCheckStatus;
  onOpenUpdate: () => void;
}

export function Footer(props: IFooterProps) {
  const isAvailable = () => props.updateStatus === "available";
  const isChecking = () => props.updateStatus === "checking";

  return (
    <footer class="h-12 shrink-0 bg-transparent flex items-center justify-between px-6 lg:px-10 xl:px-16 text-[0.65rem] font-bold tracking-wider uppercase z-10 relative border-t border-surface-low/50">
      <button
        onClick={props.onOpenSettings}
        class="flex items-center gap-2 text-on-surface-muted hover:text-white transition-colors"
      >
        <Settings size={14} /> AJUSTES
      </button>

      <button
        onClick={props.onOpenUpdate}
        class={`flex items-center gap-2 text-primary hover:text-white transition-colors ${isAvailable() ? "animate-pulse" : ""}`}
        aria-label={
          isAvailable()
            ? "Actualización de yt-dlp disponible"
            : "Comprobar actualizaciones de yt-dlp"
        }
      >
        {isAvailable() ? (
          <ArrowDownToLine size={14} />
        ) : (
          <RefreshCw size={14} class={isChecking() ? "animate-spin" : ""} />
        )}
        {isAvailable()
          ? "ACTUALIZACIÓN DISPONIBLE"
          : isChecking()
            ? "COMPROBANDO ACTUALIZACIONES"
            : "COMPROBAR ACTUALIZACIONES"}
      </button>
    </footer>
  );
}
