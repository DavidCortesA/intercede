# INTERCEDE — Contexto del proyecto e instrucciones de desarrollo (v3, desde cero)

## 1. Qué es INTERCEDE

**Tagline:** Ora. Conecta. Permanece.
**Frase de marca:** Una comunidad que ora junta.

INTERCEDE es una **PWA de oración en línea** (instalable en celular y escritorio) con una **landing page pública** en el mismo proyecto. Permite orar con otras personas por voz, compartir peticiones de oración, programar momentos de oración y, opcionalmente, agrupar todo en comunidades (iglesias, ministerios, grupos).

Las apps actuales de oración son limitadas o son reuniones genéricas (Zoom, Meet). INTERCEDE está hecha para orar.

### Principio rector (decide todo)

> Una persona que solo quiere orar debe estar orando en menos de 15 segundos, sin cuenta, sin elegir iglesia, sin configurar nada.

El producto tiene **todas las funciones**, pero en **capas**:

1. **Capa 1 — Orar ya** (sin cuenta): crear/unirse a una sala, audio, peticiones en vivo.
2. **Capa 2 — Mi vida de oración** (cuenta opcional): historial, diario, peticiones propias, recordatorios, programación.
3. **Capa 3 — Comunidades** (opcional): iglesia/grupo con salas recurrentes, muro de oración y administración simple.

Una persona nunca debe necesitar las capas 2 o 3 para usar la capa 1. La interfaz principal jamás muestra conceptos de iglesia, equipos o roles a quien solo quiere orar.

## 2. Punto de partida

El repositorio está **vacío / se empieza desde cero**. No hay código previo que auditar ni reutilizar. Si existe cualquier archivo, revisarlo antes de sobrescribir. No asumir configuraciones: crear el proyecto limpio y documentar cada decisión.

## 3. Stack

### Frontend / PWA
- Next.js (App Router, última versión estable), React, TypeScript strict
- Tailwind CSS + shadcn/ui + Lucide React + Motion
- Zustand (estado de UI), TanStack Query (datos), React Hook Form + Zod
- **PWA**: `app/manifest.ts` (manifest nativo de Next.js), service worker con **Serwist** (`@serwist/next`) para caché y página offline, íconos maskable, `theme-color`, splash. Evaluar si Serwist es compatible con la versión de Next elegida antes de instalarlo; si no, service worker propio mínimo.
- **Web Push** con VAPID (`web-push`) para recordatorios e invitaciones.
- Internacionalización con `next-intl` (español primero, preparado para inglés y portugués).

### Backend (Supabase)
- **Auth**: Anonymous Sign-ins (invitados), email/contraseña y Google; un usuario anónimo puede convertirse en permanente conservando su historial.
- **Postgres con RLS en todas las tablas.**
- **Realtime**: peticiones, presencia y estado de sala.
- **Storage**: avatares y logos de comunidades.
- **Edge Functions + pg_cron**: recordatorios y envío de push/correo programados.
- `@supabase/supabase-js` + `@supabase/ssr`. Migraciones con **Supabase CLI**; tipos con `supabase gen types typescript`.
- Route Handlers / Server Actions solo para lo que requiere secretos (token de LiveKit, suscripciones push).

### Audio / video
- **LiveKit Cloud**: `livekit-client`, `@livekit/components-react`, `@livekit/components-styles`, `livekit-server-sdk`.
- Audio primero; cámara opcional y apagada por defecto.
- El servidor valida la sesión de Supabase y la membresía de la sala, y emite un JWT corto (TTL 2 h con renovación). El navegador se conecta directo a LiveKit.
- No asumir que expirar el token desconecta a quien ya está conectado; la expulsión se hace desde el servidor (API de LiveKit).

### Infra y calidad
- Vercel (hosting), Sentry (errores), GitHub Actions (CI), Resend (correo transaccional)
- Analítica de privacidad respetuosa (Vercel Analytics o PostHog), sin rastrear contenido de oraciones
- Vitest, Playwright, ESLint, TypeScript strict
- Cobros (futuro): Stripe o Conekta. No implementar hasta definir el modelo de planes.

## 4. Arquitectura

- Monolito modular por funcionalidad. Sin microservicios, Redis ni Kubernetes.
- Server Components por defecto; Client Components solo para audio, Realtime, PWA/SW e interactividad.
- La seguridad vive en la base de datos (**RLS**), nunca solo en el frontend.
- `SUPABASE_SERVICE_ROLE_KEY`, `LIVEKIT_API_SECRET` y `VAPID_PRIVATE_KEY` solo en servidor, sin prefijo `NEXT_PUBLIC_`.
- Landing y app comparten identidad visual y sistema de diseño, pero la landing es 100 % estática/SSG y no depende de sesión.

### Estructura

```
src/
├── app/
│   ├── [locale]/
│   │   ├── (marketing)/      # landing, precios, privacidad, términos, blog (futuro)
│   │   ├── (auth)/           # login, registro, recuperar
│   │   ├── (app)/            # inicio, salas, diario, comunidades, perfil
│   │   └── r/[code]/         # sala de oración (pantalla completa)
│   ├── api/ (livekit/token, push/subscribe)
│   ├── manifest.ts
│   └── sw.ts
├── components/ (ui, shared, layout, marketing)
├── features/
│   ├── rooms/  live-audio/  prayer-requests/  prayer-journal/
│   ├── schedules/  notifications/  devotionals/  events/  communities/  auth/  moderation/
├── lib/ (supabase, livekit, push, validations, utils)
├── hooks/ stores/ types/ config/ messages/ (i18n)
supabase/ (migrations, functions, seed.sql, config.toml)
public/ (icons, screenshots)
tests/ (unit, integration, e2e)
```

## 5. Funcionalidades completas

### 5.1 Capa 1 — Orar ya (sin cuenta)
- Botón principal "Crear sala de oración" → enlace corto `/r/abc123` y entrada inmediata.
- Unirse por enlace o código escribiendo solo un nombre.
- Audio en vivo, orador activo, lista de participantes, silenciar/activar micrófono, salir.
- Modo **oyente** (sin publicar audio).
- Cámara opcional.
- Controles del anfitrión: silenciar a todos/uno, expulsar, cerrar sala, bloquear sala.
- Peticiones de oración en vivo en la sala (Realtime); marcar como respondida.
- Mantener pantalla encendida durante la sala (Wake Lock API) y manejo claro de permisos de micrófono, reconexión y mala conexión.
- Capacidad objetivo: 20 participantes por sala.

### 5.2 Capa 2 — Mi vida de oración (cuenta opcional)
- Registro/login, recuperación de contraseña, convertir invitado en cuenta.
- Perfil (nombre, avatar, idioma, zona horaria).
- Historial de salas.
- **Diario de oración**: peticiones personales, categorías simples, estado (en oración / respondida) y testimonio de respuesta.
- Botón "Estoy orando por esto" con contador en peticiones compartidas.
- Salas programadas (únicas y recurrentes, p. ej. "diario 6:00 am"), con zona horaria correcta.
- Recordatorios por **push** y correo; preferencias de notificaciones.
- Salas favoritas y enlaces de invitación revocables.
- **Devocionales**: lectura diaria breve (pasaje, reflexión, pregunta de aplicación, oración sugerida), marcar como leído, guardar notas personales y llevar una racha suave (sin presión ni gamificación agresiva; coherente con "Permanece"). Los devocionales de comunidad los publican admin/líderes. **Decisión pendiente antes de construir:** versión bíblica y licencia (usar una de dominio público, como Reina-Valera 1909, o una licenciada) y origen del contenido devocional; preguntar al propietario.

