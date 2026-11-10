# Changelog

Todos los cambios relevantes de INTERCEDE se documentan aquí.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y versionado semántico.
Cada fase del plan se publica con su tag (ver `docs/decisions/0004-versionado-changelog-y-tags.md`).

## [Sin publicar]

### Añadido
- Logo oficial en `public/brand/` (`logo.svg`, `logo-white.svg`, `logo-mark.svg`, `logo-mark-white.svg`).
- `npm run icons`: genera favicons (32/48), íconos PWA (192/512/maskable) y apple-touch-icon desde el
  símbolo oficial sobre el degradado de marca.

### Cambiado
- El wordmark de texto se reemplazó por el logo oficial en el encabezado, el pie, `/orar` y la imagen
  Open Graph; el JSON-LD de la organización incluye su logo.
- Favicon e íconos de la PWA ahora salen del logo oficial (antes eran placeholders).

## [0.2.0] - 2026-11-10 — Fase 1: Landing

### Añadido
- Landing pública estática (SSG) en `/es` con las 8 secciones del CLAUDE.md §5.5: héroe con CTA doble
  ("Orar ahora" e "Instalar la app"), el problema y la solución, cómo funciona en 3 pasos, funciones
  (bento), iglesias y ministerios, privacidad y confianza, preguntas frecuentes y pie.
- Dirección de arte propia: paisaje de montaña con cruz en SVG, ilustración de una sala de oración,
  numerales escalonados, bento asimétrico y animaciones CSS (entrada y scroll reveal) sin JavaScript.
- `InstallButton`: instalación nativa donde el navegador la ofrece y guía por plataforma (iOS Safari
  "Añadir a pantalla de inicio", Android, escritorio, Safari en Mac).
- CTA fija en móvil que aparece al pasar el héroe.
- SEO: título y descripción únicos por página, canonical, Open Graph y Twitter con imagen generada,
  JSON-LD (Organization, WebSite, SoftwareApplication, FAQPage), `sitemap.xml`, `robots.txt`.
- Páginas `/privacidad` y `/terminos` (borrador pendiente de revisión legal), 404 de marca para rutas
  inexistentes y página provisional `/orar` (`noindex`) a la que apunta el CTA hasta la Fase 3.
- Componente `Button` (variantes primaria, secundaria y clara) y token `bg-brand-dusk`.
- Pruebas e2e de la landing, SEO y accesibilidad con axe (WCAG 2.1 AA en modo claro y oscuro).
- ADR 0005 con las decisiones de la fase.

### Medido
- Lighthouse (build de producción): móvil 95 / 100 / 100 / 100 y escritorio 100 / 100 / 100 / 100
  (rendimiento, accesibilidad, buenas prácticas, SEO).

### Pendiente
- Logo oficial en `public/brand/`; el wordmark y el favicon siguen siendo placeholders.
- Correo de contacto real (`NEXT_PUBLIC_CONTACT_EMAIL`) para mostrarlo en el pie.
- Revisión legal de privacidad y términos; analítica y aviso de cookies se deciden en la Fase 8.

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
