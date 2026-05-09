import { type JSX, splitProps } from "solid-js";

interface IButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "gradient" | "surface" | "danger" | "icon";
}

export function Button(props: IButtonProps) {
  const [local, others] = splitProps(props, ["variant", "class", "children"]);

  const base =
    "transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center";

  const variants = {
    gradient:
      "bg-gradient-to-br from-primary to-primary-dim text-white rounded-xl py-3 px-3 shadow-[0_5px_20px_rgba(100,94,251,0.15)] group gap-2",
    surface:
      "bg-surface-highest hover:bg-surface-bright text-white text-[0.65rem] font-bold tracking-wider px-3 py-1.5 rounded-lg gap-1.5",
    danger:
      "bg-surface-highest hover:bg-red-500/10 text-white hover:text-red-400 text-[0.65rem] font-bold tracking-wider px-3 py-1.5 rounded-lg gap-1.5",
    icon: "w-9 h-9 rounded-full bg-surface-highest text-on-surface-muted hover:bg-surface-bright hover:text-white shrink-0",
  };

  return (
    <button
      class={`${base} ${variants[local.variant || "surface"]} ${local.class || ""}`}
      {...others}
    >
      {local.children}
    </button>
  );
}
