# 0013 — Planes, límites y cobros (Fase 9)

- Estado: aceptada (2026-11-19)
- Alcance: CLAUDE.md §14 (planes, pases, extras, medición, pasarela). **Fuera de alcance** (fase aparte): §15 (peticiones de la iglesia en la sala, importación CSV/Excel, vistas de cámara) y las 4 decisiones abiertas de §15.5.

## Principio
Orar siempre es gratis. Se cobra por **capacidad** (duración, personas, salas simultáneas) y por **administración de organización**. Un invitado por enlace nunca ve un muro de pago antes de orar.

## Una sola fuente de límites
- `plans` y `products` (precios y límites en pesos, en la base; ningún componente los escribe a mano). La página pública `/precios` y las pantallas de facturación leen de ahí.
- `entitlements_for(community)` (SQL) calcula los límites **efectivos**: plan vigente (o el gratuito) + extras activos. `getEntitlements()` en TypeScript es una envoltura de `get_entitlements`; no hay una segunda implementación.
- Los límites **de una sala se fijan al crearla** con un trigger (`rooms_set_limits`): `rooms.max_participants` y `rooms.ends_at`. Así vale para cualquier camino (sala rápida, de comunidad, programada, de evento) y un cambio de plan no altera salas en curso. Los pases y extensiones **suben** esos valores después (`apply_pass_to_room`).
- La base los aplica: `join_room` (aforo de la sala y tiempo), `create_room` / `create_community_room` (salas abiertas a la vez), `join_community` (miembros). Cifras gratuitas: 15 personas, 2 h, 4 salas, 30 miembros (antes: 20 personas y 5 salas).

## Plan Plus de prueba
Toda comunidad nueva nace con una suscripción `trialing` de Plus por 14 días, sin tarjeta (`create_community`). Al vencer, la comunidad vuelve al plan gratuito: **nadie se saca** (solo se frena el ingreso de nuevos miembros por encima del límite).

## Tiempo de sala: avisos, gracia y cierre
- Avisos a 10 y a 2 minutos del final y durante una **gracia de 5 minutos** (`RoomLimit`, calculado a partir de `rooms.ends_at`, que llega a todos por Realtime). La anfitriona puede **ampliar** con un pase desde la sala.
- Pasado `ends_at` + 5 min: `join_room` y el endpoint de token responden `room_expired`, y **el servidor cierra la sala**: `pg_cron` (cada minuto) → `invoke_enforcer()` → `POST /api/billing/enforce` (secreto compartido) → `close_room_system` + `deleteRoom` de LiveKit. Un token vigente no desconecta solo, por eso la expulsión es explícita.
- El token se acota a lo que le queda a la sala (más la gracia); el techo de LiveKit es 100 (LiveKit no permite cambiar el tope de una sala ya creada, así que el aforo real lo manda la base).

## Pases, extras y planes: pago único por periodo
- **Pases** (`sala_larga`, `vigilia`, `vigilia_grande`, `extension`): se compran desde una sala (se aplican solos al pagar) o desde *Pases y pagos* (quedan disponibles 180 días y se usan desde la sala). Precio con plan Plus/Pro (`org_price_mxn`): $149 / $479 las vigilias.
- **Extras** (+50 miembros, +5 salas: 30 días por unidad; bolsa de 100 h: 90 días) solo para comunidades con plan de pago.
- **Planes**: se pagan **por periodo** (mensual, o anual con 2 meses gratis) y **no se renuevan solos**. Renovar a tiempo suma al periodo vigente; cambiar de plan empieza al pagar (sin prorrateo).
  *Por qué no suscripción recurrente:* las suscripciones de Conekta son solo con tarjeta y requieren tokenizar la tarjeta o un flujo con `plan_ids` cuyo cobro no queda claro en la documentación (ambiguo, no verificable sin cuenta con permisos). El pago por periodo funciona con tarjeta, OXXO y SPEI y lo cubre todo con la misma capa. La renovación automática con tarjeta queda como mejora futura (`subscriptions.provider_subscription_id` ya está previsto).
- `subscriptions` guarda el dueño con dos columnas con llave foránea (`user_id` / `community_id`, exactamente una) en vez de un `owner_id` polimórfico: así el borrado en cascada de una cuenta o una comunidad funciona. Hoy solo se usan las de comunidad.

