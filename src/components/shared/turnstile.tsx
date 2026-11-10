"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";
import { CAPTCHA_ENABLED, TURNSTILE_SITE_KEY } from "@/lib/captcha";

interface TurnstileApi {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * Widget de Turnstile dentro de un formulario: en modo "solo si hace falta" (invisible para casi todas las
 * personas: orar sigue siendo cuestión de segundos). Agrega el campo `cf-turnstile-response` al formulario.
 * Cada token sirve una sola vez: `resetKey` cambia después de cada envío para pedir uno nuevo.
 * Si el CAPTCHA no está configurado, no renderiza nada ni carga el script.
 */
export function Turnstile({ resetKey }: { resetKey?: unknown }) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!CAPTCHA_ENABLED || !container.current) return;
    const element = container.current;

    function mount() {
      if (!window.turnstile || widgetId.current !== null) return;
      widgetId.current = window.turnstile.render(element, {
        sitekey: TURNSTILE_SITE_KEY,
        appearance: "interaction-only",
        "refresh-expired": "auto",
        language: "es",
      });
    }

    mount();
    window.addEventListener("turnstile-ready", mount);
    return () => {
      window.removeEventListener("turnstile-ready", mount);
      if (widgetId.current !== null) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, []);

  // Después de cada envío el token ya se gastó: se pide otro
  useEffect(() => {
    if (widgetId.current !== null) window.turnstile?.reset(widgetId.current);
  }, [resetKey]);

  if (!CAPTCHA_ENABLED) return null;
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => window.dispatchEvent(new Event("turnstile-ready"))}
      />
      <div ref={container} data-testid="turnstile" />
    </>
  );
}