### 5.3 Capa 3 — Comunidades (opcional)
- Crear comunidad (iglesia, ministerio, grupo), perfil con logo, código/enlace de invitación.
- Roles simples: **admin**, **líder** (crea salas), **miembro**.
- Salas recurrentes de la comunidad y calendario.
- **Muro de oración** de la comunidad (visibilidad: comunidad / privada).
- Gestión de miembros e invitaciones.
- Una persona puede pertenecer a varias comunidades.
- **Eventos**: la comunidad crea eventos (vigilias, retiros, ayunos, cultos) con fecha, zona horaria, descripción y enlace a sala de oración; confirmación de asistencia (RSVP), recordatorios y exportar a calendario (.ics).
- Esta capa se añade sin modificar el flujo de la capa 1.

### 5.4 Moderación y privacidad
- Reportar sala/petición/usuario, bloquear usuarios.
- Peticiones privadas por defecto; nada se hace público sin acción explícita.
- Sin grabaciones. Sin transcripciones. Eliminación de cuenta y datos.
- Política de privacidad y términos claros (contenido espiritual sensible).

### 5.5 Landing page
Pública, rápida, SEO sólido, bilingüe-preparada. Secciones:
1. Hero con mensaje claro, tagline y CTA doble: "Orar ahora" (crea sala sin cuenta) e "Instalar la app".
2. El problema (apps limitadas) y la solución.
3. Cómo funciona en 3 pasos.
4. Funciones (audio, peticiones, programación, comunidades).
5. Para iglesias y ministerios.
6. Privacidad y confianza.
7. Preguntas frecuentes.
8. Pie con privacidad, términos y contacto.
Incluir metadatos Open Graph, `sitemap.xml`, `robots.txt`, JSON-LD y rendimiento Lighthouse ≥ 90. Botón/instrucciones de instalación PWA (incluido iOS: "Añadir a pantalla de inicio").

### 5.6 Panel interno mínimo (futuro cercano)
Métricas básicas y moderación para el administrador de la plataforma. Sin construirlo antes de tener usuarios.

### 5.7 Después (modelo de negocio)
Planes y cobros para comunidades (Stripe/Conekta), analítica por comunidad, integración con calendario, app nativa solo si la PWA se queda corta.

## 6. Limitaciones PWA que Claude debe respetar

- **iOS**: Web Push solo funciona con la app instalada en pantalla de inicio (iOS 16.4+); diseñar el onboarding para pedir instalación antes de pedir permiso de notificaciones.
- El audio en segundo plano y el micrófono con pantalla bloqueada pueden ser inconsistentes en navegadores móviles; probar en dispositivos reales (iOS Safari y Android Chrome) y comunicar límites al usuario.
- El service worker **no debe cachear** respuestas autenticadas ni tokens de LiveKit; solo recursos estáticos y la página offline.
- Pedir permisos (micrófono, notificaciones) en contexto y nunca al cargar la página.

## 7. Modelo de datos

Proponer el esquema final antes de crear migraciones. Base de referencia (todas con RLS):

**Capa 1:** `profiles`, `rooms` (code, name, host_id, status, community_id nullable, is_locked, scheduled_at nullable, created_at, closed_at), `room_members` (room_id, user_id, role `host|participant`, joined_at, left_at), `prayer_requests` (room_id nullable, community_id nullable, author_id, content, visibility, is_answered, testimony, created_at)

**Capa 2:** `prayer_journal_entries`, `prayer_support` (quién ora por qué petición), `room_schedules` (recurrencia, zona horaria), `push_subscriptions`, `notification_preferences`, `notifications`, `devotionals` (contenido, fecha, community_id nullable), `devotional_progress` (leído, notas)

**Capa 3:** `communities`, `community_members` (role `admin|leader|member`), `community_invites`, `events` (community_id, título, inicia_en, zona horaria, room_id nullable), `event_rsvps`

**Moderación:** `reports`, `blocks`

Reglas RLS de referencia:
- Solo miembros de una sala leen sus peticiones; solo el autor o el anfitrión edita/borra.
- Solo el anfitrión cierra, bloquea o expulsa.
- Solo miembros de una comunidad ven su muro; solo admin/líder crean salas de comunidad.
- Un usuario solo ve y edita sus propios datos personales, diario y suscripciones push.
- Escribir pruebas de RLS por cada tabla (usuario A nunca accede a datos de B).

## 8. Identidad visual y diseño

### 8.1 Logo

- **Símbolo:** dos formas curvas tipo alas/manos abiertas que forman una montaña, con una **cruz dorada en la cima**.
- **Wordmark:** INTERCEDE en sans-serif geométrica, peso muy bold, azul marino. Debajo, "ORA · CONECTA · PERMANECE" en mayúsculas con mucho espaciado entre letras.
- **Variantes:** (a) ícono con fondo degradado violeta→azul y símbolo blanco; (b) fondo azul marino con símbolo blanco; (c) fondo blanco con símbolo a color y cruz dorada; versión horizontal completa; versión blanca monocroma para fondos oscuros o fotografías.
- **Archivos:** los entrega el propietario del proyecto y se guardan en `public/brand/` (SVG preferido, PNG de respaldo). **Claude no debe redibujar, aproximar ni inventar el logo.** Si aún no están los archivos, usar un placeholder de texto "INTERCEDE" claramente temporal y avisarlo.

### 8.2 Paleta de color

Valores base tomados de la tabla de marca; confirmar contra los archivos originales y ajustar los tokens si difieren.

| Token | Hex | Uso |
|---|---|---|
| `brand-violet` | `#5B2EE6` | Color primario: botones, enlaces, énfasis, íconos activos |
| `brand-blue` | `#2563FF` | Par del degradado primario, estados interactivos |
| `brand-cyan` | `#12B8DA` | Acento puntual (destacados, indicadores en vivo). Solo sobre fondos oscuros |
| `brand-gold` | `#F5A640` | Cruz del logo y **oración respondida**. Nunca como texto sobre blanco |
| `brand-cream` | `#FBF5EA` | Fondo claro cálido, secciones alternas de la landing |
| `brand-navy-900` | `#0A1240` | Fondo oscuro principal, texto sobre fondo claro |
| `brand-navy-800` | `#131C4F` | Superficies elevadas en modo oscuro (tarjetas, hojas) |

- **Degradado de marca:** `linear-gradient(135deg, #5B2EE6 0%, #2563FF 100%)` para CTA principal, ícono de la app y héroes. Para fondos de pantalla de bienvenida, sumar `#0A1240` hacia abajo.
- Generar escalas 50–950 por color (preferible en OKLCH) y exponerlas como tokens de Tailwind 4 con `@theme`; usar tokens **semánticos** en componentes (`background`, `foreground`, `primary`, `accent`, `surface`, `success`, `answered`), nunca hexadecimales sueltos.
- **Modo claro:** fondo blanco/crema, texto `brand-navy-900`, primario violeta.
- **Modo oscuro (predeterminado en la pantalla de bienvenida y en la sala de oración):** fondo `brand-navy-900`, superficies `brand-navy-800`, texto crema/blanco, primario en una variante más clara de violeta para mantener contraste.
- **Accesibilidad:** verificar contraste AA con una herramienta automática. Blanco sobre violeta cumple; cian y dorado no cumplen sobre blanco, por eso se restringen a fondos oscuros o a íconos/decoración.

### 8.3 Tipografía

- Títulos: **Plus Jakarta Sans** (700–800), cercana a la sensación geométrica del wordmark. Cuerpo e interfaz: **Inter**. Cargar con `next/font`, sin fuentes externas en tiempo de ejecución.
- Tagline y etiquetas pequeñas: mayúsculas con `tracking` amplio, como en el logo.
- Si el propietario confirma la fuente exacta del wordmark, se usa solo para el logo (como imagen), no para el texto de la interfaz.

