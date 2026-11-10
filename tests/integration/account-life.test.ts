// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TablesInsert } from "@/types/database";
import { adminClient, hasTestDb, signInGuest, signInTestUser, testEnv } from "./helpers";

type Person = Awaited<ReturnType<typeof signInTestUser>>;

const errorOf = (res: { error: { message: string } | null }) => res.error?.message;

// room_id lo completa un trigger de la base a partir de la petición; los tipos generados lo marcan obligatorio
const supportRow = (requestId: string) => ({ request_id: requestId }) as TablesInsert<"prayer_support">;

describe.skipIf(!hasTestDb)("vida de oración: diario, apoyo en oración y avatares", () => {
  const userIds: string[] = [];
  let ana: Person;
  let beto: Person;
  let carla: Person;

  beforeAll(async () => {
    [ana, beto, carla] = await Promise.all([signInTestUser("Ana"), signInTestUser("Beto"), signInTestUser("Carla")]);
    userIds.push(ana.user.id, beto.user.id, carla.user.id);
  });

  afterAll(async () => {
    const admin = adminClient();
    await Promise.all(userIds.map((id) => admin.auth.admin.deleteUser(id)));
  });

  // Cada prueba de salas parte sin salas previas (límite de 5 abiertas por anfitrión)
  beforeEach(async () => {
    await adminClient().from("rooms").delete().in("host_id", [ana.user.id, beto.user.id, carla.user.id]);
  });

  async function roomWithRequest() {
    const { data } = await beto.client.rpc("create_room", { p_name: "Sala", p_display_name: "Beto" });
    const room = { id: data![0]!.room_id, code: data![0]!.room_code };
    await ana.client.rpc("join_room", { p_code: room.code, p_display_name: "Ana" });
    const { data: request } = await beto.client.from("prayer_requests").insert({ room_id: room.id, content: "Por mi familia" }).select().single();
    return { room, requestId: request!.id };
  }

  describe("diario de oración", () => {
    it("una cuenta crea, lee y ordena sus entradas; nadie más las ve", async () => {
      const { data, error } = await ana.client
        .from("prayer_journal_entries")
        .insert({ content: "  Por mi salud  ", category: "health" })
        .select()
        .single();
      expect(error).toBeNull();
      expect(data).toMatchObject({ user_id: ana.user.id, category: "health", status: "praying", testimony: null, answered_at: null });

      expect((await ana.client.from("prayer_journal_entries").select("id")).data?.some((e) => e.id === data!.id)).toBe(true);
      expect((await beto.client.from("prayer_journal_entries").select("id").eq("id", data!.id)).data).toEqual([]);
    });

    it("un invitado (anónimo) no puede usar el diario", async () => {
      const guest = await signInGuest("Invitado");
      userIds.push(guest.user.id);
      const res = await guest.client.from("prayer_journal_entries").insert({ content: "No debería" });
      expect(res.error?.code).toBe("42501");
    });

    it("sin sesión no hay acceso", async () => {
      const anon = await import("./helpers").then((m) => m.anonClient());
      expect((await anon.from("prayer_journal_entries").select("*")).error?.code).toBe("42501");
    });

    it("valida contenido y categoría", async () => {
      const bad = (patch: Record<string, string>) => ana.client.from("prayer_journal_entries").insert({ content: "x", ...patch } as never);
      expect((await bad({ content: "   " })).error?.code).toBe("23514");
      expect((await bad({ content: "x".repeat(2001) })).error?.code).toBe("23514");
      expect((await bad({ category: "inventada" })).error?.code).toBe("23514");
    });

    it("marcar respondida guarda el testimonio y la fecha; quitarla los limpia", async () => {
      const { data: entry } = await ana.client.from("prayer_journal_entries").insert({ content: "Un trabajo" }).select().single();
      const answered = await ana.client
        .from("prayer_journal_entries")
        .update({ status: "answered", testimony: "Lo conseguí" })
        .eq("id", entry!.id)
        .select()
        .single();
      expect(answered.data).toMatchObject({ status: "answered", testimony: "Lo conseguí" });
      expect(answered.data?.answered_at).not.toBeNull();

      const undone = await ana.client.from("prayer_journal_entries").update({ status: "praying" }).eq("id", entry!.id).select().single();
      expect(undone.data).toMatchObject({ status: "praying", testimony: null, answered_at: null });
    });

    it("solo se edita lo propio y no se pueden cambiar columnas protegidas", async () => {
      const { data: entry } = await ana.client.from("prayer_journal_entries").insert({ content: "Mía" }).select().single();
      const others = await beto.client.from("prayer_journal_entries").update({ content: "Ajena" }).eq("id", entry!.id).select();
      expect(others.data).toEqual([]);
      expect((await ana.client.from("prayer_journal_entries").update({ user_id: beto.user.id }).eq("id", entry!.id)).error?.code).toBe("42501");
      expect((await beto.client.from("prayer_journal_entries").delete().eq("id", entry!.id).select()).data).toEqual([]);
      expect((await ana.client.from("prayer_journal_entries").delete().eq("id", entry!.id).select()).data).toHaveLength(1);
    });

    it("se puede guardar una petición de la sala; no una que la persona no puede leer", async () => {
      const { requestId } = await roomWithRequest();
      const saved = await ana.client
        .from("prayer_journal_entries")
        .insert({ content: "Por mi familia", category: "family", source_request_id: requestId })
        .select()
        .single();
      expect(saved.error).toBeNull();
      expect(saved.data?.source_request_id).toBe(requestId);

      const hidden = await carla.client.from("prayer_journal_entries").insert({ content: "Espiando", source_request_id: requestId });
      expect(hidden.error?.code).toBe("42501");

      // Si la petición se borra, la entrada del diario se conserva
      await adminClient().from("prayer_requests").delete().eq("id", requestId);
      const kept = await ana.client.from("prayer_journal_entries").select("source_request_id").eq("id", saved.data!.id).single();
      expect(kept.data?.source_request_id).toBeNull();
    });
  });

  describe("estoy orando por esto", () => {
    it("quien está en la sala apoya una petición ajena; todos en la sala ven el conteo", async () => {
      const { room, requestId } = await roomWithRequest();
      await carla.client.rpc("join_room", { p_code: room.code, p_display_name: "Carla" });

      const res = await ana.client.from("prayer_support").insert(supportRow(requestId)).select().single();
      expect(res.error).toBeNull();
      expect(res.data).toMatchObject({ request_id: requestId, user_id: ana.user.id, room_id: room.id });
      await carla.client.from("prayer_support").insert(supportRow(requestId));

      for (const viewer of [ana, beto, carla]) {
        const { data } = await viewer.client.from("prayer_support").select("user_id").eq("request_id", requestId);
        expect(data).toHaveLength(2);
      }
    });

    it("no se puede apoyar la propia petición, ni dos veces, ni falsear a la persona", async () => {
      const { requestId } = await roomWithRequest();
      expect((await beto.client.from("prayer_support").insert(supportRow(requestId))).error?.code).toBe("42501");

      expect((await ana.client.from("prayer_support").insert(supportRow(requestId))).error).toBeNull();
      expect((await ana.client.from("prayer_support").insert(supportRow(requestId))).error?.code).toBe("23505");

      const spoof = await ana.client.from("prayer_support").insert({ request_id: requestId, user_id: carla.user.id } as never);
      expect(spoof.error?.code).toBe("42501");
    });

    it("quien no está en la sala no puede apoyar ni ver; una petición inexistente da error claro", async () => {
      const { requestId } = await roomWithRequest();
      expect((await carla.client.from("prayer_support").insert(supportRow(requestId))).error).not.toBeNull();
      expect(errorOf(await ana.client.from("prayer_support").insert(supportRow(crypto.randomUUID())))).toBe("request_not_found");

      await ana.client.from("prayer_support").insert(supportRow(requestId));
      expect((await carla.client.from("prayer_support").select("*")).data).toEqual([]);
    });

    it("cada quien quita solo su apoyo; al borrarse la petición, se borran los apoyos", async () => {
      const { room, requestId } = await roomWithRequest();
      await carla.client.rpc("join_room", { p_code: room.code, p_display_name: "Carla" });
      await ana.client.from("prayer_support").insert(supportRow(requestId));

      expect((await carla.client.from("prayer_support").delete().eq("user_id", ana.user.id).select()).data).toEqual([]);
      expect((await ana.client.from("prayer_support").delete().eq("user_id", ana.user.id).select()).data).toHaveLength(1);

      await ana.client.from("prayer_support").insert(supportRow(requestId));
      await beto.client.from("prayer_requests").delete().eq("id", requestId);
      const left = await adminClient().from("prayer_support").select("*").eq("request_id", requestId);
      expect(left.data).toEqual([]);
    });

    it("quien salió de la sala ya no puede apoyar peticiones", async () => {
      const { room, requestId } = await roomWithRequest();
      await ana.client.rpc("leave_room", { p_room_id: room.id });
      // Ya no ve la petición, así que para ella "no existe" (o RLS la rechaza): siempre denegado
      const res = await ana.client.from("prayer_support").insert(supportRow(requestId));
      expect(["42501", "P0001"]).toContain(res.error?.code);
      expect((await adminClient().from("prayer_support").select("*").eq("request_id", requestId)).data).toEqual([]);
    });
  });

  describe("avatares", () => {
    const avatarUrl = (userId: string, file = "a.webp") => `${testEnv.url}/storage/v1/object/public/avatars/${userId}/${file}`;

    it("el perfil solo acepta una URL de la carpeta propia del almacenamiento", async () => {
      const own = await ana.client.from("profiles").update({ avatar_url: avatarUrl(ana.user.id) }).eq("id", ana.user.id);
      expect(own.error).toBeNull();

      expect((await ana.client.from("profiles").update({ avatar_url: "https://rastreador.example/pixel.png" }).eq("id", ana.user.id)).error?.code).toBe("23514");
      expect((await ana.client.from("profiles").update({ avatar_url: avatarUrl(beto.user.id) }).eq("id", ana.user.id)).error?.code).toBe("23514");
      expect((await ana.client.from("profiles").update({ avatar_url: null }).eq("id", ana.user.id)).error).toBeNull();
    });

    it("al crear o entrar a una sala se copia el avatar del perfil", async () => {
      await ana.client.from("profiles").update({ avatar_url: avatarUrl(ana.user.id) }).eq("id", ana.user.id);
      const { data } = await ana.client.rpc("create_room", { p_name: "Con avatar", p_display_name: "Ana" });
      const roomId = data![0]!.room_id;
      const { data: row } = await ana.client.from("room_members").select("avatar_url").eq("room_id", roomId).single();
      expect(row?.avatar_url).toBe(avatarUrl(ana.user.id));

      // Quien no tiene avatar queda en null
      await beto.client.rpc("join_room", { p_code: data![0]!.room_code, p_display_name: "Beto" });
      const { data: other } = await ana.client.from("room_members").select("avatar_url").eq("room_id", roomId).eq("user_id", beto.user.id).single();
      expect(other?.avatar_url).toBeNull();
      await ana.client.from("profiles").update({ avatar_url: null }).eq("id", ana.user.id);
    });

    it("almacenamiento: sube solo a su carpeta, solo imágenes y se lee por URL pública", async () => {
      const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      const mine = await ana.client.storage.from("avatars").upload(`${ana.user.id}/prueba.png`, png, { contentType: "image/png", upsert: true });
      expect(mine.error).toBeNull();

      const publicUrl = ana.client.storage.from("avatars").getPublicUrl(`${ana.user.id}/prueba.png`).data.publicUrl;
      expect((await fetch(publicUrl)).status).toBe(200);

      const intruder = await ana.client.storage.from("avatars").upload(`${beto.user.id}/intruso.png`, png, { contentType: "image/png" });
      expect(intruder.error).not.toBeNull();

      const notImage = await ana.client.storage.from("avatars").upload(`${ana.user.id}/texto.txt`, new Uint8Array([1, 2, 3]), { contentType: "text/plain" });
      expect(notImage.error).not.toBeNull();

      const tooBig = await ana.client.storage.from("avatars").upload(`${ana.user.id}/grande.png`, new Uint8Array(1_100_000), { contentType: "image/png" });
      expect(tooBig.error).not.toBeNull();

      // Otra persona no puede borrar lo ajeno
      await beto.client.storage.from("avatars").remove([`${ana.user.id}/prueba.png`]);
      expect((await fetch(publicUrl)).status).toBe(200);
      await ana.client.storage.from("avatars").remove([`${ana.user.id}/prueba.png`]);
    });

    it("un invitado (anónimo) no puede subir avatares", async () => {
      const guest = await signInGuest("Invitado");
      userIds.push(guest.user.id);
      const res = await guest.client.storage
        .from("avatars")
        .upload(`${guest.user.id}/a.png`, new Uint8Array([1]), { contentType: "image/png" });
      expect(res.error).not.toBeNull();
    });
  });
});
