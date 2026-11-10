"use client";

import { useEffect } from "react";

/**
 * Mantiene la pantalla encendida mientras `enabled` (Wake Lock API). El navegador libera el
 * bloqueo al ocultar la pestaña, así que se vuelve a pedir al volver. Si el dispositivo no lo
 * soporta o lo niega (ahorro de batería), la sala sigue funcionando: es una mejora, no un requisito.
 */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const next = await navigator.wakeLock.request("screen");
        if (cancelled) {
          await next.release();
          return;
        }
        sentinel = next;
      } catch {
        // Denegado o sin soporte efectivo: se ignora
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible" && (!sentinel || sentinel.released)) void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => undefined);
      sentinel = null;
    };
  }, [enabled]);
}