### 8.4 Lenguaje visual (según la tabla de marca)

- Esquinas muy redondeadas (`rounded-2xl`/`3xl`), botones **píldora** con degradado violeta→azul, tarjetas navy con ícono en un recuadro tintado de violeta.
- Íconos de línea (Lucide) en lavanda/violeta sobre fondos navy.
- Resaltado de palabra clave con color primario y subrayado de trazo suave (ej. "**ora**" en el titular).
- Fotografía: paisaje de montaña al atardecer con silueta de cruz, en tonos violeta-azul-ámbar, solo en landing y pantallas de bienvenida, con superposición navy para legibilidad. Evitar manos rezando y otros clichés de banco de imágenes. Usar imágenes con licencia libre o generadas.
- **Módulos principales y su ícono:** Salas de oración (`Video`/`Mic`), Comunidades (`Users`), Peticiones (`Heart`), Devocionales (`BookOpen`), Eventos (`CalendarDays`), Recordatorios (`Bell`).
- **Navegación progresiva:** un invitado sin cuenta solo ve *Orar* y *Peticiones*. Devocionales, Eventos, Recordatorios y Comunidades aparecen al crear cuenta o unirse a una comunidad. Cumple el principio rector de la sección 1.

### 8.5 Textos de marca

- Titular de landing: **"Una comunidad que ora junta."**
- Bienvenida en la app: **"Bienvenido. Conectemos en oración, crezcamos en la fe."**
- CTA principal: **"Comenzar"** (en la landing: "Orar ahora").

### 8.6 PWA

`theme_color` y `background_color`: `#0A1240`. Íconos PWA (192, 512 y **maskable** con zona segura) generados desde la variante (a) o (b). Splash en navy con el símbolo en blanco.

### 8.7 Principios de interfaz

Premium, minimalista y calmado. Referencias: Linear, Stripe, Vercel, Notion.
- Móvil primero (uso principal desde celular); modo claro y oscuro.
- Pantalla de sala sobria, sin distracciones, controles grandes y accesibles.
- Tipografía fuerte, mucho espacio, animaciones sutiles.
- Identidad cristiana discreta; evitar estética de software eclesial anticuado.
- Tokens de diseño centralizados; accesibilidad AA, teclado y lector de pantalla; pensar en personas mayores y conexiones lentas.

## 9. Estándares de desarrollo

1. TypeScript strict, sin `any`.
2. Validar toda entrada externa con Zod.
3. Autorización en servidor/RLS; no confiar en IDs o roles del cliente.
4. Componentes pequeños, sin abstracciones prematuras.
5. Lógica de negocio fuera de los componentes de UI.
6. Errores explícitos: sala llena, enlace inválido, permiso denegado, conexión perdida, sin red.
7. Justificar cada dependencia nueva.
8. Nunca commitear secretos; `.env.local` local, `.env.example` documentado.
9. Commits pequeños y descriptivos; documentar decisiones de arquitectura en `docs/decisions/`.

## 10. Variables de entorno

```
NEXT_PUBLIC_SITE_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=   # antes "anon key"; pública por diseño
SUPABASE_SERVICE_ROLE_KEY=       # solo servidor

LIVEKIT_URL=
NEXT_PUBLIC_LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=              # solo servidor

NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=               # solo servidor
VAPID_SUBJECT=

RESEND_API_KEY=
SENTRY_DSN=
```

No inventar ni mostrar credenciales. Nunca imprimir valores secretos.

## 11. Hoja de ruta

**Fase 0 — Fundación.** Crear el proyecto Next.js limpio, TypeScript strict, Tailwind, shadcn/ui, ESLint, Vitest, Playwright, estructura de carpetas, i18n base, tokens de diseño, CI, `.env.example`, manifest y service worker mínimos (instalable).

**Fase 1 — Landing.** Todas las secciones de 5.5, SEO, rendimiento, botón de instalación PWA. Sin depender aún del backend.

**Fase 2 — Supabase base.** Proyecto Supabase, CLI, migraciones, tipos, cliente SSR, Anonymous Auth, `profiles` con RLS.

**Fase 3 — Salas y peticiones (capa 1, sin audio).** Crear/unirse, `room_members`, cerrar sala, peticiones en vivo con Realtime. RLS probado.

**Fase 4 — Audio con LiveKit.** Endpoint de token, micrófono, orador activo, oyente, controles del anfitrión, reconexión, Wake Lock. Prueba en dispositivos reales.

**Fase 5 — Cuentas y vida de oración (capa 2).** Registro/login, conversión de invitado, perfil, historial, diario, "estoy orando por esto".

**Fase 6 — Devocionales, programación y notificaciones.** Devocionales y progreso, salas programadas/recurrentes, zonas horarias, push, correo, preferencias, pg_cron + Edge Functions.

**Fase 7 — Comunidades y eventos (capa 3).** Comunidades, roles, invitaciones, salas, muro de la comunidad, eventos con RSVP y exportación a calendario.

**Fase 8 — Moderación y producción.** Reportes, bloqueos, eliminación de datos, auditoría de seguridad y RLS, pruebas unit/integración/e2e, accesibilidad, rendimiento, Sentry, despliegue en Vercel.

**Después:** panel interno, planes y cobros, analítica por comunidad.

No avanzar de fase con problemas críticos abiertos. Cada fase termina con la app estable, tipada y probada.

## 12. Cómo debe trabajar Claude

Actúa como arquitecto de software senior y desarrollador full-stack. Avanza por fases, prioriza correctitud sobre velocidad y **defiende la simplicidad de la capa 1**.

Reglas:
- Una fase a la vez; no mezclar fases.
- Explicar brevemente cada decisión de arquitectura.
- No instalar dependencias sin explicar por qué.
- No cambiar el stack sin justificación explícita.
- No crear implementaciones falsas que simulen funcionar.
- No dejar decisiones de seguridad al frontend.
- No inventar variables de entorno ni credenciales.
- Correr typecheck, lint y pruebas relevantes tras cada cambio importante.
- Si algo es ambiguo y afecta la arquitectura o la simplicidad del producto, preguntar antes de implementar.

Para cada tarea: explicar cambios → implementar → validar → listar archivos modificados → reportar pendientes → proponer el siguiente paso.

## 13. Primera tarea

Ejecuta la **Fase 0 — Fundación**. Antes de escribir código, presenta:

1. Versiones exactas que usarás (Next.js, React, Tailwind, Supabase, LiveKit, Serwist) y por qué.
2. Estructura final de carpetas.
3. Convenciones de código y de commits.
4. Esquema de base de datos propuesto con políticas RLS (solo propuesta, sin migrar todavía).
5. Plan ordenado de las fases 0 a 3 con criterios de "terminado".

Espera mi aprobación antes de instalar dependencias o crear archivos.

## 14. Planes y cobros (MXN)

> Los precios y límites son una **propuesta inicial**. Deben vivir en configuración/base de datos (tabla `plans`), nunca escritos a mano en componentes. Se ajustan tras medir el uso real durante 2–3 meses. Precios con IVA incluido (confirmar con contador, y definir emisión de facturas CFDI para organizaciones).

### 14.1 Principio

Orar siempre es gratis. Se cobra por **capacidad** (duración, personas, salas simultáneas, cámaras) y por **administración de organización** (miembros, horas incluidas). Un invitado que entra por enlace nunca cuenta como miembro y nunca ve un muro de pago antes de poder orar.

### 14.2 Costo base de referencia (para calibrar precios)

