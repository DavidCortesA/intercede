import { cn } from "@/lib/utils";

/**
 * PLACEHOLDER temporal del logo: solo texto. Reemplazar por los archivos oficiales de
 * `public/brand/` cuando el propietario los entregue (no se redibuja ni se aproxima el logo).
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-heading text-xl font-extrabold tracking-[0.04em]", className)}>INTERCEDE</span>
  );
}
