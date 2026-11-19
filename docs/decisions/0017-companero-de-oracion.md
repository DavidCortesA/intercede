# 0017 — Compañero de oración, solo personas adultas (Fase 11, B7)

- Estado: aceptada (2026-11-21)
- Alcance: CLAUDE.md §16 **B7**. **Decisión del propietario: solo personas adultas** (sin adolescentes). C6 nivel 2 sigue esperando su decisión.

## Mayoría de edad (corrección importante)
Al preguntar esta decisión se dio por hecho que el registro ya pedía confirmar la mayoría de edad (CLAUDE.md §17.2). **No era así**: faltaba. Este lote lo corrige:
- **El registro exige "Confirmo que soy mayor de edad"** (y la acción de servidor lo rechaza si falta). La declaración se guarda en `profiles.adult_confirmed_at` (al crear la cuenta, vía metadata, o al convertir a un invitado, con `confirm_adult()`). Nadie la escribe directamente: la columna no es editable por la API.
- Las cuentas **anteriores** y las de **Google** no la tienen: **al anotarse al programa** se les pide confirmarla (una vez). Sin confirmación, `join_partner_program` responde `adult_required`, y **el emparejamiento solo toma a quienes la tienen** (se vuelve a comprobar al emparejar). Es una **declaración**, no una verificación de edad; la política de menores y su revisión legal siguen pendientes (§17).

## Modelo
- Programa por comunidad (`partner_programs`): abierto/cerrado, modo **aleatorio** o **por grupo** (etiquetas que define el liderazgo; hasta 20, de 1 a 30 letras), y `last_paired_week` para que emparejar sea **idempotente por semana**. **No se guarda género.**
- Anotarse (`partner_signups`, llave foránea a `community_members`: salir de la comunidad o que te saquen te saca del programa). Pausar y salir cuando quieras.
- Parejas (`partner_pairs`, semana en curso = lunes UTC), peticiones (1 a 3 de hasta 200 letras por persona y pareja), "Estoy orando por ti" (una marca) y revisión semanal ("Bien / Más o menos / Difícil" + nota de 140 letras).
- **Emparejar** (`pair_program`, con bloqueo de fila del programa): `pg_cron` cada **lunes 06:00 UTC** (`run_partner_pairing`) o el liderazgo con **"Emparejar ahora"** (útil al abrir a mitad de semana). Toma a quienes están anotadas, sin pausa, que siguen en la comunidad y son adultas; las baraja y busca la primera pareja válida: misma etiqueta si es por grupo, **sin bloqueo entre ambas (en cualquier sentido)** y **sin repetir pareja de las últimas 4 semanas**. Quien queda sin pareja (impar o sin opciones válidas) espera a la semana siguiente. Aviso (`partner_paired`) a ambas.

## Seguridad y privacidad
- **De la pareja solo se ve el nombre** (el mismo que ya ve la comunidad) y su id, que sirve para reportar o bloquear: nunca contacto. El liderazgo ve **solo totales** (anotadas, en pausa, parejas de la semana), nunca quiénes ni qué escribieron; la pantalla del liderazgo no incluye nombres.
- **Salir borra lo escrito**: un disparador sobre `partner_signups` borra las peticiones, la marca de oración y la revisión de esa persona y **termina las parejas vigentes**. Vale igual al salir de la comunidad o al borrar la cuenta (cascada). La otra persona conserva lo suyo y ve que la pareja terminó.
- **Bloquear** (`block_user` existente): termina la pareja de inmediato y oculta lo del otro (políticas RLS con `is_blocked_between`); el bloqueo impide emparejarlas de nuevo. **Reportar** usa el reporte de persona ya existente.
- Políticas: cada quien ve solo sus anotaciones y sus parejas; todo se escribe con RPC (`add_partner_request`, `set_partner_praying`, …).

## Interfaz
- *Comunidades → Compañero* (visible para todas las personas **solo si el programa está abierto**; el liderazgo siempre lo ve para configurarlo): configurar (abrir, modo, grupos, emparejar ahora, totales), anotarse con las reglas explicadas y la confirmación de edad si falta, pausar/reanudar/salir (con aviso de que se borra lo escrito), y la tarjeta de la pareja (peticiones, "Estoy orando por ti", revisión, reportar o bloquear).

## No incluido / límites
- Sin chat, sin contacto y sin recordatorios a mitad de semana; sin trío cuando el número es impar (la persona espera).
- No se verifica la edad (solo se declara). Los adolescentes quedan para cuando haya una política de menores revisada por un abogado.
- Los avisos usan el mismo envío de notificaciones (push/correo según las preferencias de cada persona).

## Pruebas
- Base de datos (20): confirmación de edad (única, no editable, desde el registro) y exclusión de quien no la tiene; configuración y etiquetas; anotarse (cuenta, comunidad, etiqueta); emparejar (una vez por semana, impar, pausa, por grupo, 4 semanas, **bloqueos en ambos sentidos**, tarea semanal solo para la service role); peticiones (máximos, permisos, nunca contacto), oración y revisión; **salir borra lo escrito** (también al salir de la comunidad o borrar la cuenta); vista del liderazgo sin nombres; escrituras directas bloqueadas.
- Unitarias (3) y E2E (6): configuración por el liderazgo, anotarse con confirmación de edad, emparejar ahora, la pareja se ve y ora, bloquear la termina y salir borra. Las pruebas de registro se actualizaron para la casilla de mayoría de edad.