- LiveKit cobra por minuto de cada participante conectado (2 personas × 10 min = 20 minutos). Referencia (plan Ship): US$50/mes con 150,000 minutos incluidos y ~US$0.0005 por minuto extra.
- Equivale a ~**MXN 0.54 por persona-hora** de audio (a MXN 18/USD, con colchón). Vigilia de 30 personas × 24 h en el peor caso ≈ MXN 390; realista ≈ MXN 120–160.
- El **video** agrega consumo de ancho de banda que aún no está calculado: validar con el panel de LiveKit antes de fijar los límites de cámara.

### 14.3 Pagos por evento (pago único)

| Producto | Precio MXN | Incluye |
|---|---|---|
| **Gratis** | $0 | Salas de hasta 2 h, 15 personas por sala, 4 salas simultáneas |
| **Sala Larga** | $79 | 1 sala, 6 h, hasta 30 personas |
| **Vigilia** | $249 | 1 sala, 24 h, hasta 30 personas |
| **Vigilia Grande** | $799 | 1 sala, 24 h, hasta 100 personas |
| **Extensión de sala** | $39 | +2 h en una sala en curso (hasta 30 personas) |

### 14.4 Planes de organización (iglesia, ministerio, grupo)

| Plan | Mensual | Anual (2 meses gratis) | Miembros | Salas simultáneas | Duración por sala | Personas por sala | Horas-persona/mes | Cámaras simultáneas |
|---|---|---|---|---|---|---|---|---|
| **Comunidad** | $0 | $0 | 30 | 4 | 2 h | 15 | — | 4 (360p) |
| **Plus** | $499 | $4,990 | 100 | 10 | 6 h | 30 | 500 | 12 (720p) |
| **Pro** | $1,499 | $14,990 | 500 | 30 | 12 h | 100 | 1,500 | 25 (720p) |
| **Red / Ministerio** | Cotización | | A medida | A medida | A medida | A medida | A medida | A medida |

Valores de cámaras: iniciales, a validar con costos reales de video.

### 14.5 Extras (organizaciones de pago)

| Extra | Precio MXN |
|---|---|
| +50 miembros | $99 / mes |
| +5 salas simultáneas | $149 / mes |
| Bolsa de +100 horas-persona (vigencia 90 días) | $99 |
| Vigilia (40 % menos con Plus o Pro) | $149 |
| Vigilia Grande (40 % menos con Plus o Pro) | $479 |

Prueba gratuita de 14 días de Plus al crear la organización, sin tarjeta.

### 14.6 Definiciones

- **Miembro:** cuenta vinculada a la organización (alta por correo, enlace de invitación o código). Los invitados por enlace de sala **no** son miembros.
- **Hora-persona:** una persona conectada una hora a una sala de la organización (se mide en minutos).
- **Sala simultánea:** sala con al menos un participante conectado.

### 14.7 Modelo de datos de billing (propuesta; todas con RLS)

- `plans`: code, nombre, precios mensual/anual en MXN, `limits` (jsonb con los límites de 14.4).
- `subscriptions`: owner_type (`user`|`community`), owner_id, plan_code, status, provider, provider_subscription_id, current_period_end.
- `passes`: owner, kind (`sala_larga`|`vigilia`|`vigilia_grande`|`extension`), room_id nullable, starts_at, expires_at, `limits` jsonb, status.
- `addons`: subscription_id, kind, quantity.
- `usage_events`: room_id, community_id nullable, participant, joined_at, left_at, minutes (alimentada por webhooks de LiveKit: participante entró/salió, sala terminó).
- `usage_periods`: community_id, periodo, person_minutes.
- `payment_events`: provider, provider_event_id (**único**, idempotencia), payload, processed_at.

### 14.8 Cómo se aplican los límites

1. Una función única `getEntitlements(owner)` devuelve los límites efectivos (plan + extras + pases vigentes). **Ningún componente decide límites por su cuenta.**
2. Al emitir el token de LiveKit el servidor verifica límites, fija el `maxParticipants` de la sala y la duración máxima. Un token vencido no desconecta a nadie ya conectado: el servidor debe **cerrar la sala** (API de LiveKit) al llegar al límite.
3. Avisos antes de cortar: a los 10 minutos y a los 2 minutos del límite se avisa al anfitrión con opción "Extender +2 h". Gracia corta de 5 minutos; nunca cortar una oración sin aviso.
4. Al agotar las horas-persona del mes: no se corta; se avisa al administrador y se ofrece la bolsa de +100 h. Las salas siguen hasta el aviso final definido por producto.
5. Plan gratis: tope de salas por día por dispositivo y captcha en el alta de invitados anónimos.
6. **Construir los límites (entitlements) desde las fases 3–4 aunque todavía no se cobre**; el cobro real se conecta en la fase de billing.

### 14.9 Pasarelas de pago

- **Conekta:** pagos únicos (tarjeta, OXXO, SPEI). OXXO y SPEI confirman de forma asíncrona: activar el pase solo al recibir el webhook.
- **Stripe o Conekta:** suscripciones con tarjeta.
- Webhooks verificados por firma, procesados una sola vez (`provider_event_id` único) y con reintentos seguros. Nunca confiar en la redirección del navegador como prueba de pago.
- Una capa delgada por proveedor; no abstraer más de lo necesario.

### 14.10 Fase de billing (después de la Fase 8 del roadmap)

**Fase 9 — Planes y cobros.** Planes, pases, extras, pasarelas, webhooks, medición de uso, pantalla de facturación de la organización, avisos de límite, pruebas de idempotencia y de límites. No implementar antes de que el producto base esté estable.

---

## 15. Organizaciones, peticiones de la iglesia y sala con cámara

### 15.1 Cómo se crea una organización

1. Desde Perfil → "Crear comunidad": nombre, tipo (iglesia, ministerio, grupo), logo opcional. Quien la crea es **admin**.
2. Nace en el plan **Comunidad (gratis)**. La administración de facturación vive en la comunidad, no en la persona.
3. Invitar miembros por: enlace/código, correo (pegar lista o CSV; se descuenta del límite de miembros) o desde cuenta existente.
4. Roles: admin, líder (crea salas y publica peticiones), miembro.
5. Pasar a Plus/Pro desde "Facturación" de la comunidad, con prueba de 14 días.
6. Una persona puede pertenecer a varias comunidades y elegir en cuál crear la sala; la sala rápida personal sigue existiendo y no pide comunidad.

### 15.2 Peticiones de la iglesia y la sala

**Peticiones generales de la iglesia:** los líderes las publican en el muro de la comunidad y pueden **fijarlas** como "Peticiones de la iglesia" (activas hasta que se marquen como respondidas o se archiven).

**Al crear una sala de comunidad:**
- Por defecto, la sala **incluye las peticiones fijadas activas** de la iglesia, ya preseleccionadas. El flujo es de un toque: "Crear sala".
- Opción "Personalizar": checklist para quitar/añadir peticiones, y ordenar la lista.
- Ajuste "¿Quién puede agregar peticiones en vivo?": todos / solo líderes / con aprobación del anfitrión.
- **La sala rápida personal (capa 1) no muestra este paso**: se crea vacía y las peticiones se agregan en vivo.

**Privacidad:** al entrar a la sala se guarda una **copia (snapshot)** del texto de cada petición seleccionada. Un invitado no miembro solo ve las peticiones seleccionadas para esa sala, nunca el muro completo. Cada petición puede marcarse como anónima.

### 15.3 Estados de las peticiones dentro de la sala

| Estado | Significado | Quién lo cambia |
|---|---|---|
| **En cola** | Preseleccionada de la iglesia o agregada por el anfitrión; pendiente de orar | Anfitrión/líder |
| **Nuevas** | Agregadas en vivo por participantes, a la espera de aprobación (si aplica) | Participantes → anfitrión aprueba |
| **Orando ahora** | La petición en foco; todos la ven destacada | Anfitrión ("Siguiente") |
| **Oradas** | Ya se oró por ella en esta sala | Automático al avanzar |

