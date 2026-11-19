import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROOM_GRACE_MINUTES, roomClock } from "@/features/billing/limits";
import { checkoutSchema, formatMxn, toBillingError } from "@/features/billing/schemas";
import { ConektaError, createHostedOrder } from "@/lib/conekta/client";
import { actionFor, getWebhookPublicKey, ourOrderId, parseEvent, verifyDigest } from "@/lib/conekta/webhook";

const MIN = 60_000;
const ID = "7b0c2b9e-5f0e-4a43-9f43-0d6f6a1a8b11";

describe("roomClock: avisos del límite de tiempo", () => {
  const end = Date.UTC(2026, 10, 19, 12, 0, 0);

  it("más de 10 minutos: sin aviso", () => {
    expect(roomClock(end, end - 30 * MIN).phase).toBe("ok");
    expect(roomClock(end, end - 10 * MIN - 1).phase).toBe("ok");
  });

  it("a 10 minutos avisa; a 2 minutos es urgente", () => {
    expect(roomClock(end, end - 10 * MIN)).toMatchObject({ phase: "warning", minutesLeft: 10 });
    expect(roomClock(end, end - 5 * MIN - 1000)).toMatchObject({ phase: "warning", minutesLeft: 6 });
    expect(roomClock(end, end - 2 * MIN)).toMatchObject({ phase: "urgent", minutesLeft: 2 });
    expect(roomClock(end, end - 1000)).toMatchObject({ phase: "urgent", minutesLeft: 1 });
  });

  it("al llegar al límite empieza la gracia de 5 minutos y después se acaba", () => {
    expect(roomClock(end, end)).toMatchObject({ phase: "grace", graceMinutesLeft: ROOM_GRACE_MINUTES });
    expect(roomClock(end, end + 3 * MIN)).toMatchObject({ phase: "grace", graceMinutesLeft: 2 });
    expect(roomClock(end, end + ROOM_GRACE_MINUTES * MIN)).toMatchObject({ phase: "over" });
    expect(roomClock(end, end + 60 * MIN).phase).toBe("over");
  });
});

describe("checkoutSchema: el cliente solo dice QUÉ compra, nunca cuánto", () => {
  it("acepta planes, pases y extras bien formados", () => {
    expect(checkoutSchema.safeParse({ kind: "plan", code: "plus", period: "annual", communityId: ID }).success).toBe(true);
    expect(checkoutSchema.safeParse({ kind: "pass", code: "vigilia" }).success).toBe(true);
    expect(checkoutSchema.safeParse({ kind: "pass", code: "extension", roomId: ID }).success).toBe(true);
    expect(checkoutSchema.parse({ kind: "addon", code: "members_50", communityId: ID })).toMatchObject({ quantity: 1 });
  });

  it("rechaza lo inválido, montos inventados no cambian nada y los campos de más se ignoran", () => {
    expect(checkoutSchema.safeParse({ kind: "plan", code: "comunidad", period: "monthly", communityId: ID }).success).toBe(false);
    expect(checkoutSchema.safeParse({ kind: "plan", code: "plus", period: "weekly", communityId: ID }).success).toBe(false);
    expect(checkoutSchema.safeParse({ kind: "plan", code: "plus", period: "monthly" }).success).toBe(false);
    expect(checkoutSchema.safeParse({ kind: "addon", code: "members_50", quantity: 11, communityId: ID }).success).toBe(false);
    expect(checkoutSchema.safeParse({ kind: "pass", code: "vigilia", roomId: "no-uuid" }).success).toBe(false);
    expect(checkoutSchema.safeParse({ kind: "otro", code: "vigilia" }).success).toBe(false);
    const parsed = checkoutSchema.parse({ kind: "pass", code: "vigilia", amount: 1, price: 1 });
    expect(parsed).toEqual({ kind: "pass", code: "vigilia" });
  });
});

describe("utilidades de facturación", () => {
  it("toBillingError conserva los códigos conocidos y manda el resto a generic", () => {
    expect(toBillingError("plan_required")).toBe("plan_required");
    expect(toBillingError("algo_raro")).toBe("generic");
    expect(toBillingError(undefined)).toBe("generic");
  });

  it("formatMxn da pesos mexicanos sin centavos", () => {
    expect(formatMxn(249).replace(/\s/g, " ")).toMatch(/\$249/);
    expect(formatMxn(14990)).toMatch(/14,990/);
  });
});

