# 0008 — Audio en vivo con LiveKit (Fase 4)

- Estado: aceptada (2026-11-10)

## Arquitectura
- **El navegador se conecta directo a LiveKit Cloud; el servidor solo emite tokens y modera.** Ninguna credencial de LiveKit llega al navegador: `LIVEKIT_API_SECRET` vive solo en el servidor y la URL de señalización viaja en la respuesta del token (no hace falta `NEXT_PUBLIC_LIVEKIT_URL`).
- Se usa **`livekit-client` directamente** (sin `@livekit/components-react` ni sus estilos): el hook `useLiveAudio` controla la conexión, el micrófono, el orador activo y la reconexión con poco código, y la interfaz es propia. `livekit-server-sdk` firma tokens y llama a la API de administración.
- Sala de LiveKit = id de la sala en la base; identidad = id del usuario de Supabase. El servidor crea la sala de audio con aforo 20 y vida corta (`emptyTimeout` 10 min) al emitir el token.

## Seguridad
- **`POST /api/livekit/token`**: valida la sesión de Supabase y lee la sala y la membresía **como la persona (RLS)**; exige estar presente (no haber salido ni haber sido expulsada) y sala abierta. Token de **2 h**, con permisos mínimos: escuchar y publicar **solo micrófono** (`canPublishSources: [MICROPHONE]`, sin cámara, pantalla ni datos). Nunca se cachea (`no-store`; el service worker no toca `/api/*`).
- **`POST /api/livekit/host`** (mute, mute_all, remove, close): solo anfitrión, verificado en el servidor. **Un token vigente no se anula solo**, así que expulsar y cerrar se ejecutan desde el servidor con la API de LiveKit (`removeParticipant`, `deleteRoom`), después de registrarlo en la base. Cerrar la sala ya no se hace desde el navegador sino por esta ruta.
- Defensa CSRF de los endpoints con cookies: el cuerpo debe ser `application/json` y el `Origin`, si viene, debe ser este sitio.
- Las llamadas a LiveKit se reintentan una vez (se vio una respuesta vacía intermitente); "no existe" no se reintenta. Si LiveKit cae, la base ya quedó consistente y el error es un 502 claro.

## Expulsar (migración `20261110180000_remove_member.sql`)
- `room_members.removed_at` y RPC `remove_member` (solo anfitrión, sala abierta, no a sí mismo ni al anfitrión). `join_room` rechaza con `removed` a quien fue expulsado. Quien fue expulsado sigue viendo su propia fila (para entender qué pasó) pero ya no lo que ocurre en la sala.

## Experiencia
- **El audio no arranca solo ni pide permisos al cargar la página.** Hay dos caminos: "Orar con micrófono" y "Solo escuchar". El modo oyente **nunca pide el micrófono** (se verifica en las pruebas contando llamadas a `getUserMedia`); si luego decide hablar, ahí se pide.
- Errores del micrófono distintos y accionables: permiso denegado, sin micrófono, en uso por otra app. Ante cualquiera, la persona queda como oyente y la sala (peticiones incluidas) sigue funcionando.
- **Reconexión:** LiveKit reintenta solo ante cortes breves; si se rinde, se pide un **token nuevo** y se reconecta (hasta 4 intentos con espera creciente), salvo que la causa sea definitiva (expulsada, sala cerrada, sesión vencida). También se contemplan: audio bloqueado por el navegador (botón "Activar el sonido"), entrada duplicada desde otro dispositivo, sala eliminada.
- **Wake Lock:** la pantalla se mantiene encendida mientras se está en la sala; se vuelve a pedir al volver a la pestaña y, si el dispositivo lo niega, no pasa nada.
- Orador activo con el anillo pulsante del diseño, insignias de micrófono por persona y, para el anfitrión, silenciar a alguien, silenciar a todos y sacar de la sala (con confirmación). Silenciar es **puntual**: la persona puede volver a activar su micrófono.
- Audio optimizado para voz (`AudioPresets.speech`, DTX, cancelación de eco, supresión de ruido y control de ganancia).

## Pruebas
- Integración (Supabase local, LiveKit simulado donde hay red): token (sin sesión, otros orígenes, no miembro, expulsado, sala cerrada, permisos y duración del token verificados con el verificador oficial) y controles del anfitrión; 17 pruebas. DB: `remove_member` y el bloqueo de reingreso. Unitarias del Wake Lock.
- E2E contra **LiveKit Cloud real** con micrófonos simulados de Chromium: hablar y escuchar entre dos navegadores, orador activo, silenciar, silenciar a todos, expulsar, cerrar, "solo escuchar" sin pedir micrófono, y los tres errores del micrófono. Se saltan solas sin credenciales (en CI: secretos `LIVEKIT_*`). axe (WCAG AA) con el audio conectado.

## Límites conocidos (hay que probar en dispositivos reales)
- **No se probó en iPhone/iPad ni en Android reales.** Chromium de escritorio con dispositivos simulados no reproduce: bloqueo de pantalla, audio en segundo plano, cambio de red WiFi↔datos, permisos de Safari ni la política de reproducción de iOS. Hay una lista de verificación manual en `docs/testing/audio-dispositivos-reales.md`.
- Cámara: es opcional en el CLAUDE.md y queda fuera de esta fase (los tokens ya no permiten publicar vídeo).
- Sin límite de tasa en `/api/livekit/*` (Fase 8).
