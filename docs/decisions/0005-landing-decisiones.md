# 0005 — Decisiones de la landing (Fase 1)

- Estado: aceptada (2026-11-10)

## Decisiones
- **CTA "Orar ahora" → `/es/orar` provisional.** Las salas no existen hasta la Fase 3 y el CLAUDE.md prohíbe simular que algo funciona. La página avisa con honestidad que viene pronto y está en `noindex` y fuera del sitemap. En la Fase 3 el CTA crea la sala sin cuenta.
- **Estática y sin JS de terceros.** Toda la landing es SSG. Las animaciones (entrada, scroll reveal, CTA fija en móvil) son CSS puro (`animation-timeline`) con `prefers-reduced-motion` respetado; se decidió no cargar `motion` en la landing para proteger el rendimiento. El titular del héroe no se anima porque es el elemento LCP.
- **Instalación PWA:** `InstallButton` usa `beforeinstallprompt` donde existe (Chromium) y, si no, abre una guía por plataforma (iOS Safari, Android, escritorio, Safari en Mac). Se oculta si la app ya corre instalada.
- **Sin banner de cookies ni analítica por ahora.** La landing no instala cookies ni scripts de seguimiento, así que no hace falta banner. La analítica respetuosa (CLAUDE.md §3) se decide en la Fase 8; si implica cookies se añade el aviso en ese momento.
- **Legales como borrador.** `/privacidad` y `/terminos` recogen solo los principios del producto (CLAUDE.md §5.4: sin grabaciones, peticiones privadas, eliminación de datos) y llevan la etiqueta "Borrador". Requieren revisión legal antes del lanzamiento.
- **Contacto:** el enlace del pie solo aparece si se define `NEXT_PUBLIC_CONTACT_EMAIL`. No se inventan datos de contacto.
- **Logo, favicon e íconos son placeholders** hasta recibir los archivos oficiales en `public/brand/`. El wordmark es texto.
- **Open Graph:** imagen generada con `next/og` (texto sobre el degradado de marca). Se declara explícita en `pageMetadata()` porque Next no hereda la imagen del archivo de convención cuando la página define `openGraph`.
- **Ruta 404 propia:** `[locale]/[...rest]/page.tsx` llama a `notFound()` para que las rutas inexistentes muestren la 404 de marca.
- **Accesibilidad automatizada:** `@axe-core/playwright` audita WCAG 2.1 AA en claro y oscuro en todas las páginas públicas.

## Mediciones (Lighthouse 12, build de producción local)
Móvil: rendimiento 95, accesibilidad 100, buenas prácticas 100, SEO 100 (LCP 3.0 s simulado, CLS 0). Escritorio: 100 / 100 / 100 / 100.
