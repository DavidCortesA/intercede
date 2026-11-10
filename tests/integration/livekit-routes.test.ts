// @vitest-environment node
import { TokenVerifier, TrackType } from "livekit-server-sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminClient, createCookieSession, hasTestDb, testEnv } from "./helpers";

// La sesión de la "persona" que llama: se cambia por prueba (las rutas leen las cookies).
const session = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...session.jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void session.jar.set(name, value),
  }),
}));

// LiveKit real solo para firmar tokens (local, sin red); la API de administración se simula.
const livekit = vi.hoisted(() => ({
  createRoom: vi.fn(),
  getParticipant: vi.fn(),
  listParticipants: vi.fn(),
  mutePublishedTrack: vi.fn(),
  removeParticipant: vi.fn(),
  deleteRoom: vi.fn(),
}));
vi.mock("@/lib/livekit/server", async (importOriginal) => {
  const original: Record<string, unknown> = await importOriginal();
  return { ...original, getRoomService: () => livekit };
});

const LK = { url: "wss://prueba.livekit.test", key: "APIprueba123", secret: "secreto-de-prueba-largo-0123456789abcdef" };

const HOST = "http://localhost:3000";
const call = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${HOST}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: HOST, "x-forwarded-host": "localhost:3000", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe.skipIf(!hasTestDb)("rutas de LiveKit (token y controles del anfitrión)", () => {
  const userIds: string[] = [];
  let host: Awaited<ReturnType<typeof createCookieSession>>;
  let guest: Awaited<ReturnType<typeof createCookieSession>>;
  let stranger: Awaited<ReturnType<typeof createCookieSession>>;
  let tokenPost: (request: Request) => Promise<Response>;
  let hostPost: (request: Request) => Promise<Response>;

  async function newRoom() {
    const { data, error } = await host.client.rpc("create_room", { p_name: "Sala de audio", p_display_name: "Ana" });
    if (error || !data?.[0]) throw new Error(`create_room falló: ${error?.message}`);
    await guest.client.rpc("join_room", { p_code: data[0].room_code, p_display_name: "Beto" });
    return { id: data[0].room_id, code: data[0].room_code };
  }

  const as = (who: { jar: Map<string, string> } | null) => {
    session.jar = who ? new Map(who.jar) : new Map();
  };

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = testEnv.url;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = testEnv.publishableKey;
    process.env.LIVEKIT_URL = LK.url;
    process.env.LIVEKIT_API_KEY = LK.key;
    process.env.LIVEKIT_API_SECRET = LK.secret;

    [host, guest, stranger] = await Promise.all([
      createCookieSession("Ana"),
      createCookieSession("Beto"),
      createCookieSession("Carla"),
    ]);
    userIds.push(host.userId, guest.userId, stranger.userId);
    tokenPost = (await import("@/app/api/livekit/token/route")).POST;
    hostPost = (await import("@/app/api/livekit/host/route")).POST;
  });

  afterAll(async () => {
    await Promise.all(userIds.map((id) => adminClient().auth.admin.deleteUser(id)));
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    livekit.createRoom.mockResolvedValue({});
    livekit.mutePublishedTrack.mockResolvedValue({});
    livekit.removeParticipant.mockResolvedValue({});
    livekit.deleteRoom.mockResolvedValue({});
    // Parte sin salas previas (límite de 5 abiertas por anfitrión)
    await adminClient().from("rooms").delete().eq("host_id", host.userId);
  });

  describe("POST /api/livekit/token", () => {
    it("sin sesión: 401", async () => {
      as(null);
      const res = await tokenPost(call("/api/livekit/token", { roomId: crypto.randomUUID() }));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthenticated" });
    });

    it("rechaza cuerpos inválidos, otros orígenes y contenido que no es JSON", async () => {
      as(guest);
      expect((await tokenPost(call("/api/livekit/token", { roomId: "no-es-uuid" }))).status).toBe(400);
      expect((await tokenPost(call("/api/livekit/token", "no es json"))).status).toBe(400);
      expect((await tokenPost(call("/api/livekit/token", { roomId: crypto.randomUUID() }, { origin: "https://malo.example" }))).status).toBe(403);
      expect(
        (await tokenPost(call("/api/livekit/token", { roomId: crypto.randomUUID() }, { "content-type": "text/plain" }))).status,
      ).toBe(403);
    });

    it("quien no está en la sala: 403 y no se emite token", async () => {
      const room = await newRoom();
      as(stranger);
      const res = await tokenPost(call("/api/livekit/token", { roomId: room.id }));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "not_a_member" });
      expect(livekit.createRoom).not.toHaveBeenCalled();
    });

    it("una persona de la sala recibe un token corto, solo de micrófono y de ESA sala", async () => {
      const room = await newRoom();
      as(guest);
      const res = await tokenPost(call("/api/livekit/token", { roomId: room.id }));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");

      const body = (await res.json()) as { token: string; serverUrl: string; identity: string };
      expect(body.serverUrl).toBe(LK.url);
      expect(body.identity).toBe(guest.userId);

      const claims = await new TokenVerifier(LK.key, LK.secret).verify(body.token);
      expect(claims.sub).toBe(guest.userId);
      expect(claims.name).toBe("Beto");
      expect(claims.video).toMatchObject({ room: room.id, roomJoin: true, canSubscribe: true, canPublish: true, canPublishData: false });
      expect(claims.video?.canPublishSources).toEqual(["MICROPHONE"].map(() => expect.anything()));
      expect(JSON.parse(claims.metadata ?? "{}")).toEqual({ role: "participant" });
      expect((claims.exp ?? 0) - (claims.nbf ?? 0)).toBeGreaterThanOrEqual(7190);
      expect((claims.exp ?? 0) - (claims.nbf ?? 0)).toBeLessThanOrEqual(7210);

      expect(livekit.createRoom).toHaveBeenCalledWith({ name: room.id, maxParticipants: 20, emptyTimeout: 600 });
    });

    it("el token del anfitrión lo marca como anfitrión", async () => {
      const room = await newRoom();
      as(host);
      const body = (await (await tokenPost(call("/api/livekit/token", { roomId: room.id }))).json()) as { token: string };
      const claims = await new TokenVerifier(LK.key, LK.secret).verify(body.token);
      expect(JSON.parse(claims.metadata ?? "{}")).toEqual({ role: "host" });
    });

    it("no emite token si la sala está cerrada, si salió o si lo expulsaron", async () => {
      const left = await newRoom();
      await guest.client.rpc("leave_room", { p_room_id: left.id });
      as(guest);
      expect((await tokenPost(call("/api/livekit/token", { roomId: left.id }))).status).toBe(403);

      const kicked = await newRoom();
      await host.client.rpc("remove_member", { p_room_id: kicked.id, p_user_id: guest.userId });
      const res = await tokenPost(call("/api/livekit/token", { roomId: kicked.id }));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "removed" });

      const closed = await newRoom();
      await host.client.rpc("close_room", { p_room_id: closed.id });
      as(host);
      const closedRes = await tokenPost(call("/api/livekit/token", { roomId: closed.id }));
      expect(closedRes.status).toBe(409);
      expect(await closedRes.json()).toEqual({ error: "room_closed" });
    });

    it("si LiveKit no está configurado responde 500 sin filtrar detalles", async () => {
      const room = await newRoom();
      as(guest);
      const saved = process.env.LIVEKIT_API_SECRET;
      process.env.LIVEKIT_API_SECRET = "";
      try {
        const res = await tokenPost(call("/api/livekit/token", { roomId: room.id }));
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: "server_misconfigured" });
      } finally {
        process.env.LIVEKIT_API_SECRET = saved;
      }
    });
  });

  describe("POST /api/livekit/host", () => {
    it("solo el anfitrión: una participante recibe 403 y LiveKit no se toca", async () => {
      const room = await newRoom();
      as(guest);
      for (const body of [
        { action: "mute_all", roomId: room.id },
        { action: "mute", roomId: room.id, identity: host.userId },
        { action: "remove", roomId: room.id, identity: host.userId },
        { action: "close", roomId: room.id },
      ]) {
        const res = await hostPost(call("/api/livekit/host", body));
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "not_host" });
      }
      expect(livekit.mutePublishedTrack).not.toHaveBeenCalled();
      expect(livekit.removeParticipant).not.toHaveBeenCalled();
      expect(livekit.deleteRoom).not.toHaveBeenCalled();
    });

    it("valida el cuerpo (acción y uuid)", async () => {
      as(host);
      expect((await hostPost(call("/api/livekit/host", { action: "explotar", roomId: crypto.randomUUID() }))).status).toBe(400);
      expect((await hostPost(call("/api/livekit/host", { action: "mute", roomId: crypto.randomUUID(), identity: "x" }))).status).toBe(400);
    });

    it("silenciar: apaga solo las pistas de audio que están activas", async () => {
      const room = await newRoom();
      as(host);
      livekit.getParticipant.mockResolvedValue({
        identity: guest.userId,
        tracks: [
          { sid: "TR_audio", type: TrackType.AUDIO, muted: false },
          { sid: "TR_ya_mute", type: TrackType.AUDIO, muted: true },
          { sid: "TR_video", type: TrackType.VIDEO, muted: false },
        ],
      });
      const res = await hostPost(call("/api/livekit/host", { action: "mute", roomId: room.id, identity: guest.userId }));
      expect(await res.json()).toEqual({ muted: 1 });
      expect(livekit.mutePublishedTrack).toHaveBeenCalledTimes(1);
      expect(livekit.mutePublishedTrack).toHaveBeenCalledWith(room.id, guest.userId, "TR_audio", true);
    });

    it("silenciar a alguien que no está en el audio: 404 claro", async () => {
      const room = await newRoom();
      as(host);
      livekit.getParticipant.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));
      const res = await hostPost(call("/api/livekit/host", { action: "mute", roomId: room.id, identity: guest.userId }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "participant_not_connected" });
    });

    it("silenciar a todos: no silencia al propio anfitrión", async () => {
      const room = await newRoom();
      as(host);
      livekit.listParticipants.mockResolvedValue([
        { identity: host.userId, tracks: [{ sid: "TR_host", type: TrackType.AUDIO, muted: false }] },
        { identity: guest.userId, tracks: [{ sid: "TR_beto", type: TrackType.AUDIO, muted: false }] },
      ]);
      const res = await hostPost(call("/api/livekit/host", { action: "mute_all", roomId: room.id }));
      expect(await res.json()).toEqual({ muted: 1 });
      expect(livekit.mutePublishedTrack).toHaveBeenCalledWith(room.id, guest.userId, "TR_beto", true);
      expect(livekit.mutePublishedTrack).not.toHaveBeenCalledWith(room.id, host.userId, expect.anything(), expect.anything());
    });

    it("expulsar: marca la expulsión en la base y corta el audio en LiveKit", async () => {
      const room = await newRoom();
      as(host);
      const res = await hostPost(call("/api/livekit/host", { action: "remove", roomId: room.id, identity: guest.userId }));
      expect(await res.json()).toEqual({ removed: true });
      expect(livekit.removeParticipant).toHaveBeenCalledWith(room.id, guest.userId);

      const { data } = await adminClient().from("room_members").select("removed_at,left_at").eq("room_id", room.id).eq("user_id", guest.userId).single();
      expect(data?.removed_at).not.toBeNull();
      expect(data?.left_at).not.toBeNull();
    });

    it("expulsar a quien no está conectado al audio igual funciona (ya está fuera)", async () => {
      const room = await newRoom();
      as(host);
      livekit.removeParticipant.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));
      const res = await hostPost(call("/api/livekit/host", { action: "remove", roomId: room.id, identity: guest.userId }));
      expect(res.status).toBe(200);
    });

    it("no se puede expulsar a uno mismo ni a alguien que no está en la sala", async () => {
      const room = await newRoom();
      as(host);
      const self = await hostPost(call("/api/livekit/host", { action: "remove", roomId: room.id, identity: host.userId }));
      expect(self.status).toBe(400);
      expect(await self.json()).toEqual({ error: "cannot_remove_self" });

      const nobody = await hostPost(call("/api/livekit/host", { action: "remove", roomId: room.id, identity: stranger.userId }));
      expect(nobody.status).toBe(404);
      expect(await nobody.json()).toEqual({ error: "member_not_found" });
      expect(livekit.removeParticipant).not.toHaveBeenCalled();
    });

    it("cerrar: cierra la sala en la base y desconecta a todas las personas del audio", async () => {
      const room = await newRoom();
      as(host);
      const res = await hostPost(call("/api/livekit/host", { action: "close", roomId: room.id }));
      expect(await res.json()).toEqual({ closed: true });
      expect(livekit.deleteRoom).toHaveBeenCalledWith(room.id);
      const { data } = await adminClient().from("rooms").select("status").eq("id", room.id).single();
      expect(data?.status).toBe("closed");
    });

    it("si LiveKit falla responde 502 (y la expulsión en la base ya quedó registrada)", async () => {
      const room = await newRoom();
      as(host);
      livekit.removeParticipant.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
      const res = await hostPost(call("/api/livekit/host", { action: "remove", roomId: room.id, identity: guest.userId }));
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "livekit_unavailable" });
      const { data } = await adminClient().from("room_members").select("removed_at").eq("room_id", room.id).eq("user_id", guest.userId).single();
      expect(data?.removed_at).not.toBeNull();
    });
  });
});
