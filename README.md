# INTERCEDE

**Ora. Conecta. Permanece.** — Una comunidad que ora junta.

PWA de oración en línea (audio en vivo, peticiones, programación y comunidades) con landing pública.
Contexto completo del producto y reglas de desarrollo: [`CLAUDE.md`](CLAUDE.md).
Referencia visual de pantallas: [`docs/design/pantallas.html`](docs/design/pantallas.html).

## Requisitos

Node.js ≥ 22 (desarrollo en 24) y npm.

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # completa los valores; nunca versiones .env.local
npm run dev                  # http://localhost:3000 → redirige a /es
```

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` / `build` / `start` | Desarrollo, build y servidor de producción |
| `npm run typecheck` | `next typegen` + `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest (unitarias e integración) |
| `npm run test:e2e` | Playwright (móvil y escritorio). Con `CI=1` usa el build de producción |
| `npm run check` | typecheck + lint + test |

## Base de datos (Supabase)

Requiere Docker. La app usa el proyecto remoto vía `.env.local`; las pruebas usan un Supabase local.

| Comando | Qué hace |
|---|---|
| `npx supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,mailpit,storage-api` | Levanta Supabase local (aplica las migraciones; incluye Realtime) |
| `npm run test:db` | Pruebas de integración y RLS contra el Supabase local |
| `npm run test:e2e:db` | E2E del flujo de salas con varios navegadores contra el Supabase local |
| `npm run db:types` | Regenera `src/types/database.ts` desde el esquema local |
| `npm run db:reset` | Recrea la base local desde las migraciones |
| `npx supabase db push --remote` | Aplica migraciones al proyecto remoto (pide confirmación) |
| `npx supabase config diff` | Compara `config.toml` con el remoto. Hazlo **antes** de cualquier `config push` |

Los scripts `test:db` y `test:e2e:db` reinician el contenedor de Auth antes de correr: las altas anónimas
tienen un tope de 30 por hora y por IP y se alcanza al repetir pruebas. Si algo falla con
`rate_limited`, reinicia Auth (`docker restart supabase_auth_intercede`).

Las pruebas de PWA (`tests/e2e/pwa.spec.ts`) requieren `npm run build` y `CI=1`, porque el service worker
no se registra en desarrollo. La primera vez: `npx playwright install chromium`.

## Fases y versiones

El avance se publica por fases con su tag y su entrada en [`CHANGELOG.md`](CHANGELOG.md)
(ver [ADR 0004](docs/decisions/0004-versionado-changelog-y-tags.md)). Decisiones de arquitectura en
[`docs/decisions/`](docs/decisions).

## Pendiente de la propietaria/el propietario

- Correo de contacto real: `NEXT_PUBLIC_CONTACT_EMAIL` (si está vacío, el pie no muestra el enlace).
- Revisión legal de `/privacidad` y `/terminos` (hoy son borradores).
