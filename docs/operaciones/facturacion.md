# Facturación y límites: puesta en marcha

> Decisiones y alcance: `docs/decisions/0013-planes-limites-y-cobros.md`.
> Hasta completar los pasos 1 a 4, **las compras no funcionan** (la app responde "El pago no está disponible por ahora") pero los **límites del plan gratuito ya se aplican**.

## 1. Conekta

1. En el panel de Conekta (modo **Pruebas** primero) crea una **llave privada** con permiso de escritura en órdenes (`orders:write`) y webhooks. La llave que se usó en desarrollo solo tenía lectura (la API respondía *"La API key no tiene el scope requerido: orders:write"*).
2. Variables (solo servidor; en `.env.local` y en Vercel):
   - `CONEKTA_API_SECRET` = llave **privada**.
   - `CONEKTA_API_KEY` = llave pública (hoy no se usa).
3. **Llave del webhook** (una por ambiente): `node scripts/conekta-webhook-key.mjs` imprime la llave pública (PEM, en una línea). Ponla en `CONEKTA_WEBHOOK_PUBLIC_KEY`.
4. **Registra el webhook** en Conekta (Desarrolladores → Webhooks): URL `https://<dominio>/api/billing/webhook`. Eventos: al menos `order.paid`, `order.expired`, `order.canceled`, `order.declined`, `order.refunded`. Usa "Test webhook" del panel: la app debe responder 200 (los eventos que no maneja se registran y se ignoran).
5. Métodos de pago: la página de pago ofrece tarjeta, OXXO y SPEI según lo habilitado en tu cuenta de Conekta.
6. Para pasar a producción: llave privada y llave de webhook del ambiente de **producción**, y repetir los pasos 3 y 4.

Probar un pago: *Pases y pagos* (Perfil) → comprar una Sala Larga → pagar con una tarjeta de prueba de Conekta → la orden pasa a *Pagado* **solo cuando llega el webhook**. Con OXXO/SPEI de pruebas, el pago se confirma después.

## 2. Cierre de salas que pasaron su tiempo (obligatorio para que el límite se cumpla)

Sin esto, `join_room` y el token ya rechazan a quien llegue tarde, pero una sala en curso no se cerraría sola.

1. Variable `ENFORCER_SECRET` (aleatoria y larga) en Vercel y en `.env.local`.
2. Una sola vez, en el editor SQL de Supabase (nunca en una migración: son secretos):

```sql
select vault.create_secret('https://<dominio>/api/billing/enforce', 'enforcer_url');
select vault.create_secret('<el mismo ENFORCER_SECRET>', 'enforcer_secret');
```

`invoke_enforcer()` (pg_cron, cada minuto) no hace nada mientras falte alguno y solo llama cuando hay una sala vencida.

Comprobar: `select jobname from cron.job;` debe incluir `enforce-room-limits` y `expire-passes`; `select status_code from net._http_response order by id desc limit 5;` → 200.

## 3. Medición de uso (LiveKit)

En LiveKit Cloud → Settings → Webhooks: URL `https://<dominio>/api/livekit/webhook` (firma con las mismas llaves de la app). Eventos: `participant_left` (los demás se ignoran). Sin esto las horas-persona de las comunidades quedan en cero (las salas y los límites funcionan igual).

## 4. Migración

`npx supabase db push --remote` (previa aprobación) aplica `20261119100000_billing_and_entitlements.sql`. Después: `node scripts/security-audit.mjs --remote` debe salir sin hallazgos.

**Efectos visibles al aplicarla:** las salas abiertas en ese momento reciben una ventana de 2 h; las nuevas nacen con 15 personas / 2 h; las comunidades que ya existían quedan en el plan gratuito (30 miembros, 4 salas a la vez) — **sin** prueba de Plus (la prueba solo se da al crear). Si quieres darles la prueba:

```sql
insert into subscriptions (owner_type, community_id, plan_code, status, provider, current_period_end)
select 'community', c.id, 'plus', 'trialing', 'trial', now() + interval '14 days'
from communities c where not exists (select 1 from subscriptions s where s.community_id = c.id);
```

## 5. Operación diaria

- **Cambiar un precio o un límite:** edita `plans` / `products` (no hay que tocar código). Las salas ya creadas conservan los suyos.
- **Dar un pase o un plan a mano** (cortesía, soporte): inserta un pase (`passes`) o una suscripción desde el editor SQL; o crea la orden y ejecuta `select fulfill_order('<id>')` con la service role.
- **Pagos con error:** `select provider_event_id, type, error, received_at from payment_events where error is not null order by received_at desc;` (`amount_mismatch`, `currency_mismatch`, `order_not_found` no se reintentan: se revisan a mano).
- **Reembolsos:** se hacen en el panel de Conekta; el evento `order.refunded` revierte lo comprado.
- **Estado de una comunidad:** `select * from subscriptions where community_id = '<id>';` y `usage_periods` para el mes.
- Los planes se pagan por periodo y **no se renuevan solos**; conviene un aviso a la administración antes de que venza (pendiente).
