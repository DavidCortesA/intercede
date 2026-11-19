// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createHostedOrder } from "@/lib/conekta/client";

/**
 * Prueba contra el SANDBOX real de Conekta (crea una orden sin pagar que vence sola en una hora). No corre en el CI
 * ni por defecto: `CONEKTA_SANDBOX=1 CONEKTA_API_SECRET=<llave de pruebas> npx vitest run tests/integration/conekta-sandbox.test.ts`.
 * Se niega a correr con una llave de producción (`livemode`).
 */
const enabled = process.env.CONEKTA_SANDBOX === "1" && Boolean(process.env.CONEKTA_API_SECRET);

describe.skipIf(!enabled)("Conekta (sandbox real)", () => {
  it("crea una orden con checkout alojado y devuelve la página de pago de pruebas", async () => {
    const order = await createHostedOrder({
      orderId: crypto.randomUUID(),
      itemName: "Prueba de INTERCEDE (sandbox)",
      amountMxn: 79,
      buyer: { name: "Prueba INTERCEDE", email: "prueba@example.com" },
      successUrl: "https://intercede-six.vercel.app/es/facturacion",
      failureUrl: "https://intercede-six.vercel.app/es/facturacion",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(order.livemode).toBe(false);
    expect(order.providerOrderId).toMatch(/^ord_/);
    expect(order.checkoutUrl).toMatch(/^https:\/\/pay\.conekta\.(com|io)\//);
  });
});
