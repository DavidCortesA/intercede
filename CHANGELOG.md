# Changelog

Todos los cambios relevantes de INTERCEDE se documentan aquí.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y versionado semántico.
Cada fase del plan se publica con su tag (ver `docs/decisions/0004-versionado-changelog-y-tags.md`).

## [Sin publicar]

## [0.7.0] - 2026-11-10 — Fase 6: Devocionales, programación y avisos

### Añadido
- **Devocional del día** (solo cuentas): pasaje, reflexión, pregunta y oración sugerida; marcar como leído, notas
  privadas y **racha suave** (sin gamificación; hoy sin leer no la rompe). "Hoy" según la zona horaria del perfil.
  **Sin contenido de fábrica** (decisión de la propietaria/el propietario): importador `npm run devotionals:import`
  con archivo JSON validado con Zod (`docs/operaciones/devocionales.md`).
- **Salas programadas** (una vez, a diario o cada semana) con zona horaria correcta y horario de verano:
  crear, pausar, reanudar y eliminar; **enlace de invitación revocable** (`/p/<token>`) para que otras cuentas las
  sigan. A la hora, **se abre la sala sola** y se avisa a quienes la siguen; la anfitriona entra con su rol.
- **Avisos** (`/avisos`): preferencias (push, correo, salas programadas, recordatorio del devocional con hora),
  activar/desactivar el dispositivo (el permiso se pide solo al tocar el botón; en iOS se explica la instalación) y
  lista de avisos recientes. Registro de dispositivos por `/api/push/subscribe`.
- **Envío**: cola `notifications` + pg_cron cada minuto + **Edge Function `dispatch-notifications`** (Web Push con VAPID
  y correo con Resend si hay remitente). Reintentos para fallos temporales, caducidad a la hora y baja automática de
  dispositivos que ya no existen. Service worker con `push` y `notificationclick`.
- Pestaña **Devocional** en la navegación de las cuentas; enlaces a *Avisos* desde Perfil y a *Programadas* desde Salas.
- Base de datos: `devotionals`, `devotional_progress`, `notification_preferences`, `push_subscriptions`,
  `notifications`, `room_schedules`, `schedule_invites`, `schedule_subscriptions`, `rooms.schedule_id/scheduled_at`, y las
  funciones `devotional_stats`, `create_schedule`, `process_scheduled_work`, `claim_notifications`… (todo con RLS).
- Pruebas: 34 de base de datos (RLS, recurrencia y DST, apertura de salas, cola, SSRF), 29 unitarias (lógica de envío con
  dobles, importador, validaciones) y 15 e2e (devocional, invitación y sala programada de punta a punta, preferencias,
  dispositivo con `PushManager` simulado, push real entregado al service worker por CDP).
- Documentación: ADR 0010, `docs/operaciones/avisos.md`, `docs/operaciones/devocionales.md`,
  `docs/testing/avisos-dispositivos-reales.md`.

### Seguridad
- Los endpoints push solo pueden ser de los servicios de los navegadores (restricción en la base, no solo en la ruta):
  el envío no sirve de pasarela hacia servidores internos (SSRF).
- La función de envío falla cerrada: sin `DISPATCH_SECRET` no responde a nadie; el secreto se compara en tiempo constante.

### Cambiado
- Los avisos de error usan un tinte más claro para cumplir el contraste AA sobre el fondo crema.
- El CI usa una clave pública VAPID de prueba en el build y levanta `pg_cron`/`pg_net` del Supabase local.

### Pendiente
- **Desplegar la función y los secretos en el remoto** y crear los secretos de Vault (`docs/operaciones/avisos.md`): hasta
  entonces los avisos se generan pero **no se envían**.
- Probar en teléfonos reales (Android e iOS instalada) y el correo real (requiere dominio verificado en Resend).
- Cargar el contenido de los devocionales (versión bíblica y licencia por decidir).

## [0.6.0] - 2026-11-10 — Fase 5: Cuentas y vida de oración

### Añadido
- **Cuentas:** crear cuenta con correo y contraseña, entrar, salir y recuperar la contraseña con un enlace
  del correo. Un **invitado se convierte en cuenta conservando su historial** (mismo usuario). Botón
  "Continuar con Google" (con `NEXT_PUBLIC_GOOGLE_AUTH=1`), también para vincular Google a un invitado.
