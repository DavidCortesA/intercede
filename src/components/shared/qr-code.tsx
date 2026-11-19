"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface Matrix {
  size: number;
  data: number[];
}

/** Zona en blanco alrededor del código (el estándar pide 4 módulos para que las cámaras lo lean bien). */
const QUIET = 4;

/**
 * Código QR de un texto, dibujado como SVG (no se inserta HTML: solo un `<path>` calculado aquí). La librería se carga
 * solo cuando hace falta y el código se genera en el navegador: el enlace nunca sale a un servicio externo.
 * Siempre sobre fondo blanco, aunque la pantalla sea oscura (con fondo oscuro muchos lectores no lo leen).
 */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const [matrix, setMatrix] = useState<Matrix | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("qrcode").then((module) => {
      if (cancelled) return;
      const qr = (module.default ?? module).create(value, { errorCorrectionLevel: "M" });
      setMatrix({ size: qr.modules.size, data: Array.from(qr.modules.data) });
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (!matrix) return <div className={cn("aspect-square rounded-xl bg-white", className)} aria-hidden="true" />;

  const total = matrix.size + QUIET * 2;
  let path = "";
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (matrix.data[y * matrix.size + x]) path += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
    }
  }

  return (
    <svg viewBox={`0 0 ${total} ${total}`} role="img" aria-label={label} className={cn("aspect-square rounded-xl bg-white", className)} shapeRendering="crispEdges">
      <path d={path} fill="#0a1240" />
    </svg>
  );
}
