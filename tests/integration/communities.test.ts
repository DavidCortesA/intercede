// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { TablesInsert } from "@/types/database";
import { adminClient, anonClient, hasTestDb, signInGuest, signInTestUser } from "./helpers";

type Person = Awaited<ReturnType<typeof signInTestUser>>;

const errorOf = (res: { error: { message: string } | null }) => res.error?.message;
const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const supportRow = (requestId: string) => ({ request_id: requestId }) as TablesInsert<"community_request_support">;

describe.skipIf(!hasTestDb)("comunidades: roles, muro, salas, devocional y eventos", () => {
  const admin = adminClient();
  const userIds: string[] = [];
  const communityIds: string[] = [];
  let ana: Person; // admin
  let beto: Person; // líder
  let carla: Person; // miembro
  let dani: Person; // sin relación

  beforeAll(async () => {
    [ana, beto, carla, dani] = await Promise.all([signInTestUser("Ana"), signInTestUser("Beto"), signInTestUser("Carla"), signInTestUser("Dani")]);
    userIds.push(ana.user.id, beto.user.id, carla.user.id, dani.user.id);
  });

  afterEach(async () => {
    if (communityIds.length) await admin.from("communities").delete().in("id", communityIds.splice(0));
    await admin.from("notifications").delete().in("user_id", userIds);
  });

  afterAll(async () => {
    await Promise.all(userIds.map((id) => admin.auth.admin.deleteUser(id)));
  });

  /** Comunidad de Ana con Beto (líder) y Carla (miembro). */
  async function community(kind: "church" | "ministry" | "group" = "church") {
    const { data: id, error } = await ana.client.rpc("create_community", { p_name: "Iglesia de prueba", p_kind: kind, p_description: "Una comunidad" });
    expect(error).toBeNull();
    communityIds.push(id!);
    const token = (await ana.client.rpc("get_community_invite", { p_community_id: id! })).data!;
    expect((await beto.client.rpc("join_community", { p_token: token })).error).toBeNull();
    expect((await carla.client.rpc("join_community", { p_token: token })).error).toBeNull();
    expect((await ana.client.rpc("set_member_role", { p_community_id: id!, p_user_id: beto.user.id, p_role: "leader" })).error).toBeNull();
    return { id: id!, token };
  }

  // ───────────────────────── Crear y ver ─────────────────────────

  describe("crear y ver comunidades", () => {
    it("una cuenta crea una comunidad y queda como admin con su enlace; un invitado no puede", async () => {
      const { id } = await community();
      const mine = (await ana.client.from("community_members").select("role, display_name").eq("community_id", id).eq("user_id", ana.user.id).single()).data;
      expect(mine).toEqual({ role: "admin", display_name: "Ana" });

      const guest = await signInGuest("Invitada");
      userIds.push(guest.user.id);
      expect(errorOf(await guest.client.rpc("create_community", { p_name: "No", p_kind: "group" }))).toBe("account_required");
    });

    it("valida el nombre, el tipo y limita a 5 comunidades creadas por persona", async () => {
      expect(errorOf(await dani.client.rpc("create_community", { p_name: "   ", p_kind: "church" }))).toBe("invalid_name");
      expect(errorOf(await dani.client.rpc("create_community", { p_name: "x".repeat(61), p_kind: "church" }))).toBe("invalid_name");
      expect(errorOf(await dani.client.rpc("create_community", { p_name: "Ok", p_kind: "club" }))).toBe("invalid_kind");
      for (let i = 0; i < 5; i++) {
        const res = await dani.client.rpc("create_community", { p_name: `Grupo ${i}`, p_kind: "group" });
        expect(res.error).toBeNull();
        communityIds.push(res.data!);
      }
      expect(errorOf(await dani.client.rpc("create_community", { p_name: "Sexta", p_kind: "group" }))).toBe("too_many_communities");
    });

    it("solo las personas de la comunidad la ven (con sus miembros, enlace y contenido)", async () => {
      const { id } = await community();
      await ana.client.from("community_requests").insert({ community_id: id, content: "Por la iglesia" });
      await ana.client.rpc("create_event", { p_community_id: id, p_title: "Vigilia", p_description: "", p_date: isoDay(Date.now() + DAY), p_time: "20:00", p_timezone: "UTC" });

      for (const table of ["communities", "community_members", "community_invites", "community_requests", "events"] as const) {
        const outsider = await dani.client.from(table).select("*");
        expect(outsider.data, table).toEqual([]);
        const member = await carla.client.from(table).select("*");
        // El enlace de invitación es solo del liderazgo
        expect(member.data?.length ?? 0, table).toBe(table === "community_invites" ? 0 : table === "community_members" ? 3 : 1);
      }
    });
  });

  // ───────────────────────── Invitaciones y roles ─────────────────────────

  describe("invitaciones y roles", () => {
    it("el enlace permite unirse (solo cuentas, sin duplicar); revocarlo invalida el anterior", async () => {
      const { id, token } = await community();

      const peek = await anonClient().rpc("peek_community", { p_token: token });
      expect(peek.data?.[0]).toMatchObject({ name: "Iglesia de prueba", kind: "church", members: 3 });

      const guest = await signInGuest("Invitado");
      userIds.push(guest.user.id);
      expect(errorOf(await guest.client.rpc("join_community", { p_token: token }))).toBe("account_required");

      expect((await dani.client.rpc("join_community", { p_token: token })).data).toBe(id);
      expect((await dani.client.rpc("join_community", { p_token: token })).error).toBeNull();
      expect((await admin.from("community_members").select("user_id").eq("community_id", id).eq("user_id", dani.user.id)).data).toHaveLength(1);
      expect((await admin.from("community_members").select("role").eq("community_id", id).eq("user_id", dani.user.id).single()).data?.role).toBe("member");
      await dani.client.rpc("leave_community", { p_community_id: id });

      // Solo el admin revoca; el líder ve el enlace pero no lo cambia
      expect(errorOf(await beto.client.rpc("regenerate_community_invite", { p_community_id: id }))).toBe("not_admin");
      expect((await beto.client.rpc("get_community_invite", { p_community_id: id })).data).toBe(token);
      expect((await carla.client.rpc("get_community_invite", { p_community_id: id })).data).toBeNull();

      const fresh = (await ana.client.rpc("regenerate_community_invite", { p_community_id: id })).data!;
      expect(fresh).not.toBe(token);
      expect(errorOf(await dani.client.rpc("join_community", { p_token: token }))).toBe("community_not_found");
      expect((await anonClient().rpc("peek_community", { p_token: token })).data).toEqual([]);
      expect((await dani.client.rpc("join_community", { p_token: fresh })).error).toBeNull();
    });

    it("solo el admin cambia roles; nunca queda una comunidad sin admin", async () => {
      const { id } = await community();
      expect(errorOf(await beto.client.rpc("set_member_role", { p_community_id: id, p_user_id: carla.user.id, p_role: "leader" }))).toBe("not_admin");
      expect(errorOf(await carla.client.rpc("set_member_role", { p_community_id: id, p_user_id: carla.user.id, p_role: "admin" }))).toBe("not_admin");
      expect(errorOf(await ana.client.rpc("set_member_role", { p_community_id: id, p_user_id: carla.user.id, p_role: "dios" }))).toBe("invalid_role");
      expect(errorOf(await ana.client.rpc("set_member_role", { p_community_id: id, p_user_id: dani.user.id, p_role: "leader" }))).toBe("member_not_found");

      // Ana es la única admin: no puede bajarse ni irse
      expect(errorOf(await ana.client.rpc("set_member_role", { p_community_id: id, p_user_id: ana.user.id, p_role: "member" }))).toBe("last_admin");
      expect(errorOf(await ana.client.rpc("leave_community", { p_community_id: id }))).toBe("last_admin");

      // Con otra admin, ya puede
      expect((await ana.client.rpc("set_member_role", { p_community_id: id, p_user_id: carla.user.id, p_role: "admin" })).error).toBeNull();
      expect((await ana.client.rpc("leave_community", { p_community_id: id })).error).toBeNull();
      expect((await ana.client.from("communities").select("id").eq("id", id)).data).toEqual([]);

      // Los roles no se tocan con una escritura directa
      expect((await carla.client.from("community_members").update({ role: "admin" } as never).eq("user_id", beto.user.id).select()).error?.code).toBe("42501");
      expect((await carla.client.from("community_members").insert({ community_id: id, user_id: dani.user.id, role: "member", display_name: "x" })).error?.code).toBe("42501");
    });

    it("quién puede sacar a quién", async () => {
      const { id } = await community();
      const extra = await signInTestUser("Extra");
      userIds.push(extra.user.id);
      const token = (await ana.client.rpc("get_community_invite", { p_community_id: id })).data!;
      await extra.client.rpc("join_community", { p_token: token });

      expect(errorOf(await carla.client.rpc("remove_community_member", { p_community_id: id, p_user_id: extra.user.id }))).toBe("not_leader");
      expect(errorOf(await beto.client.rpc("remove_community_member", { p_community_id: id, p_user_id: ana.user.id }))).toBe("cannot_remove_admin");
      expect(errorOf(await ana.client.rpc("remove_community_member", { p_community_id: id, p_user_id: ana.user.id }))).toBe("cannot_remove_admin");
      expect((await beto.client.rpc("remove_community_member", { p_community_id: id, p_user_id: extra.user.id })).error).toBeNull();
      expect((await extra.client.from("communities").select("id")).data).toEqual([]);
      // Un líder no saca a otro líder; el admin sí
      await ana.client.rpc("set_member_role", { p_community_id: id, p_user_id: carla.user.id, p_role: "leader" });
      expect(errorOf(await beto.client.rpc("remove_community_member", { p_community_id: id, p_user_id: carla.user.id }))).toBe("cannot_remove_admin");
      expect((await ana.client.rpc("remove_community_member", { p_community_id: id, p_user_id: carla.user.id })).error).toBeNull();
    });

    it("solo el admin edita o borra la comunidad; el logo solo puede estar en su carpeta", async () => {
      const { id } = await community();
      expect((await ana.client.from("communities").update({ name: "Nuevo nombre", kind: "ministry" }).eq("id", id).select().single()).data).toMatchObject({ name: "Nuevo nombre", kind: "ministry" });
      expect((await beto.client.from("communities").update({ name: "Líder" }).eq("id", id).select()).data).toEqual([]);
      expect((await carla.client.from("communities").update({ name: "Miembro" }).eq("id", id).select()).data).toEqual([]);
      expect((await ana.client.from("communities").update({ created_by: dani.user.id } as never).eq("id", id)).error?.code).toBe("42501");

      const own = `https://x.test/storage/v1/object/public/community-logos/${id}/logo.webp`;
      expect((await ana.client.from("communities").update({ logo_url: own }).eq("id", id)).error).toBeNull();
      for (const bad of ["https://evil.example/logo.png", `https://x.test/storage/v1/object/public/community-logos/${crypto.randomUUID()}/logo.webp`]) {
        expect((await ana.client.from("communities").update({ logo_url: bad }).eq("id", id)).error?.code, bad).toBe("23514");
      }

      expect((await beto.client.from("communities").delete().eq("id", id).select()).data).toEqual([]);
      expect((await ana.client.from("communities").delete().eq("id", id).select()).data).toHaveLength(1);
      expect((await admin.from("community_members").select("user_id").eq("community_id", id)).data).toEqual([]);
    });

    it("el nombre y la foto del perfil se reflejan en la comunidad", async () => {
      const { id } = await community();
      await carla.client.from("profiles").update({ display_name: "Carla Nueva" }).eq("id", carla.user.id);
      expect((await ana.client.from("community_members").select("display_name").eq("community_id", id).eq("user_id", carla.user.id).single()).data?.display_name).toBe("Carla Nueva");
      await carla.client.from("profiles").update({ display_name: "Carla" }).eq("id", carla.user.id);
    });

    it("el logo se sube solo si eres admin de esa comunidad", async () => {
      const { id } = await community();
      const file = new Blob([new Uint8Array([82, 73, 70, 70])], { type: "image/webp" });
      const upload = (client: Person["client"], folder: string) => client.storage.from("community-logos").upload(`${folder}/logo.webp`, file, { contentType: "image/webp", upsert: true });

      expect((await upload(ana.client, id)).error).toBeNull();
      expect((await upload(beto.client, id)).error).not.toBeNull();
      expect((await upload(carla.client, id)).error).not.toBeNull();
      expect((await upload(dani.client, id)).error).not.toBeNull();
      // Ni siquiera con una carpeta que no es un id
      expect((await upload(ana.client, "no-es-un-uuid")).error).not.toBeNull();
      await ana.client.storage.from("community-logos").remove([`${id}/logo.webp`]);
    });
  });

  // ───────────────────────── Muro de oración ─────────────────────────

  describe("muro de oración", () => {
    it("miembros publican; quien no es de la comunidad no; las visibles y las del liderazgo", async () => {
      const { id } = await community();
      const post = (client: Person["client"], visibility: "community" | "leaders", content = "Una petición") =>
        client.from("community_requests").insert({ community_id: id, content, visibility }).select().single();

      expect((await dani.client.from("community_requests").insert({ community_id: id, content: "Intruso" })).error?.code).toBe("42501");
      const open = await post(carla.client, "community", "Abierta de Carla");
      const closed = await post(carla.client, "leaders", "Pastoral de Carla");
      expect(open.error).toBeNull();
      expect(open.data).toMatchObject({ author_id: carla.user.id, visibility: "community", is_answered: false });
      expect(closed.error).toBeNull();

      const texts = async (client: Person["client"]) => ((await client.from("community_requests").select("content")).data ?? []).map((r) => r.content).sort();
      expect(await texts(carla.client)).toEqual(["Abierta de Carla", "Pastoral de Carla"]); // la autora ve las suyas
      expect(await texts(beto.client)).toEqual(["Abierta de Carla", "Pastoral de Carla"]); // el liderazgo ve todo
      expect(await texts(ana.client)).toEqual(["Abierta de Carla", "Pastoral de Carla"]);
      await post(beto.client, "community", "De Beto");
      expect(await texts(carla.client)).toEqual(["Abierta de Carla", "De Beto", "Pastoral de Carla"]);
      // Un miembro corriente (otra persona) no ve las del liderazgo
      const third = await signInTestUser("Tercera");
      userIds.push(third.user.id);
      await third.client.rpc("join_community", { p_token: (await ana.client.rpc("get_community_invite", { p_community_id: id })).data! });
      expect(await texts(third.client)).toEqual(["Abierta de Carla", "De Beto"]);

      expect((await post(carla.client, "community", "   ")).error?.code).toBe("23514");
      expect((await post(carla.client, "community", "x".repeat(501))).error?.code).toBe("23514");
    });

    it("solo quien la escribió la edita, la marca como respondida y deja testimonio; el liderazgo puede borrar", async () => {
      const { id } = await community();
      const req = (await carla.client.from("community_requests").insert({ community_id: id, content: "Por mi trabajo" }).select().single()).data!;

      expect((await beto.client.from("community_requests").update({ content: "Editado por líder" }).eq("id", req.id).select()).data).toEqual([]);
      const answered = await carla.client.from("community_requests").update({ is_answered: true, testimony: "Conseguí empleo" }).eq("id", req.id).select().single();
      expect(answered.data).toMatchObject({ is_answered: true, testimony: "Conseguí empleo" });
      expect(answered.data?.answered_at).not.toBeNull();
      // Reabrirla borra el testimonio
      expect((await carla.client.from("community_requests").update({ is_answered: false }).eq("id", req.id).select().single()).data).toMatchObject({ testimony: null, answered_at: null });
      expect((await carla.client.from("community_requests").update({ author_id: beto.user.id } as never).eq("id", req.id)).error?.code).toBe("42501");
      expect((await carla.client.from("community_requests").update({ community_id: crypto.randomUUID() } as never).eq("id", req.id)).error?.code).toBe("42501");

      expect((await dani.client.from("community_requests").delete().eq("id", req.id).select()).data).toEqual([]);
      const other = (await ana.client.from("community_requests").insert({ community_id: id, content: "Otra" }).select().single()).data!;
      expect((await carla.client.from("community_requests").delete().eq("id", other.id).select()).data).toEqual([]);
      expect((await beto.client.from("community_requests").delete().eq("id", req.id).select()).data).toHaveLength(1); // moderación
      expect((await ana.client.from("community_requests").delete().eq("id", other.id).select()).data).toHaveLength(1);
    });

    it("estoy orando por esto: una vez por persona, no en la propia, no en las que no ves", async () => {
      const { id } = await community();
      const open = (await carla.client.from("community_requests").insert({ community_id: id, content: "Abierta" }).select().single()).data!;
      const closed = (await ana.client.from("community_requests").insert({ community_id: id, content: "Solo liderazgo", visibility: "leaders" }).select().single()).data!;
      const third = await signInTestUser("Tercera");
      userIds.push(third.user.id);
      await third.client.rpc("join_community", { p_token: (await ana.client.rpc("get_community_invite", { p_community_id: id })).data! });

      expect((await beto.client.from("community_request_support").insert(supportRow(open.id))).error).toBeNull();
      expect((await third.client.from("community_request_support").insert(supportRow(open.id))).error).toBeNull();
      expect((await beto.client.from("community_request_support").insert(supportRow(open.id))).error?.code).toBe("23505");
      expect((await carla.client.from("community_request_support").insert(supportRow(open.id))).error?.message).toBe("own_request");
      expect((await dani.client.from("community_request_support").insert(supportRow(open.id))).error).not.toBeNull();
      // Una petición del liderazgo no existe para un miembro corriente
      expect((await third.client.from("community_request_support").insert(supportRow(closed.id))).error?.message).toBe("request_not_found");
      expect((await beto.client.from("community_request_support").insert(supportRow(closed.id))).error).toBeNull();

      // La comunidad ve el conteo de las visibles; el miembro corriente no ve apoyos de las del liderazgo
      expect((await carla.client.from("community_request_support").select("user_id").eq("request_id", open.id)).data).toHaveLength(2);
      expect((await third.client.from("community_request_support").select("user_id").eq("request_id", closed.id)).data).toEqual([]);
      expect((await dani.client.from("community_request_support").select("user_id")).data).toEqual([]);

      // Quitar el propio apoyo; no el ajeno
      expect((await third.client.from("community_request_support").delete().eq("request_id", open.id).eq("user_id", beto.user.id).select()).data).toEqual([]);
      expect((await third.client.from("community_request_support").delete().eq("request_id", open.id).eq("user_id", third.user.id).select()).data).toHaveLength(1);
    });
  });

  // ───────────────────────── Salas y programaciones ─────────────────────────

  describe("salas y programaciones de la comunidad", () => {
    it("el liderazgo abre una sala de la comunidad; solo la comunidad la ve y entra", async () => {
      const { id } = await community();
      expect(errorOf(await carla.client.rpc("create_community_room", { p_community_id: id, p_name: "Sala", p_display_name: "Carla" }))).toBe("not_leader");
      expect(errorOf(await dani.client.rpc("create_community_room", { p_community_id: id, p_name: "Sala", p_display_name: "Dani" }))).toBe("not_leader");

      const created = await beto.client.rpc("create_community_room", { p_community_id: id, p_name: "Oración de jóvenes", p_display_name: "Beto" });
      expect(created.error).toBeNull();
      const { room_id, room_code } = created.data![0]!;

      // La comunidad la ve (sin haber entrado) y entra; quien no es de la comunidad, no
      expect((await carla.client.from("rooms").select("code, community_id").eq("id", room_id).single()).data).toEqual({ code: room_code, community_id: id });
      expect((await dani.client.from("rooms").select("id").eq("id", room_id)).data).toEqual([]);
      expect(errorOf(await dani.client.rpc("join_room", { p_code: room_code, p_display_name: "Dani" }))).toBe("community_only");
      expect((await carla.client.rpc("join_room", { p_code: room_code, p_display_name: "Carla" })).error).toBeNull();

      // Una sala normal sigue abierta a cualquiera con el código (la capa 1 no cambia)
      const plain = (await dani.client.rpc("create_room", { p_name: "Normal", p_display_name: "Dani" })).data![0]!;
      expect((await carla.client.rpc("join_room", { p_code: plain.room_code, p_display_name: "Carla" })).error).toBeNull();
      await admin.from("rooms").delete().eq("id", plain.room_id);
    });

    it("el liderazgo programa; la comunidad ve y sigue; el admin puede pausar la de otro líder", async () => {
      const { id } = await community();
      const args = { p_name: "Oración de la mañana", p_recurrence: "daily", p_local_time: "06:00", p_start_date: isoDay(Date.now() + DAY), p_weekdays: [] as number[], p_timezone: "UTC", p_reminder_minutes: 10 };

      expect(errorOf(await carla.client.rpc("create_schedule", { ...args, p_community_id: id }))).toBe("not_leader");
      expect(errorOf(await dani.client.rpc("create_schedule", { ...args, p_community_id: id }))).toBe("not_leader");
      const created = await beto.client.rpc("create_schedule", { ...args, p_community_id: id });
      expect(created.error).toBeNull();
      const scheduleId = created.data!;

      expect((await carla.client.from("room_schedules").select("name, community_id").eq("id", scheduleId).single()).data).toEqual({ name: "Oración de la mañana", community_id: id });
      expect((await dani.client.from("room_schedules").select("id").eq("id", scheduleId)).data).toEqual([]);

      expect((await carla.client.rpc("follow_community_schedule", { p_schedule_id: scheduleId })).error).toBeNull();
      expect(errorOf(await dani.client.rpc("follow_community_schedule", { p_schedule_id: scheduleId }))).toBe("not_member");
      expect((await admin.from("schedule_subscriptions").select("user_id").eq("schedule_id", scheduleId)).data).toHaveLength(2);

      // Carla no la pausa; Ana (admin de la comunidad) sí aunque no la creó; otro líder no
      expect(errorOf(await carla.client.rpc("set_schedule_active", { p_schedule_id: scheduleId, p_active: false }))).toBe("not_owner");
      expect((await ana.client.rpc("set_schedule_active", { p_schedule_id: scheduleId, p_active: false })).error).toBeNull();
      const second = await signInTestUser("Segundo líder");
      userIds.push(second.user.id);
      await second.client.rpc("join_community", { p_token: (await ana.client.rpc("get_community_invite", { p_community_id: id })).data! });
      await ana.client.rpc("set_member_role", { p_community_id: id, p_user_id: second.user.id, p_role: "leader" });
      expect(errorOf(await second.client.rpc("set_schedule_active", { p_schedule_id: scheduleId, p_active: true }))).toBe("not_owner");
      expect((await second.client.from("room_schedules").delete().eq("id", scheduleId).select()).data).toEqual([]);

      // Al salir de la comunidad deja de seguirla
      await carla.client.rpc("leave_community", { p_community_id: id });
      expect((await admin.from("schedule_subscriptions").select("user_id").eq("schedule_id", scheduleId).eq("user_id", carla.user.id)).data).toEqual([]);
      expect((await ana.client.from("room_schedules").delete().eq("id", scheduleId).select()).data).toHaveLength(1);
    });

    it("a la hora se abre la sala de la comunidad y se avisa a quien la sigue", async () => {
      const { id } = await community();
      const scheduleId = (
        await beto.client.rpc("create_schedule", { p_name: "Vigilia semanal", p_recurrence: "daily", p_local_time: "06:00", p_start_date: isoDay(Date.now() + DAY), p_weekdays: [], p_timezone: "UTC", p_reminder_minutes: 10, p_community_id: id })
      ).data!;
      await carla.client.rpc("follow_community_schedule", { p_schedule_id: scheduleId });
      await admin.from("room_schedules").update({ next_occurrence_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", scheduleId);

      expect((await admin.rpc("process_scheduled_work")).error).toBeNull();
      const room = (await admin.from("rooms").select("id, code, community_id").eq("schedule_id", scheduleId).single()).data!;
      expect(room.community_id).toBe(id);
      const note = (await admin.from("notifications").select("url, kind").eq("user_id", carla.user.id).eq("kind", "schedule_started").single()).data!;
      expect(note.url).toBe(`/r/${room.code}`);
      expect((await carla.client.rpc("join_room", { p_code: room.code, p_display_name: "Carla" })).error).toBeNull();
      expect(errorOf(await dani.client.rpc("join_room", { p_code: room.code, p_display_name: "Dani" }))).toBe("community_only");
    });
  });

  // ───────────────────────── Devocional de la comunidad ─────────────────────────

  describe("devocional de la comunidad", () => {
    const row = (communityId: string | null, date: string) => ({
      community_id: communityId,
      devotional_date: date,
      passage_reference: "Pasaje 1:1",
      passage_text: "Texto de prueba.",
      bible_version: "Prueba",
      reflection: "Reflexión.",
      question: "¿Pregunta?",
    });

    it("el liderazgo publica; la comunidad lee lo ya publicado; nadie más lo ve", async () => {
      const { id } = await community();
      const today = isoDay(Date.now());
      expect((await beto.client.from("devotionals").insert(row(id, today))).error).toBeNull();
      expect((await ana.client.from("devotionals").insert(row(id, isoDay(Date.now() + 5 * DAY)))).error).toBeNull(); // adelantado

      expect((await carla.client.from("devotionals").select("devotional_date").eq("community_id", id)).data?.map((d) => d.devotional_date)).toEqual([today]);
      expect((await beto.client.from("devotionals").select("devotional_date").eq("community_id", id)).data).toHaveLength(2);
      expect((await dani.client.from("devotionals").select("id").eq("community_id", id)).data).toEqual([]);

      expect((await carla.client.from("devotionals").insert(row(id, isoDay(Date.now() - DAY)))).error?.code).toBe("42501");
      expect((await dani.client.from("devotionals").insert(row(id, isoDay(Date.now() - DAY)))).error?.code).toBe("42501");
      // Uno por día en la comunidad
      expect((await beto.client.from("devotionals").insert(row(id, today))).error?.code).toBe("23505");
      // El liderazgo de una comunidad no puede escribir devocionales generales de la plataforma
      expect((await beto.client.from("devotionals").insert(row(null, isoDay(Date.now() - 2 * DAY)))).error?.code).toBe("42501");
    });

    it("el liderazgo edita y borra los suyos; un miembro no", async () => {
      const { id } = await community();
      const created = (await beto.client.from("devotionals").insert(row(id, isoDay(Date.now()))).select().single()).data!;
      expect((await beto.client.from("devotionals").update({ reflection: "Editada" }).eq("id", created.id).select().single()).data?.reflection).toBe("Editada");
      expect((await carla.client.from("devotionals").update({ reflection: "No" }).eq("id", created.id).select()).data).toEqual([]);
      expect((await beto.client.from("devotionals").update({ community_id: null } as never).eq("id", created.id)).error?.code).toBe("42501");
      expect((await carla.client.from("devotionals").delete().eq("id", created.id).select()).data).toEqual([]);
      expect((await beto.client.from("devotionals").delete().eq("id", created.id).select()).data).toHaveLength(1);
    });
  });

  // ───────────────────────── Eventos ─────────────────────────

  describe("eventos y asistencia", () => {
    const eventArgs = (communityId: string, extra: Record<string, unknown> = {}) => ({
      p_community_id: communityId,
      p_title: "Vigilia de ayuno",
      p_description: "Toda la noche",
      p_date: isoDay(Date.now() + 2 * DAY),
      p_time: "20:00",
      p_timezone: "America/Mexico_City",
      p_duration_minutes: 120,
      ...extra,
    });

    it("el liderazgo crea con zona horaria; los miembros lo ven; valida las entradas", async () => {
      const { id } = await community();
      expect(errorOf(await carla.client.rpc("create_event", eventArgs(id)))).toBe("not_leader");
      expect(errorOf(await dani.client.rpc("create_event", eventArgs(id)))).toBe("not_leader");
      expect(errorOf(await beto.client.rpc("create_event", eventArgs(id, { p_title: "  " })))).toBe("invalid_title");
      expect(errorOf(await beto.client.rpc("create_event", eventArgs(id, { p_timezone: "Marte/Olimpo" })))).toBe("invalid_timezone");
      expect(errorOf(await beto.client.rpc("create_event", eventArgs(id, { p_duration_minutes: 5 })))).toBe("invalid_duration");
      expect(errorOf(await beto.client.rpc("create_event", eventArgs(id, { p_date: "2020-01-01" })))).toBe("event_in_past");
      expect((await beto.client.rpc("create_event", eventArgs(id, { p_reminder_minutes: 7 }))).error?.code).toBe("23514");

      const created = await beto.client.rpc("create_event", eventArgs(id));
      expect(created.error).toBeNull();
      const event = (await carla.client.from("events").select("*").eq("id", created.data!).single()).data!;
      // 20:00 en Ciudad de México (UTC−6, sin horario de verano) = 02:00 UTC del día siguiente
      expect(new Date(event.starts_at).toISOString().slice(11, 16)).toBe("02:00");
      expect(new Date(event.ends_at).getTime() - new Date(event.starts_at).getTime()).toBe(120 * 60_000);
      expect(event).toMatchObject({ title: "Vigilia de ayuno", timezone: "America/Mexico_City", opens_room: false, reminder_minutes: 60 });
      expect((await dani.client.from("events").select("id").eq("id", event.id)).data).toEqual([]);

      // Se borra por el liderazgo, no por un miembro; y no se inserta directo
      expect((await carla.client.from("events").delete().eq("id", event.id).select()).data).toEqual([]);
      expect((await beto.client.from("events").insert({ community_id: id, title: "x", starts_at: new Date().toISOString(), ends_at: new Date().toISOString(), timezone: "UTC" })).error?.code).toBe("42501");
      expect((await beto.client.from("events").delete().eq("id", event.id).select()).data).toHaveLength(1);
    });

    it("confirmar asistencia: solo la comunidad, cambiable, visible para la comunidad, no tras terminar", async () => {
      const { id } = await community();
      const eventId = (await beto.client.rpc("create_event", eventArgs(id))).data!;

      expect(errorOf(await dani.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "going" }))).toBe("event_not_found");
      expect(errorOf(await carla.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "quizá" }))).toBe("invalid_status");
      expect((await carla.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "maybe" })).error).toBeNull();
      expect((await carla.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "going" })).error).toBeNull();
      expect((await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "no" })).error).toBeNull();

      const rows = (await ana.client.from("event_rsvps").select("user_id, status").eq("event_id", eventId)).data ?? [];
      expect(rows.sort((a, b) => a.status.localeCompare(b.status))).toEqual(
        [
          { user_id: carla.user.id, status: "going" },
          { user_id: beto.user.id, status: "no" },
        ].sort((a, b) => a.status.localeCompare(b.status)),
      );
      expect((await dani.client.from("event_rsvps").select("*")).data).toEqual([]);
      expect((await carla.client.from("event_rsvps").insert({ event_id: eventId, user_id: carla.user.id, status: "going" })).error?.code).toBe("42501");
      expect((await carla.client.from("event_rsvps").update({ status: "no" }).eq("event_id", eventId).select()).error?.code).toBe("42501");

      const start = new Date(Date.now() - 2 * 3_600_000).toISOString();
      await admin.from("events").update({ starts_at: start, ends_at: new Date(Date.now() - 3_600_000).toISOString() }).eq("id", eventId);
      expect(errorOf(await carla.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "no" }))).toBe("event_ended");
    });

    it("avisa a quien va (o tal vez), no a quien no va, y abre la sala del evento a su hora", async () => {
      const { id } = await community();
      const eventId = (await beto.client.rpc("create_event", eventArgs(id, { p_opens_room: true, p_reminder_minutes: 60 }))).data!;
      await carla.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "going" });
      await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "maybe" });
      await ana.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "no" });
      const setStart = (offsetMs: number) =>
        admin.from("events").update({ starts_at: new Date(Date.now() + offsetMs).toISOString(), ends_at: new Date(Date.now() + offsetMs + 3_600_000).toISOString() }).eq("id", eventId);

      // Faltan 30 minutos (recordatorio de 60)
      await setStart(30 * 60_000);
      await admin.rpc("process_scheduled_work");
      await admin.rpc("process_scheduled_work");
      const reminders = (await admin.from("notifications").select("user_id, kind, url").eq("kind", "event_reminder")).data ?? [];
      expect(reminders.map((r) => r.user_id).sort()).toEqual([carla.user.id, beto.user.id].sort());
      expect(reminders[0]?.url).toBe(`/comunidades/${id}/eventos`);

      // Llega la hora: se abre la sala de la comunidad y se avisa con el enlace
      await setStart(-60_000);
      const result = (await admin.rpc("process_scheduled_work")).data as { rooms_opened: number; event_notifications: number };
      expect(result.rooms_opened).toBe(1);
      const event = (await admin.from("events").select("room_id").eq("id", eventId).single()).data!;
      const room = (await admin.from("rooms").select("code, community_id, host_id, name").eq("id", event.room_id!).single()).data!;
      expect(room).toMatchObject({ community_id: id, host_id: beto.user.id, name: "Vigilia de ayuno" });
      const started = (await admin.from("notifications").select("user_id, url").eq("kind", "event_started")).data ?? [];
      expect(started.map((s) => s.user_id).sort()).toEqual([carla.user.id, beto.user.id].sort());
      expect(started[0]?.url).toBe(`/r/${room.code}`);

      // Repetir no abre otra sala ni duplica avisos; el líder anfitrión entra con su rol
      await admin.rpc("process_scheduled_work");
      expect((await admin.from("rooms").select("id").eq("community_id", id)).data).toHaveLength(1);
      expect((await admin.from("notifications").select("id").eq("kind", "event_started")).data).toHaveLength(2);
      expect((await beto.client.rpc("join_room", { p_code: room.code, p_display_name: "Beto" })).error).toBeNull();
      expect((await carla.client.rpc("join_room", { p_code: room.code, p_display_name: "Carla" })).error).toBeNull();
    });

    it("respeta la preferencia de avisos y no avisa a quien ya salió de la comunidad", async () => {
      const { id } = await community();
      const eventId = (await beto.client.rpc("create_event", eventArgs(id))).data!;
      await carla.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "going" });
      await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "going" });
      await beto.client.from("notification_preferences").upsert({ schedule_reminders: false });
      await carla.client.rpc("leave_community", { p_community_id: id });
      await admin.from("events").update({ starts_at: new Date(Date.now() + 30 * 60_000).toISOString(), ends_at: new Date(Date.now() + 90 * 60_000).toISOString() }).eq("id", eventId);

      await admin.rpc("process_scheduled_work");
      expect((await admin.from("notifications").select("id").eq("kind", "event_reminder")).data).toEqual([]);
      await admin.from("notification_preferences").delete().eq("user_id", beto.user.id);
    });
  });
});