## Pasarela: Conekta, capa delgada y webhook como única fuente de verdad
- **Checkout alojado** (`HostedPayment`, tarjeta/OXXO/SPEI): los datos de pago no tocan nuestro servidor. `POST /api/billing/checkout`: crea la orden en la base **como la persona** (la base valida permisos y **calcula el precio**: el cliente solo manda qué compra), luego pide la orden a Conekta (`unit_price` en centavos, `metadata.order_id`, `Idempotency-Key`). Si Conekta falla, la orden se cierra.
- **Nada se activa por volver del pago.** Solo `order.paid` verificado (`POST /api/billing/webhook`): firma `DIGEST` (RSA-SHA256 sobre el cuerpo crudo con la llave pública del webhook), idempotencia por id de evento (`payment_events` único), comprobación de monto y moneda contra la orden, y cumplimiento idempotente (`fulfill_order` con bloqueo de fila). OXXO/SPEI confirman de forma asíncrona: la referencia generada (`order.pending_payment`) no activa nada. Un evento que falla a medias responde 500 y se reintenta sin duplicar; un monto distinto o una orden desconocida se conservan con su error y no se reintentan.
- Reembolso (`order.refunded`): el pase deja de servir, el plan termina y los extras vencen; lo ya vivido no se revierte.

## Medición de uso
- Webhook de LiveKit (`/api/livekit/webhook`, firma JWT del SDK) → `record_usage` al **salir** cada participante: un registro por evento (id único, idempotente), minutos **por minuto iniciado** (como LiveKit) con tope por sesión. `usage_periods` suma el mes por comunidad (UTC). Lo que excede las horas incluidas se descuenta de la **bolsa de horas** más próxima a vencer. **No se corta** al agotar horas: se avisa a la administración (pantalla de facturación).
- **Privacidad (§16 B5):** `usage_events` (minutos por persona) no lo lee nadie desde la app (RLS sin acceso); la comunidad ve solo agregados. Si se borra la cuenta, el registro conserva los minutos sin identidad.

## Seguridad
- Todas las tablas nuevas con RLS; pedidos, pases, planes y suscripciones **no** se escriben desde la app (solo funciones definer y la service role). `fulfill_order`, `refund_order`, `record_usage`, `close_room_system`, `rooms_over_limit` solo para la service role. `security_audit` sigue sin hallazgos.
- Llave privada y llave pública del webhook solo en servidor; `/api/billing/enforce` exige un secreto comparado en tiempo constante.
- Los registros de pago se conservan al borrar la cuenta pero **sin identidad** (`on delete set null`); privacidad actualizada.

## No implementado todavía (honesto)
- Cámaras simultáneas y calidad: están en `plans.limits` pero no se aplican (la cámara aún no existe en la app).
- Tope de salas por día por dispositivo en el plan gratuito y captcha ya existente (Fase 8): sin límite adicional por dispositivo.
- Aviso por notificación push/correo a la administración al agotar horas y a la anfitriona a los 10/2 min: hoy los avisos son dentro de la app.
- Factura (CFDI), impuestos y cuotas de Conekta: fuera de la app (contabilidad).
- Plan "Red / Ministerio" (cotización): sin compra en la app.
- Renovación automática y cancelación de suscripción con proveedor.
- **Integración con Conekta no probada en vivo:** la llave entregada tiene permiso de lectura pero no de escritura (`orders:write`), así que la creación de órdenes y el webhook se verificaron contra la documentación y con pruebas simuladas (firma RSA real, cuerpos de ejemplo), no contra el sandbox.

## Pruebas
- Base de datos (28 nuevas): límites de sala, planes y prueba, extras, órdenes y precios, cumplimiento idempotente, pases, eventos de pago, uso y bolsas, RLS.
- Rutas (checkout, webhook de Conekta con firma real, enforcer, token con límites, webhook de LiveKit) y unitarias (reloj de sala, esquemas, firma, cliente de Conekta).
- E2E: precios públicos, facturación de la comunidad, estado real al volver del pago, aviso de tiempo y ampliación desde la sala.
