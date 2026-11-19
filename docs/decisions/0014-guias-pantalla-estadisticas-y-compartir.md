# 0014 — Guías con temporizador, modo pantalla, estadísticas y compartir (Fase 10, lote 1)

- Estado: aceptada (2026-11-19)
- Alcance: CLAUDE.md §16 **B3** (guías con temporizador), **B4** (modo pantalla), **B5** (estadísticas para líderes), **A1** (compartir por WhatsApp y QR) y **C6 nivel 1** (botón de Google Calendar).
- **Fuera de este lote** (decisión del propietario: "preguntarme una por una"): **B2** grupos pequeños, **B6** marca de la iglesia, **B7** compañero de oración, **C6 nivel 2**, **A6** pasaje en pantalla y el resto de lo asignado a fases 3–7 que no se construyó (A2 reacciones, A3 sala de espera, A4 urgentes, A5 pastoral, A7 testimonios, B1 cadena 24/7). Las decisiones abiertas de §16.5 (versión bíblica, adolescentes, cookies entre subdominios, permiso de Google) siguen pendientes.

## B3 — Guías de oración con temporizador
- **Hora del servidor, no del dispositivo.** La base guarda el **progreso acumulado** y **desde cuándo corre** (`room_guide_runs.base_elapsed_ms` + `running_since`, timestamptz del servidor). Cada dispositivo calcula el segmento y la cuenta regresiva con la hora del servidor **estimada** (`get_server_time` descontando la mitad de la ida y vuelta, con la medición más rápida; se repite cada 5 min y al volver a la pestaña). Dos dispositivos con relojes desfasados muestran lo mismo (prueba unitaria). Pasar de un momento al siguiente **no necesita escritura**: se deduce de la posición. Saltar, pausar y sumar un minuto sí son escrituras de la anfitriona (`control_guide`, bloqueo de fila).
- **La sesión es una copia** de la guía (título y momentos): editar o borrar la guía no cambia una sala en curso. Una sola guía por sala; iniciar otra reemplaza.
- **Quién puede qué:** las guías del sistema (4, gratis) las ve cualquier cuenta, también invitados; las **propias** las crea el liderazgo de una comunidad con plan **Plus/Pro** (`own_guides` de `plans.limits`; el plan gratuito recibe `plan_required`) y solo sirven en salas de esa comunidad. Máximo 30 guías por comunidad, 20 momentos de 1 a 60 minutos (validado en la base con una restricción, no solo en la interfaz).
- Realtime (`room_guide_runs` en la publicación; RLS: solo quienes están en la sala) + relectura al volver la red o la pestaña. **Campana** opcional y local: el contexto de audio se crea al **activarla** (un clic), nunca al cargar, porque los navegadores exigen un gesto.
- **Pendiente de §16 B3:** "avanzar por la cola de peticiones" y un pasaje por momento dependen de §15 (cola de peticiones) y de A6 (versión bíblica). Los textos de las guías del sistema son indicaciones propias, sin citar ninguna versión.

## B4 — Modo pantalla y petición en foco
- **Sin sesión y sin LiveKit.** Ruta `/r/[code]/display?t=…`: la página consulta `GET /api/display` cada 2,5 s. El servidor valida el **enlace secreto** en la base (`display_state`, solo `service_role`) y devuelve **solo lo proyectable**: la petición en foco, hasta 2 que siguen, la guía en curso y el código/QR para entrar. **Nunca autores ni nombres.** Enlace inválido, revocado o sala inexistente responden igual (404). Polling en vez de Realtime: una pantalla anónima no puede suscribirse sin abrir RLS a quien no tiene sesión.
- **Enlace revocable:** lo crea y lo ve solo quien anfitriona (`room_display_links`, RLS de anfitriona); crear otro invalida el anterior y "desactivar" lo apaga. Con el token en el URL se evita fuga por referencia (`referrer: no-referrer`, `noindex`).
- **Petición en foco (`rooms.focus_request_id`):** quien anfitriona elige "Orar por esta"; todos la ven marcada como "Orando ahora" y la pantalla la muestra grande. Es el **primer paso hacia el estado "Orando ahora" de §15.3 sin cola**: cuando se construya `room_prayer_items`, esta columna se migra a `status = 'current'`. Una petición respondida sale del foco y de la pantalla.
- Hoy no existen peticiones anónimas ni pastorales (A5 y §15.2): cuando existan, `display_state` deberá excluirlas; está anotado en la función.

