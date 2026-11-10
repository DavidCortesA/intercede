// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminClient, anonClient, createBareUser, hasTestDb, signInTestUser, type TestClient } from "./helpers";

const ROOM_CODE = /^[a-hj-km-np-z2-9]{6}$/;

type Person = Awaited<ReturnType<typeof signInTestUser>>;

/** Mensaje de error de una RPC (los errores de negocio son códigos estables, ver la migración). */
const errorOf = (res: { error: { message: string } | null }) => res.error?.message;

async function newRoom(client: TestClient, name = "Sala de prueba", displayName = "Anfitriona") {
  const { data, error } = await client.rpc("create_room", { p_name: name, p_display_name: displayName });
  if (error || !data?.[0]) throw new Error(`create_room falló: ${error?.message}`);
  return { id: data[0].room_id, code: data[0].room_code };
}

describe.skipIf(!hasTestDb)("salas y peticiones — RPC y RLS", () => {
  const userIds: string[] = [];
  let host: Person;
  let guest: Person;
  let outsider: Person;

  beforeAll(async () => {
    [host, guest, outsider] = await Promise.all([
      signInTestUser("Ana"),
      signInTestUser("Beto"),
      signInTestUser("Carla"),
    ]);
    userIds.push(host.user.id, guest.user.id, outsider.user.id);
  });

  afterAll(async () => {
    const admin = adminClient();
    await Promise.all(userIds.map((id) => admin.auth.admin.deleteUser(id)));
  });

  // El límite de 5 salas abiertas por anfitrión es real: cada prueba parte sin salas previas
  // (salvo las que un bloque necesita conservar, registradas en `keepRooms`).
  const keepRooms = new Set<string>();
  beforeEach(async () => {
    let query = adminClient().from("rooms").delete().in("host_id", [host.user.id, guest.user.id, outsider.user.id]);
    if (keepRooms.size > 0) query = query.not("id", "in", `(${[...keepRooms].join(",")})`);
    await query;
  });

  describe("create_room", () => {
    it("crea la sala con código válido y al anfitrión como miembro", async () => {
      const room = await newRoom(host.client, "  Oración de la mañana  ", "Ana");
      expect(room.code).toMatch(ROOM_CODE);

      const { data: members } = await host.client.from("room_members").select("*").eq("room_id", room.id);
      expect(members).toEqual([
        expect.objectContaining({ user_id: host.user.id, role: "host", display_name: "Ana", left_at: null }),
      ]);
      const { data: r } = await host.client.from("rooms").select("name,status,is_locked").eq("id", room.id).single();
      expect(r).toEqual({ name: "Oración de la mañana", status: "open", is_locked: false });
    });

    it("sin sesión no se puede (la función no se concede al rol anon)", async () => {
      const res = await anonClient().rpc("create_room", { p_name: "x", p_display_name: "y" });
      expect(res.error?.code).toBe("42501");
    });

    it("valida el nombre de la persona y el de la sala", async () => {
      expect(errorOf(await host.client.rpc("create_room", { p_name: "Sala", p_display_name: "   " }))).toBe("invalid_name");
      expect(errorOf(await host.client.rpc("create_room", { p_name: "Sala", p_display_name: "x".repeat(41) }))).toBe("invalid_name");
      expect(errorOf(await host.client.rpc("create_room", { p_name: "  ", p_display_name: "Ana" }))).toBe("invalid_room_name");
      expect(errorOf(await host.client.rpc("create_room", { p_name: "x".repeat(61), p_display_name: "Ana" }))).toBe("invalid_room_name");
    });

    it("limita a 5 salas abiertas por anfitrión", async () => {
      const busy = await signInTestUser("Ocupada");
      userIds.push(busy.user.id);
      for (let i = 0; i < 5; i++) await newRoom(busy.client, `Sala ${i}`, "Ocupada");
      const res = await busy.client.rpc("create_room", { p_name: "Sala 6", p_display_name: "Ocupada" });
      expect(errorOf(res)).toBe("too_many_rooms");
    });

    it("las tablas no admiten escrituras directas", async () => {
      const insertRoom = await host.client
        .from("rooms")
        .insert({ code: "abc234", name: "Directa", host_id: host.user.id });
      expect(insertRoom.error?.code).toBe("42501");

      const room = await newRoom(host.client);
      const lock = await host.client.from("rooms").update({ is_locked: true }).eq("id", room.id);
      expect(lock.error?.code).toBe("42501");
      const member = await host.client
        .from("room_members")
        .insert({ room_id: room.id, user_id: host.user.id, display_name: "x" });
      expect(member.error?.code).toBe("42501");
    });
  });

  describe("join_room, leave_room y peek_room", () => {
    it("entra con el código (sin importar mayúsculas ni espacios) y es idempotente", async () => {
      const room = await newRoom(host.client);
      const joined = await guest.client.rpc("join_room", { p_code: `  ${room.code.toUpperCase()} `, p_display_name: "Beto" });
      expect(joined.data).toBe(room.id);

      const again = await guest.client.rpc("join_room", { p_code: room.code, p_display_name: "Beto R." });
      expect(again.data).toBe(room.id);

      const { data } = await host.client.from("room_members").select("display_name,role").eq("room_id", room.id).order("role");
      expect(data).toEqual([
        { display_name: "Anfitriona", role: "host" },
        { display_name: "Beto R.", role: "participant" },
      ]);
    });

    it("rechaza códigos inexistentes y nombres inválidos", async () => {
      expect(errorOf(await guest.client.rpc("join_room", { p_code: "zzzzzz", p_display_name: "Beto" }))).toBe("room_not_found");
      const room = await newRoom(host.client);
      expect(errorOf(await guest.client.rpc("join_room", { p_code: room.code, p_display_name: "  " }))).toBe("invalid_name");
    });

    it("al salir deja de ver la sala en vivo; puede volver a entrar", async () => {
      const room = await newRoom(host.client);
      await guest.client.rpc("join_room", { p_code: room.code, p_display_name: "Beto" });
      await guest.client.rpc("leave_room", { p_room_id: room.id });

      const { data: left } = await guest.client.from("room_members").select("user_id,left_at").eq("room_id", room.id);
      expect(left).toHaveLength(1); // solo su propia fila
      expect(left?.[0]?.left_at).not.toBeNull();

      await guest.client.rpc("join_room", { p_code: room.code, p_display_name: "Beto" });
      const { data: back } = await host.client.from("room_members").select("user_id").eq("room_id", room.id).is("left_at", null);
      expect(back).toHaveLength(2);
    });

    it("sala bloqueada: no entra nadie nuevo, el anfitrión sí", async () => {
      const room = await newRoom(host.client);
      expect(errorOf(await guest.client.rpc("set_room_locked", { p_room_id: room.id, p_locked: true }))).toBe("not_host");
      expect((await host.client.rpc("set_room_locked", { p_room_id: room.id, p_locked: true })).error).toBeNull();

      expect(errorOf(await guest.client.rpc("join_room", { p_code: room.code, p_display_name: "Beto" }))).toBe("room_locked");
      expect((await host.client.rpc("join_room", { p_code: room.code, p_display_name: "Ana" })).error).toBeNull();

      await host.client.rpc("set_room_locked", { p_room_id: room.id, p_locked: false });
      expect((await guest.client.rpc("join_room", { p_code: room.code, p_display_name: "Beto" })).error).toBeNull();
    });

    it("aforo de 20: la persona 21 recibe room_full y al salir alguien hay lugar", async () => {
      const room = await newRoom(host.client, "Sala llena");
      const admin = adminClient();
      const fillerIds = await Promise.all(Array.from({ length: 19 }, () => createBareUser()));
      userIds.push(...fillerIds);
      const { error } = await admin.from("room_members").insert(
        fillerIds.map((id, i) => ({ room_id: room.id, user_id: id, display_name: `Relleno ${i}` })),
      );
      expect(error).toBeNull();

      expect(errorOf(await guest.client.rpc("join_room", { p_code: room.code, p_display_name: "Beto" }))).toBe("room_full");

      await admin.from("room_members").update({ left_at: new Date().toISOString() }).eq("room_id", room.id).eq("user_id", fillerIds[0]!);
      expect((await guest.client.rpc("join_room", { p_code: room.code, p_display_name: "Beto" })).error).toBeNull();
    });

    it("peek_room: cualquiera con el código ve nombre, estado y aforo, sin datos del anfitrión", async () => {
      const room = await newRoom(host.client, "Vista previa");
      const peek = await anonClient().rpc("peek_room", { p_code: room.code });
      expect(peek.data).toEqual([{ name: "Vista previa", status: "open", is_locked: false, active_members: 1 }]);
      expect((await anonClient().rpc("peek_room", { p_code: "zzzzzz" })).data).toEqual([]);
    });
  });

  describe("remove_member (expulsar)", () => {
    it("solo el anfitrión expulsa; la persona sale y no puede volver a entrar", async () => {
      const room = await newRoom(host.client);
      await guest.client.rpc("join_room", { p_code: room.code, p_display_name: "Beto" });
      await outsider.client.rpc("join_room", { p_code: room.code, p_display_name: "Carla" });

      // Una participante no puede expulsar a otra
      expect(errorOf(await outsider.client.rpc("remove_member", { p_room_id: room.id, p_user_id: guest.user.id }))).toBe("not_host");

      expect((await host.client.rpc("remove_member", { p_room_id: room.id, p_user_id: guest.user.id })).error).toBeNull();

      const { data: row } = await adminClient()
        .from("room_members")
        .select("left_at,removed_at")
        .eq("room_id", room.id)
        .eq("user_id", guest.user.id)
        .single();
      expect(row?.left_at).not.toBeNull();
      expect(row?.removed_at).not.toBeNull();

      // Sigue viendo su propia fila (para saber que la sacaron) pero ya no lo que pasa en la sala
      const own = await guest.client.from("room_members").select("removed_at").eq("room_id", room.id);
      expect(own.data).toHaveLength(1);
      expect(own.data?.[0]?.removed_at).not.toBeNull();

      expect(errorOf(await guest.client.rpc("join_room", { p_code: room.code, p_display_name: "Beto" }))).toBe("removed");
      // A las demás no les afecta
      const others = await host.client.from("room_members").select("user_id").eq("room_id", room.id).is("left_at", null);
      expect(others.data).toHaveLength(2);
    });

    it("no se puede expulsar al anfitrión, a uno mismo ni a quien no está", async () => {
      const room = await newRoom(host.client);
      await guest.client.rpc("join_room", { p_code: room.code, p_display_name: "Beto" });

      expect(errorOf(await host.client.rpc("remove_member", { p_room_id: room.id, p_user_id: host.user.id }))).toBe("cannot_remove_self");
      expect(errorOf(await host.client.rpc("remove_member", { p_room_id: room.id, p_user_id: outsider.user.id }))).toBe("member_not_found");
      // La persona participante tampoco puede expulsar al anfitrión
      expect(errorOf(await guest.client.rpc("remove_member", { p_room_id: room.id, p_user_id: host.user.id }))).toBe("not_host");
    });

    it("no funciona en una sala cerrada", async () => {
      const room = await newRoom(host.client);
      await guest.client.rpc("join_room", { p_code: room.code, p_display_name: "Beto" });
      await host.client.rpc("close_room", { p_room_id: room.id });
      expect(errorOf(await host.client.rpc("remove_member", { p_room_id: room.id, p_user_id: guest.user.id }))).toBe("not_host");
    });
  });

  describe("close_room", () => {
    it("solo el anfitrión cierra: cierra la sala, saca a todos y nadie más entra", async () => {
      const room = await newRoom(host.client);
      await guest.client.rpc("join_room", { p_code: room.code, p_display_name: "Beto" });

      expect(errorOf(await guest.client.rpc("close_room", { p_room_id: room.id }))).toBe("not_host");
      expect(errorOf(await outsider.client.rpc("close_room", { p_room_id: room.id }))).toBe("not_host");

      expect((await host.client.rpc("close_room", { p_room_id: room.id })).error).toBeNull();
      const { data: r } = await host.client.from("rooms").select("status,closed_at").eq("id", room.id).single();
      expect(r?.status).toBe("closed");
      expect(r?.closed_at).not.toBeNull();

      const { data: active } = await adminClient().from("room_members").select("user_id").eq("room_id", room.id).is("left_at", null);
      expect(active).toEqual([]);
      expect(errorOf(await outsider.client.rpc("join_room", { p_code: room.code, p_display_name: "Carla" }))).toBe("room_closed");
    });
  });

  describe("lectura (RLS): quien no está en la sala no ve nada", () => {
    it("rooms, room_members y prayer_requests de una sala ajena salen vacíos", async () => {
      const room = await newRoom(host.client);
      await host.client.from("prayer_requests").insert({ room_id: room.id, content: "Por la paz" });

      expect((await outsider.client.from("rooms").select("*").eq("id", room.id)).data).toEqual([]);
      expect((await outsider.client.from("room_members").select("*").eq("room_id", room.id)).data).toEqual([]);
      expect((await outsider.client.from("prayer_requests").select("*").eq("room_id", room.id)).data).toEqual([]);
      expect((await outsider.client.from("rooms").select("id")).data?.some((x) => x.id === room.id)).toBe(false);
    });

    it("sin sesión (rol anon) tampoco", async () => {
      for (const table of ["rooms", "room_members", "prayer_requests"] as const) {
        const res = await anonClient().from(table).select("*");
        expect(res.error?.code).toBe("42501");
      }
    });
  });

  describe("peticiones", () => {
    let room: { id: string; code: string };

    beforeAll(async () => {
      room = await newRoom(host.client, "Sala de peticiones", "Ana");
      keepRooms.add(room.id);
      await guest.client.rpc("join_room", { p_code: room.code, p_display_name: "Beto" });
    });

    const post = (client: TestClient, content: string, roomId = room.id) =>
      client.from("prayer_requests").insert({ room_id: roomId, content }).select().single();

    it("quien está en la sala publica y los demás la ven", async () => {
      const { data, error } = await post(guest.client, "  Por mi familia  ");
      expect(error).toBeNull();
      expect(data).toMatchObject({ author_id: guest.user.id, content: "  Por mi familia  ", is_answered: false });

      const seen = await host.client.from("prayer_requests").select("content").eq("room_id", room.id);
      expect(seen.data?.map((x) => x.content)).toContain("  Por mi familia  ");
    });

    it("quien no está no puede publicar; tampoco puede falsear al autor", async () => {
      expect((await post(outsider.client, "Intruso")).error?.code).toBe("42501");

      const spoof = await outsider.client
        .from("prayer_requests")
        .insert({ room_id: room.id, content: "x", author_id: host.user.id } as never);
      expect(spoof.error?.code).toBe("42501");
    });

    it("quien salió deja de poder publicar y de ver las nuevas", async () => {
      const leaver = await signInTestUser("Salió");
      userIds.push(leaver.user.id);
      await leaver.client.rpc("join_room", { p_code: room.code, p_display_name: "Salió" });
      await leaver.client.rpc("leave_room", { p_room_id: room.id });

      expect((await post(leaver.client, "Ya no estoy")).error?.code).toBe("42501");
      const afterLeave = await post(host.client, "Nueva después de que salió");
      expect(afterLeave.error).toBeNull();
      const seen = await leaver.client.from("prayer_requests").select("id").eq("id", afterLeave.data!.id);
      expect(seen.data).toEqual([]);
    });

    it("no se publica en salas cerradas", async () => {
      const closed = await newRoom(host.client, "Cerrada");
      await host.client.rpc("close_room", { p_room_id: closed.id });
      expect((await post(host.client, "Tarde", closed.id)).error?.code).toBe("42501");
    });

    it("valida el contenido y limita a 20 por persona y sala", async () => {
      expect((await post(guest.client, "   ")).error?.code).toBe("23514");
      expect((await post(guest.client, "x".repeat(501))).error?.code).toBe("23514");

      const spammer = await signInTestUser("Spam");
      userIds.push(spammer.user.id);
      const spamRoom = await newRoom(spammer.client, "Spam", "Spam");
      for (let i = 0; i < 20; i++) expect((await post(spammer.client, `Petición ${i}`, spamRoom.id)).error).toBeNull();
      expect(errorOf(await post(spammer.client, "La 21", spamRoom.id))).toBe("too_many_requests");
    });

    it("el autor marca respondida con testimonio; al desmarcar se limpia", async () => {
      const { data: created } = await post(guest.client, "Por el trabajo");
      const answered = await guest.client
        .from("prayer_requests")
        .update({ is_answered: true, testimony: "Conseguí el empleo" })
        .eq("id", created!.id)
        .select()
        .single();
      expect(answered.data).toMatchObject({ is_answered: true, testimony: "Conseguí el empleo" });
      expect(answered.data?.answered_at).not.toBeNull();

      const undone = await guest.client.from("prayer_requests").update({ is_answered: false }).eq("id", created!.id).select().single();
      expect(undone.data).toMatchObject({ is_answered: false, testimony: null, answered_at: null });
    });

    it("nadie más edita la petición (ni el anfitrión): 0 filas", async () => {
      const { data: created } = await post(guest.client, "Intocable");
      for (const other of [host, outsider]) {
        const res = await other.client.from("prayer_requests").update({ content: "Editada" }).eq("id", created!.id).select();
        expect(res.data).toEqual([]);
      }
      const check = await adminClient().from("prayer_requests").select("content").eq("id", created!.id).single();
      expect(check.data?.content).toBe("Intocable");
    });

    it("no se pueden cambiar columnas protegidas (autor, sala)", async () => {
      const { data: created } = await post(guest.client, "Protegida");
      const res = await guest.client.from("prayer_requests").update({ author_id: host.user.id }).eq("id", created!.id);
      expect(res.error?.code).toBe("42501");
      const res2 = await guest.client.from("prayer_requests").update({ room_id: crypto.randomUUID() }).eq("id", created!.id);
      expect(res2.error?.code).toBe("42501");
    });

    it("borra el autor o el anfitrión; otra persona de la sala no", async () => {
      const third = await signInTestUser("Tercera");
      userIds.push(third.user.id);
      await third.client.rpc("join_room", { p_code: room.code, p_display_name: "Tercera" });

      const { data: byGuest } = await post(guest.client, "Para borrar");
      expect((await third.client.from("prayer_requests").delete().eq("id", byGuest!.id).select()).data).toEqual([]);
      expect((await host.client.from("prayer_requests").delete().eq("id", byGuest!.id).select()).data).toHaveLength(1);

      const { data: own } = await post(third.client, "Mía");
      expect((await third.client.from("prayer_requests").delete().eq("id", own!.id).select()).data).toHaveLength(1);
    });
  });

  describe("Realtime respeta RLS", () => {
    it("quien está en la sala recibe las peticiones nuevas en vivo; quien no está, nada", async () => {
      const room = await newRoom(host.client, "En vivo");
      await guest.client.rpc("join_room", { p_code: room.code, p_display_name: "Beto" });

      const subscribe = (client: TestClient, sink: string[]) =>
        new Promise<() => Promise<unknown>>((resolve, reject) => {
          const channel = client
            .channel(`prueba-${crypto.randomUUID()}`)
            .on(
              "postgres_changes",
              { event: "INSERT", schema: "public", table: "prayer_requests", filter: `room_id=eq.${room.id}` },
              (payload) => sink.push((payload.new as { content: string }).content),
            )
            .subscribe((status) => {
              if (status === "SUBSCRIBED") resolve(() => client.removeChannel(channel));
              if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(`Realtime: ${status}`));
            });
        });

      const fromGuest: string[] = [];
      const fromOutsider: string[] = [];
      const stopGuest = await subscribe(guest.client, fromGuest);
      const stopOutsider = await subscribe(outsider.client, fromOutsider);
      // Realtime avisa SUBSCRIBED un instante antes de registrar la suscripción en la base (más
      // lento justo tras reiniciar el servicio): por eso se publica hasta que llegue el primer
      // evento. La app, por su parte, vuelve a leer la lista tras suscribirse (use-room-live).
      for (let attempt = 0; attempt < 6 && fromGuest.length === 0; attempt++) {
        await host.client.from("prayer_requests").insert({ room_id: room.id, content: `Llega en vivo ${attempt}` });
        const until = Date.now() + 2000;
        while (fromGuest.length === 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
      }
      await new Promise((r) => setTimeout(r, 500)); // margen para confirmar que a la otra persona no le llega

      await stopGuest();
      await stopOutsider();
      expect(fromGuest.length).toBeGreaterThanOrEqual(1);
      expect(fromGuest.every((content) => content.startsWith("Llega en vivo"))).toBe(true);
      expect(fromOutsider).toEqual([]);
    }, 20000);
  });
});
