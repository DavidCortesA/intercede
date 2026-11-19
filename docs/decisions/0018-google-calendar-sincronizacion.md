# 0018 — Sincronización con Google Calendar (Fase 11, C6 nivel 2)

- Estado: aceptada (2026-11-21), **pendiente de configurar Google Cloud** (ver `docs/operaciones/google-calendar.md`)
- Alcance: CLAUDE.md §16.3 **C6 nivel 2**. **Decisión del propietario: permiso mínimo, calendario propio de INTERCEDE.**

## Decisión: el permiso más acotado
Se pide **solo** `https://www.googleapis.com/auth/calendar.app.created`: INTERCEDE crea un calendario secundario llamado **"INTERCEDE"** en la cuenta de la persona y solo puede leer y escribir **ahí**. No puede ver el calendario principal ni ningún otro (§16.3: "no se lee ningún otro calendario"). Contras asumidos: los eventos viven en un calendario aparte (la persona lo ve junto a los demás en Google Calendar), y el permiso sigue siendo "sensible" para Google, por lo que **publicar la app para cualquier persona puede requerir verificación en Google Cloud**; mientras tanto funciona en modo de pruebas con usuarios de prueba.

## Flujo de autorización APARTE del inicio de sesión
- El inicio de sesión con Google sigue con permisos mínimos (correo y perfil). Conectar el calendario es otro flujo propio (`/api/calendar/google/connect` → `…/callback`), porque Supabase Auth no conserva el token de actualización del proveedor y los permisos de calendario son sensibles.
- Se pide con `access_type=offline` y `prompt=consent` (Google solo entrega el token de actualización así) y `include_granted_scopes=false`.
- El `state` aleatorio viaja también en una cookie **httpOnly** (`gcal_state`, solo para `/api/calendar`) y se compara en tiempo constante: el regreso solo vale para quien lo inició (CSRF).
- Al volver se comprueba que Google concedió **exactamente** el permiso acotado y que entregó token de actualización; si no, se **revoca** y se rechaza. Solo cuentas permanentes (los invitados usan el nivel 1, el botón "Agregar a Google Calendar").

## Token guardado cifrado, atado a la persona
- AES-256-GCM en el servidor (`src/lib/crypto/secret-box.ts`), formato `v1.iv.tag.datos`, llave en `CALENDAR_ENCRYPTION_KEY` (32 bytes en base64, solo servidor). El **id de la persona va como dato autenticado (AAD)**: copiar el texto cifrado de una fila a otra no sirve.
- La columna del token **no es seleccionable** por la persona (permiso de columna); solo la lee el servidor con la service role. Sin Supabase Vault porque el cifrado con llave de entorno evita sumar otra dependencia y mantiene la llave fuera de la base.
- **Rotar o perder la llave deja las conexiones existentes ilegibles**: sus trabajos se reintentan y se descartan a los 6 intentos, sin aviso automático a la persona; habría que pedirles volver a conectar (Desconectar y Conectar). Por eso la llave se guarda con cuidado y no se rota a la ligera.

## Un solo sentido: INTERCEDE → Google
- Se sincronizan: **asistencia confirmada** a eventos (`going`/`maybe`) y **salas programadas que la persona sigue**. Cada evento lleva el enlace a la sala/evento y un recordatorio de 10 minutos. Los turnos de cadena (B1) se sumarán cuando exista B1.
- La persona elige en el perfil si sincroniza eventos, salas programadas o ambos.
- Salas programadas recurrentes: un solo evento con regla `RRULE` y hora de pared + zona horaria (el horario de verano no lo mueve).

## Cola de trabajos que reconcilia (idempotente)
- Disparadores de base de datos (RSVP, evento, suscripción, sala programada) solo **encolan** un trabajo por (persona, origen). `pg_cron` llama cada minuto a `/api/calendar/sync` (pg_net + secreto de Vault `calendar_sync_secret`, igual que el resto).
- Cada trabajo **compara lo que debe existir con lo que hay** (no aplica "diferencias"), así que repetirlo es seguro. Si un intento anterior creó el evento sin confirmar, se encuentra por la propiedad privada `intercede=<tipo>:<id>` y no se duplica.
- Reintentos con espera creciente (30 s → 1 h) para fallos pasajeros y límites de uso; a los 6 intentos se descarta. Un error que reintentar no arregla se descarta sin bloquear la cola.

## Casos de la persona
- **Borra un evento en Google**: queda `user_deleted` y **no se vuelve a crear** mientras siga debiendo existir. Si lo que borró es el **calendario** completo (el 404 se distingue consultando el calendario), se recrea una vez.
- **Revoca el permiso** (o Google lo rechaza): la conexión pasa a `disconnected`, se descarta su cola y se le avisa (notificación `calendar_disconnected`); puede volver a conectar desde el perfil.
- **Desconectar**: revoca el token en Google y **borra** conexión, vínculos y cola. Los eventos ya creados quedan en el calendario "INTERCEDE" (se avisa; puede borrarlo desde Google). Lo mismo al **eliminar la cuenta**.

## Datos
`calendar_connections` (token cifrado, estado, preferencias), `calendar_event_links` (origen ↔ evento de Google, `active|user_deleted`), `calendar_sync_jobs` (cola). RLS: la persona ve solo su conexión (sin el token); vínculos y cola, solo servidor. Funciones sin permiso para `public/anon/authenticated`; auditoría `security_audit()` sin hallazgos (solo las tres vistas previas públicas).

## Qué se probó y qué NO
- **Probado** (Google simulado con un `fetch` falso): crear, actualizar, borrar, idempotencia, evento borrado a mano que no reaparece, calendario borrado, permiso revocado, reintentos, desconexión, cifrado atado a la persona, RLS del token, y la pantalla del perfil en e2e.
- **NO probado contra Google real**: aún no hay un cliente OAuth con este permiso. Hay que hacer una prueba real con una cuenta de prueba al configurar Google Cloud (ver la guía de operación).

## Fuera de alcance
- Sincronización de vuelta (Google → INTERCEDE) y lectura de otros calendarios (no, por diseño). Turnos de cadena hasta que exista B1.
