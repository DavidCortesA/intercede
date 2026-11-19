import { createVerify } from "node:crypto";
import { z } from "zod";

/**
 * Webhooks de Conekta. La autenticidad se comprueba con la cabecera `DIGEST`: firma RSA-SHA256 (base64) del cuerpo
 * CRUDO, verificada con la llave pública del webhook (`CONEKTA_WEBHOOK_PUBLIC_KEY`, PEM). Nunca se confía en la
 * redirección del navegador como prueba de pago (CLAUDE.md §14.9).
 */
export function getWebhookPublicKey(): string | null {
  const raw = process.env.CONEKTA_WEBHOOK_PUBLIC_KEY?.trim();
  if (!raw) return null;
  // En una variable de una sola línea el PEM suele venir con "\n" literales
  return raw.replaceAll("\\n", "\n");
}

export function verifyDigest(rawBody: string, digestHeader: string | null, publicKeyPem: string): boolean {
  if (!digestHeader) return false;
  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(rawBody, "utf8");
    return verifier.verify(publicKeyPem, Buffer.from(digestHeader, "base64"));
  } catch {
    return false;
  }
}

const eventSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.string().min(1).max(100),
  livemode: z.boolean().optional(),
  data: z
    .object({
      object: z
        .object({
          id: z.string().optional(),
          amount: z.number().optional(),
          currency: z.string().optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .loose(),
    })
    .loose()
    .optional(),
});
export type ConektaEvent = z.infer<typeof eventSchema>;

export function parseEvent(rawBody: string): ConektaEvent | null {
  try {
    const parsed = eventSchema.safeParse(JSON.parse(rawBody));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type PaymentAction = "paid" | "failed" | "canceled" | "refunded" | "ignore";

/**
 * Qué hacer con cada evento. Solo `order.paid` activa algo (OXXO y SPEI confirman de forma asíncrona: la referencia
 * generada no es un pago). Los demás solo cierran la orden o la reembolsan.
 */
export function actionFor(type: string): PaymentAction {
  switch (type) {
    case "order.paid":
      return "paid";
    case "order.expired":
    case "order.declined":
      return "failed";
    case "order.canceled":
      return "canceled";
    case "order.refunded":
      return "refunded";
    default:
      return "ignore";
  }
}

/** Nuestra orden: el id propio viaja en `metadata.order_id`; si no, se busca por el id de Conekta. */
export function ourOrderId(event: ConektaEvent): string | null {
  const value = event.data?.object.metadata?.order_id;
  return typeof value === "string" && z.uuid().safeParse(value).success ? value : null;
}
