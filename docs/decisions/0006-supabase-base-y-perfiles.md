# 0006 — Supabase base, invitados y perfiles (Fase 2)

- Estado: aceptada (2026-11-10)

## Decisiones
- **Invitados = usuarios anónimos de Supabase Auth** (`signInAnonymously`). Tienen `id` y rol `authenticated`, así que toda la seguridad se expresa con `auth.uid()` y RLS; no hay un "modo invitado" paralelo. Al convertirlos en cuenta conservan el mismo `id` (Fase 5).
- **`public.profiles`** (migración `20261110160000_create_profiles.sql`):
  - Se crea por trigger `SECURITY DEFINER` sobre `auth.users` a partir de `options.data.display_name` (o `full_name`/`name` con Google), recortado a 40 caracteres.
  - RLS activo. Privilegios de cero: se revoca todo a `anon`/`authenticated` y solo se concede `SELECT` y `UPDATE` de `display_name, avatar_url, locale, timezone`. No hay políticas de `INSERT` ni `DELETE`: el alta es del trigger y el borrado ocurre en cascada al eliminar la cuenta.
  - Políticas `SELECT`/`UPDATE` solo sobre la fila propia, con `(select auth.uid())` para que Postgres evalúe el uid una vez.
  - Validaciones en la base: nombre 1–40, idioma `es|en|pt`, zona horaria existente (trigger contra `pg_timezone_names`), `updated_at` automático.
  - La política para ver a las demás personas de una sala (nombre/avatar de co-miembros) se añade en la Fase 3, junto con `rooms` y `room_members`.
- **Clientes** (`src/lib/supabase/`): navegador (`client.ts`), servidor (`server.ts`, actúa como la persona) y `proxy.ts`. La app **no usa la service role**; esa clave solo se usa en pruebas.
- **Proxy:** refresca la sesión con `getClaims()` (valida el JWT sin tocar la base) **solo si la petición ya trae cookies `sb-*-auth-token`**. La landing y quien no tiene sesión no pagan costo ni reciben cookies. El proxy no autoriza nada: RLS es la barrera real.
- **Variables de entorno** validadas con Zod (`src/lib/env.ts`); el error nombra las variables faltantes, nunca sus valores.
- **`supabase/config.toml` refleja el proyecto remoto.** `supabase config push` empuja todo lo que el archivo declara, así que se alineó primero con los valores actuales del remoto (confirmación de correo, MFA, pooler…) y solo se empujó lo intencional: Anonymous sign-ins activado, `http://localhost:3000/**` como redirección y contraseña mínima de 8. Antes de cada `config push` hay que correr `supabase config diff`.
- **Pruebas** (`npm run test:db`) contra el Supabase local, nunca contra el remoto:
  - RLS de `profiles` (A no lee, edita, inserta ni borra lo de B; `anon` denegado; columnas protegidas; validaciones; cascada).
  - La acción `signInAsGuest` y `getCurrentSession` con un almacén de cookies en memoria.
  - El refresco de sesión del proxy.
  - Se verificó que las pruebas detectan fallos: al añadir a propósito una política `using (true)` fallaron las de lectura.
  - CI: el job `db` levanta Supabase local, comprueba que `src/types/database.ts` está al día y corre las pruebas.
- Local: se arranca solo con los servicios necesarios (sin Studio, Realtime, Storage…). Se amplía al usarlos.
- Se aplicó al remoto con `db push` y `config push` (2026-11-10) y se verificó con invitados de prueba que se borraron al terminar.

## Pendiente antes de producción
- **CAPTCHA en las entradas anónimas** (Turnstile/hCaptcha en Supabase Auth): el límite por defecto es 30 altas/hora/IP y, sin CAPTCHA, alguien puede inflar `auth.users`. Fase 8.
- `enable_manual_linking = true` cuando se añada "convertir invitado con Google" (Fase 5).
- Los usuarios anónimos inactivos se acumulan: planear una limpieza periódica (pg_cron, Fase 6/8).
