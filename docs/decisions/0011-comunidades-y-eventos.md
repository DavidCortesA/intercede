# 0011 — Comunidades, muro, salas, devocional y eventos (Fase 7)

- Estado: aceptada (2026-11-10)

## Principio: la capa 3 se SUMA, no cambia la capa 1
- Quien solo quiere orar no ve comunidades: la pestaña **Comunidades solo aparece al crear una o unirse a una**
  (navegación progresiva, CLAUDE.md §8.4). Crear o unirse se hace desde *Perfil → Comunidades*.
- Las tablas de la capa 1 no cambian de forma: `rooms` gana `community_id` (nulo = sala normal, como siempre) y
  `join_room` gana una comprobación (si la sala es de una comunidad, solo entran sus miembros). Todo lo demás es nuevo.

## Modelo y roles
- `communities` (nombre, tipo iglesia/ministerio/grupo, descripción, logo), `community_members` (rol), `community_invites`.
- Roles: **admin** (todo: roles, enlace, ajustes, eliminar, pausar programaciones de otros), **líder** (abre salas, programa,
  crea eventos y devocionales, modera el muro, saca a *miembros*) y **miembro** (ora, publica, confirma asistencia).
- Solo **cuentas** crean o se unen (los invitados no): la comprobación vive en las funciones de la base. Máximo 5 comunidades
  creadas por persona y 1000 miembros por comunidad.
- Todo es **privado para quien no es miembro**: la comunidad "no existe" (404 en las pantallas, filas vacías en la API).
- **Nunca queda una comunidad sin admin**: `leave_community` y `set_member_role` lo impiden (`last_admin`). La regla está en
  las funciones y no en un trigger a propósito: un trigger también bloquearía el borrado de una cuenta en cascada (Fase 8
  tendrá que decidir qué pasa con las comunidades de una cuenta eliminada: transferir o borrar).
- **Nombre y foto de cada miembro** se copian a `community_members` (el perfil es privado) y un trigger sobre `profiles` los
  mantiene al día.

## Entrar: enlace revocable, sin aprobación
- Igual que las invitaciones de salas programadas: el token vive en `community_invites` (lo ven admin y líderes; solo admin lo
  regenera, y regenerar invalida el anterior). `/c/<token>` enseña nombre, tipo, logo y cuántas personas a quien tenga el
  enlace (`peek_community`, sin sesión) y pide cuenta para unirse. Se acepta el enlace completo o el código.
- El enlace **vuelve a donde ibas** tras crear cuenta o entrar (`?next=`, validado con `safeNextPath`; también con Google).
- Decisión: **sin aprobación manual** de solicitudes (el enlace es la llave). Si se necesita más control, la administración
  revoca el enlace o saca a quien no corresponde.

## Muro de oración
- Tabla propia `community_requests` (no se reutiliza `prayer_requests`, atada a una sala): la capa 1 no se toca.
- **Visibilidad** (CLAUDE.md pide "comunidad / privada"): se implementó como **`community` (toda la comunidad)** y
  **`leaders` (solo quien la escribió, administración y líderes)**, pensando en peticiones pastorales delicadas. Una petición
  visible solo para su autora no tendría sentido en un muro compartido (para eso está el diario). *Interpretación mía:
  si prefieres otra, se cambia con una migración pequeña.*
- Quien la escribió la edita, la marca como respondida (con testimonio) y la borra; **el liderazgo puede borrar** (moderación).
- "Estoy orando por esto" (`community_request_support`): una vez por persona, no en las propias, y **no en las que no ves**
  (el trigger lee con los permisos de quien inserta). Los apoyos de una petición del liderazgo no son legibles por un miembro corriente.
- **El muro no es en vivo** (no usa Realtime): se actualiza al publicar o recargar. Es una decisión consciente para esta fase
  (menos conexiones y menos superficie); se puede añadir igual que en las salas.

## Salas y programaciones
- **Abrir ahora**: `create_community_room` (admin/líder). Las personas de la comunidad ven las salas abiertas de la
  comunidad aunque no hayan entrado (política de lectura nueva) y entran con el flujo normal; los de fuera con el código
  reciben `community_only`.
- **Recurrentes**: `create_schedule` gana `p_community_id` (solo liderazgo). Los miembros ven las programaciones y **las siguen
  con un botón** (sin enlace: ser miembro basta). Quien la creó o la administración las pausa o borra. Al salir de la comunidad
  (o ser sacado) se deja de seguirlas. `process_scheduled_work` crea la sala con `community_id`.
