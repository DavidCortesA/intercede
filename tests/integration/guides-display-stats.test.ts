// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { adminClient, anonClient, createBareUser, hasTestDb, signInGuest, signInTestUser } from "./helpers";

type Person = Awaited<ReturnType<typeof signInTestUser>>;

const errorOf = (res: { error: { message: string } | null }) => res.error?.message;
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const SEGMENTS = [
  { title: "Entrada", minutes: 2, instruction: "Respira" },
  { title: "Centro", minutes: 10 },
  { title: "Cierre", minutes: 3 },
];

describe.skipIf(!hasTestDb)("fase 10: guías, modo pantalla y estadísticas", () => {
  const admin = adminClient();
  const userIds: string[] = [];
  const communityIds: string[] = [];
  let ana: Person; // anfitriona y administración
  let beto: Person; // miembro
  let carla: Person; // sin relación

  beforeAll(async () => {
    [ana, beto, carla] = await Promise.all([signInTestUser("Ana"), signInTestUser("Beto"), signInTestUser("Carla")]);
    userIds.push(ana.user.id, beto.user.id, carla.user.id);
  });

  afterEach(async () => {
    if (communityIds.length) await admin.from("communities").delete().in("id", communityIds.splice(0));
    await admin.from("rooms").delete().in("host_id", userIds);
  });

  afterAll(async () => {
    await Promise.all(userIds.map((id) => admin.auth.admin.deleteUser(id)));
  });

  async function community() {
    const { data: id } = await ana.client.rpc("create_community", { p_name: "Iglesia", p_kind: "church" });
    communityIds.push(id!);
    const token = (await ana.client.rpc("get_community_invite", { p_community_id: id! })).data!;
    await beto.client.rpc("join_community", { p_token: token });
    return id!;
  }
  const endTrial = (id: string) => admin.from("subscriptions").update({ current_period_end: iso(Date.now() - MIN) }).eq("community_id", id);

  async function room(person: Person = ana, communityId?: string) {
    const res = communityId
      ? await person.client.rpc("create_community_room", { p_community_id: communityId, p_name: "Sala", p_display_name: "Ana" })
      : await person.client.rpc("create_room", { p_name: "Sala", p_display_name: "Ana" });
    expect(res.error).toBeNull();
    return { id: res.data![0]!.room_id, code: res.data![0]!.room_code };
  }
  const systemGuide = async (title: string) => (await admin.from("prayer_guides").select("id").eq("title", title).eq("is_system", true).single()).data!.id;
  const run = async (roomId: string) => (await admin.from("room_guide_runs").select("*").eq("room_id", roomId).maybeSingle()).data;

  // ───────────────────────── Guías ─────────────────────────

  describe("guías de oración", () => {
    it("las 4 guías del sistema las ve cualquier cuenta (también invitados) y nadie sin sesión", async () => {
      const guest = await signInGuest("Invitada");
      userIds.push(guest.user.id);
      for (const client of [ana.client, guest.client]) {
        const titles = ((await client.from("prayer_guides").select("title, is_system")).data ?? []).filter((g) => g.is_system).map((g) => g.title);
        expect(titles).toEqual(expect.arrayContaining(["Silencio y escucha", "Oración por la nación", "El Padre Nuestro, guiado", "Adoración, confesión, gratitud y súplica"]));
      }
      expect((await anonClient().from("prayer_guides").select("id")).data ?? []).toEqual([]);
    });

    it("guías propias: liderazgo con plan Plus/Pro; la comunidad las ve y quien no es de ella, no", async () => {
      const id = await community();
      expect(errorOf(await beto.client.rpc("create_guide", { p_community_id: id, p_title: "Mía", p_description: "", p_segments: SEGMENTS }))).toBe("not_leader");

      const created = await ana.client.rpc("create_guide", { p_community_id: id, p_title: "Vigilia de jóvenes", p_description: "Para el viernes", p_segments: SEGMENTS });
      expect(created.error).toBeNull();
      expect((await beto.client.from("prayer_guides").select("title").eq("id", created.data!)).data).toEqual([{ title: "Vigilia de jóvenes" }]);
      expect((await carla.client.from("prayer_guides").select("id").eq("id", created.data!)).data).toEqual([]);

      await endTrial(id);
      expect(errorOf(await ana.client.rpc("create_guide", { p_community_id: id, p_title: "Otra", p_description: "", p_segments: SEGMENTS }))).toBe("plan_required");
    });

    it("valida el título y los segmentos (cantidad, minutos, textos)", async () => {
      const id = await community();
      const create = (segments: unknown, title = "Guía") => ana.client.rpc("create_guide", { p_community_id: id, p_title: title, p_description: "", p_segments: segments as never });
      expect(errorOf(await create(SEGMENTS, "   "))).toBe("invalid_title");
      expect(errorOf(await create([]))).toBe("invalid_segments");
      expect(errorOf(await create({ no: "lista" }))).toBe("invalid_segments");
      expect(errorOf(await create([{ title: "Sin minutos" }]))).toBe("invalid_segments");
      expect(errorOf(await create([{ title: "Larga", minutes: 61 }]))).toBe("invalid_segments");
      expect(errorOf(await create([{ title: "Cero", minutes: 0 }]))).toBe("invalid_segments");
      expect(errorOf(await create([{ title: "Decimal", minutes: 1.5 }]))).toBe("invalid_segments");
      expect(errorOf(await create([{ title: "", minutes: 5 }]))).toBe("invalid_segments");
      expect(errorOf(await create([{ title: "x", minutes: 5, instruction: "y".repeat(301) }]))).toBe("invalid_segments");
      expect(errorOf(await create(Array.from({ length: 21 }, (_, i) => ({ title: `S${i}`, minutes: 1 }))))).toBe("invalid_segments");
      expect((await create(Array.from({ length: 20 }, (_, i) => ({ title: `S${i}`, minutes: 1 })))).error).toBeNull();
    });

    it("borrar una guía propia: solo el liderazgo; las del sistema no se borran", async () => {
      const id = await community();
      const guideId = (await ana.client.rpc("create_guide", { p_community_id: id, p_title: "Borrar", p_description: "", p_segments: SEGMENTS })).data!;
      expect(errorOf(await beto.client.rpc("delete_guide", { p_guide_id: guideId }))).toBe("not_leader");
      expect((await ana.client.rpc("delete_guide", { p_guide_id: guideId })).error).toBeNull();
      expect(errorOf(await ana.client.rpc("delete_guide", { p_guide_id: await systemGuide("Silencio y escucha") }))).toBe("guide_not_found");
    });

    it("las guías no se escriben directamente", async () => {
      expect((await ana.client.from("prayer_guides").insert({ title: "x", segments: SEGMENTS, is_system: true })).error?.code).toBe("42501");
    });
  });

  describe("temporizador de la sala (hora del servidor)", () => {
    it("guide_segment_at ubica cada instante y marca el final", async () => {
      const at = async (pos: number, extra: number[] = [0, 0, 0]) => (await admin.rpc("guide_segment_at", { p_segments: SEGMENTS, p_extra: extra, p_pos: pos })).data![0]!;
      expect(await at(0)).toEqual({ idx: 0, seg_start: 0, seg_end: 2 * MIN });
      expect(await at(2 * MIN - 1)).toMatchObject({ idx: 0 });
      expect(await at(2 * MIN)).toEqual({ idx: 1, seg_start: 2 * MIN, seg_end: 12 * MIN });
      expect(await at(14 * MIN)).toMatchObject({ idx: 2 });
      expect(await at(15 * MIN)).toEqual({ idx: null, seg_start: 15 * MIN, seg_end: 15 * MIN });
      // Un minuto extra en el primer segmento corre los siguientes
      expect(await at(2 * MIN, [60_000, 0, 0])).toMatchObject({ idx: 0 });
      expect(await at(3 * MIN, [60_000, 0, 0])).toMatchObject({ idx: 1 });
    });

    it("solo quien anfitriona inicia; una guía de otra comunidad no sirve; los de la sala la ven y los de fuera no", async () => {
      const r = await room();
      const guide = await systemGuide("Silencio y escucha");
      expect(errorOf(await beto.client.rpc("start_guide", { p_room_id: r.id, p_guide_id: guide }))).toBe("not_host");
      expect((await ana.client.rpc("start_guide", { p_room_id: r.id, p_guide_id: guide })).error).toBeNull();

      const started = (await run(r.id))!;
      expect(started).toMatchObject({ title: "Silencio y escucha", status: "running", base_elapsed_ms: 0, guide_id: guide });
      expect(started.extra_ms).toEqual([0, 0, 0]);
      expect(started.running_since).not.toBeNull();

      await beto.client.rpc("join_room", { p_code: r.code, p_display_name: "Beto" });
      expect((await beto.client.from("room_guide_runs").select("room_id").eq("room_id", r.id)).data).toHaveLength(1);
      expect((await carla.client.from("room_guide_runs").select("room_id").eq("room_id", r.id)).data).toEqual([]);

      const id = await community();
      const own = (await ana.client.rpc("create_guide", { p_community_id: id, p_title: "Propia", p_description: "", p_segments: SEGMENTS })).data!;
      expect(errorOf(await ana.client.rpc("start_guide", { p_room_id: r.id, p_guide_id: own }))).toBe("guide_wrong_community");
      const inCommunity = await room(ana, id);
      expect((await ana.client.rpc("start_guide", { p_room_id: inCommunity.id, p_guide_id: own })).error).toBeNull();
      expect(errorOf(await ana.client.rpc("start_guide", { p_room_id: r.id, p_guide_id: crypto.randomUUID() }))).toBe("guide_not_found");
    });

    it("la sesión es una copia: borrar la guía no la altera", async () => {
      const id = await community();
      const guideId = (await ana.client.rpc("create_guide", { p_community_id: id, p_title: "Efímera", p_description: "", p_segments: SEGMENTS })).data!;
      const r = await room(ana, id);
      await ana.client.rpc("start_guide", { p_room_id: r.id, p_guide_id: guideId });
      await ana.client.rpc("delete_guide", { p_guide_id: guideId });
      expect(await run(r.id)).toMatchObject({ title: "Efímera", guide_id: null });
    });

    it("pausar, reanudar, saltar, sumar un minuto y terminar", async () => {
      const r = await room();
      await ana.client.rpc("start_guide", { p_room_id: r.id, p_guide_id: await systemGuide("Silencio y escucha") });
      const control = (action: string) => ana.client.rpc("control_guide", { p_room_id: r.id, p_action: action });
      // Simula que llevan 3 minutos (segmento 2 de 3)
      await admin.from("room_guide_runs").update({ running_since: iso(Date.now() - 3 * MIN) }).eq("room_id", r.id);

      expect((await control("pause")).error).toBeNull();
      const paused = (await run(r.id))!;
      expect(paused.status).toBe("paused");
      expect(paused.running_since).toBeNull();
      expect(Math.abs(paused.base_elapsed_ms - 3 * MIN)).toBeLessThan(5_000);

      expect((await control("resume")).error).toBeNull();
      expect((await run(r.id))!.status).toBe("running");

      // Sumar un minuto al segmento actual (el 2.º): índice 1
      expect((await control("add_minute")).error).toBeNull();
      expect((await run(r.id))!.extra_ms).toEqual([0, 60_000, 0]);

      // Saltar: el progreso pasa al final del segmento actual (2 + 10 + 1 minutos)
      expect((await control("skip")).error).toBeNull();
      expect((await run(r.id))!.base_elapsed_ms).toBe(13 * MIN);
      // Último segmento: saltar equivale a terminar
      expect((await control("skip")).error).toBeNull();
      expect(await run(r.id)).toBeNull();
      expect(errorOf(await control("pause"))).toBe("no_guide_running");

      await ana.client.rpc("start_guide", { p_room_id: r.id, p_guide_id: await systemGuide("Silencio y escucha") });
      expect((await control("stop")).error).toBeNull();
      expect(await run(r.id)).toBeNull();
    });

    it("saltar estando en pausa conserva la pausa; los minutos extra tienen tope; solo el anfitrión controla", async () => {
      const r = await room();
      await ana.client.rpc("start_guide", { p_room_id: r.id, p_guide_id: await systemGuide("Silencio y escucha") });
      await ana.client.rpc("control_guide", { p_room_id: r.id, p_action: "pause" });
      await ana.client.rpc("control_guide", { p_room_id: r.id, p_action: "skip" });
      expect(await run(r.id)).toMatchObject({ status: "paused", base_elapsed_ms: 2 * MIN, running_since: null });

      for (let i = 0; i < 35; i++) await ana.client.rpc("control_guide", { p_room_id: r.id, p_action: "add_minute" });
      expect((await run(r.id))!.extra_ms[1]).toBe(30 * MIN);

      expect(errorOf(await ana.client.rpc("control_guide", { p_room_id: r.id, p_action: "volar" }))).toBe("invalid_action");
      await beto.client.rpc("join_room", { p_code: r.code, p_display_name: "Beto" });
      expect(errorOf(await beto.client.rpc("control_guide", { p_room_id: r.id, p_action: "stop" }))).toBe("not_host");
      expect(errorOf(await carla.client.rpc("start_guide", { p_room_id: r.id, p_guide_id: await systemGuide("Silencio y escucha") }))).toBe("not_host");
    });

    it("get_server_time devuelve la hora del servidor", async () => {
      const { data } = await ana.client.rpc("get_server_time");
      expect(Math.abs(new Date(data!).getTime() - Date.now())).toBeLessThan(10_000);
    });
  });

  // ───────────────────────── Modo pantalla ─────────────────────────

  describe("petición en foco y modo pantalla", () => {
    async function withRequests() {
      const r = await room();
      await beto.client.rpc("join_room", { p_code: r.code, p_display_name: "Beto" });
      const ids: string[] = [];
      for (const [i, who] of [ana, beto, ana].entries()) {
        const { data, error } = await who.client.from("prayer_requests").insert({ room_id: r.id, content: `Petición ${i + 1}` }).select("id").single();
        expect(error).toBeNull();
        ids.push(data!.id);
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      return { ...r, ids };
    }

    it("set_room_focus: solo el anfitrión, y la petición debe ser de la sala", async () => {
      const r = await withRequests();
      expect(errorOf(await beto.client.rpc("set_room_focus", { p_room_id: r.id, p_request_id: r.ids[0]! }))).toBe("not_host");
      const other = await room(ana);
      expect(errorOf(await ana.client.rpc("set_room_focus", { p_room_id: other.id, p_request_id: r.ids[0]! }))).toBe("request_not_found");
      expect((await ana.client.rpc("set_room_focus", { p_room_id: r.id, p_request_id: r.ids[1]! })).error).toBeNull();
      expect((await admin.from("rooms").select("focus_request_id").eq("id", r.id).single()).data!.focus_request_id).toBe(r.ids[1]);
      expect((await ana.client.rpc("set_room_focus", { p_room_id: r.id, p_request_id: null as never })).error).toBeNull();
      expect((await admin.from("rooms").select("focus_request_id").eq("id", r.id).single()).data!.focus_request_id).toBeNull();
    });

    it("el enlace de pantalla lo crea y lo ve solo el anfitrión; generar otro invalida el anterior; revocar lo apaga", async () => {
      const r = await room();
      await beto.client.rpc("join_room", { p_code: r.code, p_display_name: "Beto" });
      expect(errorOf(await beto.client.rpc("create_display_link", { p_room_id: r.id }))).toBe("not_host");

      const first = (await ana.client.rpc("create_display_link", { p_room_id: r.id })).data!;
      expect(first).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      expect((await ana.client.from("room_display_links").select("token").eq("room_id", r.id)).data).toEqual([{ token: first }]);
      expect((await beto.client.from("room_display_links").select("token").eq("room_id", r.id)).data).toEqual([]);
      expect((await admin.rpc("display_state", { p_code: r.code, p_token: first })).data).toMatchObject({ status: "open", name: "Sala" });

      const second = (await ana.client.rpc("create_display_link", { p_room_id: r.id })).data!;
      expect(second).not.toBe(first);
      expect((await admin.rpc("display_state", { p_code: r.code, p_token: first })).data).toBeNull();
      expect((await admin.rpc("display_state", { p_code: r.code, p_token: second })).data).not.toBeNull();

      expect(errorOf(await beto.client.rpc("revoke_display_link", { p_room_id: r.id }))).toBe("not_host");
      expect((await ana.client.rpc("revoke_display_link", { p_room_id: r.id })).error).toBeNull();
      expect((await admin.rpc("display_state", { p_code: r.code, p_token: second })).data).toBeNull();
    });

    it("display_state: foco grande, siguientes en pequeño, sin autores; las respondidas no se proyectan", async () => {
      const r = await withRequests();
      const token = (await ana.client.rpc("create_display_link", { p_room_id: r.id })).data!;
      await ana.client.rpc("set_room_focus", { p_room_id: r.id, p_request_id: r.ids[0]! });

      const state = (await admin.rpc("display_state", { p_code: r.code, p_token: token })).data as Record<string, unknown>;
      expect(state).toMatchObject({ status: "open", code: r.code, focus: "Petición 1", next: ["Petición 2", "Petición 3"], guide: null });
      // Nada de personas: ni autores ni nombres
      expect(JSON.stringify(state)).not.toMatch(/Beto|author|user_id|Ana/);

      await admin.from("prayer_requests").update({ is_answered: true, answered_at: iso(Date.now()) }).eq("id", r.ids[0]!);
      const after = (await admin.rpc("display_state", { p_code: r.code, p_token: token })).data as { focus: string | null; next: string[] };
      expect(after.focus).toBeNull();
      expect(after.next).toEqual(["Petición 2", "Petición 3"]);

      // Mayúsculas en el código no importan; un código ajeno con este token no sirve
      expect((await admin.rpc("display_state", { p_code: r.code.toUpperCase(), p_token: token })).data).not.toBeNull();
      const other = await room(ana);
      expect((await admin.rpc("display_state", { p_code: other.code, p_token: token })).data).toBeNull();
    });

    it("incluye la guía en curso y avisa cuando la sala cerró; solo la service role la ejecuta", async () => {
      const r = await room();
      const token = (await ana.client.rpc("create_display_link", { p_room_id: r.id })).data!;
      await ana.client.rpc("start_guide", { p_room_id: r.id, p_guide_id: await systemGuide("Silencio y escucha") });
      const open = (await admin.rpc("display_state", { p_code: r.code, p_token: token })).data as { guide: { title: string; status: string; segments: unknown[] } };
      expect(open.guide).toMatchObject({ title: "Silencio y escucha", status: "running" });
      expect(open.guide.segments).toHaveLength(3);

      for (const client of [ana.client, anonClient()]) {
        expect((await client.rpc("display_state", { p_code: r.code, p_token: token })).error?.code).toBe("42501");
      }

      await ana.client.rpc("close_room", { p_room_id: r.id });
      expect((await admin.rpc("display_state", { p_code: r.code, p_token: token })).data).toMatchObject({ status: "closed", name: "Sala" });
    });
  });

  // ───────────────────────── Estadísticas ─────────────────────────

  describe("estadísticas para líderes", () => {
    async function usage(roomId: string, users: string[], minutes = 10) {
      for (const [i, userId] of users.entries()) {
        const { error } = await admin.rpc("record_usage", {
          p_event_id: `st_${crypto.randomUUID()}_${i}`,
          p_room_id: roomId,
          p_user_id: userId,
          p_joined_at: iso(Date.now() - minutes * MIN),
          p_left_at: iso(Date.now()),
        });
        expect(error).toBeNull();
      }
    }
    type Stats = { level: string; people_in_period: number; weeks: { week_start: string; rooms: number; person_minutes: number | null; avg_participants: number | null; had_attendance: boolean; requests_new: number; requests_answered: number; devotionals_read: number | null; members: number }[] };
    const stats = async (client: Person["client"], id: string) => (await client.rpc("community_stats", { p_community_id: id })).data as unknown as Stats;

    it("solo el liderazgo; el plan gratuito no las tiene; Plus ve 5 semanas y Pro hasta 52", async () => {
      const id = await community();
      expect(errorOf(await beto.client.rpc("community_stats", { p_community_id: id }))).toBe("not_leader");
      expect(errorOf(await carla.client.rpc("community_stats", { p_community_id: id }))).toBe("not_leader");
      expect(await stats(ana.client, id)).toMatchObject({ level: "last_30_days" });
      expect((await stats(ana.client, id)).weeks).toHaveLength(5);

      await admin.from("subscriptions").update({ plan_code: "pro", current_period_end: iso(Date.now() + 30 * 24 * 60 * MIN) }).eq("community_id", id);
      const pro = await stats(ana.client, id);
      expect(pro.level).toBe("history");
      expect(pro.weeks).toHaveLength(52);

      await endTrial(id);
      await admin.from("subscriptions").delete().eq("community_id", id);
      expect(errorOf(await ana.client.rpc("community_stats", { p_community_id: id }))).toBe("plan_required");
      expect(errorOf(await anonClient().rpc("community_stats", { p_community_id: id }))).toBeDefined();
    });

    it("con menos de 5 personas se oculta el tiempo y la participación (nunca minutos de una persona)", async () => {
      const id = await community();
      const r = await room(ana, id);
      await usage(r.id, [ana.user.id, beto.user.id], 25);
      const four = await Promise.all([createBareUser(), createBareUser()]);
      userIds.push(...four);
      await usage(r.id, four, 7);

      const week = (await stats(ana.client, id)).weeks.at(-1)!;
      expect(week).toMatchObject({ rooms: 1, had_attendance: true, person_minutes: null, avg_participants: null });
      expect(JSON.stringify(await stats(ana.client, id))).not.toContain(ana.user.id);
    });

    it("con 5 personas o más se muestran los totales; se cuentan salas, peticiones, devocionales y miembros", async () => {
      const id = await community();
      const r = await room(ana, id);
      const extra = await Promise.all([createBareUser(), createBareUser(), createBareUser()]);
      userIds.push(...extra);
      await usage(r.id, [ana.user.id, beto.user.id, ...extra], 10);

      // Peticiones de la comunidad: una nueva y una respondida
      const { data: post } = await beto.client.from("community_requests").insert({ community_id: id, content: "Por la familia" }).select("id").single();
      await admin.from("community_requests").insert({ community_id: id, author_id: beto.user.id, content: "Gracias", is_answered: true, answered_at: iso(Date.now()), testimony: "Dios respondió" });
      expect(post).not.toBeNull();

      const week = (await stats(ana.client, id)).weeks.at(-1)!;
      expect(week).toMatchObject({ rooms: 1, person_minutes: 50, avg_participants: 5, requests_new: 2, requests_answered: 1, devotionals_read: null, members: 2 });
      expect((await stats(ana.client, id)).people_in_period).toBe(5);
    });

    it("los devocionales leídos se muestran solo con 5 personas lectoras o más", async () => {
      const id = await community();
      const { data: devo, error } = await admin
        .from("devotionals")
        .insert({ community_id: id, devotional_date: new Date().toISOString().slice(0, 10), passage_reference: "Salmo 23", passage_text: "Texto de prueba", bible_version: "Prueba", reflection: "Reflexión", question: "¿Cómo?" })
        .select("id")
        .single();
      expect(error).toBeNull();
      const readers = await Promise.all(Array.from({ length: 5 }, () => createBareUser()));
      userIds.push(...readers);

      await admin.from("devotional_progress").insert(readers.slice(0, 4).map((user_id) => ({ user_id, devotional_id: devo!.id, read_at: iso(Date.now()) })));
      expect((await stats(ana.client, id)).weeks.at(-1)!.devotionals_read).toBeNull();
      await admin.from("devotional_progress").insert({ user_id: readers[4]!, devotional_id: devo!.id, read_at: iso(Date.now()) });
      expect((await stats(ana.client, id)).weeks.at(-1)!.devotionals_read).toBe(5);
    });
  });
});
