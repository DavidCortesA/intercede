# Operación de los avisos (push y correo)

Resumen del flujo (ver `docs/decisions/0010`): **pg_cron** (cada minuto) prepara los avisos y llama a la **Edge Function
`dispatch-notifications`**, que los envía por **Web Push** y, si hay remitente configurado, por **correo (Resend)**.

Sin los pasos de abajo la app funciona igual: las salas programadas se abren y los avisos quedan en la lista de
*Avisos*, pero **nada se envía a los dispositivos ni al correo**.

## 1. Claves

| Dato | Dónde se define | Notas |
|---|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Vercel (build) y secretos de la función | Pública por diseño |
| `VAPID_PRIVATE_KEY` | Secretos de la función | **Solo servidor**. Nunca en `NEXT_PUBLIC_*` |
| `VAPID_SUBJECT` | Secretos de la función | `mailto:…` o `https://…` |
| `NEXT_PUBLIC_SITE_URL` | Vercel y secretos de la función | Solo para los enlaces del **correo** (sin ella el correo se omite; el push no la usa) |
| `DISPATCH_SECRET` | Secretos de la función **y** Vault (`dispatcher_secret`) | Valor largo y aleatorio; el mismo en ambos |
| `RESEND_API_KEY`, `RESEND_FROM` | Secretos de la función | Opcionales (con `NEXT_PUBLIC_SITE_URL`, activan el correo). `RESEND_FROM` = remitente de un **dominio verificado** en Resend (p. ej. `INTERCEDE <avisos@tudominio.com>`) |

Genera un par VAPID nuevo con `npx web-push generate-vapid-keys` (no se versiona nada) y un secreto con
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

## 2. Publicar la función y sus secretos (proyecto remoto)

```bash
npx supabase secrets set DISPATCH_SECRET=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:... NEXT_PUBLIC_VAPID_PUBLIC_KEY=... NEXT_PUBLIC_SITE_URL=https://...
npx supabase functions deploy dispatch-notifications
```

`config.toml` ya declara `verify_jwt = false` para esta función (la protege el secreto compartido). Opcional, para el
correo: `npx supabase secrets set RESEND_API_KEY=... RESEND_FROM="INTERCEDE <avisos@tudominio.com>"`.

## 3. Decirle a la base adónde llamar (Vault)

Una sola vez por proyecto, en el editor SQL (nunca en una migración: son secretos):

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1/dispatch-notifications', 'dispatcher_url');
select vault.create_secret('<el mismo DISPATCH_SECRET>', 'dispatcher_secret');
```

Mientras falte alguno, `invoke_dispatcher()` no hace nada.

## 4. Comprobar

- `select jobname, schedule from cron.job;` → deben existir `process-scheduled-work` y `dispatch-notifications`.
- `select status, return_message from cron.job_run_details order by runid desc limit 5;`
- `select status_code, content from net._http_response order by id desc limit 5;` → respuestas 200 de la función.
- `select kind, push_state, email_state, delivery_error from notifications order by created_at desc limit 20;`
  - `skipped` = ese canal no aplicaba (sin dispositivos, preferencia apagada, correo sin configurar).
  - `failed` + `delivery_error` = revisar el motivo. `expired` = pasó más de una hora sin poder enviarse.
- Registros de la función: panel de Supabase → Edge Functions → `dispatch-notifications` → Logs.

## 5. Problemas conocidos

- **Correo:** el proyecto remoto usa el SMTP por defecto para Auth (ver ADR 0009); eso es **independiente** de estos avisos,
  que usan la API de Resend con su propio remitente. Resend solo envía desde dominios verificados.
- **iPhone/iPad:** los avisos push solo funcionan con la app instalada en la pantalla de inicio (iOS 16.4 o superior).
- **Un aviso que no se pudo enviar en una hora caduca** (no se reintenta indefinidamente).