- Correos en español (confirmación, recuperación, cambio de correo) y rutas `/auth/confirm` y
  `/auth/callback` con protección contra redirecciones abiertas.
- **Perfil:** nombre, zona horaria, foto (recortada y guardada en Storage), correo y cambio de contraseña.
  La foto se ve en las salas.
- **Mis salas:** historial de las salas en las que has orado, con "volver a entrar".
- **Diario de oración** privado (solo cuentas): categorías, en oración / respondida con testimonio, editar,
  eliminar, filtros y guardar en el diario una petición de una sala.
- **"Estoy orando por esto"** con contador en vivo en las peticiones ajenas; quien escribió la petición ve
  cuántas personas oran por ella.
- Navegación progresiva: invitado = Orar y Perfil; con cuenta, también Diario y Salas. Enlaces "Entrar" en
  la landing y en `/orar`.
- Base de datos: `prayer_journal_entries`, `prayer_support`, bucket `avatars`, `room_members.avatar_url`,
  `is_permanent_user()` y las reglas de seguridad de cada una (RLS). `enable_manual_linking`.
- Pruebas: 16 de base de datos, unitarias de Auth y 10 e2e con correo real (Mailpit) incluyendo axe.
- ADR 0009.

### Cambiado
- El CI levanta Mailpit y Storage en el Supabase local.

### Aplicado al proyecto remoto
- Migración `account_life` y `enable_manual_linking`. Verificado con usuarios de prueba que se borraron al
  terminar. Google ya estaba activo en el proyecto y redirige a `accounts.google.com`.

### Pendiente
- **SMTP propio para el correo del proyecto remoto** (p. ej. Resend con dominio verificado): el plan gratuito
  con el SMTP por defecto no permite plantillas propias ni enviar a cualquier dirección; hasta entonces el
  registro por correo en producción no es viable (ver ADR 0009).
- Probar el inicio de sesión completo con Google (requiere consentimiento interactivo).
- Eliminar cuenta y datos (Fase 8).

## [0.5.0] - 2026-11-10 — Fase 4: Audio con LiveKit

### Añadido
- **Audio en vivo** en la sala con LiveKit: "Orar con micrófono" o "Solo escuchar". El micrófono no se
  pide al cargar la página ni en modo oyente; solo al decidir hablar.
- **Orador activo** (anillo pulsante y "Está orando"), insignias de micrófono por persona y silenciar o
  activar el propio micrófono. Audio optimizado para voz.
- **Controles del anfitrión:** silenciar a una persona, silenciar a todos, sacar de la sala (con
  confirmación y sin poder volver) y cerrar la sala cortando el audio de todos.
- **Servidor:** `POST /api/livekit/token` (valida sesión y membresía con RLS; token de 2 h, solo escuchar y
  publicar micrófono) y `POST /api/livekit/host` (acciones del anfitrión con la API de LiveKit). Defensa
  CSRF, reintento ante fallos pasajeros y sin caché.
- **Reconexión:** reintenta con un token nuevo si LiveKit se rinde; contempla audio bloqueado por el
  navegador, entrada desde otro dispositivo, sala cerrada y expulsión.
- **Wake Lock:** la pantalla se mantiene encendida durante la sala.
- Errores claros del micrófono: permiso denegado, sin micrófono, en uso; la sala sigue funcionando.
- Migración `remove_member`: `room_members.removed_at`, RPC `remove_member` y bloqueo del reingreso.
- Pruebas: 17 de las rutas (token y anfitrión), `remove_member` en la base, Wake Lock y e2e de audio real
  contra LiveKit Cloud con micrófonos simulados (se saltan sin credenciales); axe con el audio conectado.
- ADR 0008 y lista de verificación para dispositivos reales (`docs/testing/audio-dispositivos-reales.md`).

### Cambiado
- Cerrar la sala pasa por el servidor para desconectar a todas las personas del audio.
- El CI pasa los secretos `LIVEKIT_*` al e2e (opcional); `test:db` espera a que Auth esté listo tras reiniciarlo.

### Aplicado al proyecto remoto
- Migración `remove_member`, verificada con invitados de prueba que se borraron al terminar.

### Pendiente
- **Probar en iPhone/iPad y Android reales** (lista en `docs/testing/`): bloqueo de pantalla, segundo plano,
  cambio de red y permisos de Safari no se pueden verificar en automático.
- Cámara (opcional en el CLAUDE.md) y límite de tasa en `/api/livekit/*` (Fase 8).

