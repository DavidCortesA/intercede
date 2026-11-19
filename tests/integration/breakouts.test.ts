// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { adminClient, anonClient, createBareUser, hasTestDb, signInTestUser } from "./helpers";

type Person = Awaited<ReturnType<typeof signInTestUser>>;

const errorOf = (res: { error: { message: string } | null }) => res.error?.message;
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe.skipIf(!hasTestDb)("grupos pequeños (B2)", () => {
  const admin = adminClient();
  const userIds: string[] = [];
  const communityIds: string[] = [];
  let ana: Person; // anfitriona y administración
  let people: Person[]; // 4 participantes de la comunidad
  let outsider: Person;

  beforeAll(async () => {
    const everyone = await Promise.all(["Ana", "Fuera", "Beto", "Carla", "Dani", "Eli"].map((name) => signInTestUser(name)));
    ana = everyone[0]!;
    outsider = everyone[1]!;
    people = everyone.slice(2);
    userIds.push(ana.user.id, outsider.user.id, ...people.map((p) => p.user.id));
  });

  afterEach(async () => {
    if (communityIds.length) await admin.from("communities").delete().in("id", communityIds.splice(0));
    await admin.from("rooms").delete().in("host_id", userIds);
  });

  afterAll(async () => {
    await Promise.all(userIds.map((id) => admin.auth.admin.deleteUser(id)));
  });

  /** Sala de una comunidad (prueba de Plus: hasta 10 grupos) con las 4 personas dentro. */
  async function setup(joined = people) {
    const { data: communityId } = await ana.client.rpc("create_community", { p_name: "Iglesia", p_kind: "church" });
    communityIds.push(communityId!);
    const token = (await ana.client.rpc("get_community_invite", { p_community_id: communityId! })).data!;
    const { data } = await ana.client.rpc("create_community_room", { p_community_id: communityId!, p_name: "Sala", p_display_name: "Ana" });
    const room = { id: data![0]!.room_id, code: data![0]!.room_code };
    for (const person of joined) {
      await person.client.rpc("join_community", { p_token: token });
      expect((await person.client.rpc("join_room", { p_code: room.code, p_display_name: "X" })).error).toBeNull();
    }
    return { communityId: communityId!, room };
  }
  const start = (roomId: string, groups = 2, minutes = 10, assignments?: Record<string, number>, requests?: (string | null)[]) =>
    ana.client.rpc("start_breakout", { p_room_id: roomId, p_group_count: groups, p_minutes: minutes, p_assignments: assignments as never, p_requests: requests as never });
  const assignmentsOf = async (breakoutId: string) => (await admin.from("breakout_assignments").select("user_id, group_id").eq("breakout_id", breakoutId)).data ?? [];

  // ───────────────────────── Reglas de inicio ─────────────────────────

  describe("iniciar el reparto", () => {
    it("solo comunidades con plan Plus/Pro: una sala personal o un plan gratuito no pueden", async () => {
      const personal = await ana.client.rpc("create_room", { p_name: "Personal", p_display_name: "Ana" });
      const personalId = personal.data![0]!.room_id;
      for (const person of people.slice(0, 2)) await person.client.rpc("join_room", { p_code: personal.data![0]!.room_code, p_display_name: "X" });
      expect(errorOf(await start(personalId))).toBe("plan_required");

      const { room, communityId } = await setup();
      await admin.from("subscriptions").update({ current_period_end: iso(Date.now() - MIN) }).eq("community_id", communityId);
      expect(errorOf(await start(room.id))).toBe("plan_required");
    });

    it("valida quién, cuántos grupos, la duración y la cantidad de personas", async () => {
      const { room } = await setup();
      expect(errorOf(await people[0]!.client.rpc("start_breakout", { p_room_id: room.id, p_group_count: 2, p_minutes: 10 }))).toBe("not_host");
      expect(errorOf(await outsider.client.rpc("start_breakout", { p_room_id: room.id, p_group_count: 2, p_minutes: 10 }))).toBe("not_host");
      expect(errorOf(await start(room.id, 1))).toBe("invalid_groups");
      expect(errorOf(await start(room.id, 11))).toBe("too_many_groups"); // Plus: hasta 10
      expect(errorOf(await start(room.id, 2, 0))).toBe("invalid_duration");
      expect(errorOf(await start(room.id, 2, 61))).toBe("invalid_duration");
      expect(errorOf(await start(room.id, 5))).toBe("not_enough_people"); // 4 personas, 5 grupos
      expect(errorOf(await anonClient().rpc("start_breakout", { p_room_id: room.id, p_group_count: 2, p_minutes: 10 }))).toBeDefined();
    });

    it("el plan Pro permite hasta 20 grupos", async () => {
      const { room, communityId } = await setup();
      await admin.from("subscriptions").update({ plan_code: "pro", current_period_end: iso(Date.now() + 30 * 24 * 60 * MIN) }).eq("community_id", communityId);
      expect(errorOf(await start(room.id, 21))).toBe("too_many_groups");
      expect(errorOf(await start(room.id, 20))).toBe("not_enough_people");
    });

    it("reparto aleatorio y parejo: nadie se repite, la anfitriona queda fuera y se crean los grupos", async () => {
      const { room } = await setup();
      const { data: id, error } = await start(room.id, 2, 15);
      expect(error).toBeNull();

      const breakout = (await admin.from("room_breakouts").select("*").eq("id", id!).single()).data!;
      expect(breakout).toMatchObject({ status: "active", minutes: 15, room_id: room.id, started_by: ana.user.id });
      expect((new Date(breakout.ends_at).getTime() - Date.now()) / MIN).toBeGreaterThan(14.5);

      const groups = (await admin.from("breakout_groups").select("id, position, name, livekit_room").eq("breakout_id", id!).order("position")).data!;
      expect(groups.map((g) => g.name)).toEqual(["Grupo 1", "Grupo 2"]);
      expect(groups[0]!.livekit_room).toBe(`bg-${groups[0]!.id}`);

      const assigned = await assignmentsOf(id!);
      expect(assigned).toHaveLength(4);
      expect(new Set(assigned.map((a) => a.user_id)).size).toBe(4);
      expect(assigned.map((a) => a.user_id)).not.toContain(ana.user.id);
      const sizes = groups.map((g) => assigned.filter((a) => a.group_id === g.id).length);
      expect(sizes).toEqual([2, 2]);
    });

    it("20 personas se reparten en 4 grupos parejos y todas quedan asignadas", async () => {
      const { room, communityId } = await setup([]);
      await admin.from("subscriptions").update({ plan_code: "pro", current_period_end: iso(Date.now() + 30 * 24 * 60 * MIN) }).eq("community_id", communityId);
      const crowd = await Promise.all(Array.from({ length: 19 }, () => createBareUser()));
      userIds.push(...crowd);
      await admin.from("room_members").insert(crowd.map((user_id, i) => ({ room_id: room.id, user_id, display_name: `Persona ${i}` })));

      const { data: id, error } = await start(room.id, 4, 10);
      expect(error).toBeNull();
      const assigned = await assignmentsOf(id!);
      expect(assigned).toHaveLength(19);
      const bySize = new Map<string, number>();
      for (const a of assigned) bySize.set(a.group_id, (bySize.get(a.group_id) ?? 0) + 1);
      expect([...bySize.values()].sort()).toEqual([4, 5, 5, 5]);
    });

    it("reparto manual: lo que se indica se respeta y quien no aparece se queda en la sala principal", async () => {
      const { room } = await setup();
      const [beto, carla, dani] = people.map((p) => p.user.id) as [string, string, string];
      const { data: id, error } = await start(room.id, 2, 10, { [beto]: 2, [carla]: 2, [dani]: 1 });
      expect(error).toBeNull();
      const groups = (await admin.from("breakout_groups").select("id, position").eq("breakout_id", id!)).data!;
      const idOf = (position: number) => groups.find((g) => g.position === position)!.id;
      const assigned = await assignmentsOf(id!);
      expect(assigned).toHaveLength(3);
      expect(assigned.find((a) => a.user_id === beto)!.group_id).toBe(idOf(2));
      expect(assigned.find((a) => a.user_id === dani)!.group_id).toBe(idOf(1));
      expect(assigned.some((a) => a.user_id === people[3]!.user.id)).toBe(false);
    });

    it("un reparto manual inválido se rechaza completo (sin dejar nada a medias)", async () => {
      const { room } = await setup();
      const beto = people[0]!.user.id;
      for (const bad of [{ [beto]: 3 }, { [beto]: 0 }, { [outsider.user.id]: 1 }, { [ana.user.id]: 1 }, { "no-es-uuid": 1 }, { [beto]: "x" as never }]) {
        expect(errorOf(await start(room.id, 2, 10, bad as never))).toBe("invalid_assignments");
      }
      expect((await admin.from("room_breakouts").select("id").eq("room_id", room.id)).data).toEqual([]);
    });

    it("una petición por grupo (opcional): solo de esta sala", async () => {
      const { room } = await setup();
      const mine = (await people[0]!.client.from("prayer_requests").insert({ room_id: room.id, content: "Por la familia" }).select("id").single()).data!.id;
      const otherRoom = (await ana.client.rpc("create_room", { p_name: "Otra", p_display_name: "Ana" })).data![0]!.room_id;
      const foreign = (await ana.client.from("prayer_requests").insert({ room_id: otherRoom, content: "De otra sala" }).select("id").single()).data!.id;

      expect(errorOf(await start(room.id, 2, 10, undefined, [foreign]))).toBe("request_not_found");
      expect(errorOf(await start(room.id, 2, 10, undefined, [mine, null, mine]))).toBe("request_not_found");
      const { data: id, error } = await start(room.id, 2, 10, undefined, [mine, null]);
      expect(error).toBeNull();
      const groups = (await admin.from("breakout_groups").select("position, request_id").eq("breakout_id", id!).order("position")).data!;
      expect(groups.map((g) => g.request_id)).toEqual([mine, null]);
    });

    it("solo un reparto activo por sala; al terminarlo se puede iniciar otro", async () => {
      const { room } = await setup();
      expect((await start(room.id)).error).toBeNull();
      expect(errorOf(await start(room.id))).toBe("breakout_active");
      expect((await ana.client.rpc("end_breakout", { p_room_id: room.id })).error).toBeNull();
      expect((await start(room.id)).error).toBeNull();
    });
  });

  // ───────────────────────── Visibilidad y acceso ─────────────────────────

  describe("quién ve y quién entra", () => {
    it("cada quien ve el reparto y sus grupos; quién está en cada grupo, solo la anfitriona y quienes lo comparten", async () => {
      const { room } = await setup();
      const [beto, carla, dani, eli] = people.map((p) => p.user.id) as [string, string, string, string];
      const { data: id } = await start(room.id, 2, 10, { [beto]: 1, [carla]: 1, [dani]: 2, [eli]: 2 });

      for (const person of people) {
        expect((await person.client.from("room_breakouts").select("id").eq("id", id!)).data).toHaveLength(1);
        expect((await person.client.from("breakout_groups").select("id").eq("breakout_id", id!)).data).toHaveLength(2);
      }
      const seenByBeto = ((await people[0]!.client.from("breakout_assignments").select("user_id").eq("breakout_id", id!)).data ?? []).map((a) => a.user_id).sort();
      expect(seenByBeto).toEqual([beto, carla].sort());
      expect((await ana.client.from("breakout_assignments").select("user_id").eq("breakout_id", id!)).data).toHaveLength(4);

      // Quien no está en la sala no ve nada
      expect((await outsider.client.from("room_breakouts").select("id")).data).toEqual([]);
      expect((await outsider.client.from("breakout_groups").select("id")).data).toEqual([]);
      expect((await outsider.client.from("breakout_assignments").select("user_id")).data).toEqual([]);
      expect((await anonClient().from("room_breakouts").select("id")).data ?? []).toEqual([]);
    });

    it("nadie escribe el reparto directamente", async () => {
      const { room } = await setup();
      const { data: id } = await start(room.id);
      expect((await ana.client.from("breakout_assignments").insert({ breakout_id: id!, group_id: crypto.randomUUID(), user_id: ana.user.id })).error?.code).toBe("42501");
      expect((await ana.client.from("room_breakouts").update({ minutes: 60 }).eq("id", id!)).data).toBeNull();
      expect((await admin.from("room_breakouts").select("minutes").eq("id", id!).single()).data!.minutes).toBe(10);
    });

    it("get_breakout_access: solo el grupo asignado (o la anfitriona) y solo mientras el reparto sigue vigente", async () => {
      const { room } = await setup();
      const [beto, carla] = people.map((p) => p.user.id) as [string, string];
      const { data: id } = await start(room.id, 2, 10, { [beto]: 1, [carla]: 2 });
      const groups = (await admin.from("breakout_groups").select("id, position, livekit_room").eq("breakout_id", id!).order("position")).data!;

      const own = await people[0]!.client.rpc("get_breakout_access", { p_room_id: room.id, p_group_id: groups[0]!.id });
      expect(own.data![0]).toMatchObject({ livekit_room: groups[0]!.livekit_room });
      expect(errorOf(await people[0]!.client.rpc("get_breakout_access", { p_room_id: room.id, p_group_id: groups[1]!.id }))).toBe("not_assigned");
      expect(errorOf(await people[2]!.client.rpc("get_breakout_access", { p_room_id: room.id, p_group_id: groups[0]!.id }))).toBe("not_assigned"); // sin asignar
      expect(errorOf(await outsider.client.rpc("get_breakout_access", { p_room_id: room.id, p_group_id: groups[0]!.id }))).toBe("not_assigned");
      // La anfitriona visita cualquier grupo
      for (const group of groups) expect((await ana.client.rpc("get_breakout_access", { p_room_id: room.id, p_group_id: group.id })).error).toBeNull();
      // Una sala equivocada no sirve
      expect(errorOf(await people[0]!.client.rpc("get_breakout_access", { p_room_id: crypto.randomUUID(), p_group_id: groups[0]!.id }))).toBe("not_assigned");

      // Pasado el tiempo (más el margen de 15 s) ya no se emiten accesos
      await admin.from("room_breakouts").update({ ends_at: iso(Date.now() - 20_000) }).eq("id", id!);
      expect(errorOf(await people[0]!.client.rpc("get_breakout_access", { p_room_id: room.id, p_group_id: groups[0]!.id }))).toBe("not_assigned");
    });
  });

  // ───────────────────────── Aviso, fin y regreso ─────────────────────────

  describe("aviso, terminar y regresar", () => {
    it("la anfitriona avisa a todos y los demás lo ven; mensajes válidos y solo con reparto activo", async () => {
      const { room } = await setup();
      expect(errorOf(await ana.client.rpc("announce_breakout", { p_room_id: room.id, p_message: "Hola" }))).toBe("no_breakout");
      const { data: id } = await start(room.id);

      expect(errorOf(await people[0]!.client.rpc("announce_breakout", { p_room_id: room.id, p_message: "Hola" }))).toBe("not_host");
      expect(errorOf(await ana.client.rpc("announce_breakout", { p_room_id: room.id, p_message: "   " }))).toBe("invalid_message");
      expect(errorOf(await ana.client.rpc("announce_breakout", { p_room_id: room.id, p_message: "x".repeat(141) }))).toBe("invalid_message");
      expect((await ana.client.rpc("announce_breakout", { p_room_id: room.id, p_message: "Regresamos en 2 minutos" })).error).toBeNull();

      const seen = (await people[1]!.client.from("room_breakouts").select("announcement, announced_at").eq("id", id!).single()).data!;
      expect(seen.announcement).toBe("Regresamos en 2 minutos");
      expect(seen.announced_at).not.toBeNull();
    });

    it("terminar el reparto devuelve las salas de audio para cortarlas; solo la anfitriona; no se repite", async () => {
      const { room } = await setup();
      const { data: id } = await start(room.id, 3);
      expect(errorOf(await people[0]!.client.rpc("end_breakout", { p_room_id: room.id }))).toBe("not_host");

      const { data: rooms, error } = await ana.client.rpc("end_breakout", { p_room_id: room.id });
      expect(error).toBeNull();
      const groups = (await admin.from("breakout_groups").select("livekit_room").eq("breakout_id", id!)).data!.map((g) => g.livekit_room);
      expect([...rooms!].sort()).toEqual(groups.sort());
      expect((await admin.from("room_breakouts").select("status, ended_at").eq("id", id!).single()).data).toMatchObject({ status: "ended" });
      expect(errorOf(await ana.client.rpc("end_breakout", { p_room_id: room.id }))).toBe("no_breakout");
      expect(errorOf(await ana.client.rpc("announce_breakout", { p_room_id: room.id, p_message: "Hola" }))).toBe("no_breakout");
    });

    it("cerrar la sala principal termina el reparto", async () => {
      const { room } = await setup();
      const { data: id } = await start(room.id);
      await ana.client.rpc("close_room", { p_room_id: room.id });
      expect((await admin.from("room_breakouts").select("status").eq("id", id!).single()).data!.status).toBe("ended");
    });

    it("el servidor cierra los repartos vencidos aunque nadie los termine (la anfitriona se desconectó)", async () => {
      const { room } = await setup();
      const { data: late } = await start(room.id);
      const other = await setup();
      const { data: fresh } = await start(other.room.id);
      await admin.from("room_breakouts").update({ ends_at: iso(Date.now() - MIN) }).eq("id", late!);

      const { data: rooms, error } = await admin.rpc("end_expired_breakouts");
      expect(error).toBeNull();
      const lateGroups = (await admin.from("breakout_groups").select("livekit_room").eq("breakout_id", late!)).data!.map((g) => g.livekit_room);
      expect([...(rooms ?? [])].sort()).toEqual(expect.arrayContaining(lateGroups));
      expect((await admin.from("room_breakouts").select("status").eq("id", late!).single()).data!.status).toBe("ended");
      expect((await admin.from("room_breakouts").select("status").eq("id", fresh!).single()).data!.status).toBe("active");

      // Solo la service role
      for (const client of [ana.client, anonClient()]) expect((await client.rpc("end_expired_breakouts")).error?.code).toBe("42501");
    });

    it("las funciones del servidor: salas de grupo de una sala y sala principal de un grupo", async () => {
      const { room } = await setup();
      const { data: id } = await start(room.id, 2);
      const groups = (await admin.from("breakout_groups").select("livekit_room").eq("breakout_id", id!)).data!.map((g) => g.livekit_room);
      expect(((await admin.rpc("breakout_group_rooms", { p_room_id: room.id })).data ?? []).sort()).toEqual(groups.sort());
      expect((await admin.rpc("breakout_main_room", { p_livekit_room: groups[0]! })).data).toBe(room.id);
      expect((await admin.rpc("breakout_main_room", { p_livekit_room: "bg-no-existe" })).data).toBeNull();
      expect((await ana.client.rpc("breakout_group_rooms", { p_room_id: room.id })).error?.code).toBe("42501");
      expect((await ana.client.rpc("breakout_main_room", { p_livekit_room: groups[0]! })).error?.code).toBe("42501");
    });

    it("el uso de un grupo cuenta una sola vez, en la sala principal (record_usage)", async () => {
      const { room, communityId } = await setup();
      const { data: id } = await start(room.id, 2, 10, { [people[0]!.user.id]: 1, [people[1]!.user.id]: 2 });
      const group = (await admin.from("breakout_groups").select("livekit_room").eq("breakout_id", id!).limit(1).single()).data!;
      const mainRoom = (await admin.rpc("breakout_main_room", { p_livekit_room: group.livekit_room })).data!;
      // En la principal estuvo 20 min y en el grupo 10: dos tramos seguidos, nunca a la vez
      const t = Date.now();
      await admin.rpc("record_usage", { p_event_id: `bk_${crypto.randomUUID()}`, p_room_id: room.id, p_user_id: people[0]!.user.id, p_joined_at: iso(t - 30 * MIN), p_left_at: iso(t - 10 * MIN) });
      await admin.rpc("record_usage", { p_event_id: `bk_${crypto.randomUUID()}`, p_room_id: mainRoom, p_user_id: people[0]!.user.id, p_joined_at: iso(t - 10 * MIN), p_left_at: iso(t) });
      const period = new Date().toISOString().slice(0, 7) + "-01";
      expect((await admin.from("usage_periods").select("person_minutes").eq("community_id", communityId).eq("period", period).single()).data!.person_minutes).toBe(30);
    });
  });
});
