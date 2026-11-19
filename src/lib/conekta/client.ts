import { z } from "zod";

/**
 * Capa delgada de Conekta (API v2.3.0, sin SDK). Solo servidor: la llave privada (`CONEKTA_API_SECRET`) nunca va
 * al navegador ni se imprime. Usamos el checkout alojado (HostedPayment): la persona paga en una página de
 * Conekta (tarjeta, OXXO o SPEI) y los datos de pago nunca pasan por nuestro servidor.
 */
const API_URL = "https://api.conekta.io";
const API_VERSION = "application/vnd.conekta-v2.3.0+json";

export class ConektaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function getConektaPrivateKey(): string {
  const key = process.env.CONEKTA_API_SECRET;
  if (!key) throw new Error("Falta CONEKTA_API_SECRET (solo servidor). Revisa .env.example.");
  return key;
}

const orderResponseSchema = z.object({
  id: z.string().min(1),
  livemode: z.boolean().optional(),
  checkout: z.object({ url: z.url(), expires_at: z.number().optional() }),
});

const errorResponseSchema = z.object({ details: z.array(z.object({ message: z.string().optional() })).optional() });

export interface HostedOrderInput {
  /** Nuestra orden (viaja en metadata y vuelve en el webhook). */
  orderId: string;
  /** Texto del concepto (3 a 249 caracteres). */
  itemName: string;
  /** Pesos enteros; Conekta pide centavos. */
  amountMxn: number;
  buyer: { name: string; email: string };
  successUrl: string;
  failureUrl: string;
  /** Segundos desde epoch (Unix). */
  expiresAt: number;
}

export interface HostedOrder {
  providerOrderId: string;
  checkoutUrl: string;
  expiresAt: number | null;
  livemode: boolean | null;
}

export async function createHostedOrder(input: HostedOrderInput): Promise<HostedOrder> {
  const name = input.itemName.padEnd(3, " ").slice(0, 249);
  const response = await fetch(`${API_URL}/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getConektaPrivateKey()}`,
      Accept: API_VERSION,
      "Content-Type": "application/json",
      "Accept-Language": "es",
      // Reintentar con la misma llave devuelve la misma orden: no se cobra dos veces
      "Idempotency-Key": `intercede-order-${input.orderId}`,
    },
    body: JSON.stringify({
      currency: "MXN",
      customer_info: { name: input.buyer.name, email: input.buyer.email },
      line_items: [{ name, quantity: 1, unit_price: input.amountMxn * 100 }],
      checkout: {
        type: "HostedPayment",
        name,
        allowed_payment_methods: ["card", "cash", "bank_transfer"],
        success_url: input.successUrl,
        failure_url: input.failureUrl,
        expires_at: input.expiresAt,
      },
      metadata: { order_id: input.orderId },
    }),
    cache: "no-store",
  });

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = errorResponseSchema.safeParse(body);
    throw new ConektaError(detail.success ? (detail.data.details?.[0]?.message ?? "Conekta rechazó la orden") : "Conekta rechazó la orden", response.status);
  }
  const parsed = orderResponseSchema.safeParse(body);
  if (!parsed.success) throw new ConektaError("Respuesta inesperada de Conekta", 502);
  return {
    providerOrderId: parsed.data.id,
    checkoutUrl: parsed.data.checkout.url,
    expiresAt: parsed.data.checkout.expires_at ?? null,
    livemode: parsed.data.livemode ?? null,
  };
}
