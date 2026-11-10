// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { TablesInsert } from "@/types/database";
import { adminClient, anonClient, hasTestDb, signInGuest, signInTestUser } from "./helpers";

type Person = Awaited<ReturnType<typeof signInTestUser>>;

const errorOf = (res: { error: { message: string } | null }) => res.error?.message;
const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const supportRow = (requestId: string) => ({ request_id: requestId }) as TablesInsert<"prayer_support">;

describe.skipIf(!hasTestDb)("moderación, eliminación de cuenta y auditoría", () => {
  const admin = adminClient();
  const userIds: string[] = [];
  const communityIds: string[] = [];
  const roomIds: string[] = [];
  let ana: Person;
  let beto: Person;
  let carla: Person;
  let dani: Person;

  beforeAll(async () => {
    [ana, beto, carla, dani] = await Promise.all([signInTestUser("Ana"), signInTestUser("Beto"), signInTestUser("Carla"), signInTestUser("Dani")]);
    userIds.push(ana.user.id, beto.user.id, carla.user.id, dani.user.id);
  });

  afterEach(async () => {
    if (communityIds.length) await admin.from("communities").delete().in("id", communityIds.splice(0));
    if (roomIds.length) await admin.from("rooms").delete().in("id", roomIds.splice(0));
    await admin.from("blocks").delete().in("blocker_id", userIds);
    await admin.from("reports").delete().in("reporter_id", userIds);
  });

  afterAll(async () => {
    await Promise.all(userIds.map((id) => admin.auth.admin.deleteUser(id)));
  });

  /** Sala de Ana con Beto y Carla dentro (y una petición de Beto). */
  async function room() {
    const created = await ana.client.rpc("create_room", { p_name: "Sala", p_display_name: "Ana" });
    const { room_id, room_code } = created.data![0]!;
    roomIds.push(room_id);
    await beto.client.rpc("join_room", { p_code: room_code, p_display_name: "Beto" });
    await carla.client.rpc("join_room", { p_code: room_code, p_display_name: "Carla" });
    const request = (await beto.client.from("prayer_requests").insert({ room_id, content: "Petición de Beto" }).select().single()).data!;
    return { id: room_id, code: room_code, requestId: request.id };
  }

  /** Comunidad de Ana con Beto (miembro) y Carla (miembro). */
  async function community() {
    const id = (await ana.client.rpc("create_community", { p_name: "Comunidad", p_kind: "group", p_description: "" })).data!;
    communityIds.push(id);
    const token = (await ana.client.rpc("get_community_invite", { p_community_id: id })).data!;
    await beto.client.rpc("join_community", { p_token: token });
    await carla.client.rpc("join_community", { p_token: token });
    return { id, token };
  }

  // ───────────────────────── Auditoría de seguridad ─────────────────────────

  describe("auditoría de seguridad de la base", () => {
    it("no hay tablas sin RLS, funciones definer sin search_path, permisos de más para anon ni buckets abiertos", async () => {
      const { data, error } = await admin.rpc("security_audit");
      expect(error).toBeNull();
      // Lo único que se puede llamar sin sesión son las vistas previas de invitación (devuelven solo nombre y horario)
      const allowedForAnon = new Set(["peek_room(p_code text)", "peek_schedule(p_token text)", "peek_community(p_token text)"]);
      const unexpected = (data ?? []).filter((row) => !(row.category === "anon_can_execute" && allowedForAnon.has(row.object_name)));
      expect(unexpected).toEqual([]);
      expect((data ?? []).filter((row) => row.category === "anon_can_execute")).toHaveLength(allowedForAnon.size);
    });

    it("solo la service role puede ejecutarla", async () => {
      for (const client of [ana.client, anonClient()]) {
        expect((await client.rpc("security_audit")).error?.code).toBe("42501");
        expect((await client.rpc("prepare_account_deletion", { p_user_id: ana.user.id })).error?.code).toBe("42501");
        expect((await client.rpc("purge_inactive_guests", { p_days: -1 })).error?.code).toBe("42501");
      }
    });
  });

  // ───────────────────────── Bloqueos ─────────────────────────

  describe("bloqueos", () => {
    it("solo se bloquea a quien se conoce de una sala o comunidad; cada quien ve solo los suyos", async () => {
      expect(errorOf(await ana.client.rpc("block_user", { p_user_id: ana.user.id }))).toBe("cannot_block_self");
      expect(errorOf(await ana.client.rpc("block_user", { p_user_id: dani.user.id }))).toBe("no_shared_context");
      expect(errorOf(await ana.client.rpc("block_user", { p_user_id: crypto.randomUUID() }))).toBe("no_shared_context");

      await room();
      expect((await carla.client.rpc("block_user", { p_user_id: beto.user.id })).error).toBeNull();
      expect((await carla.client.rpc("block_user", { p_user_id: beto.user.id })).error).toBeNull(); // idempotente
      expect((await carla.client.from("blocks").select("blocked_id")).data).toEqual([{ blocked_id: beto.user.id }]);
      // Beto no sabe que lo bloquearon
      expect((await beto.client.from("blocks").select("*")).data).toEqual([]);
      expect((await beto.client.from("blocks").insert({ blocker_id: beto.user.id, blocked_id: carla.user.id })).error?.code).toBe("42501");

      expect((await beto.client.from("blocks").delete().eq("blocker_id", carla.user.id).select()).data).toEqual([]);
      expect((await carla.client.from("blocks").delete().eq("blocked_id", beto.user.id).select()).data).toHaveLength(1);
    });

    it("un invitado también puede bloquear y reportar (la seguridad no exige cuenta)", async () => {
      const { code } = await room();
      const guest = await signInGuest("Invitado");
      userIds.push(guest.user.id);
      await guest.client.rpc("join_room", { p_code: code, p_display_name: "Invitado" });
      expect((await guest.client.rpc("block_user", { p_user_id: beto.user.id })).error).toBeNull();
      expect((await guest.client.rpc("create_report", { p_type: "user", p_target_id: beto.user.id, p_reason: "spam" })).error).toBeNull();
    });

    it("en las salas oculta las peticiones de la persona bloqueada (en ambos sentidos), pero la anfitriona ve todo", async () => {
      const { id, requestId } = await room();
      const carlaRequest = (await carla.client.from("prayer_requests").insert({ room_id: id, content: "Petición de Carla" }).select().single()).data!;
      const seen = async (person: Person) => ((await person.client.from("prayer_requests").select("id").eq("room_id", id)).data ?? []).map((r) => r.id).sort();

      expect(await seen(carla)).toEqual([requestId, carlaRequest.id].sort());
      await carla.client.rpc("block_user", { p_user_id: beto.user.id });
      expect(await seen(carla)).toEqual([carlaRequest.id]); // ya no ve la de Beto
      expect(await seen(beto)).toEqual([requestId]); // y Beto ya no ve la de Carla
      expect(await seen(ana)).toEqual([requestId, carlaRequest.id].sort()); // la anfitriona modera con todo a la vista

      // Orar por una petición bloqueada no se puede (no existe para ti)
      expect((await carla.client.from("prayer_support").insert(supportRow(requestId))).error).not.toBeNull();

      await carla.client.from("blocks").delete().eq("blocked_id", beto.user.id);
      expect(await seen(carla)).toEqual([requestId, carlaRequest.id].sort());
    });

    it("la anfitriona que bloquea a alguien le cierra la puerta de sus salas (sin revelar el bloqueo)", async () => {
      const first = await room();
      await ana.client.rpc("block_user", { p_user_id: beto.user.id });
      const second = (await ana.client.rpc("create_room", { p_name: "Otra", p_display_name: "Ana" })).data![0]!;
      roomIds.push(second.room_id);
      expect(errorOf(await beto.client.rpc("join_room", { p_code: second.room_code, p_display_name: "Beto" }))).toBe("removed");
      // Una persona sin bloqueo entra sin problema
      expect((await dani.client.rpc("join_room", { p_code: second.room_code, p_display_name: "Dani" })).error).toBeNull();
      // Bloquear no es expulsar: quien ya está dentro puede seguir en la sala hasta que la anfitriona lo saque
      expect(first.id).toBeTruthy();
    });

    it("en el muro de la comunidad oculta las publicaciones de la persona bloqueada, salvo al liderazgo", async () => {
      const { id } = await community();
      const post = async (person: Person, content: string) => (await person.client.from("community_requests").insert({ community_id: id, content }).select().single()).data!;
      await post(beto, "De Beto");
      await post(carla, "De Carla");
      const seen = async (person: Person) => ((await person.client.from("community_requests").select("content").eq("community_id", id)).data ?? []).map((r) => r.content).sort();

      expect(await seen(carla)).toEqual(["De Beto", "De Carla"]);
      await carla.client.rpc("block_user", { p_user_id: beto.user.id });
      expect(await seen(carla)).toEqual(["De Carla"]);
      expect(await seen(beto)).toEqual(["De Beto"]);
      expect(await seen(ana)).toEqual(["De Beto", "De Carla"]); // administración: ve todo para moderar

      // Si quien bloquea es del liderazgo, sigue viendo todo
      await ana.client.rpc("set_member_role", { p_community_id: id, p_user_id: carla.user.id, p_role: "leader" });
      expect(await seen(carla)).toEqual(["De Beto", "De Carla"]);
    });
  });

  // ───────────────────────── Reportes ─────────────────────────

  describe("reportes", () => {
    const report = (person: Person, type: string, id: string, reason = "harassment", details?: string, communityId?: string) =>
      person.client.rpc("create_report", { p_type: type, p_target_id: id, p_reason: reason, p_details: details, p_community_id: communityId });

    it("se reporta una sala, una petición de sala o una persona que conoces; no lo ajeno", async () => {
      const { id, requestId } = await room();

      const asRoom = await report(carla, "room", id, "inappropriate", "  Contenido ofensivo  ");
      expect(asRoom.error).toBeNull();
      const stored = (await admin.from("reports").select("*").eq("id", asRoom.data!).single()).data!;
      expect(stored).toMatchObject({ reporter_id: carla.user.id, target_type: "room", target_id: id, target_user_id: ana.user.id, reason: "inappropriate", details: "Contenido ofensivo", status: "open", community_id: null });

      const asRequest = await report(carla, "prayer_request", requestId, "spam");
      expect(asRequest.error).toBeNull();
      expect((await admin.from("reports").select("target_user_id").eq("id", asRequest.data!).single()).data?.target_user_id).toBe(beto.user.id);
      expect((await report(carla, "user", beto.user.id, "harassment")).error).toBeNull();

      // Quien nunca estuvo en la sala no puede reportar nada de ella ni a sus participantes
      expect(errorOf(await report(dani, "room", id))).toBe("target_not_found");
      expect(errorOf(await report(dani, "prayer_request", requestId))).toBe("target_not_found");
      expect(errorOf(await report(dani, "user", beto.user.id))).toBe("no_shared_context");
      expect(errorOf(await report(dani, "user", crypto.randomUUID()))).toBe("no_shared_context");
    });

    it("valida el motivo, el detalle, el tipo y que no sea propio; no se duplica un reporte abierto", async () => {
      const { id, requestId } = await room();
      expect(errorOf(await report(carla, "room", id, "porque sí"))).toBe("invalid_reason");
      expect(errorOf(await report(carla, "room", id, "other", "x".repeat(501)))).toBe("invalid_details");
      expect(errorOf(await report(carla, "mensaje", id))).toBe("invalid_target");
      expect(errorOf(await report(beto, "prayer_request", requestId))).toBe("own_content");
      expect(errorOf(await report(ana, "room", id))).toBe("own_content");
      expect(errorOf(await report(carla, "user", carla.user.id))).toBe("own_content");

      expect((await report(carla, "room", id)).error).toBeNull();
      expect(errorOf(await report(carla, "room", id))).toBe("already_reported");
      expect((await report(beto, "room", id)).error).toBeNull(); // otra persona sí puede
    });

    it("tope de 20 reportes por persona al día", async () => {
      const { id } = await room();
      const rows = Array.from({ length: 20 }, () => ({ reporter_id: carla.user.id, target_type: "room", target_id: crypto.randomUUID(), reason: "spam" }));
      expect((await admin.from("reports").insert(rows)).error).toBeNull();
      expect(errorOf(await report(carla, "room", id))).toBe("too_many_reports");
    });

    it("quien reporta ve los suyos; el resto no ve nada; no se escriben directo", async () => {
      const { id } = await room();
      const reportId = (await report(carla, "room", id)).data!;
      expect(((await carla.client.from("reports").select("id")).data ?? []).map((r) => r.id)).toEqual([reportId]);
      for (const other of [beto, ana, dani]) expect((await other.client.from("reports").select("id").eq("id", reportId)).data).toEqual([]);
      expect((await carla.client.from("reports").insert({ target_type: "room", target_id: id, reason: "spam" } as never)).error?.code).toBe("42501");
      expect((await carla.client.from("reports").update({ status: "resolved" } as never).eq("id", reportId).select()).error?.code).toBe("42501");
      expect((await carla.client.from("reports").delete().eq("id", reportId).select()).error?.code).toBe("42501");
      expect((await anonClient().from("reports").select("id")).error?.code).toBe("42501");
    });

    it("en una comunidad, el liderazgo ve y atiende los reportes de su comunidad; los miembros corrientes no", async () => {
      const { id } = await community();
      await ana.client.rpc("set_member_role", { p_community_id: id, p_user_id: beto.user.id, p_role: "leader" });
      const trollPost = (await carla.client.from("community_requests").insert({ community_id: id, content: "Mensaje ofensivo" }).select().single()).data!;
      const secret = (await carla.client.from("community_requests").insert({ community_id: id, content: "Pastoral", visibility: "leaders" }).select().single()).data!;
      const third = await signInTestUser("Tercera");
      userIds.push(third.user.id);
      await third.client.rpc("join_community", { p_token: (await ana.client.rpc("get_community_invite", { p_community_id: id })).data! });

      const reportId = (await report(third, "community_request", trollPost.id, "hate")).data!;
      expect((await admin.from("reports").select("community_id, target_user_id").eq("id", reportId).single()).data).toEqual({ community_id: id, target_user_id: carla.user.id });
      // La de solo liderazgo no existe para un miembro corriente
      expect(errorOf(await report(third, "community_request", secret.id))).toBe("target_not_found");
      expect((await report(beto, "community_request", secret.id, "other")).error).toBeNull(); // el liderazgo sí la ve
      // Quien no es de la comunidad no reporta nada
      expect(errorOf(await report(dani, "community_request", trollPost.id))).toBe("target_not_found");

      // Ve el liderazgo (Ana y Beto), no la autora ni otra persona corriente
      for (const leader of [ana, beto]) expect(((await leader.client.from("reports").select("id").eq("community_id", id)).data ?? []).length).toBeGreaterThanOrEqual(1);
      expect((await carla.client.from("reports").select("id").eq("community_id", id)).data).toEqual([]);

      expect(errorOf(await third.client.rpc("resolve_report", { p_report_id: reportId, p_status: "resolved" }))).toBe("not_leader");
      expect(errorOf(await carla.client.rpc("resolve_report", { p_report_id: reportId, p_status: "dismissed" }))).toBe("not_leader");
      expect(errorOf(await beto.client.rpc("resolve_report", { p_report_id: reportId, p_status: "archivado" }))).toBe("invalid_status");
      expect((await beto.client.rpc("resolve_report", { p_report_id: reportId, p_status: "resolved" })).error).toBeNull();
      const resolved = (await admin.from("reports").select("status, resolved_at, resolved_by").eq("id", reportId).single()).data!;
      expect(resolved).toMatchObject({ status: "resolved", resolved_by: beto.user.id });
      expect(resolved.resolved_at).not.toBeNull();
      // Ya atendido, la misma persona puede volver a reportar
      expect((await report(third, "community_request", trollPost.id, "hate")).error).toBeNull();
    });

    it("reportar a una persona desde la comunidad avisa al liderazgo solo si ambas son de ella", async () => {
      const { id } = await community();
      const inCommunity = await report(beto, "user", carla.user.id, "harassment", undefined, id);
      expect(inCommunity.error).toBeNull();
      expect((await admin.from("reports").select("community_id").eq("id", inCommunity.data!).single()).data?.community_id).toBe(id);
      const { code } = await room(); // Dani comparte sala con Ana pero no es de la comunidad
      await dani.client.rpc("join_room", { p_code: code, p_display_name: "Dani" });
      const outside = await report(dani, "user", ana.user.id, "spam", undefined, id);
      expect(outside.error).toBeNull();
      expect((await admin.from("reports").select("community_id").eq("id", outside.data!).single()).data?.community_id).toBeNull();
    });
  });

  // ───────────────────────── Eliminar cuenta ─────────────────────────

  describe("eliminación de cuenta", () => {
    it("borra todo lo de la persona, transfiere la administración y elimina lo que quedaría vacío", async () => {
      const leaver = await signInTestUser("Se va");
      const stays = await signInTestUser("Se queda");
      userIds.push(stays.user.id);
      const uid = leaver.user.id;

      // Sala propia con petición, apoyo, diario, avisos, dispositivo, preferencias, programación…
      const myRoom = (await leaver.client.rpc("create_room", { p_name: "Mía", p_display_name: "Se va" })).data![0]!;
      roomIds.push(myRoom.room_id);
      await stays.client.rpc("join_room", { p_code: myRoom.room_code, p_display_name: "Se queda" });
      const mine = (await leaver.client.from("prayer_requests").insert({ room_id: myRoom.room_id, content: "Mía" }).select().single()).data!;
      const theirs = (await stays.client.from("prayer_requests").insert({ room_id: myRoom.room_id, content: "Ajena" }).select().single()).data!;
      await leaver.client.from("prayer_support").insert(supportRow(theirs.id));
      await leaver.client.from("prayer_journal_entries").insert({ content: "Diario", category: "faith" });
      await leaver.client.from("notification_preferences").insert({});
      await leaver.client.rpc("upsert_push_subscription", { p_endpoint: `https://push.example.test/${crypto.randomUUID()}`, p_p256dh: "k", p_auth: "a" });
      await admin.from("notifications").insert({ user_id: uid, kind: "schedule_reminder", title: "t", body: "b", url: "/x", dedupe_key: "k" });
      const schedule = (
        await leaver.client.rpc("create_schedule", { p_name: "Prog", p_recurrence: "daily", p_local_time: "06:00", p_start_date: isoDay(Date.now() + DAY), p_weekdays: [], p_timezone: "UTC" })
      ).data!;
      const { data: devotional } = await admin.from("devotionals").insert({ devotional_date: isoDay(Date.now() - 400 * DAY), passage_reference: "x", passage_text: "x", bible_version: "x", reflection: "x", question: "x" }).select().single();
      await leaver.client.from("devotional_progress").insert({ devotional_id: devotional!.id, read_at: new Date().toISOString(), note: "nota" });

      // Comunidades: una con otra persona (se transfiere) y una sola (se elimina)
      const shared = (await leaver.client.rpc("create_community", { p_name: "Compartida", p_kind: "church", p_description: "" })).data!;
      const alone = (await leaver.client.rpc("create_community", { p_name: "Sola", p_kind: "group", p_description: "" })).data!;
      communityIds.push(shared, alone);
      await stays.client.rpc("join_community", { p_token: (await leaver.client.rpc("get_community_invite", { p_community_id: shared })).data! });
      await leaver.client.from("community_requests").insert({ community_id: shared, content: "Muro del que se va" });
      await leaver.client.rpc("create_event", { p_community_id: shared, p_title: "Evento", p_description: "", p_date: isoDay(Date.now() + 2 * DAY), p_time: "10:00", p_timezone: "UTC" });
      // Bloqueos y reportes (como quien reporta y como reportado)
      await leaver.client.rpc("block_user", { p_user_id: stays.user.id });
      await stays.client.rpc("block_user", { p_user_id: uid });
      const reportMade = (await leaver.client.rpc("create_report", { p_type: "user", p_target_id: stays.user.id, p_reason: "spam" })).data!;
      const reportAbout = (await stays.client.rpc("create_report", { p_type: "user", p_target_id: uid, p_reason: "spam" })).data!;

      const prepared = (await admin.rpc("prepare_account_deletion", { p_user_id: uid })).data as { deleted_communities: string[]; transferred: { community_id: string; user_id: string }[]; open_rooms: string[] };
      expect(prepared.deleted_communities).toEqual([alone]);
      expect(prepared.transferred).toEqual([{ community_id: shared, user_id: stays.user.id }]);
      expect(prepared.open_rooms).toEqual([myRoom.room_id]);

      expect((await admin.auth.admin.deleteUser(uid)).error).toBeNull();

      // Nada de la persona queda en ninguna tabla
      const columns: [string, string][] = [
        ["profiles", "id"], ["rooms", "host_id"], ["room_members", "user_id"], ["prayer_requests", "author_id"], ["prayer_support", "user_id"],
        ["prayer_journal_entries", "user_id"], ["notification_preferences", "user_id"], ["push_subscriptions", "user_id"], ["notifications", "user_id"],
        ["room_schedules", "owner_id"], ["schedule_subscriptions", "user_id"], ["devotional_progress", "user_id"], ["community_members", "user_id"],
        ["community_requests", "author_id"], ["community_request_support", "user_id"], ["event_rsvps", "user_id"], ["blocks", "blocker_id"], ["blocks", "blocked_id"],
        ["reports", "reporter_id"], ["reports", "target_user_id"],
      ];
      for (const [table, column] of columns) {
        const { data, error } = await admin.from(table as "profiles").select("*", { count: "exact", head: false }).eq(column as "id", uid);
        expect(error, `${table}.${column}`).toBeNull();
        expect(data, `${table}.${column}`).toEqual([]);
      }
      expect((await admin.from("rooms").select("id").eq("id", myRoom.room_id)).data).toEqual([]);
      expect((await admin.from("room_schedules").select("id").eq("id", schedule)).data).toEqual([]);
      expect((await admin.from("prayer_requests").select("id").in("id", [mine.id])).data).toEqual([]);

      // Lo de otras personas se conserva (su petición ya no tiene sala: la sala era de quien se fue)
      expect((await admin.from("prayer_requests").select("id").eq("id", theirs.id)).data).toEqual([]);
      // La comunidad compartida sigue, con quien se queda como administración; la sola desapareció
      expect((await admin.from("community_members").select("role").eq("community_id", shared).eq("user_id", stays.user.id).single()).data?.role).toBe("admin");
      expect((await admin.from("communities").select("created_by").eq("id", shared).single()).data?.created_by).toBeNull();
      expect((await admin.from("communities").select("id").eq("id", alone)).data).toEqual([]);
      expect((await admin.from("community_requests").select("id").eq("community_id", shared)).data).toEqual([]); // su muro se fue con él
      expect((await admin.from("events").select("created_by").eq("community_id", shared)).data).toEqual([{ created_by: null }]);
      // Los reportes se conservan, sin la identidad de quien reportó
      expect((await admin.from("reports").select("reporter_id").eq("id", reportMade).single()).data).toEqual({ reporter_id: null });
      expect((await admin.from("reports").select("target_user_id").eq("id", reportAbout).single()).data).toEqual({ target_user_id: null });
    });

    it("una comunidad con otra admin no se toca al irse una de las dos", async () => {
      const { id } = await community();
      await ana.client.rpc("set_member_role", { p_community_id: id, p_user_id: beto.user.id, p_role: "admin" });
      const prepared = (await admin.rpc("prepare_account_deletion", { p_user_id: ana.user.id })).data as { deleted_communities: string[]; transferred: unknown[] };
      expect(prepared.deleted_communities).toEqual([]);
      expect(prepared.transferred).toEqual([]);
    });

    it("la herencia prefiere al liderazgo y, entre iguales, a quien lleva más tiempo", async () => {
      const { id } = await community(); // Beto entra antes que Carla
      await ana.client.rpc("set_member_role", { p_community_id: id, p_user_id: carla.user.id, p_role: "leader" });
      const prepared = (await admin.rpc("prepare_account_deletion", { p_user_id: ana.user.id })).data as { transferred: { user_id: string }[] };
      expect(prepared.transferred).toEqual([{ community_id: id, user_id: carla.user.id }]);
    });
  });

  // ───────────────────────── Invitados inactivos ─────────────────────────

  describe("limpieza de invitados", () => {
    it("borra solo a los invitados indicados que cumplen el plazo; nunca a las cuentas", async () => {
      const stale = await signInGuest("Antiguo");
      const fresh = await signInGuest("Reciente");
      userIds.push(stale.user.id, fresh.user.id);

      // Con el plazo normal (90 días) nadie recién creado se borra
      expect((await admin.rpc("purge_inactive_guests", { p_days: 90, p_only: [stale.user.id, fresh.user.id] })).data).toBe(0);
      expect((await admin.auth.admin.getUserById(stale.user.id)).data.user).not.toBeNull();

      // Con un plazo "ya vencido" y limitado a una cuenta de invitado: se borra solo esa (y su perfil cae en cascada)
      expect((await admin.rpc("purge_inactive_guests", { p_days: -1, p_only: [stale.user.id] })).data).toBe(1);
      expect((await admin.auth.admin.getUserById(stale.user.id)).data.user).toBeNull();
      expect((await admin.from("profiles").select("id").eq("id", stale.user.id)).data).toEqual([]);
      expect((await admin.auth.admin.getUserById(fresh.user.id)).data.user).not.toBeNull();

      // Una cuenta con correo nunca se considera invitada
      expect((await admin.rpc("purge_inactive_guests", { p_days: -1, p_only: [ana.user.id] })).data).toBe(0);
      expect((await admin.auth.admin.getUserById(ana.user.id)).data.user).not.toBeNull();
    });
  });
});
