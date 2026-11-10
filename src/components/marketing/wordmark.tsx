import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Logo horizontal oficial (símbolo + wordmark). `white` para fondos oscuros o fotografías;
 * `color` para fondos claros. Archivos entregados por el propietario en `public/brand/`:
 * no se redibujan ni se modifican (CLAUDE.md §8.1).
 */
export function Wordmark({ variant = "white", className }: { variant?: "white" | "color"; className?: string }) {
  return (
    <Image
      src={variant === "white" ? "/brand/logo-white.svg" : "/brand/logo.svg"}
      alt="INTERCEDE"
      width={1204}
      height={218}
      // Ya es un SVG vectorial: el optimizador de imágenes de Next no aporta nada.
      unoptimized
      className={cn("h-8 w-auto", className)}
    />
  );
}
