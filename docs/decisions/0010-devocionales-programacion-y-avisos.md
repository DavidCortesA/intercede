# 0010 — Devocionales, salas programadas y avisos (Fase 6)

- Estado: aceptada (2026-11-10)

## Devocionales (solo la estructura)
- Decisión de la propietaria/el propietario: **no se incluye texto bíblico ni devocionales de fábrica**. La versión y su
  licencia las decide quien carga el contenido (CLAUDE.md §5.2). Sin devocional del día, la pantalla lo dice y ofrece orar.
- Tabla `devotionals` (un devocional general por fecha; `community_id` ya existe sin llave foránea hasta la Fase 7, y
  tiene su propio índice único por comunidad y fecha). **Nadie los escribe desde el cliente**: se cargan con
  `npm run devotionals:import -- archivo.json` (service role; valida con Zod; ver `docs/operaciones/devocionales.md`).
  Lectura para cualquier sesión, solo hasta "mañana" (las zonas horarias) para no adelantar contenido.
- **"Hoy" lo decide la zona horaria del perfil**, no la del servidor (`todayIn`).
- Progreso y notas (`devotional_progress`) **privados y solo de cuentas**, aplicado por RLS. `read_at` se guarda una
  vez (un trigger evita moverlo al editar la nota). Las políticas solo dejan escribir `read_at` y `note`: por eso la
  pantalla actualiza y, si no hay fila, inserta (PostgREST `upsert` intentaría actualizar también la llave).
- **Racha suave** (`devotional_stats`): días seguidos con devocional leído, contados sobre los devocionales que existen
  (un día sin publicar no la rompe), y **hoy sin leer no la rompe**. Sin puntos, niveles ni insignias.

## Salas programadas
- `room_schedules` guarda la **hora de pared + zona horaria** (no un instante UTC): "6:00 a. m." sigue siendo las 6:00
  aunque cambie el horario de verano. `compute_next_occurrence` calcula la siguiente ocurrencia con
  `(fecha + hora) at time zone <zona>` y se prueba con Nueva York (cambio de marzo), Tokio y México.
  Frecuencias: una vez, a diario y cada semana (días 0 = domingo … 6).
- **Invitación por enlace revocable** (`/p/<token>`): el token vive en otra tabla (`schedule_invites`) que solo lee quien
  creó la programación; regenerarlo invalida el anterior. Seguir una sala exige cuenta. La vista previa
  (`peek_schedule`) enseña nombre y horario a quien tenga el enlace, sin sesión.
- Quien la creó queda suscrito y **no cuenta como "seguidor"**. Tope de 10 programaciones activas por persona.
- **`process_scheduled_work()`** (pg_cron, cada minuto; idempotente): recordatorios antes de cada ocurrencia, apertura
  de la sala a su hora, aviso con el enlace de la sala, avance de la programación, recordatorio del devocional y
  limpieza (salas vacías de más de 3 horas, avisos de más de 30 días). Detalles:
  - La sala se crea con `rooms.schedule_id` + `scheduled_at` (índice único: nunca dos salas para la misma ocurrencia).
  - La anfitriona figura en `room_members` con `left_at` ya puesto: así entra con `join_room` conservando el rol de anfitriona.
  - Si el sistema estuvo caído **más de 6 horas**, esa ocurrencia se omite (no se abre una sala a deshoras).
  - Cerrar la sala del día no cancela la programación.
  - Una sala "una vez" se desactiva tras abrirse.

## Avisos: cola en la base + Edge Function de envío
- `notifications` es una **cola** con `dedupe_key` único por persona (los reintentos de cron no duplican). Cada persona
  solo lee los suyos y solo puede cambiar `read_at`.
- pg_cron llama cada minuto a `invoke_dispatcher()` (pg_net), que **solo actúa si hay avisos pendientes y si existen los
  secretos de Vault** `dispatcher_url` y `dispatcher_secret` (seguro por defecto: sin ellos no hace nada).
