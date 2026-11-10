import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const fieldClass =
  "w-full rounded-2xl border border-border bg-surface px-4 py-3 text-base text-surface-foreground " +
  "placeholder:text-muted-foreground transition-colors focus-visible:border-ring disabled:opacity-60";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldClass, "min-h-12", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(fieldClass, "resize-none", className)} {...props} />;
}