## B5 — Estadísticas para líderes
- `community_stats`: **solo agregados por comunidad y semana** (lunes, UTC), solo liderazgo, solo planes Plus (últimas 5 semanas ≈ 30 días) y Pro (hasta 52 semanas + comparativa 4 contra 4). El plan gratuito recibe `plan_required`.
- **Privacidad (regla de 5):** el tiempo de oración, las personas por sala y los devocionales leídos se devuelven **`null` si involucran a menos de 5 personas distintas** esa semana. Para que no se deduzcan por resta, **los totales no se muestran** si alguna semana con asistencia quedó oculta o si el periodo tiene menos de 5 personas (`summarize`). La función nunca devuelve ni identificadores ni minutos por persona; el CSV tampoco.
- Peticiones nuevas/respondidas y crecimiento de miembros no se ocultan: el liderazgo ya ve el muro y la lista de miembros. Las "salas realizadas" salen de `rooms`; **las horas y la participación dependen del webhook de LiveKit** (Fase 9): sin él quedan en cero.
- **Desviación del CLAUDE.md:** §16 B5 pide "vistas materializadas actualizadas por tarea programada". Se calcula **en vivo** con índices (`usage_events` por comunidad y fecha): a este volumen no hay costo, no hay datos viejos y se evita una tarea más. Si el volumen lo pide, se cambia por vistas materializadas sin tocar la interfaz.
- **CSV** de los mismos agregados (`/api/communities/[id]/stats`, con BOM para Excel; lo oculto sale vacío; antepone comilla a lo que parezca fórmula, como §15.6).

## A1 — Compartir por WhatsApp y QR
- Diálogo de compartir en la sala: hoja nativa del celular si existe, **WhatsApp** (`https://wa.me/?text=…`) con un mensaje **editable** que **nunca lleva peticiones ni datos personales**, copiar enlace y **código QR** (con pantalla completa) del enlace de la sala **sin parámetros**.
- **Dependencia nueva: `qrcode`** (+ `@types/qrcode`). Justificación: generar el QR **en el navegador** (el enlace no sale a ningún servicio externo) con una librería mantenida y pequeña; se carga bajo demanda y se dibuja como un `<path>` SVG (no se inserta HTML). Siempre sobre fondo blanco con zona de silencio, para que lo lean las cámaras.

## C6 nivel 1 — Google Calendar
- Botón "Google Calendar" en eventos y en salas programadas: abre la **URL de plantilla** del formulario de Google ya llena. **No pide permisos ni conecta la cuenta.** Para eventos y programaciones se manda la **hora de pared con su zona** (`ctz`), de modo que una recurrencia respeta el horario de verano; las programaciones diarias y semanales llevan `RRULE`. El `.ics` para Apple y Outlook sigue disponible. (El nivel 2, sincronización automática, requiere la decisión del permiso de Google y su verificación.)
- Las programadas muestran la **próxima** sala, no el pasado: el enlace usa `next_occurrence_at`.

## Seguridad
- Tablas nuevas con RLS (`prayer_guides`, `room_guide_runs`, `room_display_links`). Todas las funciones nuevas con `search_path` fijo y sin acceso para `anon`; `display_state` solo para la `service_role`. `security_audit` sigue sin hallazgos.
- `/api/display` valida el formato del código y del token antes de llamar a la base y no cachea.

## No incluido (honesto)
- Sin límite de intentos para `/api/display` (el token tiene ≥ 128 bits de entropía; el firewall de Vercel recomendado en `docs/operaciones/produccion.md` aplica también aquí).
- La campana y la cuenta regresiva no se probaron en dispositivos reales (iOS Safari y Android): conviene verificar el sonido y la pantalla completa.
- Las guías propias no se editan (se borra y se crea de nuevo).

## Pruebas
- Base de datos (19): guías (visibilidad, plan, validación de momentos, borrado), temporizador (`guide_segment_at`, pausar/reanudar/saltar/sumar/terminar, tope de minutos extra, copia de la sesión, solo anfitriona), foco, enlace de pantalla (revocar, renovar, sin autores, solo `service_role`) y estadísticas (plan, regla de 5, agregados, devocionales).
- Unitarias (19): temporizador y sincronía entre relojes desfasados, totales con privacidad, comparativa, CSV (BOM, fórmulas, sin identificadores).
- E2E (11): compartir (mensaje editable, WhatsApp, copiar, QR, axe), Google Calendar de evento y programada, guía en vivo entre dos personas, foco, pantalla (sin nombres, se actualiza, revocar), guías propias, estadísticas ocultas con pocas personas y visibles con 5, CSV y bloqueo por plan.