- La **Edge Function `dispatch-notifications`** (`verify_jwt = false`) se autentica con un **secreto compartido** en el
  encabezado `x-dispatch-secret` (comparación en tiempo constante; sin secreto configurado no responde a nadie). Usa la
  service role solo para `claim_notifications` y `finish_notification`, que existen únicamente para ese rol.
- `claim_notifications` decide los canales **según preferencias y dispositivos** y marca `skipped` lo que no aplica.
  Usa `for update skip locked` (dos ejecuciones no envían lo mismo). Un fallo temporal (red, 429, 5xx) deja el canal en
  `pending` y se reintenta cada 2 minutos; **tras una hora sin enviarse el aviso caduca** (un recordatorio tardío confunde).
  404/410 del servicio push borran ese dispositivo. Un dispositivo alcanzado basta para dar el push por enviado.
- Toda la lógica de envío está en `dispatch.ts`, sin Deno ni librerías, con todo lo externo **inyectado**: se prueba en
  Vitest con dobles. `index.ts` solo conecta `web-push` (VAPID) y la API de Resend.
- **Correo**: usa Resend si hay `RESEND_API_KEY` **y** `RESEND_FROM` (un remitente de un dominio verificado); si no, el canal
  correo se marca `skipped`. Solo lleva el título, el texto del aviso y un enlace; nunca contenido de oraciones.
- **Seguridad del push (SSRF).** El envío hace una petición HTTP a cada `endpoint` guardado; si cualquiera pudiera guardar
  un URL arbitrario, el envío serviría de pasarela hacia servidores internos. Por eso la base **solo acepta endpoints de los
  servicios push de los navegadores** (`fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.push.apple.com`,
  `*.notify.windows.com`; y `*.test`, reservado y sin resolución en internet, para las pruebas) con una función usada en un
  `CHECK` de la tabla **y** en el RPC. La ruta `/api/push/subscribe` solo valida la forma y el origen; la regla vive en la base
  porque la API se puede llamar directo.
- Un mismo navegador puede pasar de una cuenta a otra: el `endpoint` es único y se reasigna. Tope de 10 dispositivos por cuenta.

## Service worker y permisos (CLAUDE.md §6)
- `push` siempre muestra una notificación (los navegadores lo exigen) y `notificationclick` solo abre **rutas de este sitio**.
  El service worker sigue sin cachear nada autenticado.
- El permiso del navegador se pide **al tocar "Activar avisos"**, nunca al cargar. En **iOS** se explica primero la
  instalación (Compartir → Añadir a pantalla de inicio): fuera de la app instalada no hay push.

## Qué se probó y qué no
- **Probado:** RLS y reglas de cada tabla (DB), recurrencia y horario de verano, apertura de salas y limpieza, cola de envío,
  lógica de envío con dobles (unitarias), **la Edge Function real en el runtime de Supabase local** (autenticación, cola vacía,
  y un envío real con VAPID y cifrado hacia FCM con un registro falso: FCM responde "no existe" y el dispositivo se borra),
  **el ciclo completo pg_cron → pg_net → función** (se vio pasar un aviso de `pending` a `failed` en ~55 s) y, en e2e, el
  devocional, el flujo de invitación y de sala programada de punta a punta, las preferencias, el registro de un dispositivo
  (con `PushManager` simulado) y la entrega de un push real al service worker (CDP) en el build de producción.
- **No probado:** el viaje FCM/APNs hasta un teléfono real, el correo real (requiere un dominio verificado en Resend) y el
  clic en la notificación. Ver `docs/testing/avisos-dispositivos-reales.md`.

## Cambios de paso
- Los avisos de error usan `bg-destructive/10` (antes `/15`): con el fondo crema el contraste bajaba de AA.
- La URL de invitación se calcula con `useSyncExternalStore` para no romper la hidratación (en el servidor no hay origen).
