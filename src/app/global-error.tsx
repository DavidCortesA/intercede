"use client";

import { useEffect } from "react";

/**
 * Último recurso: falla el propio diseño raíz (no hay proveedor de idioma ni estilos de la app). Texto fijo en
 * español y estilos mínimos en línea.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    // Se carga solo si hay un error: el SDK no pesa en la carga normal de las páginas
    void import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error));
  }, [error]);

  return (
    <html lang="es">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#0A1240", color: "#FBF5EA", margin: 0 }}>
        <main style={{ maxWidth: 420, margin: "0 auto", padding: "20vh 24px" }}>
          <h1 style={{ fontSize: 28 }}>Algo salió mal</h1>
          <p style={{ lineHeight: 1.6 }}>Recarga la página. Si estabas en una sala de oración, vuelve a entrar con el mismo enlace.</p>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- aquí no hay router: se recarga todo */}
          <a href="/" style={{ color: "#FBF5EA" }}>
            Ir al inicio
          </a>
        </main>
      </body>
    </html>
  );
}
