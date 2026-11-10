# Changelog

Todos los cambios relevantes de INTERCEDE se documentan aquí.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y versionado semántico.
Cada fase del plan se publica con su tag (ver `docs/decisions/0004-versionado-changelog-y-tags.md`).

## [Sin publicar]

## [0.1.0] - 2026-11-10 — Fase 0: Fundación

### Añadido
- Proyecto Next.js 16.4.6 (App Router, Turbopack), React 19.3, TypeScript 5.9 en modo estricto
  (`noUncheckedIndexedAccess`), Tailwind CSS 4.3 y ESLint (sin `any`, imports de tipos).
- Tokens de diseño de marca en `src/app/globals.css`: paleta violeta/azul/cian/dorado/crema/navy con
  escalas en OKLCH, tokens semánticos (`background`, `primary`, `surface`, `answered`, …), modo claro
  y oscuro, degradado de marca y reglas de accesibilidad (foco visible, `prefers-reduced-motion`).
- Tipografía con `next/font`: Plus Jakarta Sans (títulos) e Inter (cuerpo).
- Internacionalización con `next-intl`: rutas `/[locale]`, español como idioma base, claves tipadas,
  `src/proxy.ts` (nombre de `middleware` en Next 16).
- PWA instalable: `app/manifest.ts`, service worker con `@serwist/turbopack` (solo estáticos y página
  offline, sin HTML ni API en caché), página `/es/offline`, íconos placeholder (192, 512, maskable, Apple).
- Pruebas: Vitest (contraste AA de la paleta) y Playwright (humo, manifest, service worker, fallback offline)
  en móvil y escritorio.
- CI en GitHub Actions: typecheck, lint, pruebas unitarias, build y e2e.
- Cabeceras de seguridad básicas y `.env.example` documentado.
- Decisiones de arquitectura en `docs/decisions/` (0001–0004), `CLAUDE.md` del proyecto y referencia
  visual de pantallas en `docs/design/`.

### Cambiado
- Se desactivaron `cacheComponents` y `partialPrefetching` que traía el scaffold (ver ADR 0002).

### Pendiente
- Logo oficial en `public/brand/` (hasta entonces: texto "INTERCEDE" e íconos placeholder).
- Activar *Anonymous Sign-ins* en Supabase (Fase 2).
