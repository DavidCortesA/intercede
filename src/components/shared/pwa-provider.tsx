"use client";

import { SerwistProvider } from "@serwist/turbopack/react";
import type { ReactNode } from "react";

/**
 * Registra el service worker (solo en producción).
 *  - reloadOnOnline=false: el valor por defecto recarga la página al volver la red, lo que
 *    sacaría a la persona de una sala de oración en curso.
 *  - cacheOnNavigation=false: el valor por defecto envía cada URL visitada al worker para
 *    cachearla; no queremos guardar páginas (pueden contener datos de la sesión).
 */
export function PwaProvider({ children }: { children: ReactNode }) {
  return (
    <SerwistProvider
      swUrl="/serwist/sw.js"
      disable={process.env.NODE_ENV === "development"}
      reloadOnOnline={false}
      cacheOnNavigation={false}
    >
      {children}
    </SerwistProvider>
  );
}