describe("webhooks de Conekta", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const sign = (body: string) => createSign("RSA-SHA256").update(body, "utf8").sign(privateKey, "base64");

  afterEach(() => vi.unstubAllEnvs());

  it("verifyDigest acepta la firma RSA-SHA256 del cuerpo crudo y nada más", () => {
    const body = JSON.stringify({ id: "evt_1", type: "order.paid" });
    expect(verifyDigest(body, sign(body), pem)).toBe(true);
    expect(verifyDigest(body + " ", sign(body), pem)).toBe(false); // un solo carácter cambia la firma
    expect(verifyDigest(body, null, pem)).toBe(false);
    expect(verifyDigest(body, "no-es-base64-valido!!", pem)).toBe(false);
    expect(verifyDigest(body, sign(body), "no es una llave")).toBe(false);
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(verifyDigest(body, createSign("RSA-SHA256").update(body).sign(other.privateKey, "base64"), pem)).toBe(false);
  });

  it("la llave pública acepta el PEM con saltos de línea literales (\\n) de una variable de una línea", () => {
    vi.stubEnv("CONEKTA_WEBHOOK_PUBLIC_KEY", pem.trim().replace(/\n/g, "\\n"));
    const body = "{}";
    expect(verifyDigest(body, sign(body), getWebhookPublicKey()!)).toBe(true);
    vi.stubEnv("CONEKTA_WEBHOOK_PUBLIC_KEY", "");
    expect(getWebhookPublicKey()).toBeNull();
  });

  it("parseEvent valida el sobre y ourOrderId solo acepta un uuid propio", () => {
    const raw = JSON.stringify({ id: "evt_1", type: "order.paid", data: { object: { id: "ord_1", amount: 7900, currency: "MXN", metadata: { order_id: ID } } } });
    const event = parseEvent(raw)!;
    expect(event).toMatchObject({ id: "evt_1", type: "order.paid" });
    expect(ourOrderId(event)).toBe(ID);
    expect(ourOrderId(parseEvent(JSON.stringify({ id: "e", type: "t", data: { object: { metadata: { order_id: "no-uuid" } } } }))!)).toBeNull();
    expect(parseEvent("no es json")).toBeNull();
    expect(parseEvent(JSON.stringify({ type: "sin id" }))).toBeNull();
  });

  it("solo order.paid activa; expirar, cancelar y reembolsar cierran; lo demás se ignora", () => {
    expect(actionFor("order.paid")).toBe("paid");
    expect(actionFor("order.expired")).toBe("failed");
    expect(actionFor("order.declined")).toBe("failed");
    expect(actionFor("order.canceled")).toBe("canceled");
    expect(actionFor("order.refunded")).toBe("refunded");
    for (const type of ["order.pending_payment", "order.created", "charge.paid", "charge.created", "subscription.paid", "webhook.ping"]) {
      expect(actionFor(type)).toBe("ignore");
    }
  });
});

describe("createHostedOrder (Conekta)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const input = {
    orderId: ID,
    itemName: "Vigilia",
    amountMxn: 249,
    buyer: { name: "Ana", email: "ana@example.test" },
    successUrl: "https://app.test/ok",
    failureUrl: "https://app.test/fail",
    expiresAt: 1_800_000_000,
  };

  it("manda el monto en centavos, el id propio en metadata y una llave de idempotencia", async () => {
    vi.stubEnv("CONEKTA_API_SECRET", "key_privada_de_prueba");
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ id: "ord_123", livemode: false, checkout: { url: "https://pay.conekta.com/checkout/abc", expires_at: 1_800_000_000 } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const order = await createHostedOrder(input);
    expect(order).toEqual({ providerOrderId: "ord_123", checkoutUrl: "https://pay.conekta.com/checkout/abc", expiresAt: 1_800_000_000, livemode: false });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://api.conekta.io/orders");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer key_privada_de_prueba",
      Accept: "application/vnd.conekta-v2.3.0+json",
      "Idempotency-Key": `intercede-order-${ID}`,
    });
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      currency: "MXN",
      line_items: [{ name: "Vigilia", quantity: 1, unit_price: 24900 }],
      checkout: { type: "HostedPayment", allowed_payment_methods: ["card", "cash", "bank_transfer"], success_url: input.successUrl, expires_at: 1_800_000_000 },
      metadata: { order_id: ID },
    });
  });

  it("un rechazo de Conekta es un ConektaError sin filtrar la llave", async () => {
    vi.stubEnv("CONEKTA_API_SECRET", "key_privada_de_prueba");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ details: [{ message: "Acceso no autorizado." }] }, { status: 403 })));
    const failure = await createHostedOrder(input).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConektaError);
    expect((failure as ConektaError).status).toBe(403);
    expect(String((failure as Error).message)).not.toContain("key_privada_de_prueba");
  });

  it("sin la llave privada falla antes de llamar a la red; una respuesta rara es un error", async () => {
    vi.stubEnv("CONEKTA_API_SECRET", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(createHostedOrder(input)).rejects.toThrow(/CONEKTA_API_SECRET/);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv("CONEKTA_API_SECRET", "key_x");
    fetchMock.mockResolvedValue(Response.json({ id: "ord_1" }));
    await expect(createHostedOrder(input)).rejects.toBeInstanceOf(ConektaError);
  });
});
