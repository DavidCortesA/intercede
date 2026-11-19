// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { adminClient, anonClient, hasTestDb, signInGuest, signInTestUser } from "./helpers";

type Person = Awaited<ReturnType<typeof signInTestUser>>;

const errorOf = (res: { error: { message: string } | null }) => res.error?.message;
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe.skipIf(!hasTestDb)("planes, límites y cobros (Fase 9)", () => {
  const admin = adminClient();
  const userIds: string[] = [];
  const communityIds: string[] = [];
  const planCodes: string[] = [];
  let ana: Person; // administra la comunidad y compra
  let beto: Person; // miembro
  let carla: Person; // sin relación

  beforeAll(async () => {
    [ana, beto, carla] = await Promise.all([signInTestUser("Ana"), signInTestUser("Beto"), signInTestUser("Carla")]);
    userIds.push(ana.user.id, beto.user.id, carla.user.id);
  });

  afterEach(async () => {
    if (communityIds.length) await admin.from("communities").delete().in("id", communityIds.splice(0));
    await admin.from("rooms").delete().in("host_id", userIds);
    await admin.from("orders").delete().in("buyer_id", userIds);
    await admin.from("passes").delete().in("buyer_id", userIds);
    if (planCodes.length) await admin.from("plans").delete().in("code", planCodes.splice(0));
  });

  afterAll(async () => {
    await Promise.all(userIds.map((id) => admin.auth.admin.deleteUser(id)));
  });

  async function community() {
    const { data: id, error } = await ana.client.rpc("create_community", { p_name: "Iglesia de prueba", p_kind: "church" });
    expect(error).toBeNull();
    communityIds.push(id!);
    const token = (await ana.client.rpc("get_community_invite", { p_community_id: id! })).data!;
    expect((await beto.client.rpc("join_community", { p_token: token })).error).toBeNull();
    return id!;
  }

  /** Termina la prueba de Plus: la comunidad queda en el plan gratuito. */
  async function endTrial(id: string) {
    const { error } = await admin.from("subscriptions").update({ current_period_end: iso(Date.now() - MIN) }).eq("community_id", id);
    expect(error).toBeNull();
  }

  async function personalRoom(person: Person = ana) {
    const { data, error } = await person.client.rpc("create_room", { p_name: "Sala", p_display_name: "Ana" });
    expect(error).toBeNull();
    return { id: data![0]!.room_id, code: data![0]!.room_code };
  }

  async function roomRow(id: string) {
    return (await admin.from("rooms").select("max_participants, ends_at, created_at, status").eq("id", id).single()).data!;
  }

  async function paidOrder(person: Person, args: { kind: string; code: string; period?: string; qty?: number; community?: string; room?: string }) {
    const { data, error } = await person.client.rpc("create_order", {
      p_kind: args.kind,
      p_code: args.code,
      p_period: args.period,
      p_quantity: args.qty ?? 1,
      p_community_id: args.community,
      p_room_id: args.room,
    });
    expect(error).toBeNull();
    const order = data![0]!;
    const { data: result, error: fulfillError } = await admin.rpc("fulfill_order", { p_order_id: order.order_id });
    expect(fulfillError).toBeNull();
    return { ...order, result };
  }

  // ───────────────────────── Límites de las salas ─────────────────────────

  describe("límites de las salas", () => {
    it("una sala personal nace con los límites gratuitos: 15 personas y 2 horas", async () => {
      const room = await roomRow((await personalRoom()).id);
      expect(room.max_participants).toBe(15);
      const minutes = (new Date(room.ends_at).getTime() - new Date(room.created_at).getTime()) / MIN;
      expect(minutes).toBeCloseTo(120, 0);
    });

    it("pasado el tiempo y la gracia de 5 minutos ya no se entra; dentro de la gracia sí", async () => {
      const room = await personalRoom();
      await admin.from("rooms").update({ ends_at: iso(Date.now() - 2 * MIN) }).eq("id", room.id);
      expect((await beto.client.rpc("join_room", { p_code: room.code, p_display_name: "Beto" })).error).toBeNull();

      await admin.from("rooms").update({ ends_at: iso(Date.now() - 6 * MIN) }).eq("id", room.id);
      expect(errorOf(await carla.client.rpc("join_room", { p_code: room.code, p_display_name: "Carla" }))).toBe("room_expired");
    });

    it("rooms_over_limit lista solo las abiertas fuera de tiempo y close_room_system las cierra", async () => {
      const late = await personalRoom();
      const grace = await personalRoom();
      const fine = await personalRoom();
      await admin.from("rooms").update({ ends_at: iso(Date.now() - 6 * MIN) }).eq("id", late.id);
      await admin.from("rooms").update({ ends_at: iso(Date.now() - 2 * MIN) }).eq("id", grace.id);

      const over = (await admin.rpc("rooms_over_limit")).data ?? [];
      expect(over).toContain(late.id);
      expect(over).not.toContain(grace.id);
      expect(over).not.toContain(fine.id);

      expect((await admin.rpc("close_room_system", { p_room_id: late.id })).error).toBeNull();
      expect((await roomRow(late.id)).status).toBe("closed");
      expect((await admin.rpc("rooms_over_limit")).data ?? []).not.toContain(late.id);
    });

    it("el aforo lo fija la sala (no una constante): una sala de 2 personas se llena", async () => {
      const room = await personalRoom();
      await admin.from("rooms").update({ max_participants: 2 }).eq("id", room.id);
      expect((await beto.client.rpc("join_room", { p_code: room.code, p_display_name: "Beto" })).error).toBeNull();
      expect(errorOf(await carla.client.rpc("join_room", { p_code: room.code, p_display_name: "Carla" }))).toBe("room_full");
    });
  });

  // ───────────────────────── Planes y comunidades ─────────────────────────

  describe("planes de comunidad", () => {
    it("una comunidad nueva estrena Plus 14 días sin tarjeta; al terminar baja al plan gratuito", async () => {
      const id = await community();
      const sub = (await admin.from("subscriptions").select("plan_code, status, provider, current_period_end").eq("community_id", id).single()).data!;
      expect(sub).toMatchObject({ plan_code: "plus", status: "trialing", provider: "trial" });
      const days = (new Date(sub.current_period_end).getTime() - Date.now()) / (24 * 60 * MIN);
      expect(days).toBeGreaterThan(13.9);
      expect(days).toBeLessThanOrEqual(14);

      const plus = (await ana.client.rpc("get_entitlements", { p_community_id: id })).data as Record<string, unknown>;
      expect(plus).toMatchObject({ plan: "plus", max_members: 100, max_room_participants: 30, max_room_minutes: 360 });

      await endTrial(id);
      const free = (await ana.client.rpc("get_entitlements", { p_community_id: id })).data as Record<string, unknown>;
      expect(free).toMatchObject({ plan: "comunidad", max_members: 30, max_room_participants: 15, max_room_minutes: 120 });
    });

    it("las salas de la comunidad toman los límites de su plan al crearse", async () => {
      const id = await community();
      const { data } = await ana.client.rpc("create_community_room", { p_community_id: id, p_name: "Sala Plus", p_display_name: "Ana" });
      const plus = await roomRow(data![0]!.room_id);
      expect(plus.max_participants).toBe(30);
      expect((new Date(plus.ends_at).getTime() - new Date(plus.created_at).getTime()) / MIN).toBeCloseTo(360, 0);

      await endTrial(id);
      const { data: again } = await ana.client.rpc("create_community_room", { p_community_id: id, p_name: "Sala gratis", p_display_name: "Ana" });
      expect((await roomRow(again![0]!.room_id)).max_participants).toBe(15);
    });

    it("get_entitlements: quien no es miembro no ve los límites de la comunidad; sin comunidad ve los gratuitos", async () => {
      const id = await community();
      expect(errorOf(await carla.client.rpc("get_entitlements", { p_community_id: id }))).toBe("not_member");
      expect(((await carla.client.rpc("get_entitlements", {})).data as { plan: string }).plan).toBe("comunidad");
      expect(errorOf(await anonClient().rpc("get_entitlements", {}))).toBeDefined();
    });

    it("salas simultáneas: el plan gratuito permite 4 con gente; la 5.ª se rechaza", async () => {
      const id = await community();
      await endTrial(id);
      for (let i = 0; i < 4; i++) {
        const { error } = await ana.client.rpc("create_community_room", { p_community_id: id, p_name: `Sala ${i}`, p_display_name: "Ana" });
        expect(error).toBeNull();
      }
      expect(errorOf(await ana.client.rpc("create_community_room", { p_community_id: id, p_name: "Sala 5", p_display_name: "Ana" }))).toBe("community_rooms_limit");
    });

    it("el límite de miembros sale del plan y los extras lo amplían", async () => {
      const id = await community(); // Ana + Beto
      await endTrial(id);
      const small = `chica_${Date.now()}`;
      planCodes.push(small);
      const limits = { max_members: 2, max_concurrent_rooms: 1, max_room_minutes: 60, max_room_participants: 3, included_person_hours: null, max_cameras: 1, camera_quality: "360p", urgent_per_day: 3, breakout_groups: 0, own_guides: false, stats: "none", branding: false };
      expect((await admin.from("plans").insert({ code: small, name: "Chica", limits, sort_order: 99 })).error).toBeNull();
      await admin.from("subscriptions").update({ plan_code: small, current_period_end: iso(Date.now() + 7 * 24 * 60 * MIN) }).eq("community_id", id);

      const token = (await ana.client.rpc("get_community_invite", { p_community_id: id })).data!;
      expect(errorOf(await carla.client.rpc("join_community", { p_token: token }))).toBe("community_full");

      // Un extra de +50 miembros vigente lo amplía
      await admin.from("addons").insert({ community_id: id, kind: "members_50", quantity: 1, expires_at: iso(Date.now() + 30 * 24 * 60 * MIN) });
      expect((await ana.client.rpc("get_entitlements", { p_community_id: id })).data).toMatchObject({ max_members: 52 });
      expect((await carla.client.rpc("join_community", { p_token: token })).error).toBeNull();
    });
  });

  // ───────────────────────── Órdenes ─────────────────────────

  describe("create_order: permisos y precios calculados en la base", () => {
    it("un invitado no puede pagar", async () => {
      const guest = await signInGuest("Invitada");
      userIds.push(guest.user.id);
      expect(errorOf(await guest.client.rpc("create_order", { p_kind: "pass", p_code: "vigilia" }))).toBe("account_required");
    });

    it("el precio de cada producto sale de la base; con plan de pago, las vigilias cuestan menos", async () => {
      const personal = (await ana.client.rpc("create_order", { p_kind: "pass", p_code: "vigilia" })).data![0]!;
      expect(personal.amount_mxn).toBe(249);

      const id = await community(); // prueba de Plus = plan de pago
      const org = (await ana.client.rpc("create_order", { p_kind: "pass", p_code: "vigilia", p_community_id: id })).data![0]!;
      expect(org.amount_mxn).toBe(149);
      const big = (await ana.client.rpc("create_order", { p_kind: "pass", p_code: "vigilia_grande", p_community_id: id })).data![0]!;
      expect(big.amount_mxn).toBe(479);
      const annual = (await ana.client.rpc("create_order", { p_kind: "plan", p_code: "pro", p_period: "annual", p_community_id: id })).data![0]!;
      expect(annual.amount_mxn).toBe(14990);
      const monthly = (await ana.client.rpc("create_order", { p_kind: "plan", p_code: "plus", p_period: "monthly", p_community_id: id })).data![0]!;
      expect(monthly.amount_mxn).toBe(499);
      const extra = (await ana.client.rpc("create_order", { p_kind: "addon", p_code: "members_50", p_quantity: 3, p_community_id: id })).data![0]!;
      expect(extra.amount_mxn).toBe(297);
    });

    it("validaciones: administración, producto, cantidad, plan de pago para extras y sala propia", async () => {
      const id = await community();
      expect(errorOf(await beto.client.rpc("create_order", { p_kind: "plan", p_code: "plus", p_period: "monthly", p_community_id: id }))).toBe("not_admin");
      expect(errorOf(await ana.client.rpc("create_order", { p_kind: "plan", p_code: "comunidad", p_period: "monthly", p_community_id: id }))).toBe("invalid_item");
      expect(errorOf(await ana.client.rpc("create_order", { p_kind: "plan", p_code: "plus", p_period: "weekly", p_community_id: id }))).toBe("invalid_item");
      expect(errorOf(await ana.client.rpc("create_order", { p_kind: "pass", p_code: "no_existe" }))).toBe("invalid_item");
      expect(errorOf(await ana.client.rpc("create_order", { p_kind: "pass", p_code: "vigilia", p_quantity: 11 }))).toBe("invalid_quantity");
      expect(errorOf(await ana.client.rpc("create_order", { p_kind: "pass", p_code: "extension" }))).toBe("invalid_item");

      const room = await personalRoom(ana);
      expect(errorOf(await beto.client.rpc("create_order", { p_kind: "pass", p_code: "extension", p_room_id: room.id }))).toBe("not_host");
      expect((await ana.client.rpc("create_order", { p_kind: "pass", p_code: "extension", p_room_id: room.id })).error).toBeNull();

      await endTrial(id);
      expect(errorOf(await ana.client.rpc("create_order", { p_kind: "addon", p_code: "rooms_5", p_community_id: id }))).toBe("plan_required");
    });

    it("tope de 10 pagos pendientes por día", async () => {
      for (let i = 0; i < 10; i++) expect((await carla.client.rpc("create_order", { p_kind: "pass", p_code: "sala_larga" })).error).toBeNull();
      expect(errorOf(await carla.client.rpc("create_order", { p_kind: "pass", p_code: "sala_larga" }))).toBe("too_many_pending");
    });
  });

  describe("fulfill_order: se activa solo con el pago y una sola vez", () => {
    it("un plan crea la suscripción por un mes y pagar dos veces la misma orden no suma nada", async () => {
      const id = await community();
      await endTrial(id);
      const order = await paidOrder(ana, { kind: "plan", code: "pro", period: "monthly", community: id });
      expect(order.result).toMatchObject({ already: false, status: "paid" });

      const sub = (await admin.from("subscriptions").select("plan_code, status, provider, current_period_end").eq("community_id", id).single()).data!;
      expect(sub).toMatchObject({ plan_code: "pro", status: "active", provider: "conekta" });
      const days = (new Date(sub.current_period_end).getTime() - Date.now()) / (24 * 60 * MIN);
      expect(days).toBeGreaterThan(27);
      expect(days).toBeLessThan(32);

      const again = (await admin.rpc("fulfill_order", { p_order_id: order.order_id })).data as { already: boolean };
      expect(again.already).toBe(true);
      expect((await admin.from("subscriptions").select("current_period_end").eq("community_id", id).single()).data!.current_period_end).toBe(sub.current_period_end);
      expect(((await ana.client.rpc("get_entitlements", { p_community_id: id })).data as { plan: string }).plan).toBe("pro");
    });

    it("renovar a tiempo suma al periodo vigente; el plan anual dura un año", async () => {
      const id = await community();
      await endTrial(id);
      await paidOrder(ana, { kind: "plan", code: "plus", period: "monthly", community: id });
      const first = (await admin.from("subscriptions").select("current_period_end").eq("community_id", id).single()).data!.current_period_end;
      await paidOrder(ana, { kind: "plan", code: "plus", period: "annual", community: id });
      const second = (await admin.from("subscriptions").select("current_period_end").eq("community_id", id).single()).data!.current_period_end;
      const days = (new Date(second).getTime() - new Date(first).getTime()) / (24 * 60 * MIN);
      expect(days).toBeGreaterThanOrEqual(364);
      expect(days).toBeLessThanOrEqual(366);
    });

    it("un pase comprado desde una sala en curso se aplica solo: más personas y más tiempo", async () => {
      const room = await personalRoom();
      const before = await roomRow(room.id);
      await paidOrder(ana, { kind: "pass", code: "vigilia", room: room.id });
      const after = await roomRow(room.id);
      expect(after.max_participants).toBe(30);
      const hours = (new Date(after.ends_at).getTime() - Date.now()) / (60 * MIN);
      expect(hours).toBeGreaterThan(23.9);
      expect(new Date(after.ends_at).getTime()).toBeGreaterThan(new Date(before.ends_at).getTime());
      const pass = (await admin.from("passes").select("status, room_id").eq("buyer_id", ana.user.id).single()).data!;
      expect(pass).toEqual({ status: "applied", room_id: room.id });
    });

    it("un pase sin sala queda disponible y se usa con apply_pass (solo su dueña, en una sala suya)", async () => {
      await paidOrder(ana, { kind: "pass", code: "vigilia_grande" });
      const pass = (await admin.from("passes").select("id, status").eq("buyer_id", ana.user.id).single()).data!;
      expect(pass.status).toBe("available");

      const room = await personalRoom(ana);
      const others = await personalRoom(carla);
      expect(errorOf(await carla.client.rpc("apply_pass", { p_pass_id: pass.id, p_room_id: others.id }))).toBe("pass_not_found");
      expect(errorOf(await ana.client.rpc("apply_pass", { p_pass_id: pass.id, p_room_id: others.id }))).toBe("not_host");
      expect((await ana.client.rpc("apply_pass", { p_pass_id: pass.id, p_room_id: room.id })).error).toBeNull();
      expect((await roomRow(room.id)).max_participants).toBe(100);
      // Ya usado: no se puede reutilizar
      const second = await personalRoom(ana);
      expect(errorOf(await ana.client.rpc("apply_pass", { p_pass_id: pass.id, p_room_id: second.id }))).toBe("pass_unavailable");
    });

    it("la extensión suma 2 horas al final actual; el pase de una comunidad solo sirve en sus salas", async () => {
      const room = await personalRoom();
      const before = new Date((await roomRow(room.id)).ends_at).getTime();
      await paidOrder(ana, { kind: "pass", code: "extension", room: room.id });
      const after = new Date((await roomRow(room.id)).ends_at).getTime();
      expect((after - before) / MIN).toBeCloseTo(120, 0);

      const id = await community();
      await paidOrder(ana, { kind: "pass", code: "sala_larga", community: id });
      const pass = (await admin.from("passes").select("id").eq("community_id", id).single()).data!;
      expect(errorOf(await ana.client.rpc("apply_pass", { p_pass_id: pass.id, p_room_id: room.id }))).toBe("pass_wrong_community");
    });

    it("las bolsas y los extras mensuales se activan con su vigencia", async () => {
      const id = await community();
      await paidOrder(ana, { kind: "addon", code: "hours_100", qty: 2, community: id });
      await paidOrder(ana, { kind: "addon", code: "rooms_5", community: id });
      const pack = (await admin.from("addons").select("minutes_remaining, expires_at").eq("community_id", id).eq("kind", "hours_100").single()).data!;
      expect(pack.minutes_remaining).toBe(12000);
      expect((new Date(pack.expires_at).getTime() - Date.now()) / (24 * 60 * MIN)).toBeGreaterThan(89);
      expect((await ana.client.rpc("get_entitlements", { p_community_id: id })).data).toMatchObject({ max_concurrent_rooms: 15 });
    });

    it("fail_order solo cierra las pendientes; refund_order revierte lo comprado", async () => {
      const pending = (await ana.client.rpc("create_order", { p_kind: "pass", p_code: "sala_larga" })).data![0]!;
      expect((await admin.rpc("fail_order", { p_order_id: pending.order_id, p_status: "expired" })).error).toBeNull();
      expect((await admin.from("orders").select("status").eq("id", pending.order_id).single()).data!.status).toBe("expired");
      // Una vencida ya no se puede cumplir por error: fulfill la marcaría pagada, así que el webhook valida antes; aquí se comprueba el estado final
      const paid = await paidOrder(ana, { kind: "pass", code: "sala_larga" });
      await admin.rpc("fail_order", { p_order_id: paid.order_id, p_status: "failed" });
      expect((await admin.from("orders").select("status").eq("id", paid.order_id).single()).data!.status).toBe("paid");

      await admin.rpc("refund_order", { p_order_id: paid.order_id });
      expect((await admin.from("orders").select("status").eq("id", paid.order_id).single()).data!.status).toBe("refunded");
      expect((await admin.from("passes").select("status").eq("order_id", paid.order_id).single()).data!.status).toBe("refunded");

      const id = await community();
      const plan = await paidOrder(ana, { kind: "plan", code: "plus", period: "monthly", community: id });
      await endTrial(id);
      await admin.rpc("refund_order", { p_order_id: plan.order_id });
      expect(((await ana.client.rpc("get_entitlements", { p_community_id: id })).data as { plan: string }).plan).toBe("comunidad");
    });
  });

  // ───────────────────────── Eventos de pago y uso ─────────────────────────

  describe("record_payment_event: idempotencia", () => {
    it("el mismo evento se procesa una sola vez; si falló a medias se puede reintentar", async () => {
      const event = `evt_${crypto.randomUUID()}`;
      const first = (await admin.rpc("record_payment_event", { p_provider: "conekta", p_event_id: event, p_type: "order.paid", p_payload: { a: 1 } })).data![0]!;
      expect(first.already_processed).toBe(false);

      // Falló a medias (sin processed_at): la entrega repetida debe poder reprocesarse
      await admin.rpc("finish_payment_event", { p_id: first.event_row_id, p_error: "fulfill_failed" });
      const retry = (await admin.rpc("record_payment_event", { p_provider: "conekta", p_event_id: event, p_type: "order.paid", p_payload: { a: 1 } })).data![0]!;
      expect(retry).toEqual({ event_row_id: first.event_row_id, already_processed: false });

      await admin.rpc("finish_payment_event", { p_id: first.event_row_id });
      const done = (await admin.rpc("record_payment_event", { p_provider: "conekta", p_event_id: event, p_type: "order.paid", p_payload: { a: 1 } })).data![0]!;
      expect(done.already_processed).toBe(true);
      expect((await admin.from("payment_events").select("id", { count: "exact", head: true }).eq("provider_event_id", event)).count).toBe(1);
    });
  });

  describe("record_usage: minutos conectados", () => {
    it("registra una sola vez por evento, cobra por minuto iniciado y suma el mes de la comunidad", async () => {
      const id = await community();
      const { data } = await ana.client.rpc("create_community_room", { p_community_id: id, p_name: "Sala", p_display_name: "Ana" });
      const roomId = data![0]!.room_id;
      const joined = Date.now() - 10 * MIN - 20_000; // 10 min 20 s → 11 minutos
      const args = { p_event_id: `ev_${crypto.randomUUID()}`, p_room_id: roomId, p_user_id: beto.user.id, p_joined_at: iso(joined), p_left_at: iso(Date.now()) };

      expect((await admin.rpc("record_usage", args)).data).toBe(true);
      expect((await admin.rpc("record_usage", args)).data).toBe(false);

      const period = new Date().toISOString().slice(0, 7) + "-01";
      expect((await admin.from("usage_periods").select("person_minutes").eq("community_id", id).eq("period", period).single()).data!.person_minutes).toBe(11);
      expect((await admin.from("usage_events").select("minutes").eq("livekit_event_id", args.p_event_id).single()).data!.minutes).toBe(11);
      expect(errorOf(await admin.rpc("record_usage", { ...args, p_event_id: "x", p_left_at: iso(joined - MIN) }))).toBe("invalid_event");
    });

    it("lo que excede las horas incluidas se descuenta de la bolsa; los minutos por persona no los ve nadie", async () => {
      const id = await community();
      const tiny = `horas_${Date.now()}`;
      planCodes.push(tiny);
      const limits = { max_members: 30, max_concurrent_rooms: 4, max_room_minutes: 120, max_room_participants: 15, included_person_hours: 1, max_cameras: 4, camera_quality: "360p", urgent_per_day: 3, breakout_groups: 0, own_guides: false, stats: "none", branding: false };
      await admin.from("plans").insert({ code: tiny, name: "Una hora", limits, sort_order: 98 });
      // La bolsa se compra con plan de pago (prueba de Plus); después la comunidad queda en un plan de 1 hora incluida
      await paidOrder(ana, { kind: "addon", code: "hours_100", community: id });
      await admin.from("subscriptions").update({ plan_code: tiny, current_period_end: iso(Date.now() + 7 * 24 * 60 * MIN) }).eq("community_id", id);

      const { data } = await ana.client.rpc("create_community_room", { p_community_id: id, p_name: "Sala", p_display_name: "Ana" });
      const roomId = data![0]!.room_id;
      // 90 minutos: 60 incluidos + 30 de la bolsa
      await admin.rpc("record_usage", { p_event_id: `ev_${crypto.randomUUID()}`, p_room_id: roomId, p_user_id: beto.user.id, p_joined_at: iso(Date.now() - 90 * MIN), p_left_at: iso(Date.now()) });
      expect((await admin.from("addons").select("minutes_remaining").eq("community_id", id).eq("kind", "hours_100").single()).data!.minutes_remaining).toBe(6000 - 30);
      // Otros 10 minutos: todo sale de la bolsa
      await admin.rpc("record_usage", { p_event_id: `ev_${crypto.randomUUID()}`, p_room_id: roomId, p_user_id: ana.user.id, p_joined_at: iso(Date.now() - 10 * MIN), p_left_at: iso(Date.now()) });
      expect((await admin.from("addons").select("minutes_remaining").eq("community_id", id).eq("kind", "hours_100").single()).data!.minutes_remaining).toBe(6000 - 40);

      // Nadie lee minutos por persona
      expect((await ana.client.from("usage_events").select("*")).data).toEqual([]);
      expect((await ana.client.from("payment_events").select("*")).data).toEqual([]);
    });
  });

  // ───────────────────────── Acceso y RLS ─────────────────────────

  describe("acceso: cada quien ve solo lo suyo", () => {
    it("pedidos, pases y suscripciones: la administración y la compradora ven lo suyo; los demás, nada", async () => {
      const id = await community();
      const order = await paidOrder(ana, { kind: "pass", code: "sala_larga", community: id });
      await paidOrder(carla, { kind: "pass", code: "sala_larga" });

      const mineAna = (await ana.client.from("orders").select("id")).data ?? [];
      expect(mineAna.map((o) => o.id)).toContain(order.order_id);
      expect((await beto.client.from("orders").select("id")).data).toEqual([]); // miembro, no admin
      expect((await beto.client.from("passes").select("id")).data).toEqual([]);
      expect((await beto.client.from("subscriptions").select("id")).data).toEqual([]);
      expect((await ana.client.from("subscriptions").select("id").eq("community_id", id)).data).toHaveLength(1);

      // Carla solo ve su pedido, no el de Ana
      const carlaOrders = (await carla.client.from("orders").select("buyer_id")).data ?? [];
      expect(carlaOrders.every((o) => o.buyer_id === carla.user.id)).toBe(true);
      expect((await carla.client.from("passes").select("buyer_id")).data?.every((p) => p.buyer_id === carla.user.id)).toBe(true);
    });

    it("nadie escribe pedidos, pases, planes ni suscripciones directamente", async () => {
      const id = await community();
      expect((await ana.client.from("orders").insert({ kind: "pass", item_code: "vigilia", amount_mxn: 1 })).error?.code).toBe("42501");
      expect((await ana.client.from("passes").insert({ product_code: "vigilia", limits: {}, expires_at: iso(Date.now() + MIN) })).error?.code).toBe("42501");
      expect((await ana.client.from("plans").update({ monthly_price_mxn: 1 }).eq("code", "plus")).data).toBeNull();
      expect((await ana.client.from("subscriptions").update({ plan_code: "pro" }).eq("community_id", id)).data).toBeNull();
      expect((await admin.from("plans").select("monthly_price_mxn").eq("code", "plus").single()).data!.monthly_price_mxn).toBe(499);
      expect((await admin.from("subscriptions").select("plan_code").eq("community_id", id).single()).data!.plan_code).toBe("plus");
    });

    it("las funciones de servidor no están al alcance de las personas ni de quien no tiene sesión", async () => {
      const room = await personalRoom();
      const order = (await ana.client.rpc("create_order", { p_kind: "pass", p_code: "vigilia" })).data![0]!;
      for (const client of [ana.client, anonClient()]) {
        expect((await client.rpc("fulfill_order", { p_order_id: order.order_id })).error?.code).toBe("42501");
        expect((await client.rpc("refund_order", { p_order_id: order.order_id })).error?.code).toBe("42501");
        expect((await client.rpc("close_room_system", { p_room_id: room.id })).error?.code).toBe("42501");
        expect((await client.rpc("rooms_over_limit")).error?.code).toBe("42501");
        expect((await client.rpc("record_usage", { p_event_id: "x", p_room_id: room.id, p_user_id: ana.user.id, p_joined_at: iso(Date.now()), p_left_at: iso(Date.now()) })).error?.code).toBe("42501");
      }
      expect((await anonClient().rpc("create_order", { p_kind: "pass", p_code: "vigilia" })).error?.code).toBe("42501");
    });

    it("el catálogo lo lee cualquier cuenta; community_billing solo la administración", async () => {
      const id = await community();
      expect((await beto.client.from("plans").select("code")).data?.map((p) => p.code)).toEqual(expect.arrayContaining(["comunidad", "plus", "pro"]));
      expect(errorOf(await beto.client.rpc("community_billing", { p_community_id: id }))).toBe("not_admin");
      const summary = (await ana.client.rpc("community_billing", { p_community_id: id })).data as { plan: string; members: number; usage: { included_minutes: number | null } };
      expect(summary).toMatchObject({ plan: "plus", members: 2 });
      expect(summary.usage.included_minutes).toBe(500 * 60);
    });
  });

  // El usuario sin relación existe para comprobar aislamiento; se usa su id en una sala ajena
  it("quien no es miembro no entra a una sala de comunidad aunque tenga el código", async () => {
    const id = await community();
    const { data } = await ana.client.rpc("create_community_room", { p_community_id: id, p_name: "Sala", p_display_name: "Ana" });
    expect(errorOf(await carla.client.rpc("join_room", { p_code: data![0]!.room_code, p_display_name: "Carla" }))).toBe("community_only");
  });
});
