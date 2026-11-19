import { NextResponse } from "next/server";
import { actionFor, getWebhookPublicKey, ourOrderId, parseEvent, verifyDigest, type ConektaEvent } from "@/lib/conekta/webhook";
import { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

const ok = () => NextResponse.json({ received: true }, { headers: { "Cache-Control": "no-store" } });
const reject = (status: number, error: string) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/** Busca nuestra orden por el id propio (metadata) o, si no viene, por el id de la orden de Conekta. */
async function findOrder(admin: Admin, event: ConektaEvent) {
  const mine = ourOrderId(event);
  const providerId = event.data?.object.id;
  const query = admin.from("orders").select("id, amount_mxn, status");
  const { data } = mine
    ? await query.eq("id", mine).maybeSingle()
    : providerId
      ? await query.eq("provider_order_id", providerId).maybeSingle()
      : { data: null };
  return data;
}

/** Fallos que reintentar no arregla: se conserva el evento con su error para revisarlo y se responde 200. */
const PERMANENT_FAILURES = new Set(["amount_mismatch", "currency_mismatch", "order_not_found"]);

/**
 * Webhook de Conekta: la ÚNICA vía por la que una compra se activa. Verifica la firma sobre el cuerpo crudo, registra
 * el evento una sola vez (idempotencia por id de evento) y cumple/cierra la orden. Si algo falla a medias responde
 * 500 y Conekta reintenta (el evento queda sin `processed_at`, así que se vuelve a procesar de forma segura).
 */
export async function POST(request: Request) {
  const publicKey = getWebhookPublicKey();
  if (!publicKey) return reject(500, "server_misconfigured");

  const rawBody = await request.text();
  if (!verifyDigest(rawBody, request.headers.get("digest"), publicKey)) return reject(401, "invalid_signature");

  const event = parseEvent(rawBody);
  if (!event) return reject(400, "invalid_event");

  const admin = createAdminClient();
  const { data: recorded, error: recordError } = await admin.rpc("record_payment_event", {
    p_provider: "conekta",
    p_event_id: event.id,
    p_type: event.type,
    p_payload: JSON.parse(rawBody),
  });
  const row = recorded?.[0];
  if (recordError || !row) return reject(500, "record_failed");
  if (row.already_processed) return ok();

  const action = actionFor(event.type);
  let failure: string | null = null;

  if (action !== "ignore") {
    const order = await findOrder(admin, event);
    if (!order) {
      failure = "order_not_found";
    } else if (action === "paid") {
      // Defensa en profundidad: el monto cobrado debe ser el de la orden (Conekta usa centavos)
      const amount = event.data?.object.amount;
      const currency = event.data?.object.currency;
      if (typeof amount === "number" && amount !== order.amount_mxn * 100) failure = "amount_mismatch";
      else if (currency && currency.toUpperCase() !== "MXN") failure = "currency_mismatch";
      else {
        const { error } = await admin.rpc("fulfill_order", { p_order_id: order.id });
        if (error) failure = "fulfill_failed";
      }
    } else if (action === "refunded") {
      const { error } = await admin.rpc("refund_order", { p_order_id: order.id });
      if (error) failure = "refund_failed";
    } else {
      const { error } = await admin.rpc("fail_order", { p_order_id: order.id, p_status: action === "canceled" ? "canceled" : "expired" });
      if (error) failure = "fail_failed";
    }
  }

  await admin.rpc("finish_payment_event", failure ? { p_id: row.event_row_id, p_error: failure } : { p_id: row.event_row_id });
  if (failure && !PERMANENT_FAILURES.has(failure)) return reject(500, failure);
  return ok();
}
