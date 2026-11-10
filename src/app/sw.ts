/// <reference lib="webworker" />
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkOnly,
  type PrecacheEntry,
  Serwist,
  type SerwistGlobalConfig,
  StaleWhileRevalidate,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * Política de caché (CLAUDE.md §6): el service worker NO cachea respuestas autenticadas
 * ni tokens de LiveKit. Solo recursos estáticos y la página offline.
 *  - /_next/static/*  → inmutables con hash en el nombre (incluye fuentes de next/font).
 *  - íconos y marca públicos → stale-while-revalidate.
 *  - API, HTML, RSC y cualquier otra cosa → red, sin caché.
 */
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    {
      matcher: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({
        cacheName: "next-static",
        plugins: [new ExpirationPlugin({ maxEntries: 96, maxAgeSeconds: 30 * 24 * 60 * 60 })],
      }),
    },
    {
      matcher: ({ sameOrigin, url }) =>
        sameOrigin && (url.pathname.startsWith("/icons/") || url.pathname.startsWith("/brand/")),
      handler: new StaleWhileRevalidate({
        cacheName: "public-brand",
        plugins: [new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 30 * 24 * 60 * 60 })],
      }),
    },
    {
      // Navegaciones: siempre a la red. Se declara la ruta para que el fallback offline
      // (catch handler) se active cuando la red falla; no se guarda ninguna página.
      matcher: ({ request }) => request.mode === "navigate",
      handler: new NetworkOnly(),
    },
  ],
  fallbacks: {
    entries: [
      {
        // Idioma por defecto. Con más idiomas, resolver según el prefijo de la URL.
        url: "/es/offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();

/**
 * Avisos push. El mensaje lo arma la Edge Function de envío (title, body, url con idioma) y llega
 * cifrado de extremo a extremo; aquí solo se muestra. Siempre se muestra una notificación (los
 * navegadores exigen que cada push sea visible) y nada de esto toca cachés.
 */
interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}

self.addEventListener("push", (event) => {
  let payload: PushPayload = {};
  try {
    payload = (event.data?.json() ?? {}) as PushPayload;
  } catch {
    payload = { body: event.data?.text() };
  }
  const title = payload.title ?? "INTERCEDE";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body ?? "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: payload.tag,
      data: { url: payload.url ?? "/es" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data as { url?: string } | undefined;
  // Solo rutas de este sitio: un push no puede llevar a otro dominio
  const target = new URL(data?.url ?? "/es", self.location.origin);
  if (target.origin !== self.location.origin) return;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === target.origin && "focus" in client) {
          await client.focus();
          if ("navigate" in client) await (client as WindowClient).navigate(target.href);
          return;
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
