// @vitest-environment node
import { createHash } from "node:crypto";
import { AccessToken, TokenVerifier } from "livekit-server-sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminClient, createCookieSession, hasTestDb, testEnv } from "./helpers";

const session = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...session.jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void session.jar.set(name, value),
  }),
}));

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
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe.skipIf(!hasTestDb)("rutas de grupos pequeños (B2)", () => {
  const admin = adminClient();
  const userIds: string[] = [];
  const communityIds: string[] = [];
  type Cookie = Awaited<ReturnType<typeof createCookieSession>>;
  let ana: Cookie;
  let beto: Cookie;
  let carla: Cookie;
  let dani: Cookie;
  let token: (request: Request) => Promise<Response>;
  let hostRoute: (request: Request) => Promise<Response>;
  let enforce: (request: Request) => Promise<Response>;
  let lkWebhook: (request: Request) => Promise<Response>;

  const as = (who: Cookie | null) => {
    session.jar = who ? new Map(who.jar) : new Map();
  };
  const json = (path: string, body: unknown) =>
    new Request(`${HOST}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: HOST, "x-forwarded-host": "localhost:3000" }, body: JSON.stringify(body) });

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = testEnv.url;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = testEnv.publishableKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = testEnv.serviceRoleKey;
    process.env.LIVEKIT_URL = LK.url;
    process.env.LIVEKIT_API_KEY = LK.key;
    process.env.LIVEKIT_API_SECRET = LK.secret;
    process.env.ENFORCER_SECRET = "secreto-del-enforcer-de-prueba";
    [ana, beto, carla, dani] = (await Promise.all(["Ana", "Beto", "Carla", "Dani"].map((n) => createCookieSession(n)))) as [Cookie, Cookie, Cookie, Cookie];
    userIds.push(ana.userId, beto.userId, carla.userId, dani.userId);
    token = (await import("@/app/api/livekit/token/route")).POST;
    hostRoute = (await import("@/app/api/livekit/host/route")).POST;
    enforce = (await import("@/app/api/billing/enforce/route")).POST;
    lkWebhook = (await import("@/app/api/livekit/webhook/route")).POST;
  });

  afterAll(async () => {
    await Promise.all(userIds.map((id) => admin.auth.admin.deleteUser(id)));
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    livekit.createRoom.mockResolvedValue({});
    livekit.removeParticipant.mockResolvedValue({});
    livekit.deleteRoom.mockResolvedValue({});
    if (communityIds.length) await admin.from("communities").delete().in("id", communityIds.splice(0));
    await admin.from("rooms").delete().in("host_id", userIds);
  });

  /** Sala de comunidad con Beto, Carla y Dani dentro y dos grupos: Beto en el 1, Carla en el 2, Dani sin grupo. */
  async function withBreakout(minutes = 10) {
    const { data: communityId } = await ana.client.rpc("create_community", { p_name: "Iglesia", p_kind: "church" });
    communityIds.push(communityId!);
    const invite = (await ana.client.rpc("get_community_invite", { p_community_id: communityId! })).data!;
    const { data } = await ana.client.rpc("create_community_room", { p_community_id: communityId!, p_name: "Sala", p_display_name: "Ana" });
    const room = { id: data![0]!.room_id, code: data![0]!.room_code };
    for (const person of [beto, carla, dani]) {
      await person.client.rpc("join_community", { p_token: invite });
      await person.client.rpc("join_room", { p_code: room.code, p_display_name: "X" });
    }
    const { data: breakoutId, error } = await ana.client.rpc("start_breakout", { p_room_id: room.id, p_group_count: 2, p_minutes: minutes, p_assignments: { [beto.userId]: 1, [carla.userId]: 2 } as never });
    expect(error).toBeNull();
    const groups = (await admin.from("breakout_groups").select("id, position, livekit_room").eq("breakout_id", breakoutId!).order("position")).data!;
    return { room, communityId: communityId!, breakoutId: breakoutId!, groups };
  }

  describe("POST /api/livekit/token con grupo", () => {
    it("la persona asignada recibe un token de la sala de SU grupo y que no dura más que el reparto", async () => {
      const { room, groups } = await withBreakout(10);
      as(beto);
      const res = await token(json("/api/livekit/token", { roomId: room.id, groupId: groups[0]!.id }));
      expect(res.status).toBe(200);
      expect(livekit.createRoom).toHaveBeenCalledWith(expect.objectContaining({ name: groups[0]!.livekit_room }));

      const { token: jwt } = (await res.json()) as { token: string };
      const claims = await new TokenVerifier(LK.key, LK.secret).verify(jwt);
      expect(claims.sub).toBe(beto.userId);
      expect(claims.video).toMatchObject({ room: groups[0]!.livekit_room, roomJoin: true, canPublishData: false });
      const lifetime = (claims.exp ?? 0) - (claims.nbf ?? 0);
      expect(lifetime).toBeGreaterThan(9 * 60);
      expect(lifetime).toBeLessThanOrEqual(10 * 60 + 20);
    });

    it("no se puede entrar al grupo de otra persona ni sin estar asignada, aunque se conozca el id", async () => {
      const { room, groups } = await withBreakout();
      as(beto);
      expect(await (await token(json("/api/livekit/token", { roomId: room.id, groupId: groups[1]!.id }))).json()).toEqual({ error: "not_assigned" });
      as(dani); // está en la sala pero no se le asignó grupo
      expect((await token(json("/api/livekit/token", { roomId: room.id, groupId: groups[0]!.id }))).status).toBe(403);
      expect(livekit.createRoom).not.toHaveBeenCalled();
      // El token de la sala principal sigue funcionando para quien no tiene grupo
      expect((await token(json("/api/livekit/token", { roomId: room.id }))).status).toBe(200);
      as(beto);
      expect((await token(json("/api/livekit/token", { roomId: room.id, groupId: "no-es-uuid" }))).status).toBe(400);
    });

    it("la anfitriona puede visitar cualquier grupo; pasado el reparto nadie recibe token de grupo", async () => {
      const { room, groups, breakoutId } = await withBreakout();
      as(ana);
      for (const group of groups) expect((await token(json("/api/livekit/token", { roomId: room.id, groupId: group.id }))).status).toBe(200);

      await admin.from("room_breakouts").update({ ends_at: iso(Date.now() - 30_000) }).eq("id", breakoutId);
      as(beto);
      expect((await token(json("/api/livekit/token", { roomId: room.id, groupId: groups[0]!.id }))).status).toBe(403);
      // Y sigue pudiendo volver a la sala principal
      expect((await token(json("/api/livekit/token", { roomId: room.id }))).status).toBe(200);
    });
  });

  describe("controles de la anfitriona con grupos", () => {
    it("terminar los grupos: la base los cierra y se cortan sus salas de audio; solo la anfitriona; no se repite", async () => {
      const { room, groups, breakoutId } = await withBreakout();
      as(beto);
      expect((await hostRoute(json("/api/livekit/host", { action: "end_breakout", roomId: room.id }))).status).toBe(403);
      expect(livekit.deleteRoom).not.toHaveBeenCalled();

      as(ana);
      const res = await hostRoute(json("/api/livekit/host", { action: "end_breakout", roomId: room.id }));
      expect(res.status).toBe(200);
      expect(livekit.deleteRoom.mock.calls.map((call) => call[0]).sort()).toEqual(groups.map((g) => g.livekit_room).sort());
      expect((await admin.from("room_breakouts").select("status").eq("id", breakoutId).single()).data!.status).toBe("ended");

      const again = await hostRoute(json("/api/livekit/host", { action: "end_breakout", roomId: room.id }));
      expect(again.status).toBe(404);
      expect(await again.json()).toEqual({ error: "no_breakout" });
    });

    it("cerrar la sala corta también el audio de los grupos", async () => {
      const { room, groups } = await withBreakout();
      as(ana);
      expect((await hostRoute(json("/api/livekit/host", { action: "close", roomId: room.id }))).status).toBe(200);
      const deleted = livekit.deleteRoom.mock.calls.map((call) => call[0]);
      for (const group of groups) expect(deleted).toContain(group.livekit_room);
      expect(deleted).toContain(room.id);
    });

    it("expulsar a alguien lo saca también de las salas de los grupos", async () => {
      const { room, groups } = await withBreakout();
      as(ana);
      const res = await hostRoute(json("/api/livekit/host", { action: "remove", roomId: room.id, identity: beto.userId }));
      expect(res.status).toBe(200);
      const removedFrom = livekit.removeParticipant.mock.calls.filter((call) => call[1] === beto.userId).map((call) => call[0]);
      for (const group of groups) expect(removedFrom).toContain(group.livekit_room);
      expect(removedFrom).toContain(room.id);
      // Y ya no recibe token de ningún grupo
      as(beto);
      expect((await token(json("/api/livekit/token", { roomId: room.id, groupId: groups[0]!.id }))).status).toBe(403);
    });
  });

  describe("cierre por tiempo y uso", () => {
    it("el servidor cierra los repartos vencidos y corta sus salas aunque nadie lo haga", async () => {
      const { groups, breakoutId } = await withBreakout();
      await admin.from("room_breakouts").update({ ends_at: iso(Date.now() - MIN) }).eq("id", breakoutId);

      const res = await enforce(new Request(`${HOST}/api/billing/enforce`, { method: "POST", headers: { "x-enforcer-secret": "secreto-del-enforcer-de-prueba" } }));
      expect(res.status).toBe(200);
      expect(((await res.json()) as { breakouts: number }).breakouts).toBeGreaterThanOrEqual(2);
      const deleted = livekit.deleteRoom.mock.calls.map((call) => call[0]);
      for (const group of groups) expect(deleted).toContain(group.livekit_room);
      expect((await admin.from("room_breakouts").select("status").eq("id", breakoutId).single()).data!.status).toBe("ended");
    });

    it("el webhook de LiveKit suma los minutos de un grupo a la sala principal de la comunidad", async () => {
      const { communityId, groups } = await withBreakout();
      const now = Math.floor(Date.now() / 1000);
      const raw = JSON.stringify({ event: "participant_left", id: `EV_${crypto.randomUUID()}`, createdAt: String(now), room: { name: groups[0]!.livekit_room }, participant: { identity: beto.userId, joinedAt: String(now - 5 * 60) } });
      const jwt = new AccessToken(LK.key, LK.secret);
      jwt.sha256 = createHash("sha256").update(raw).digest("base64");
      const res = await lkWebhook(new Request(`${HOST}/api/livekit/webhook`, { method: "POST", headers: { authorization: await jwt.toJwt() }, body: raw }));
      expect(await res.json()).toEqual({ recorded: true });

      const period = new Date().toISOString().slice(0, 7) + "-01";
      expect((await admin.from("usage_periods").select("person_minutes").eq("community_id", communityId).eq("period", period).single()).data!.person_minutes).toBe(5);

      // Un grupo que no existe no suma nada
      const other = JSON.stringify({ event: "participant_left", id: `EV_${crypto.randomUUID()}`, createdAt: String(now), room: { name: "bg-no-existe" }, participant: { identity: beto.userId, joinedAt: String(now - 60) } });
      const jwt2 = new AccessToken(LK.key, LK.secret);
      jwt2.sha256 = createHash("sha256").update(other).digest("base64");
      expect(await (await lkWebhook(new Request(`${HOST}/api/livekit/webhook`, { method: "POST", headers: { authorization: await jwt2.toJwt() }, body: other }))).json()).toEqual({ ignored: true });
    });
  });
});
