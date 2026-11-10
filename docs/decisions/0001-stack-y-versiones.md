# 0001 — Stack y versiones de la Fase 0

- Estado: aceptada (2026-11-10)

## Contexto
El CLAUDE.md define el stack. Había que fijar versiones concretas verificadas en npm el 2026-11-10.

## Decisión
- Next.js 16.4.6 (App Router, Turbopack), React 19.3, Tailwind CSS 4.3, Node ≥ 22 (desarrollo en 24).
- **TypeScript 5.9.x, no 7.x**: `typescript-eslint` declara `typescript <6.1`, así que TS 7 rompería el lint.
- `@types/node` 24: Vitest 5 exige `^22 || >=24`; el scaffold traía la 20.
- Dependencias de la Fase 0 y por qué:
  - `next-intl`: i18n con tipado de claves; recomendado por la propia guía de Next.
  - `zustand`, `@tanstack/react-query`, `zod`, `react-hook-form` + `@hookform/resolvers`: pila de estado, datos y validación definida en el CLAUDE.md (aún sin uso hasta la Fase 2).
  - `lucide-react`, `motion`, `clsx`, `tailwind-merge`, `class-variance-authority`: base de shadcn/ui y animación sutil.
  - `serwist`, `@serwist/turbopack`, `esbuild`: service worker (ver 0003).
  - Dev: `vitest`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/*`, `@playwright/test`, `sharp` (solo para los íconos placeholder).
- Supabase, LiveKit y `web-push` **no** se instalan todavía: entran en las fases 2, 4 y 6.
- shadcn/ui: se usará la CLI componente a componente cuando haga falta (Fase 1+). `cn()` ya existe en `src/lib/utils.ts`.

## Consecuencias
Las versiones se fijan con `package-lock.json`. Subir TypeScript a 6.1+/7 requiere esperar soporte de `typescript-eslint`.