Reglas:
- Solo hay **una** petición "Orando ahora" por sala; el anfitrión avanza con "Siguiente" o toca otra de la cola.
- Los participantes pueden tocar "Estoy orando por esto" (contador en vivo).
- Al cerrar la sala, el anfitrión decide qué peticiones se archivan, siguen activas en la comunidad o se marcan como respondidas.
- Datos: tabla `room_prayer_items` (room_id, request_id nullable, content_snapshot, is_anonymous, position, status `queued|pending|current|prayed`, source `community|host|live`, created_by). Todo con Realtime y RLS por sala.

### 15.4 Vistas de cámara (escenarios)

Cada persona elige su vista; la elección es local. Antes de entrar: **"Solo escuchar / Solo audio / Audio y cámara"**.

1. **Solo voz (predeterminada):** avatares con indicador de orador activo. Menos datos, ideal en celular.
2. **Orador activo:** el orador en pantalla grande y los demás en una tira pequeña.
3. **Cuadrícula:** mosaico paginado (4, 9 o 12 por página). Solo se suscribe al video de los mosaicos visibles (suscripción adaptativa de LiveKit).
4. **Oración guiada:** la petición "Orando ahora" grande y destacada, con una tira de video pequeña. Pensada para pasar de petición en petición.

**Panel de peticiones (en todas las vistas):**
- Escritorio y tablet: panel lateral derecho (~320 px), colapsable.
- Celular: hoja inferior (bottom sheet) con 3 posiciones: cerrada, "peek" (muestra la petición actual) y expandida.
- Pestañas: **Ahora** (petición en foco), **Siguientes** (cola), **Nuevas** (agregadas en vivo). Campo rápido "Agregar petición" siempre disponible según el ajuste de la sala.

**Reglas de video y costo:**
- El límite de cámaras simultáneas y la calidad dependen del plan (14.4). Quien no tiene "cupo de cámara" entra con audio.
- Video apagado por defecto; el anfitrión puede pedir apagar cámaras.
- Calidad adaptativa; reducir la de mosaicos pequeños.
- Respetar el principio rector: entrar solo con audio siempre debe ser un toque.

### 15.5 Decisiones aún abiertas (preguntar al propietario antes de implementar)

1. ¿Las peticiones de la iglesia incluidas por defecto son **todas las fijadas** o solo las marcadas como "para esta semana"?
2. ¿Los participantes pueden proponer peticiones en la sala por defecto, o solo con aprobación del anfitrión?
3. ¿La vista "Oración guiada" aparece solo cuando hay peticiones en cola o siempre?
4. ¿El anfitrión puede **forzar** una vista a todos (por ejemplo "todos en oración guiada") o cada persona elige la suya?

### 15.6 Cargar peticiones de la iglesia: manual, CSV o Excel

Quien carga peticiones al muro de la comunidad (admin o líder) tiene tres caminos, desde **Comunidad → Muro de oración → "Agregar peticiones"**:

1. **Una por una (manual).**
2. **Importar archivo CSV.**
3. **Importar archivo Excel (.xlsx).**

El camino manual es el predeterminado y el más corto. La importación es para cargar muchas de una vez (por ejemplo la lista semanal de la iglesia).

#### Alta manual (una petición)

Formulario con los mismos campos del archivo:

| Campo | Control | Reglas |
|---|---|---|
| Petición | Texto con contador | Obligatorio, máximo 280 caracteres |
| Por quién | Texto | Opcional |
| Categoría | Selector | salud, familia, trabajo, finanzas, iglesia, nación, misiones, gratitud, otro (predeterminada: otro) |
| Anónima | Interruptor | Si está activo no se muestra quién la publicó |
| Fijar como petición de la iglesia | Interruptor | Si está activo entra preseleccionada al crear salas de la comunidad (ver 15.2) |
| Vence | Selector de fecha | Opcional; pasada esa fecha se archiva sola |

- Botones: **Guardar** y **Guardar y agregar otra** (para cargar varias seguidas sin salir del formulario).
- Después se puede editar, reordenar (arrastrar), archivar o marcar como respondida.

#### Importar CSV o Excel

**Plantillas descargables** desde la misma pantalla: `public/templates/plantilla-peticiones.xlsx` (con hoja de instrucciones y listas desplegables) y `public/templates/peticiones-ejemplo.csv`.

**Columnas** (la primera fila es el encabezado):

| Columna | Obligatoria | Valores | Ejemplo |
|---|---|---|---|
| `peticion` | Sí | Texto, máx. 280 caracteres | Por la salud de los enfermos de nuestra congregación |
| `por_quien` | No | Texto | Familia Pérez |
| `categoria` | No | salud, familia, trabajo, finanzas, iglesia, nacion, misiones, gratitud, otro. Vacío = otro | salud |
| `anonima` | No | si / no. Vacío = no | no |
| `fijar` | No | si / no. Vacío = no | si |
| `vence` | No | AAAA-MM-DD. Vacío = no vence | 2026-12-31 |
| `orden` | No | Número entero (1 aparece primero). Vacío = al final | 1 |

**Ejemplo de CSV:**

```csv
peticion,por_quien,categoria,anonima,fijar,vence,orden
"Por la salud de los enfermos de nuestra congregación",,salud,no,si,2026-12-31,1
"Por las familias que atraviesan momentos difíciles",,familia,no,si,2026-12-31,2
"Por sabiduría y fortaleza para nuestros pastores y líderes",,iglesia,no,si,,3
"Por el retiro de mujeres del 22 de noviembre",,iglesia,no,si,2026-11-22,4
"Por la cirugía de mañana y una recuperación completa","Familia Pérez",salud,si,no,2026-11-20,5
"Por provisión y trabajo para quienes están desempleados",,trabajo,no,no,,6
```

**Reglas de lectura (tolerantes, porque la gente guarda los archivos de formas distintas):**
- Aceptar `.csv` (UTF-8, con o sin BOM; separador coma **o punto y coma**, porque Excel en español exporta con punto y coma) y `.xlsx`. Rechazar `.xlsm`, `.xls` y cualquier archivo con macros.
- En Excel leer la hoja llamada "Peticiones"; si no existe, la primera hoja. Ignorar la hoja "Instrucciones".
- Encabezados sin distinguir mayúsculas ni acentos, y con alias razonables (`petición`, `por quién`, `categoría`, `anónima`).
- Booleanos: `si`, `sí`, `no`, `true`, `false`, `1`, `0`.
- Fechas: `AAAA-MM-DD` o `DD/MM/AAAA`; en Excel aceptar también celdas con formato de fecha.
- Límites: máximo **200 filas** y **5 MB** por archivo.
- Todo se lee como **texto**: no evaluar fórmulas ni ejecutar nada. Quitar HTML y caracteres de control.

**Flujo de importación:**
1. Subir el archivo.
2. El servidor lo analiza y valida cada fila con Zod (nunca confiar en una validación solo del navegador).
3. **Vista previa** en tabla con el estado de cada fila: correcta, advertencia (por ejemplo categoría desconocida → "otro", petición repetida) o error (vacía, más de 280 caracteres, fecha inválida).
4. Se puede corregir una fila en la misma vista previa o quitarla.
5. Botón **"Importar N peticiones"**: importa solo las filas válidas. Nada se guarda antes de confirmar.
6. Resumen final ("38 importadas, 2 omitidas") con descarga de las filas con error.
7. **Deshacer** la importación completa durante las primeras 24 horas (se revierte por lote).

