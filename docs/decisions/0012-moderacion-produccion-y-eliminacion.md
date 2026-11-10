# 0012 — Moderación, eliminación de cuenta y endurecimiento para producción (Fase 8)

- Estado: aceptada (2026-11-10)

## Reportes (`reports`, `create_report`)
- Se reporta **una sala, una petición de sala, una publicación del muro de una comunidad o una persona**. La función de la base
  comprueba que la persona **pueda ver lo que reporta** (sala en la que estuvo, petición que lee, publicación visible para ella,
  persona con la que comparte sala o comunidad): no sirve para sondear ids ni para acosar a desconocidos.
- Motivos fijos (acoso, odio, spam, inapropiado, riesgo de autolesión, otro) y detalle opcional de 500 letras. **Un reporte
  abierto por persona y objetivo**; tope de **20 por persona al día**. No se puede reportar lo propio.
- **Quién los ve:** quien reportó (los suyos) y, si el reporte toca una comunidad, **su liderazgo** (pantalla
  *Comunidades → Reportes*). Al liderazgo **no se le muestra quién reportó** (evita represalias; la pantalla ni siquiera
  recibe `reporter_id`). La plataforma los lee con la service role (panel interno futuro, CLAUDE.md §5.6: sin construirlo antes de
  tener usuarios).
- El liderazgo atiende (`resolve_report`: atendido / descartado / reabrir) y puede **eliminar la publicación** reportada.
- Si quien reportó borra su cuenta, el reporte se **conserva sin su identidad** (`on delete set null`).
- Reportar y bloquear **también están disponibles para invitados**: la seguridad no puede exigir una cuenta.

## Bloqueos (`blocks`, `block_user`)
- Solo se bloquea a **quien se conoce** (comparten sala o comunidad). Quien bloquea ve y quita sus bloqueos; **la otra persona no
  se entera**.
- Efectos (decididos por RLS, no por la interfaz): se **ocultan en ambos sentidos** (a) las publicaciones del muro de la
  comunidad y (b) las peticiones de las salas (Realtime respeta esa política). **La anfitriona y el liderazgo ven todo** para poder
  moderar. (c) Una anfitriona que bloquea a alguien le cierra la puerta de **sus** salas (`join_room` responde como a quien fue
  sacado, sin revelar el bloqueo).
- Límite honesto: **bloquear no silencia el audio** de una sala en curso (el audio va directo por LiveKit); la persona puede salir o
  pedir a la anfitriona que saque a quien molesta. Tope de 200 bloqueos por persona.

## Eliminación de cuenta (`POST /api/account/delete`)
- **Confirmación**: escribir ELIMINAR y, si la cuenta tiene contraseña, **la contraseña** (se verifica con un cliente aparte; una
  sesión abierta en un equipo ajeno no basta). Las cuentas de Google o de invitado solo confirman con la palabra. La identidad sale
  de la sesión, nunca del cuerpo; defensa CSRF igual que las demás rutas.
- **Orden**: (1) `prepare_account_deletion` (service role): las comunidades en las que era la **única** administración pasan a
  quien lleva más tiempo (liderazgo primero) o, si estaban vacías, se eliminan; (2) se cierran en LiveKit sus salas abiertas y se
  **borran sus archivos de Storage** (foto y logos de las comunidades eliminadas: la base no borra Storage sola); (3) se borra el
  usuario de Auth y **todas las tablas caen en cascada** (una prueba recorre todas las columnas que apuntan a `auth.users`);
  (4) se cierra la sesión.
- Lo que cae con la cuenta incluye las salas que anfitrionaba (con sus peticiones). Lo que **se conserva**: los reportes (sin
  identidad de quien reportó) y las comunidades heredadas.
- **Invitados inactivos**: `purge_inactive_guests` (pg_cron, domingos 04:17) borra a quienes entraron como invitados y no volvieron en
  90 días (minimización de datos). Nunca toca cuentas con correo.

## Auditoría de seguridad automatizada (`security_audit`)
- Función solo para la service role que revisa **la propia base** (también el proyecto remoto): tablas sin RLS o sin políticas,
  `SECURITY DEFINER` sin `search_path` fijo, funciones y tablas alcanzables sin sesión (rol `anon`), buckets públicos sin límite de
  tamaño o de tipos y buckets sin política de escritura. La prueba exige que **no devuelva nada inesperado**: lo único público son
  las vistas previas de invitación (`peek_room`, `peek_schedule`, `peek_community`).
