import { type JSX, splitProps } from "solid-js";

interface TextInputProps extends JSX.InputHTMLAttributes<HTMLInputElement> {}

export function TextInput(props: TextInputProps) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <input
      class={`w-full bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4 text-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors shadow-inner ${local.class || ""}`}
      {...others}
    />
  );
}
