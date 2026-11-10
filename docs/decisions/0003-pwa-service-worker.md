# 0003 — Service worker con @serwist/turbopack

- Estado: aceptada (2026-11-10)

## Contexto
`@serwist/next` está pensado para webpack y Next 16 compila con Turbopack. El CLAUDE.md pedía evaluar compatibilidad antes de instalar y, si no, un service worker propio.

## Decisión
Usar `@serwist/turbopack` 9.5.13 (misma versión que `serwist`): el worker vive en `src/app/sw.ts` y se compila con esbuild desde un Route Handler (`/serwist/sw.js`, con `Service-Worker-Allowed: /`). Se verificó con build de producción y pruebas e2e de Playwright (instalación, fallback offline).

Política de caché (CLAUDE.md §6):
- **No se usa `defaultCache` de Serwist**: cachea HTML, RSC y `/api/*`, lo que podría guardar respuestas autenticadas o tokens de LiveKit.
- Solo se cachean `/_next/static/*` (CacheFirst), `/icons` y `/brand` (stale-while-revalidate) y se precachea `/{locale}/offline`.
- Navegaciones y todo lo demás van a la red; si falla, se muestra la página offline.
- `PwaProvider` desactiva `reloadOnOnline` (recargar sacaría a la persona de una sala) y `cacheOnNavigation` (guardaría páginas).
- El worker no se registra en `npm run dev`.

## Consecuencias
Las pruebas de PWA requieren build de producción (`CI=1`). Los íconos actuales son placeholders (`scripts/generate-placeholder-icons.mjs`) hasta recibir los archivos de marca en `public/brand/`.