**Detección de duplicados:** comparar el texto (sin mayúsculas, acentos ni espacios extra) contra las peticiones activas de la comunidad y dentro del mismo archivo; marcar como advertencia, nunca bloquear.

#### Seguridad y permisos
- Solo **admin y líder** de la comunidad pueden importar o crear peticiones de la iglesia (validado en el servidor y con RLS).
- Al **exportar** peticiones a CSV, anteponer una comilla a cualquier celda que empiece con `=`, `+`, `-` o `@` para evitar inyección de fórmulas al abrirlo en Excel.
- Límite de importaciones por comunidad y hora (evitar abuso).
- Dependencias de lectura de archivos: justificar antes de instalar y elegir librerías mantenidas (por ejemplo una para CSV y una para .xlsx), revisando su historial de vulnerabilidades. Procesar el archivo en el servidor, con tamaño limitado.

#### Modelo de datos (agregar a `prayer_requests`; todas con RLS)
- `source`: `manual` | `import` | `live`
- `import_batch_id` (nullable), `category`, `for_whom` (por quién), `is_anonymous`, `is_pinned`, `expires_at`, `sort_order`
- Tabla `request_import_batches`: id, community_id, created_by, filename, rows_total, rows_ok, rows_skipped, created_at, reverted_at
- Tarea programada (pg_cron): archivar las peticiones cuyo `expires_at` ya pasó.

#### Criterios de "terminado"
- Se puede crear una petición manual, importar el CSV de ejemplo y el Excel de plantilla, y ver la vista previa con errores por fila.
- Un archivo con acentos, con punto y coma y guardado desde Excel en español se importa bien.
- Un archivo de 201 filas, uno de más de 5 MB, uno `.xlsm` y uno con fórmulas se rechazan o se leen como texto sin ejecutar nada.
- Un miembro sin rol de líder no puede importar (prueba de RLS).
- Deshacer una importación elimina solo las peticiones de ese lote.
## 16. Funciones adicionales (A1–A7, B1–B7, C6)

> Todas respetan el principio rector de la sección 1: **la sala rápida personal no se complica**. Cada función indica su fase, sus datos, su límite por plan (ver 14) y cuándo se considera terminada. Si una función choca con el principio rector, gana el principio.

### 16.0 Resumen y orden de implementación

| Cód. | Función | Fase | Plan |
|---|---|---|---|
| A1 | Compartir por WhatsApp y código QR | 3 | Todos |
| A2 | Reacciones rápidas | 4 | Todos |
| A3 | Sala de espera / admisión | 4 | Todos |
| A6 | Pasaje en pantalla | 4 (si ya se decidió la versión bíblica; si no, pasa a la 7) | Todos |
| A4 | Petición urgente | 7 | Comunidad (todas) |
| A5 | Peticiones solo para el equipo pastoral | 7 | Comunidad (todas) |
| A7 | Muro de testimonios | 7 | Comunidad (todas) |
| B1 | Cadena de oración 24/7 | 7 | Con pase Vigilia o plan Plus/Pro |
| C6 | Google Calendar, nivel 1 (botón sin permisos) | 7 | Todos |
| B3 | Guías de oración con temporizador | 10 | Guías del sistema: todos. Propias: Plus/Pro |
| B4 | Modo pantalla / proyección | 10 | Todos |
| B2 | Grupos pequeños | 10 | Plus y Pro |
| B5 | Estadísticas para líderes | 10 | Básicas: Plus. Históricas: Pro |
| B6 | Marca de la iglesia | 10 | Pro |
| B7 | Compañero de oración | 10 | Comunidad (todas) |
| C6 | Google Calendar, nivel 2 (sincronización automática) | 10 | Todos |

**Fase 10 — Mejoras posteriores al lanzamiento.** Se hace después de las fases 8 (moderación y producción) y 9 (billing). Orden sugerido: B3, B4, B2, B5, B6, B7, C6 nivel 2. Se puede adelantar cualquiera si el propietario lo pide, pero **no antes de que la Fase 8 esté terminada** en las funciones que involucran a varias personas (B2 y B7).

---

### 16.1 Funciones de sala y comunidad

#### A1 — Compartir por WhatsApp y código QR (Fase 3)
- Botón **Compartir** al crear una sala y dentro de la sala: Web Share API en celular, con respaldo a "Copiar enlace".
- Opción **WhatsApp**: abre `https://wa.me/?text=` con un mensaje predefinido en español (por ejemplo "Te invito a orar conmigo en INTERCEDE: {enlace}"). El mensaje **nunca incluye** el texto de peticiones ni datos personales.
- **Código QR** del enlace corto `/r/abc123`, con vista a pantalla completa para proyectarlo. Generarlo en el cliente con una librería ligera (justificar la dependencia).
- Listo cuando: el enlace se comparte por WhatsApp en un toque en Android e iOS; el QR abre la sala; el mensaje es editable antes de enviar.

#### A2 — Reacciones rápidas (Fase 4)
- Tipos: **Amén**, **corazón**, **mano levantada**. Se envían por el canal de datos de LiveKit y se muestran unos segundos sobre el avatar de quien reaccionó.
- La **mano levantada** se queda hasta que la persona la baja o el anfitrión la baja, y le aparece al anfitrión como lista ordenada.
- Quien está en **modo oyente** puede reaccionar (sin micrófono). Límite en el cliente de una reacción por segundo por persona; ignorar las que lleguen más rápido.
- No se guardan en base de datos (son efímeras). Solo se cuenta el total de "Amén" de la sala si el anfitrión lo activa.
- Listo cuando: las reacciones llegan a todos en menos de un segundo con 20 participantes y no afectan el audio.

#### A3 — Sala de espera / admisión (Fase 4)
- Ajuste de la sala **Entrada**: *Abierta* (predeterminada en la sala rápida, para mantener el principio rector), *Con aprobación* o *Bloqueada*.
- En *Con aprobación*, quien llega queda en **sala de espera dentro de nuestra base de datos**, no dentro de LiveKit: el servidor **no emite el token** hasta que el anfitrión lo admita.
- El anfitrión ve la lista en vivo con **Admitir**, **Rechazar** y **Admitir a todos**. Quien fue rechazado no puede volver a pedir entrada durante 10 minutos.
- Ajuste opcional: "Los miembros de la comunidad entran directo". Las salas de comunidad pueden tener "con aprobación" como valor predeterminado solo para no miembros.
- Datos: `room_admissions` (room_id, user_id, display_name, status `pending|approved|denied`, decided_by, decided_at). RLS por sala; solo el anfitrión decide.
- Listo cuando: un usuario sin admisión no puede conectarse ni forzando la llamada al servicio de tokens (prueba de seguridad).

#### A6 — Pasaje en pantalla (Fase 4; pasa a la 7 si no se ha decidido la versión bíblica)
- El anfitrión elige libro, capítulo y versículo(s) y lo **muestra a todos** en una tarjeta en vivo ("Leyendo: Salmo 46:10"). Cada persona puede ocultarla solo para ella.
- El texto sale de una **versión de dominio público** (Reina-Valera 1909 por omisión) cargada en la base de datos o en un archivo estático; cualquier otra versión requiere resolver licencia antes.
- Estado de la sala: `room_state.current_passage` (referencia, versión y copia del texto). No consume video ni audio.
- **Decisión pendiente (preguntar al propietario):** versión bíblica y fuente del texto.
- Listo cuando: el pasaje aparece a todos al mismo tiempo, se oculta y se reemplaza sin recargar, y funciona en la vista de modo pantalla (B4) cuando exista.

