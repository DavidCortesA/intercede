# 0015 — Grupos pequeños dentro de una sala (Fase 11, B2)

- Estado: aceptada (2026-11-20)
- Alcance: CLAUDE.md §16 **B2**. Las demás piezas de la Fase 11 (B6 marca de la iglesia, B7 compañero de oración, C6 nivel 2) esperan tus decisiones de §16.5 y se tratan una por una.

## Modelo
- **Cada grupo es una sala de LiveKit aparte** (`bg-<id>`), creada por el servidor al emitir el primer token. La persona se **reconecta con un token nuevo** que el servidor solo emite si la **base** dice que está asignada a ese grupo (`get_breakout_access`, como la persona, con RLS); la anfitriona puede visitar cualquiera. El token dura lo que le queda al reparto (+15 s), nunca más que la sala.
- Tablas (`room_breakouts`, `breakout_groups`, `breakout_assignments`; RLS, solo escritura por RPC): un reparto activo por sala (índice único parcial), una asignación por persona y reparto (llave primaria). Quienes están en la sala ven el reparto y los grupos; **quién está en cada grupo**, solo la anfitriona y quienes comparten grupo. Las tres tablas están en la publicación de Realtime.
- **Reparto:** por tamaño (2 a 5) o por número de grupos; **aleatorio** (lo hace la base, parejo y sin la anfitriona) o **manual** (`{usuario: grupo}`; quien no aparece se queda en la sala principal). Duración de 1 a 60 min. Opcional: **una petición por grupo** (de las peticiones de esa sala). Una solicitud inválida se rechaza completa (la función es transaccional).
- **Plan:** Plus hasta 10 grupos y Pro hasta 20 (`plans.limits.breakout_groups`); plan gratuito y **salas personales: 0** (`plan_required`). Las salas de grupo **no cuentan como salas simultáneas** (CLAUDE.md §16 B2) porque no son filas de `rooms`.

## Regresar sin quedar atrapados
- **Cada dispositivo vuelve por sí solo** al terminar el tiempo del reparto, según la **hora del servidor** (misma estimación de las guías): `activeGroupId` devuelve `null` cuando `ends_at` pasó o el reparto terminó. No depende de que la anfitriona esté conectada ni de recibir un mensaje.
- Si la anfitriona termina antes (`end_breakout`, vía `/api/livekit/host`), la base cierra el reparto (todos reciben el cambio por Realtime) y el servidor **corta las salas de audio de los grupos**. Si una persona se queda con una sala de grupo ya borrada, el cliente interpreta `ROOM_DELETED` como "vuelve a la principal" (no como "sala cerrada").
- **Respaldo del servidor:** `end_expired_breakouts` cierra los repartos vencidos (+15 s) y el servidor corta sus salas; lo dispara el mismo `pg_cron` de límites (`invoke_enforcer` ahora también mira repartos vencidos). Cerrar la sala principal termina el reparto (trigger) y se cortan los grupos.
- Si el token de un grupo falla porque ya no corresponde (`not_assigned`), el cliente pide el de la sala principal en el acto.
- **Una persona, una sala:** el micrófono y el permiso se conservan al cambiar de sala (no se vuelve a pedir nada). Sus minutos cuentan una sola vez: el webhook de LiveKit suma los de un grupo (`bg-…`) a la sala principal (`breakout_main_room`), así las horas-persona de la comunidad son correctas.
- **Moderación:** expulsar a alguien también lo saca de las salas de los grupos; cerrar la sala corta todo. Silenciar a uno o a todos (`mute`, `mute_all`) actúa sobre la **sala principal**; en un grupo, la anfitriona puede visitarlo o terminar los grupos.

## Interfaz
- **Anfitriona:** *Dividir en grupos* (diálogo con tamaño/número, duración, aleatorio o manual con "mezclar de nuevo", y petición por grupo) → panel *Grupos en curso* con cuenta regresiva, gente de cada grupo, *Unirme a este grupo* (para hablar con ese grupo hay que estar en el audio), aviso a todos (140 letras) y *Terminar grupos y volver a la sala*.
- **Participantes:** banner con su grupo, quién está con ella, por quién orar (si hay) y cuánto falta; la lista de personas y "quién habla" pasan a ser las de **su** sala de audio. Quien se quedó en la principal lo sabe.

## No incluido / límites
- Un grupo no tiene chat ni peticiones propias; la petición del grupo es de solo lectura.
- La anfitriona no se asigna a un grupo (supervisa y visita). Cambiar a alguien de grupo con el reparto en curso no está (se termina y se vuelve a dividir).
- Si una persona cambia de sala justo mientras LiveKit aún conecta, el cambio puede tardar unos segundos; el reparto no se rompe.
- Sin prueba en dispositivos reales (iOS Safari y Android): el cambio de sala de audio en segundo plano puede variar por navegador.

## Pruebas
- Base de datos (18): plan, validaciones, reparto aleatorio y parejo (incluye 19 personas en 4 grupos), manual (y rechazos), petición por grupo, un reparto activo, visibilidad por RLS, acceso por grupo (asignada/visita/vencido), aviso, terminar, cerrar la sala, repartos vencidos y uso.
- Rutas (8): token por grupo (asignada, ajena, sin grupo, vencido), terminar/cerrar/expulsar cortan los grupos, cierre programado y webhook de uso. Se encontró y corrigió un error real: el token se firmaba para la sala principal.
- Unitarias (10): sala que le toca a cada quien, regreso con relojes distintos, armado de grupos.
- E2E (6, audio real con LiveKit): reparto manual con audio que cambia de sala, aviso, visita de la anfitriona, terminar y **regreso automático con la anfitriona desconectada**.
