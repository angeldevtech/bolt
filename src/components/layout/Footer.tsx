import { Settings, ArrowDownToLine } from "lucide-solid";

export function Footer() {
  return (
    <footer class="h-12 shrink-0 bg-surface-lowest flex items-center justify-between px-6 lg:px-10 xl:px-16 text-[0.65rem] font-bold tracking-wider uppercase z-10 relative border-t border-surface-low/50">
      <button class="flex items-center gap-2 text-on-surface-muted hover:text-white transition-colors">
        <Settings size={14} /> AJUSTES
      </button>

      <button class="flex items-center gap-2 text-primary hover:text-white transition-colors">
        <ArrowDownToLine size={14} /> ACTUALIZACIÓN DISPONIBLE
      </button>
    </footer>
  );
}