#### A4 — Petición urgente (Fase 7)
- Un líder marca una petición de la comunidad como **urgente**: llega una notificación push y dentro de la app a los miembros que activaron "Peticiones urgentes".
- Controles contra el cansancio de notificaciones: **máximo 3 urgentes por día por comunidad**; **horario silencioso** de 10 pm a 7 am hora local del destinatario (no se notifica en ese horario, queda visible al abrir la app); caducidad automática a las 48 horas.
- Muestra un aviso destacado en Inicio con el botón **"Orar ahora"**, que crea o abre una sala con esa petición en "Orando ahora".
- Datos: `prayer_requests.is_urgent`, `urgent_until`. Preferencia por usuario en `notification_preferences`.
- Listo cuando: se respetan el horario silencioso y el tope diario, y solo miembros de esa comunidad la reciben.

#### A5 — Peticiones solo para el equipo pastoral (Fase 7)
- Cualquier miembro puede usar **"Enviar a mis pastores"**: la petición es confidencial y **solo la ve el equipo pastoral**, no el muro ni las salas.
- El equipo pastoral no es "todos los líderes": se marca a personas concretas con `community_members.is_pastoral_team`. El administrador asigna ese permiso.
- Estados: `nueva` → `en_atención` → `atendida`. Un pastor puede convertirla en una petición general **solo con el consentimiento de quien la envió** (y por omisión, anónima).
- Nunca se incluye en copias (snapshots) de sala, exportaciones ni estadísticas.
- Datos: `prayer_requests.visibility = 'pastoral'`, `pastoral_status`. RLS estricta: solo autor y equipo pastoral.
- Mostrar a los líderes un aviso claro de confidencialidad y la guía de qué hacer si una petición indica riesgo para la vida (ver sección 17).
- Listo cuando: pruebas de RLS demuestran que ni un líder sin la marca pastoral ni un administrador sin ella pueden leerlas.

#### A7 — Muro de testimonios (Fase 7)
- Una petición respondida con testimonio puede **compartirse con la comunidad** únicamente con la **aceptación de su autor**, que puede elegir publicarla como anónima y retirarla cuando quiera.
- Los líderes moderan antes de publicar (estados `pendiente|publicado|oculto`).
- Pestaña **Testimonios** en la comunidad con la reacción "Gloria a Dios" y su contador.
- Datos: `testimonies` (id, request_id, community_id, content, is_anonymous, status, approved_by, created_at).
- Listo cuando: ningún testimonio se publica sin consentimiento y retirarlo lo quita de inmediato.

---

### 16.2 Funciones de mayor alcance

#### B1 — Cadena de oración 24/7 (Fase 7)
- Una **cadena** es un periodo (por ejemplo un ayuno o una vigilia) dividido en **turnos** de una hora por omisión, en los que las personas se apuntan para orar.
- Pantalla con la **cobertura** ("18 de 24 horas cubiertas"), horas vacías resaltadas, y acciones **Apartar turno**, **Cancelar** y **Cambiar**.
- Recordatorios por notificación 15 minutos antes y al inicio, con botón **Entrar a la sala de la cadena**.
- La cadena usa **una sala persistente** durante su periodo. Esa sala consume un **pase Vigilia** o el plan Plus/Pro (ver 14); los minutos solo cuentan por quien está conectado.
- Cada persona ve los horarios en su zona horaria. Máximo de turnos por persona configurable.
- Se puede vincular a un **Evento** de la comunidad.
- Datos: `prayer_chains` (community_id nullable, event_id nullable, name, starts_at, ends_at, timezone, slot_minutes, room_id), `chain_slots` (chain_id, slot_start, user_id nullable).
- Listo cuando: dos personas no pueden apartar el mismo turno aunque lo intenten al mismo tiempo (restricción única en base de datos) y los recordatorios llegan en la zona correcta.

#### B2 — Grupos pequeños (Fase 10)
- El anfitrión pulsa **"Dividir en grupos"**: tamaño de grupo (2 a 5) o número de grupos, asignación aleatoria o manual, y duración con cuenta regresiva.
- Cada grupo es una **sala de LiveKit aparte** creada por el servidor; el cliente se reconecta con un token nuevo que el servidor emite solo si la asignación existe.
- El anfitrión ve todos los grupos y puede **enviar un aviso a todos** ("Regresamos en 2 minutos"). Al terminar el tiempo, todos regresan solos a la sala principal.
- Opcional: **una petición distinta por grupo**, tomada de la cola de peticiones.
- Una persona está en una sola sala a la vez, por lo que cuenta sus minutos una sola vez. Las salas de grupo **no cuentan** como salas simultáneas. Límite de grupos: **10 en Plus, 20 en Pro**.
- Datos: `room_breakouts` (room_id, status, ends_at), `breakout_groups` (breakout_id, name, livekit_room, request_item_id nullable), `breakout_assignments` (group_id, user_id).
- Listo cuando: 20 personas se reparten y regresan sin quedar atrapadas en una sala; si el anfitrión se desconecta, el regreso ocurre igual por temporizador del servidor.

#### B3 — Guías de oración con temporizador (Fase 10)
- Una **guía** es una lista ordenada de segmentos: título, duración, instrucción breve, y opcionalmente un pasaje (A6) o avanzar por la cola de peticiones.
- **Guías del sistema** (gratis): adoración-confesión-gratitud-súplica, oración por la nación, silencio y escucha, y el Padre Nuestro guiado. Guías **propias**: Plus y Pro.
- El anfitrión **inicia, pausa, salta y suma un minuto**. Todos ven el segmento actual y la cuenta regresiva **sincronizada con la hora del servidor** (no con el reloj del dispositivo).
- Campana suave opcional al terminar cada segmento; el audio se desbloquea con un gesto del usuario al entrar.
- Datos: `prayer_guides` (id, community_id nullable, title, language, segments jsonb), `room_guide_runs` (room_id, guide_id, segment_index, started_at, paused_at).
- Listo cuando: la cuenta regresiva coincide entre dispositivos con diferencia visible menor a un segundo, y sobrevive a que alguien se reconecte.

#### B4 — Modo pantalla / proyección (Fase 10)
- Vista de **solo lectura** en `/r/[code]/display` para proyectar en el templo: petición "Orando ahora" en grande, la siguiente en pequeño, pasaje (A6), segmento y tiempo de la guía (B3), y el QR/código para entrar.
- **No se conecta a LiveKit** (no usa audio ni consume minutos): solo recibe el estado por Realtime.
- Acceso mediante un **enlace de pantalla que genera el anfitrión**, revocable, que no expone peticiones anónimas ni pastorales. Respetar el ajuste de ocultar "por quién".
- Alto contraste, tipografía grande, pantalla completa y mantener la pantalla encendida.
- Listo cuando: el enlace deja de funcionar al revocarlo y la vista no muestra ninguna petición pastoral ni nombres ocultos.

#### B5 — Estadísticas para líderes (Fase 10)
- Panel solo para administradores y líderes: horas de oración de la comunidad por semana y mes, salas realizadas, participación promedio, peticiones nuevas y respondidas, devocionales leídos (agregado) y crecimiento de miembros.
- **Solo datos agregados, nunca minutos por persona.** Si un indicador involucra a menos de 5 personas, se oculta.
- Se calcula con vistas materializadas sobre `usage_events`, actualizadas por tarea programada.
- Plan Plus: últimos 30 días. Plan Pro: histórico y comparativas. Exportación en CSV de los datos agregados.
- Listo cuando: ningún miembro común puede acceder y no hay forma de deducir el tiempo de oración de una persona concreta.

