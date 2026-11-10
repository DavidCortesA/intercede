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
