import { type JSX, splitProps } from "solid-js";

interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "md" | "lg";
}

export function Button(props: ButtonProps) {
  const [local, others] = splitProps(props, [
    "variant",
    "size",
    "class",
    "children",
  ]);

  const baseStyles =
    "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-zinc-950 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]";

  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-500 focus:ring-blue-600",
    secondary:
      "bg-zinc-800 text-zinc-200 hover:bg-zinc-700 focus:ring-zinc-700",
    danger: "bg-red-600/10 text-red-500 hover:bg-red-600/20 focus:ring-red-600",
    ghost:
      "bg-transparent text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 focus:ring-zinc-800",
  };

  const sizes = {
    md: "px-4 py-2 text-sm",
    lg: "px-6 py-4 text-base",
  };

  return (
    <button
      class={`${baseStyles} ${variants[local.variant || "primary"]} ${sizes[local.size || "md"]} ${local.class || ""}`}
      {...others}
    >
      {local.children}
    </button>
  );
}