#### B6 — Marca de la iglesia (Fase 10, plan Pro)
- Logo, nombre visible y **color de acento** de la comunidad en sus páginas y salas, con la marca "Con tecnología de INTERCEDE" siempre visible. El manifiesto de la PWA sigue siendo el de INTERCEDE.
- El color elegido debe **pasar contraste AA**; si no pasa, se ajusta o se rechaza.
- Subdominio `nombre.intercede.app` resuelto por middleware. Lista de nombres reservados y prohibidos, y revisión contra suplantación (nombres que imiten a otra iglesia o a INTERCEDE).
- Dominio propio: fuera de alcance por ahora.
- **Decisión técnica antes de implementar:** cómo se comparten o aíslan las sesiones y cookies entre subdominios (riesgo de seguridad si el contenido de una comunidad pudiera afectar a otra).
- Listo cuando: una comunidad no puede tomar un subdominio reservado ni uno ya usado, y las sesiones no se filtran entre subdominios.

#### B7 — Compañero de oración (Fase 10)
- **Opcional (opt-in)** dentro de la comunidad. Cada semana, una tarea programada empareja a dos miembros que se anotaron, evitando repetir pareja en las últimas 4 semanas.
- Modos de emparejamiento que elige el líder: **aleatorio** o **por grupo** (etiqueta de célula o grupo pequeño). **No se guarda género.**
- Cada persona escribe de 1 a 3 peticiones para su compañero; el compañero las ve, puede enviar un "Estoy orando por ti" y hay una revisión semanal sencilla ("¿cómo te fue?").
- **Seguridad:** solo se ve el nombre; no se muestra contacto; cualquiera puede pausar o salir cuando quiera; funcionan **reportar y bloquear**.
- **Menores:** no se emparejan con adultos. **Decisión pendiente:** si se permiten adolescentes y bajo qué consentimiento.
- Datos: `partner_programs` (community_id, mode, active), `partner_pairs` (program_id, week_start, user_a, user_b), `partner_requests`.
- Listo cuando: una persona bloqueada nunca vuelve a emparejarse con quien la bloqueó y salir del programa borra sus peticiones de compañero.

---

### 16.3 C6 — Google Calendar

Ya existe el inicio de sesión con Google (Supabase Auth). La integración con calendario es **un permiso distinto** y se pide aparte.

**Nivel 1 — "Agregar a Google Calendar" (Fase 7, sin permisos)**
- Botón en eventos, salas programadas y turnos de cadena que abre el formulario de Google Calendar prellenado con una URL de plantilla, además de la descarga `.ics` para Apple y Outlook.
- No requiere conectar la cuenta ni permisos especiales. Es la versión que se debe construir primero.

**Nivel 2 — Sincronización automática (Fase 10)**
- Pantalla **"Conectar Google Calendar"** en Perfil. Es un flujo de autorización **independiente** del inicio de sesión, por estas razones:
  - Mantiene el login con permisos mínimos (correo y perfil), que es más simple para todos.
  - Supabase Auth **no conserva de forma permanente** el token de actualización del proveedor; hay que guardarlo nosotros.
  - Los permisos de calendario son sensibles y pueden requerir **verificación de la aplicación en Google Cloud**. Tomar el tiempo en cuenta: mientras tanto, la app puede funcionar en modo de pruebas con usuarios de prueba.
- Pedir el **permiso más acotado que funcione** (evaluar si basta el que limita a calendarios creados por la app, o si se necesita el de eventos) y solicitar acceso sin conexión para obtener el token de actualización.
- **Almacenamiento:** el token de actualización se guarda **cifrado en el servidor** (por ejemplo con Supabase Vault o una columna cifrada), nunca en el cliente.
- **Comportamiento (un solo sentido: INTERCEDE → Google):** se crean, actualizan y eliminan eventos de: asistencia confirmada a eventos, salas programadas que la persona marcó con "recordarme" y turnos de cadena. Cada evento lleva el enlace de la sala y un recordatorio de 10 minutos.
- **No se lee** ningún otro calendario ni evento de la persona.
- Idempotencia: guardar el identificador de INTERCEDE en las propiedades privadas extendidas del evento de Google y la relación en `calendar_event_links`. Cola con reintentos para fallos temporales.
- Si la persona **borra el evento en Google**, no se vuelve a crear (queda `user_deleted`). Si **revoca el permiso**, se marca la conexión como desconectada y se le avisa.
- Botón **Desconectar**: revoca el token en Google y borra los datos guardados.
- Datos: `calendar_connections` (user_id, provider, scope, refresh_token_encrypted, status, connected_at), `calendar_event_links` (user_id, source_type `event|chain_slot|schedule`, source_id, google_event_id, status).
- Solo para quien inició sesión con cuenta (los invitados anónimos usan el nivel 1).
- **Decisión pendiente:** permiso exacto de Google a solicitar y fecha para iniciar la verificación.
- Listo cuando: confirmar asistencia crea el evento en Google, cambiar la fecha lo actualiza, cancelar lo elimina, desconectar borra el token, y un evento borrado a mano no reaparece.

---

### 16.4 Impacto en planes y datos

**Límites por plan** (agregar a la tabla 14.4 y a `plans.limits`):

| Límite | Comunidad (gratis) | Plus | Pro |
|---|---|---|---|
| Peticiones urgentes por día | 3 | 3 | 3 |
| Grupos pequeños (B2) | — | 10 | 20 |
| Guías de oración propias (B3) | — | Sí | Sí |
| Estadísticas (B5) | — | Últimos 30 días | Histórico y comparativas |
| Marca de la iglesia y subdominio (B6) | — | — | Sí |

**Tablas nuevas** (todas con RLS): `room_admissions`, `testimonies`, `prayer_chains`, `chain_slots`, `room_breakouts`, `breakout_groups`, `breakout_assignments`, `prayer_guides`, `room_guide_runs`, `partner_programs`, `partner_pairs`, `partner_requests`, `calendar_connections`, `calendar_event_links`.

**Columnas nuevas:** `prayer_requests.is_urgent`, `urgent_until`, `pastoral_status`; `community_members.is_pastoral_team`; `room_state.current_passage`.

### 16.5 Decisiones abiertas (preguntar al propietario antes de implementar)

1. **A6:** versión bíblica y fuente del texto.
2. **B7:** si se permiten adolescentes y bajo qué consentimiento.
3. **B6:** estrategia de sesiones y cookies entre subdominios.
4. **C6 nivel 2:** permiso de Google a solicitar y cuándo iniciar la verificación.
5. **A5:** quién integra el equipo pastoral de cada comunidad (lo asigna el administrador).

---

## 17. Decisiones previas al lanzamiento (no son funciones)

1. **Privacidad de datos religiosos.** Las peticiones de oración y la pertenencia a una iglesia revelan creencias, que suelen considerarse datos sensibles. Redactar con un abogado el aviso de privacidad y los términos, pedir consentimiento claro al registrarse y documentar cuánto tiempo se conservan los datos. Esto incluye la eliminación de cuenta y datos ya prevista en 5.4.
2. **Menores de edad.** Decidir si se permiten adolescentes (ministerio de jóvenes), con qué edad mínima y con qué consentimiento de padres o tutores. Mientras no se decida, el registro pide confirmar que la persona es mayor de edad. Afecta a B7 y a la moderación.
3. **Peticiones que indican crisis.** Algunas personas escribirán cosas graves (por ejemplo, ideas de hacerse daño o situaciones de violencia). Preparar:
   - una guía breve para líderes sobre qué hacer y a quién acudir;
   - un reporte rápido de peticiones;
   - un enlace visible a **recursos locales de ayuda profesional, verificados antes de publicarlos** (no copiar números de memoria; confirmarlos en fuentes oficiales y revisarlos periódicamente).
   La app **no** debe prometer atención de emergencia.
4. **Contacto y soporte.** Correo o formulario de ayuda, botón de comentarios dentro de la app y página de preguntas frecuentes.