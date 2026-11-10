# 0007 — Salas, peticiones en vivo y Realtime (Fase 3)

- Estado: aceptada (2026-11-10)

## Modelo de datos (migración `20261110170000_rooms_and_prayer_requests.sql`)
- `rooms` (código de 6 caracteres sin ambiguos, anfitrión, estado `open|closed`, `is_locked`), `room_members` (rol, nombre visible, `left_at` nulo = presente) y `prayer_requests` (contenido 1–500, respondida, testimonio).
- **Nadie escribe `rooms` ni `room_members` directamente.** Todo pasa por RPC `SECURITY DEFINER` con `search_path = ''`: `create_room`, `join_room`, `leave_room`, `close_room`, `set_room_locked` y `peek_room`. Validan sesión, estado, aforo (20, serializado con `FOR UPDATE`), límite de 5 salas abiertas por anfitrión y rol. Los errores de negocio son mensajes-código estables (`room_full`, `room_locked`, …) que la app traduce.
- **El código de la sala es la llave:** no hay forma de listar salas. `peek_room` (también para `anon`) devuelve solo nombre, estado y cuántas personas hay, para la pantalla de unirse; no expone al anfitrión.
- **RLS con funciones auxiliares** (`is_room_member`, `has_joined_room`, `is_room_host`, `is_room_open`, todas `SECURITY DEFINER`) para evitar la recursión entre `rooms` y `room_members`:
  - Quien está ahora en la sala lee miembros y peticiones; quien participó alguna vez conserva el acceso a la fila de la sala (historial, Fase 5) pero deja de ver lo nuevo al salir.
  - Peticiones: publica quien está presente y la sala está abierta (`author_id` sale de `auth.uid()` por defecto, no se puede falsear); edita solo el autor; borra el autor o el anfitrión.
  - Se separa de la regla del CLAUDE.md §7 ("solo el autor o el anfitrión edita/borra"): **el anfitrión modera borrando, no reescribe lo que otra persona dijo.**
  - Freno anti-spam: 20 peticiones por persona y sala (trigger).
- **El nombre visible vive en `room_members.display_name`** (cada sala puede usar otro nombre), así que `profiles` sigue siendo privado y no hace falta una política de lectura entre personas.
- Se difirieron a su fase: `community_id`/`scheduled_at` en `rooms` (Fases 6–7), `visibility` y "estoy orando por esto" (Fase 5), silenciar y expulsar (Fase 4, necesitan LiveKit).
- Las salas se borran en cascada al eliminar la cuenta del anfitrión.

## Realtime
- `rooms`, `room_members` y `prayer_requests` están en la publicación `supabase_realtime`. Realtime respeta RLS en INSERT/UPDATE (se probó que quien no está en la sala no recibe nada). Los DELETE no se pueden filtrar y llegan solo con la clave primaria: el cliente los escucha sin filtro y los descarta si el id no es suyo.
- `useRoomLive` parte de los datos que el servidor ya leyó y se mantiene con Realtime. **Vuelve a leer todo al quedar suscrito, al volver la red y al volver la pestaña**: Realtime avisa `SUBSCRIBED` un instante antes de registrar la suscripción y no reenvía lo perdido sin conexión. La relectura **fusiona** (no reemplaza) para no perder lo creado mientras se leía, y no resucita lo borrado ni reabre una sala cerrada.
- Estados explícitos: sin red, reconectando, sala llena, enlace inválido, sala bloqueada, sala cerrada, permiso denegado.

## App
- Crear sala sin cuenta: `/orar` pide solo un nombre; la acción de servidor entra como invitado, crea la sala y redirige a `/r/<código>`. Quien llega a `/r/<código>` sin estar dentro ve el nombre de la sala y escribe su nombre para entrar. Las salas no se indexan (`noindex` y `Disallow: /es/r/`).
- Las mutaciones de peticiones usan el cliente del navegador con RLS como barrera (no hay endpoints intermedios); las de ciclo de vida de la sala son RPC.
- Se decidió **no usar TanStack Query todavía**: el estado de una sala es un único flujo en vivo con un reducer pequeño. Se usará cuando haya listas con caché real (diario, devocionales).

## Pruebas
- `rooms-rls.test.ts` (24): RPC, aforo, bloqueo, cierre, lectura de quien no está, escritura, validaciones, columnas protegidas, spam, borrado y Realtime respetando RLS. Se verificó que detectan fallos (política abierta a propósito → fallan).
- `tests/e2e/rooms.spec.ts` (con dos y tres navegadores reales): crear sin cuenta, unirse, ver entrar y publicar en vivo, responder con testimonio, bloquear/desbloquear, borrar, cerrar para todos, salir y volver, unirse con enlace o código, enlaces inválidos y accesibilidad (axe) de la sala.
- `npm run test:db` y `npm run test:e2e:db` corren contra el Supabase local y reinician Auth antes para reiniciar el tope de altas anónimas (30 por hora por IP). En CI el job `e2e` levanta Supabase local y exporta sus claves.

## Pendiente
- Rate limit de `join_room`/`peek_room` contra fuerza bruta de códigos (hay 31⁶ ≈ 887 millones; sin límite por IP sigue siendo adivinable en volumen). Fase 8.
- Wake Lock, audio, silenciar y expulsar: Fase 4.
- Limpieza de salas y usuarios anónimos inactivos (pg_cron): Fases 6/8.
