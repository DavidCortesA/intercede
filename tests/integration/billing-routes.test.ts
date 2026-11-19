// @vitest-environment node
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { AccessToken, TokenVerifier } from "livekit-server-sdk";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminClient, createCookieSession, hasTestDb, signInGuest, testEnv } from "./helpers";

const session = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...session.jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void session.jar.set(name, value),
  }),
}));

const livekit = vi.hoisted(() => ({ createRoom: vi.fn(), deleteRoom: vi.fn() }));
vi.mock("@/lib/livekit/server", async (importOriginal) => {
  const original: Record<string, unknown> = await importOriginal();
  return { ...original, getRoomService: () => livekit };
});

const LK = { url: "wss://prueba.livekit.test", key: "APIprueba123", secret: "secreto-de-prueba-largo-0123456789abcdef" };
const HOST = "http://localhost:3000";
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const signBody = (body: string) => createSign("RSA-SHA256").update(body, "utf8").sign(privateKey, "base64");

describe.skipIf(!hasTestDb)("rutas de facturación y límites (Fase 9)", () => {
  const admin = adminClient();
  const userIds: string[] = [];
  const realFetch = globalThis.fetch;
  let ana: Awaited<ReturnType<typeof createCookieSession>>;
  let beto: Awaited<ReturnType<typeof createCookieSession>>;
  let conektaCalls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  let conektaResponse: () => Response;
  let post: Record<"checkout" | "webhook" | "enforce" | "lkWebhook" | "token", (request: Request) => Promise<Response>>;

  const as = (who: { jar: Map<string, string> } | null) => {
    session.jar = who ? new Map(who.jar) : new Map();
  };
  const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    new Request(`${HOST}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: HOST, "x-forwarded-host": "localhost:3000", ...headers },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = testEnv.url;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = testEnv.publishableKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = testEnv.serviceRoleKey;
    process.env.LIVEKIT_URL = LK.url;
    process.env.LIVEKIT_API_KEY = LK.key;
    process.env.LIVEKIT_API_SECRET = LK.secret;
    process.env.NEXT_PUBLIC_SITE_URL = "https://intercede.test";
    process.env.CONEKTA_API_SECRET = "key_privada_de_prueba";
    process.env.CONEKTA_WEBHOOK_PUBLIC_KEY = publicKey.export({ type: "spki", format: "pem" }).toString();
    process.env.ENFORCER_SECRET = "secreto-del-enforcer-de-prueba";

    [ana, beto] = await Promise.all([createCookieSession("Ana"), createCookieSession("Beto")]);
    userIds.push(ana.userId, beto.userId);
    post = {
      checkout: (await import("@/app/api/billing/checkout/route")).POST,
      webhook: (await import("@/app/api/billing/webhook/route")).POST,
      enforce: (await import("@/app/api/billing/enforce/route")).POST,
      lkWebhook: (await import("@/app/api/livekit/webhook/route")).POST,
      token: (await import("@/app/api/livekit/token/route")).POST,
    };
  });

  afterAll(async () => {
    await Promise.all(userIds.map((id) => admin.auth.admin.deleteUser(id)));
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    livekit.createRoom.mockResolvedValue({});
    livekit.deleteRoom.mockResolvedValue({});
    conektaCalls = [];
    conektaResponse = () => Response.json({ id: "ord_prueba_1", livemode: false, checkout: { url: "https://pay.conekta.test/checkout/abc", expires_at: Math.floor(Date.now() / 1000) + 3600 } });
    // Solo Conekta se simula; Supabase (local) sigue siendo real
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("https://api.conekta.io")) {
        conektaCalls.push({ url, body: JSON.parse(String(init?.body ?? "{}")), headers: (init?.headers ?? {}) as Record<string, string> });
        return conektaResponse();
      }
      return realFetch(input, init);
    });
    await admin.from("rooms").delete().in("host_id", userIds);
    await admin.from("orders").delete().in("buyer_id", userIds);
    await admin.from("passes").delete().in("buyer_id", userIds);
  });

  afterEach(() => vi.unstubAllGlobals());

  async function newRoom() {
    const { data, error } = await ana.client.rpc("create_room", { p_name: "Sala", p_display_name: "Ana" });
    expect(error).toBeNull();
    return { id: data![0]!.room_id, code: data![0]!.room_code };
  }

  // ───────────────────────── Checkout ─────────────────────────

  describe("POST /api/billing/checkout", () => {
    it("sin sesión 401; invitado 403; origen ajeno 403; cuerpo inválido 400", async () => {
      as(null);
      expect((await post.checkout(json("/api/billing/checkout", { kind: "pass", code: "vigilia" }))).status).toBe(401);

      const guest = await signInGuest("Invitada");
      userIds.push(guest.user.id);
      as(ana);
      expect((await post.checkout(json("/api/billing/checkout", { kind: "pass", code: "vigilia" }, { origin: "https://malo.example" }))).status).toBe(403);
      expect((await post.checkout(json("/api/billing/checkout", { kind: "pass", code: "inventado" }))).status).toBe(400);
      expect(conektaCalls).toHaveLength(0);
    });

    it("crea la orden con el precio de la base (aunque el cliente mande otro) y devuelve la página de pago", async () => {
      as(ana);
      const res = await post.checkout(json("/api/billing/checkout", { kind: "pass", code: "vigilia", amount: 1, price: 1, unit_price: 1 }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { url: string; orderId: string };
      expect(body.url).toBe("https://pay.conekta.test/checkout/abc");

      expect(conektaCalls).toHaveLength(1);
      expect(conektaCalls[0]!.body).toMatchObject({
        line_items: [{ name: "Vigilia", quantity: 1, unit_price: 24900 }],
        metadata: { order_id: body.orderId },
        checkout: { type: "HostedPayment", success_url: `https://intercede.test/es/facturacion?orden=${body.orderId}` },
      });
      expect(conektaCalls[0]!.headers.Authorization).toBe("Bearer key_privada_de_prueba");

      const order = (await admin.from("orders").select("status, amount_mxn, provider_order_id, checkout_url, buyer_id").eq("id", body.orderId).single()).data!;
      expect(order).toMatchObject({ status: "pending", amount_mxn: 249, provider_order_id: "ord_prueba_1", checkout_url: body.url, buyer_id: ana.userId });
      // Todavía NO hay pase: solo el pago verificado activa
      expect((await admin.from("passes").select("id").eq("buyer_id", ana.userId)).data).toEqual([]);
    });

    it("comprado desde una sala vuelve a la sala; la comunidad vuelve a su facturación", async () => {
      as(ana);
      const room = await newRoom();
      const fromRoom = await post.checkout(json("/api/billing/checkout", { kind: "pass", code: "extension", roomId: room.id }));
      expect(fromRoom.status).toBe(200);
      expect(conektaCalls[0]!.body).toMatchObject({ checkout: { success_url: `https://intercede.test/es/r/${room.code}` } });

      const { data: id } = await ana.client.rpc("create_community", { p_name: "Iglesia", p_kind: "church" });
      const community = await post.checkout(json("/api/billing/checkout", { kind: "plan", code: "pro", period: "annual", communityId: id! }));
      expect(community.status).toBe(200);
      expect(conektaCalls[1]!.body).toMatchObject({ line_items: [{ unit_price: 1_499_000 }] });
      expect((conektaCalls[1]!.body.checkout as { success_url: string }).success_url).toContain(`/es/comunidades/${id}/facturacion?orden=`);
      await admin.from("communities").delete().eq("id", id!);
    });

    it("las reglas de la base se respetan: no administración, extensión sin sala, extras sin plan", async () => {
      as(beto);
      const { data: id } = await ana.client.rpc("create_community", { p_name: "Iglesia", p_kind: "church" });
      const notAdmin = await post.checkout(json("/api/billing/checkout", { kind: "plan", code: "plus", period: "monthly", communityId: id! }));
      expect(notAdmin.status).toBe(400);
      expect(await notAdmin.json()).toEqual({ error: "not_admin" });
      as(ana);
      expect(await (await post.checkout(json("/api/billing/checkout", { kind: "pass", code: "extension" }))).json()).toEqual({ error: "invalid_item" });
      expect(conektaCalls).toHaveLength(0);
      await admin.from("communities").delete().eq("id", id!);
    });

    it("si Conekta falla la orden se cierra (no queda pendiente) y se responde 502", async () => {
      conektaResponse = () => Response.json({ details: [{ message: "Acceso no autorizado." }] }, { status: 403 });
      as(ana);
      const res = await post.checkout(json("/api/billing/checkout", { kind: "pass", code: "sala_larga" }));
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "payment_unavailable" });
      const orders = (await admin.from("orders").select("status").eq("buyer_id", ana.userId)).data ?? [];
      expect(orders).toEqual([{ status: "failed" }]);
    });
  });

  // ───────────────────────── Webhook de Conekta ─────────────────────────

  describe("POST /api/billing/webhook", () => {
    async function pendingOrder(kind: "pass" | "plan" = "pass", extra: Record<string, unknown> = {}) {
      const args = kind === "pass" ? { p_kind: "pass", p_code: "vigilia" } : { p_kind: "plan", p_code: "plus", p_period: "monthly" };
      const { data, error } = await ana.client.rpc("create_order", { ...args, ...extra } as never);
      expect(error).toBeNull();
      return (data as { order_id: string; amount_mxn: number }[])[0]!;
    }
    const event = (type: string, orderId: string | null, over: Record<string, unknown> = {}) => ({
      id: `evt_${crypto.randomUUID()}`,
      type,
      livemode: false,
      data: { object: { id: "ord_x", amount: 24900, currency: "MXN", metadata: orderId ? { order_id: orderId } : {}, ...over } },
    });
    const send = (payload: unknown, signature?: string) => {
      const raw = JSON.stringify(payload);
      return post.webhook(new Request(`${HOST}/api/billing/webhook`, { method: "POST", headers: { "content-type": "application/json", digest: signature ?? signBody(raw) }, body: raw }));
    };

    it("sin firma válida: 401 y no pasa nada", async () => {
      const order = await pendingOrder();
      const payload = event("order.paid", order.order_id);
      expect((await send(payload, "AAAA")).status).toBe(401);
      const noHeader = await post.webhook(new Request(`${HOST}/api/billing/webhook`, { method: "POST", body: JSON.stringify(payload) }));
      expect(noHeader.status).toBe(401);
      expect((await admin.from("orders").select("status").eq("id", order.order_id).single()).data!.status).toBe("pending");
      expect((await admin.from("payment_events").select("id", { count: "exact", head: true }).eq("provider_event_id", payload.id)).count).toBe(0);
    });

    it("order.paid verificado activa lo comprado y reenviarlo no duplica nada", async () => {
      const order = await pendingOrder();
      const payload = event("order.paid", order.order_id);
      expect((await send(payload)).status).toBe(200);

      expect((await admin.from("orders").select("status, paid_at").eq("id", order.order_id).single()).data).toMatchObject({ status: "paid" });
      expect((await admin.from("passes").select("status").eq("buyer_id", ana.userId)).data).toEqual([{ status: "available" }]);
      const stored = (await admin.from("payment_events").select("processed_at, error").eq("provider_event_id", payload.id).single()).data!;
      expect(stored.processed_at).not.toBeNull();
      expect(stored.error).toBeNull();

      // Reintento del mismo evento y un evento nuevo para la misma orden: un solo pase
      expect((await send(payload)).status).toBe(200);
      expect((await send(event("order.paid", order.order_id))).status).toBe(200);
      expect((await admin.from("passes").select("id").eq("buyer_id", ana.userId)).data).toHaveLength(1);
    });

    it("encuentra la orden por el id de Conekta si falta nuestro id en metadata", async () => {
      const order = await pendingOrder();
      await admin.rpc("attach_order_checkout", { p_order_id: order.order_id, p_provider_order_id: "ord_buscada", p_checkout_url: "https://pay.conekta.test/x", p_expires_at: iso(Date.now() + 60 * MIN) });
      expect((await send(event("order.paid", null, { id: "ord_buscada" }))).status).toBe(200);
      expect((await admin.from("orders").select("status").eq("id", order.order_id).single()).data!.status).toBe("paid");
    });

    it("un monto o una moneda distintos NO activan nada y se conservan para revisarlos", async () => {
      const order = await pendingOrder();
      const wrongAmount = event("order.paid", order.order_id, { amount: 100 });
      expect((await send(wrongAmount)).status).toBe(200);
      const wrongCurrency = event("order.paid", order.order_id, { currency: "USD" });
      expect((await send(wrongCurrency)).status).toBe(200);

      expect((await admin.from("orders").select("status").eq("id", order.order_id).single()).data!.status).toBe("pending");
      expect((await admin.from("passes").select("id").eq("buyer_id", ana.userId)).data).toEqual([]);
      expect((await admin.from("payment_events").select("error").eq("provider_event_id", wrongAmount.id).single()).data!.error).toBe("amount_mismatch");
      expect((await admin.from("payment_events").select("error").eq("provider_event_id", wrongCurrency.id).single()).data!.error).toBe("currency_mismatch");
    });

    it("una referencia generada o un evento ajeno no activan nada; una orden desconocida se registra con su error", async () => {
      const order = await pendingOrder();
      for (const type of ["order.pending_payment", "order.created", "charge.paid", "subscription.paid"]) {
        expect((await send(event(type, order.order_id))).status).toBe(200);
      }
      expect((await admin.from("orders").select("status").eq("id", order.order_id).single()).data!.status).toBe("pending");

      const unknown = event("order.paid", crypto.randomUUID());
      expect((await send(unknown)).status).toBe(200);
      expect((await admin.from("payment_events").select("error").eq("provider_event_id", unknown.id).single()).data!.error).toBe("order_not_found");
    });

    it("vencer o cancelar cierra la orden; reembolsar revierte lo comprado", async () => {
      const expired = await pendingOrder();
      await send(event("order.expired", expired.order_id));
      expect((await admin.from("orders").select("status").eq("id", expired.order_id).single()).data!.status).toBe("expired");

      const canceled = await pendingOrder();
      await send(event("order.canceled", canceled.order_id));
      expect((await admin.from("orders").select("status").eq("id", canceled.order_id).single()).data!.status).toBe("canceled");

      const paid = await pendingOrder();
      await send(event("order.paid", paid.order_id));
      await send(event("order.refunded", paid.order_id));
      expect((await admin.from("orders").select("status").eq("id", paid.order_id).single()).data!.status).toBe("refunded");
      expect((await admin.from("passes").select("status").eq("order_id", paid.order_id).single()).data!.status).toBe("refunded");
    });

    it("un plan pagado cambia los límites de la comunidad", async () => {
      const { data: id } = await ana.client.rpc("create_community", { p_name: "Iglesia", p_kind: "church" });
      await admin.from("subscriptions").update({ current_period_end: iso(Date.now() - MIN) }).eq("community_id", id!);
      const { data } = await ana.client.rpc("create_order", { p_kind: "plan", p_code: "pro", p_period: "monthly", p_community_id: id! });
      const order = data![0]!;
      expect((await send(event("order.paid", order.order_id, { amount: 149_900 }))).status).toBe(200);
      expect(((await ana.client.rpc("get_entitlements", { p_community_id: id! })).data as { plan: string; max_room_participants: number })).toMatchObject({ plan: "pro", max_room_participants: 100 });
      await admin.from("communities").delete().eq("id", id!);
    });

    it("cuerpo que no es un evento: 400 (firmado)", async () => {
      expect((await send({ hola: "mundo" })).status).toBe(400);
    });
  });

  // ───────────────────────── Cierre de salas vencidas ─────────────────────────

  describe("POST /api/billing/enforce", () => {
    const call = (secret: string | null) =>
      post.enforce(new Request(`${HOST}/api/billing/enforce`, { method: "POST", headers: secret ? { "x-enforcer-secret": secret } : {} }));

    it("sin el secreto compartido: 401 y no cierra nada", async () => {
      const room = await newRoom();
      await admin.from("rooms").update({ ends_at: iso(Date.now() - 10 * MIN) }).eq("id", room.id);
      expect((await call(null)).status).toBe(401);
      expect((await call("otro-secreto")).status).toBe(401);
      expect((await admin.from("rooms").select("status").eq("id", room.id).single()).data!.status).toBe("open");
      expect(livekit.deleteRoom).not.toHaveBeenCalled();
    });

    it("cierra las salas fuera de tiempo (con su gracia), desconecta el audio y deja las demás", async () => {
      const late = await newRoom();
      const grace = await newRoom();
      await admin.from("rooms").update({ ends_at: iso(Date.now() - 10 * MIN) }).eq("id", late.id);
      await admin.from("rooms").update({ ends_at: iso(Date.now() - 2 * MIN) }).eq("id", grace.id);

      const res = await call("secreto-del-enforcer-de-prueba");
      expect(res.status).toBe(200);
      expect(((await res.json()) as { closed: number }).closed).toBeGreaterThanOrEqual(1);
      expect((await admin.from("rooms").select("status").eq("id", late.id).single()).data!.status).toBe("closed");
      expect((await admin.from("rooms").select("status").eq("id", grace.id).single()).data!.status).toBe("open");
      expect(livekit.deleteRoom).toHaveBeenCalledWith(late.id);
      expect(livekit.deleteRoom).not.toHaveBeenCalledWith(grace.id);
      // Quien estaba dentro queda fuera
      expect((await admin.from("room_members").select("left_at").eq("room_id", late.id)).data?.every((m) => m.left_at !== null)).toBe(true);
    });

    it("si LiveKit no conoce la sala igual queda cerrada en la base", async () => {
      livekit.deleteRoom.mockRejectedValue(new Error("not_found"));
      const room = await newRoom();
      await admin.from("rooms").update({ ends_at: iso(Date.now() - 10 * MIN) }).eq("id", room.id);
      expect((await call("secreto-del-enforcer-de-prueba")).status).toBe(200);
      expect((await admin.from("rooms").select("status").eq("id", room.id).single()).data!.status).toBe("closed");
    });
  });

  // ───────────────────────── Token con límites ─────────────────────────

  describe("POST /api/livekit/token con límites de la sala", () => {
    it("el techo de LiveKit es el del plan más alto y el token no dura más que la sala", async () => {
      as(ana);
      const room = await newRoom();
      await admin.from("rooms").update({ ends_at: iso(Date.now() + 10 * MIN) }).eq("id", room.id);
      const res = await post.token(json("/api/livekit/token", { roomId: room.id }));
      expect(res.status).toBe(200);
      expect(livekit.createRoom).toHaveBeenCalledWith({ name: room.id, maxParticipants: 100, emptyTimeout: 600 });

      const { token } = (await res.json()) as { token: string };
      const claims = await new TokenVerifier(LK.key, LK.secret).verify(token);
      const lifetime = (claims.exp ?? 0) - (claims.nbf ?? 0);
      // 10 min de sala + 5 de gracia = 15 min (900 s), no las 2 h de siempre
      expect(lifetime).toBeGreaterThan(14 * 60);
      expect(lifetime).toBeLessThanOrEqual(15 * 60 + 5);
    });

    it("dentro de la gracia se emite token; pasada la gracia, 409 room_expired", async () => {
      as(ana);
      const room = await newRoom();
      await admin.from("rooms").update({ ends_at: iso(Date.now() - 2 * MIN) }).eq("id", room.id);
      expect((await post.token(json("/api/livekit/token", { roomId: room.id }))).status).toBe(200);

      await admin.from("rooms").update({ ends_at: iso(Date.now() - 6 * MIN) }).eq("id", room.id);
      const res = await post.token(json("/api/livekit/token", { roomId: room.id }));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "room_expired" });
    });
  });

  // ───────────────────────── Webhook de LiveKit (uso) ─────────────────────────

  describe("POST /api/livekit/webhook", () => {
    async function signedEvent(payload: Record<string, unknown>, tamper = false) {
      const raw = JSON.stringify(payload);
      const token = new AccessToken(LK.key, LK.secret);
      token.sha256 = createHash("sha256").update(tamper ? raw + " " : raw).digest("base64");
      return new Request(`${HOST}/api/livekit/webhook`, { method: "POST", headers: { "content-type": "application/webhook+json", authorization: await token.toJwt() }, body: raw });
    }
    const left = (roomId: string, userId: string, id: string, minutes = 7) => {
      const now = Math.floor(Date.now() / 1000);
      return { event: "participant_left", id, createdAt: String(now), room: { name: roomId }, participant: { identity: userId, joinedAt: String(now - minutes * 60) } };
    };

    it("una firma falsa o un cuerpo alterado: 401", async () => {
      const room = await newRoom();
      const payload = left(room.id, ana.userId, "EV_falso");
      expect((await post.lkWebhook(new Request(`${HOST}/api/livekit/webhook`, { method: "POST", body: JSON.stringify(payload) }))).status).toBe(401);
      expect((await post.lkWebhook(await signedEvent(payload, true))).status).toBe(401);
      expect((await admin.from("usage_events").select("id", { count: "exact", head: true }).eq("livekit_event_id", "EV_falso")).count).toBe(0);
    });

    it("al salir alguien se registran sus minutos una sola vez y se suman a la comunidad", async () => {
      const { data: communityId } = await ana.client.rpc("create_community", { p_name: "Iglesia", p_kind: "church" });
      const { data } = await ana.client.rpc("create_community_room", { p_community_id: communityId!, p_name: "Sala", p_display_name: "Ana" });
      const roomId = data![0]!.room_id;
      const eventId = `EV_${crypto.randomUUID()}`;

      expect(await (await post.lkWebhook(await signedEvent(left(roomId, beto.userId, eventId, 7)))).json()).toEqual({ recorded: true });
      expect((await post.lkWebhook(await signedEvent(left(roomId, beto.userId, eventId, 7)))).status).toBe(200); // reintento
      expect((await admin.from("usage_events").select("minutes").eq("livekit_event_id", eventId)).data).toEqual([{ minutes: 7 }]);
      expect((await admin.from("usage_periods").select("person_minutes").eq("community_id", communityId!).single()).data!.person_minutes).toBe(7);

      // Otros eventos (entrar, cerrar la sala) y datos sin forma de sala se ignoran
      for (const other of [{ event: "participant_joined", id: "EV_j", room: { name: roomId }, participant: { identity: beto.userId } }, { event: "room_finished", id: "EV_f", room: { name: roomId } }, left("no-es-uuid", beto.userId, "EV_n")]) {
        expect(await (await post.lkWebhook(await signedEvent(other))).json()).toEqual({ ignored: true });
      }
      await admin.from("communities").delete().eq("id", communityId!);
    });
  });
});
