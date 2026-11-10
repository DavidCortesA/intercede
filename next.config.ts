import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Tailwind 4 se integra con Turbopack mediante este loader (viene del scaffold
  // de create-next-app 16.4.6). No hay postcss.config en el proyecto.
  turbopack: {
    // Fija la raíz del proyecto (hay un pnpm-lock.yaml suelto en la carpeta del usuario).
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Cache Components / Partial Prefetching vienen activados por el scaffold, pero
  // se desactivan en la Fase 0: <Activity> deja las rutas ocultas con sus efectos
  // pausados, lo cual complica Realtime y LiveKit. Ver docs/decisions/0002-*.md
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            // Micrófono: solo este origen. Cámara: solo este origen (opcional en sala).
            key: "Permissions-Policy",
            value: "microphone=(self), camera=(self), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default withNextIntl(withSerwist(nextConfig));