## [0.4.0] - 2026-11-10 — Fase 3: Salas y peticiones (sin audio)

### Añadido
- **Orar sin cuenta:** "Orar ahora" lleva a `/orar`, donde un nombre y un toque crean la sala y llevan a
  `/r/<código>`. Para quien ya tiene un código o un enlace, un campo lo normaliza y lleva a la sala.
- **Salas** (`/r/<código>`): vista previa para unirse con solo un nombre; sala en pantalla completa con
  participantes, código, compartir enlace (hoja nativa o copiar), salir y estados claros (enlace inválido,
  sala cerrada, bloqueada o llena).
- **Peticiones en vivo** con Supabase Realtime: publicar (1–500 caracteres), marcar como respondida con
  testimonio, quitar la marca y eliminar; las ven al instante quienes están en la sala.
- **Controles del anfitrión:** bloquear/desbloquear la sala y cerrarla para todos.
- Base de datos: tablas `rooms`, `room_members` y `prayer_requests` con RLS, RPC de ciclo de vida
  (`create_room`, `join_room`, `leave_room`, `close_room`, `set_room_locked`, `peek_room`), aforo de 20,
  límites anti-spam y publicación en Realtime. Tipos regenerados.
- Aviso de sin conexión y reconexión; relectura automática al volver la red o la pestaña.
- Pruebas: 24 de RPC/RLS/Realtime, e2e de tres personas con navegadores reales y accesibilidad (axe) de
  la sala. `npm run test:e2e:db`; el CI levanta Supabase local para el build y el e2e.
- ADR 0007.

### Cambiado
- `/orar` ya no es provisional: crea salas de verdad. Las salas no se indexan (`noindex` y `robots.txt`).
- El job `db` del CI incluye Realtime.

### Aplicado al proyecto remoto
- Migración `rooms_and_prayer_requests`. Verificada con invitados de prueba (crear, unirse, publicar y
  recibir en vivo, aislamiento entre salas, cierre) que se borraron al terminar.

### Pendiente
- Rate limit contra fuerza bruta de códigos de sala (Fase 8). Audio, silenciar y expulsar: Fase 4.

## [0.3.0] - 2026-11-10 — Fase 2: Supabase base

### Añadido
- Proyecto Supabase con CLI (`supabase/`): `config.toml` alineado con el proyecto remoto, migraciones y
  `seed.sql`. Scripts `db:types`, `db:reset` y `test:db`.
- Migración `create_profiles`: tabla `profiles` con RLS, trigger de alta automática (invitados y cuentas),
  privilegios mínimos por columna, validación de nombre, idioma y zona horaria, y `updated_at`.
- Invitados con Anonymous Sign-ins: acción `signInAsGuest` (solo un nombre, sin cuenta) y consulta
  `getCurrentSession` (`src/features/auth/`).
- Clientes de Supabase para navegador, servidor y proxy (`src/lib/supabase/`) con `@supabase/ssr`;
  refresco de sesión en `src/proxy.ts` solo cuando ya hay sesión.
- Variables públicas de Supabase validadas con Zod (`src/lib/env.ts`).
- Tipos generados de la base (`src/types/database.ts`).
- Pruebas de integración contra Supabase local: RLS de `profiles` (A nunca accede a datos de B), acción de
  invitado y refresco de sesión; 23 pruebas.
- Job `db` en el CI (migraciones, tipos al día y RLS).
- ADR 0006 con las decisiones y los pendientes de seguridad.

### Aplicado al proyecto remoto
- Migración `create_profiles` y ajustes de Auth: Anonymous sign-ins activado, redirección a
  `http://localhost:3000/**` y contraseña mínima de 8. Verificado con invitados de prueba.

### Marca
- Logo oficial en `public/brand/` (`logo.svg`, `logo-white.svg`, `logo-mark.svg`, `logo-mark-white.svg`).
- `npm run icons`: genera favicons (32/48), íconos PWA (192/512/maskable) y apple-touch-icon desde el
  símbolo oficial sobre el degradado de marca.
- El wordmark de texto se reemplazó por el logo oficial en el encabezado, el pie, `/orar` y la imagen
  Open Graph; el JSON-LD de la organización incluye su logo. Favicon e íconos de la PWA dejaron de ser
  placeholders.

### Pendiente
- CAPTCHA en las entradas anónimas antes de producción (Fase 8).

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