- Primer hallazgo real: `devotional_stats`, `is_allowed_push_endpoint` e `is_permanent_user` eran ejecutables sin sesión por el permiso
  por defecto. No exponían datos, pero se cerraron.

## Anti-abuso
- **CAPTCHA (Cloudflare Turnstile), opcional y apagado por defecto.** Se enciende con `NEXT_PUBLIC_TURNSTILE_SITE_KEY` y se activa
  en Supabase Auth (la clave secreta vive allí, nunca en la app). Cubre las altas de **invitados** (crear/unirse a una sala sin sesión),
  el registro, la entrada y la recuperación de contraseña. Modo "solo si hace falta": casi nadie ve nada (el principio rector de orar
  en 15 segundos no se toca). Quien ya tiene sesión no lo ve. Sin la variable no se carga ningún script de terceros.
  *Verificado* contra Auth con CAPTCHA activo y las claves de prueba de Cloudflare: con el widget se crea la sala; sin él, mensaje claro.
- **Cabeceras**: HSTS, `X-Frame-Options`, `frame-ancestors 'none'`, `base-uri`, `object-src 'none'`, `Permissions-Policy` (micrófono y cámara
  solo de este origen), `nosniff`, `Referrer-Policy`. **No hay CSP con `script-src` y nonces** a propósito: los nonces obligan a
  renderizar todo en el servidor y la landing debe ser estática (CLAUDE.md §4). Queda como mejora si se justifica.
- **Riesgos que quedan** (documentados en `docs/operaciones/produccion.md`): los códigos de sala (6 caracteres, ~887 millones) no tienen
  limitador de intentos fallidos propio (se apoya en el límite de altas anónimas de Auth y en la protección de red de Vercel);
  conviene activar el firewall/limitador de Vercel o Supabase antes de lanzar.

## Observabilidad con privacidad
- **Sentry** (`@sentry/nextjs`): sin `SENTRY_DSN` está apagado y no envía nada. Con DSN: **sin datos personales** (`sendDefaultPii: false`, sin
  repetición de sesión) y con limpieza propia de todo lo que sale: se descartan usuario, cuerpo, cookies, encabezados y extras; las URLs
  se generalizan (`/r/[code]`, `/p/[token]`, `/c/[token]`, sin query ni hash); se descartan las migajas de teclas, clics y consola. El SDK
  del navegador se carga **perezosamente** cuando la página está libre (el primer intento costó 8 puntos de Lighthouse móvil: 95 → 87; con
  carga diferida quedó en 91–93). No hay carga de mapas de fuentes todavía (falta un token de Sentry): las trazas llegan minificadas.
- **Vercel Analytics**: solo en Vercel, sin cookies, con las rutas con llave generalizadas antes de enviarse. Nada del contenido de oraciones.
- Pantallas de error (`error.tsx`, `global-error.tsx`) amigables que reportan a Sentry y ofrecen reintentar o volver.

## Dependencias
- `@sentry/nextjs` y `@vercel/analytics` (ambas ya estaban en el stack del CLAUDE.md §3). `npm audit` marca avisos en las herramientas de
  *build* de Serwist (`zod`/`glob` anidados): no van al navegador ni al servidor; se esperan arreglos de Serwist.
- El precaché del service worker creció (~2.5 → 2.9 MB) porque el fragmento perezoso de Sentry también se precarga. Mejora pendiente:
  excluirlo del precaché.

## Pruebas
- **Base de datos (17 nuevas)**: auditoría, bloqueos (contexto compartido, efectos en salas y muro, anfitriona), reportes (permisos de
  visibilidad, validaciones, duplicados, tope, visibilidad para el liderazgo y anonimato), eliminación (cascada en 20 columnas, herencia de
  administración, comunidades vacías) y limpieza de invitados.
- **Unitarias (11 nuevas)**: limpieza de URLs, eventos y migajas de Sentry, opciones apagadas/encendidas, token de CAPTCHA, confirmación del borrado.
- **E2E (9 nuevas)**: reportar y bloquear en una sala (con axe), reportes de comunidad con moderación, borrado de cuenta de punta a punta
  (contraseña, herencia, archivos, sesión), invitado que borra sus datos, rechazos de la ruta, cabeceras y ausencia de scripts de terceros.
- **Lighthouse (producción local)**: móvil 91–93 / 100 / 100 / 100; escritorio 100 / 100 / 100 / 100.
