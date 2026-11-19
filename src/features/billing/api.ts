import { toBillingError, type BillingErrorKey, type CheckoutInput } from "./schemas";

type Result = { ok: true; url: string } | { ok: false; error: BillingErrorKey };

/** Pide al servidor una página de pago. El monto lo calcula la base; aquí solo se dice QUÉ se compra. */
export async function startCheckout(input: CheckoutInput): Promise<Result> {
  try {
    const response = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
    const json = (await response.json().catch(() => ({}))) as { error?: string; url?: string };
    if (!response.ok || !json.url) return { ok: false, error: toBillingError(json.error) };
    return { ok: true, url: json.url };
  } catch {
    return { ok: false, error: "generic" };
  }
}
