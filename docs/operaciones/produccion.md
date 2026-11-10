# Puesta en producción: lista de verificación

> **Estado (2026-11-10):** desplegado en https://intercede-six.vercel.app (proyecto `intercede`, sin conexión a GitHub: `vercel --prod`).
> Variables ya definidas en Vercel: Supabase, LiveKit, VAPID, Resend, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_GOOGLE_AUTH`, `NEXT_PUBLIC_CONTACT_EMAIL`.
> Faltan (opcionales): `SENTRY_DSN`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.

Pasos y decisiones para publicar INTERCEDE (Vercel + Supabase + LiveKit). Lo que ya está hecho está marcado; el resto necesita datos
o cuentas de quien opera el proyecto.

## 1. Variables de entorno en Vercel

| Variable | Valor | Notas |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | URL pública (`https://…`) | Enlaces de correo, OG, sitemap, redirecciones |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | del proyecto Supabase | Públicas por diseño |
| `SUPABASE_SERVICE_ROLE_KEY` | del proyecto Supabase | **Solo servidor.** La usa `POST /api/account/delete` |
| `LIVEKIT_URL`, `NEXT_PUBLIC_LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | de LiveKit Cloud | El secreto solo servidor |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | clave pública VAPID | La privada va en los secretos de la Edge Function |
| `NEXT_PUBLIC_GOOGLE_AUTH` | `1` | El proveedor ya está activo en Supabase |
| `NEXT_PUBLIC_CONTACT_EMAIL` | correo de contacto real | Si falta, el pie no muestra el enlace |
| `SENTRY_DSN` | DSN del proyecto de Sentry | Opcional: sin él, Sentry está apagado |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | clave de sitio de Turnstile | Opcional: ver §3 |

No definas `RESEND_*` ni `VAPID_PRIVATE_KEY` en Vercel: viven en los secretos de la Edge Function (`docs/operaciones/avisos.md`).

## 2. Supabase (proyecto remoto)

- [x] Migraciones aplicadas hasta la Fase 8 (`npx supabase db push --remote`).
- [ ] **Authentication → URL Configuration**: Site URL = la URL pública; agrega `https://<dominio>/auth/callback` y `/auth/confirm` a las URL de redirección.
- [ ] **SMTP propio** (Resend con dominio verificado) para que el correo de Auth salga a cualquier dirección y use las plantillas en español
      (`supabase/templates`); sin eso, el plan gratuito solo envía a miembros del equipo y con plantillas en inglés (ADR 0009).
- [ ] **Authentication → Attack Protection**: activar CAPTCHA (Turnstile) si se usa; revisar los límites de la sección Rate Limits.
- [ ] Google Cloud: agrega `https://<ref>.supabase.co/auth/v1/callback` (ya está) y el dominio público a los orígenes autorizados.
- [ ] Función de avisos desplegada y secretos de Vault (ver `docs/operaciones/avisos.md`).
- [x] Auditoría de seguridad del remoto (`node scripts/security-audit.mjs --remote`): sin hallazgos; solo `peek_room`, `peek_schedule` y `peek_community` son públicas.
      Repítela después de cada migración.

## 3. CAPTCHA (Cloudflare Turnstile) — opcional

1. En Cloudflare → Turnstile crea un widget (modo *Managed*, dominios = el sitio). Obtienes una **clave de sitio** y una **clave secreta**.
2. Supabase → Authentication → Attack Protection → CAPTCHA: proveedor *Turnstile* y pega la **secreta** (solo ahí).
3. Vercel: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` = la clave de sitio y vuelve a desplegar.
4. Prueba: crear una sala sin sesión debe seguir tomando segundos; en `/entrar`, `/registro` y `/recuperar` también funciona.
Para probar sin cuenta de Cloudflare hay claves públicas de prueba (`1x00000000000000000000AA` y la secreta `1x0000000000000000000000000000000AA`).
**Importante:** si activas CAPTCHA en Supabase y no pones la clave de sitio en Vercel, **nadie podrá crear invitados** (la app responde con un aviso claro).

## 4. Seguridad: riesgos que quedan abiertos

- **Intentos de adivinar códigos de sala:** no hay limitador propio. El espacio es de ~887 millones y las altas anónimas tienen tope por IP
  en Auth. Antes de lanzar, activa el **Firewall/Rate Limiting de Vercel** (reglas sobre `POST /es/r/*` y `/es/orar`) o Supabase.
- **Audio y bloqueos:** bloquear a alguien no lo silencia en una sala en curso; la anfitriona puede sacarlo.
- **CSP sin `script-src`:** ver ADR 0012.
- **Dependencias:** avisos de `npm audit` solo en herramientas de build de Serwist.

## 5. Observabilidad

- Sentry: crea el proyecto, copia el DSN a `SENTRY_DSN` en Vercel y provoca un error de prueba. Verifica en Sentry que el evento llega
  **sin usuario, sin cookies y con la URL generalizada** (`/es/r/[code]`). Los mapas de fuentes requieren `SENTRY_AUTH_TOKEN` (no configurado).
- Vercel Analytics: se activa en el panel del proyecto; el componente ya está y solo se carga en Vercel.

## 6. Moderación en la práctica

- Los reportes de **comunidades** los atiende su liderazgo en *Comunidades → Reportes*.
- Los reportes de **salas y personas fuera de una comunidad** quedan en la tabla `reports` (solo la service role los lee) hasta que haya un panel
  interno. Revísalos con:
  `select created_at, target_type, reason, details, target_user_id from reports where status = 'open' and community_id is null order by created_at desc;`
- Para sancionar a una cuenta (cerrar su acceso) usa el panel de Supabase (Authentication → Users → Ban).

## 7. Después del primer despliegue

- [ ] Probar el flujo completo en teléfonos reales (`docs/testing/audio-dispositivos-reales.md`, `docs/testing/avisos-dispositivos-reales.md`).
- [ ] Revisión legal de `/privacidad` y `/terminos` (hoy son borradores).
- [ ] Rotar las claves que se pegaron en el chat durante el desarrollo (Supabase, LiveKit, Resend, Google).