- La pantalla personal *Programadas* solo muestra las que sigues; las que creaste dentro de una comunidad se administran ahí.

## Devocional de la comunidad
- `devotionals.community_id` ya existía: ahora tiene llave foránea. Admin y líderes **publican, editan y retiran** los de su
  comunidad (política y permisos por columna: `community_id` no se puede cambiar); los miembros leen hasta "mañana" (el
  liderazgo ve también los adelantados). Un devocional por comunidad y día.
- Un líder **no puede** escribir devocionales generales de la plataforma (siguen siendo solo del importador).
- El contenido y su licencia son de quien publica (se avisa en el formulario). La **racha** sigue siendo la del devocional
  general: no se mezcla (la pantalla de la comunidad no la muestra).

## Eventos
- `events` guarda el **instante** (`starts_at`/`ends_at`) y la **zona horaria** en la que se programó; `create_event` calcula
  `(fecha + hora) at time zone <zona>` (horario de verano correcto) y la pantalla enseña la hora de pared de esa zona.
- **Asistencia** (`event_rsvps`) por `set_rsvp`: voy / tal vez / no voy, cambiable, no tras terminar el evento. Los miembros ven
  los conteos.
- **Avisos** (cola de la Fase 6): recordatorio a quien va o "tal vez" (`reminder_minutes`, respeta la preferencia de avisos de
  salas) y, si el evento pide sala (`opens_room`), `process_scheduled_work` la abre a su hora (con la tolerancia de 6 horas) y avisa
  con el enlace. No se avisa a quien ya salió de la comunidad. Dos tipos nuevos de aviso (`event_reminder`, `event_started`).
- **Exportar a calendario**: `GET /api/events/<id>/ics` (RFC 5545: UTC, escapado, líneas dobladas a 75 octetos, `UID` estable).
  Lee el evento **como la persona** (RLS): de fuera, 404; sin sesión, 401; sin caché. El título no puede inyectar propiedades
  (los saltos de línea se escapan). Probado con unitarias y e2e.
- Limitación: los eventos **no se editan** (se borran y se crean de nuevo).

## Logos
- Bucket público `community-logos` (1 MB; WEBP/PNG/JPEG), carpeta = id de la comunidad; **solo la administración de esa
  comunidad escribe** (política con una función que tolera carpetas que no son un uuid). La URL del logo solo puede apuntar a
  su carpeta (CHECK), como los avatares. El recorte a 256 px en el navegador es ahora una utilidad compartida (`src/lib/image.ts`).

## Interfaz
- Rutas: `/comunidades`, `/comunidades/<id>` (muro) con `salas`, `eventos`, `devocional`, `miembros` y `ajustes` (solo
  administración), y `/c/<token>`. Acciones destructivas con confirmación en línea; todo pasa axe (WCAG AA).
- El diseño de la cuenta se vuelve a leer (`router.refresh()`) al crear, unirse, salir o eliminar, para que la pestaña
  *Comunidades* aparezca o desaparezca al instante.
- `ScheduleForm` y `ScheduleCard` se extrajeron de la pantalla de programadas y se reutilizan.

## Pruebas
- **Base de datos (21)**: crear y límites, visibilidad por rol y de fuera, enlace (revocar, idempotencia, invitados), roles y
  "último admin", quién saca a quién, ajustes/logo/eliminar, sincronía del perfil, Storage por rol, muro (visibilidad, edición,
  testimonio, moderación, apoyo), salas (ver/entrar, `community_only`), programaciones (seguir, pausar por admin, salir),
  devocional (publicar, editar, límites), eventos (zona horaria, validaciones, RSVP, avisos, sala automática, preferencias).
- **Unitarias (13)**: `.ics`, `parseInviteToken`, errores, formulario y los plurales de los mensajes.
- **E2E (11)**: crear, invitar, roles, 404 a quien no es miembro, muro con tres personas, sala de comunidad con una persona de
  fuera, programación seguida, devocional, evento con RSVP, descarga `.ics` y sala automática, ajustes con logo real,
  salir y eliminar. Pasan axe las pantallas principales.

## Pendiente / límites
- Reportar, bloquear y moderar a nivel plataforma (Fase 8). Aún no hay "silenciar a un miembro" ni expulsión con bloqueo
  (quien es sacado puede volver con el enlace si no se revoca).
- Eliminación de cuenta y qué pasa con las comunidades que quedan sin admin (Fase 8).
- Muro sin tiempo real, eventos sin edición, sin recordatorio del devocional de la comunidad, sin búsqueda de miembros.
