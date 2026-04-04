import { Link, ClipboardPaste } from "lucide-solid";

interface UrlInputProps {
  value: string;
  onInput: (value: string) => void;
  onPasteClick: () => void;
}

export function UrlInput(props: UrlInputProps) {
  return (
    <div class="relative flex items-center w-full">
      <div class="absolute left-4 text-on-surface-muted">
        <Link size={18} strokeWidth={2} />
      </div>
      <input
        type="url"
        placeholder="Pega el enlace del video aquí..."
        class="w-full bg-surface-low ghost-border rounded-xl py-3.5 pl-12 pr-40 text-base text-on-surface placeholder:text-on-surface-muted focus:outline-none focus:border-primary/50 focus:bg-surface-high transition-all duration-200 shadow-[0_10px_30px_rgba(0,0,0,0.15)]"
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
      />
      <button
        onClick={props.onPasteClick}
        class="absolute right-2 flex items-center gap-2 bg-surface-highest hover:bg-surface-bright text-primary px-3 py-2 rounded-lg text-sm font-semibold transition-colors duration-200"
      >
        <ClipboardPaste size={16} />
        <span>Pegar Enlace</span>
      </button>
    </div>
  );
}
