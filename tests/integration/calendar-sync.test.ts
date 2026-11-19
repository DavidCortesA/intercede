// @vitest-environment node
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { processCalendarJobs, disconnectGoogleCalendar, type SyncDeps } from "@/features/calendar/sync";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";
import { CALENDAR_SCOPE } from "@/lib/google/client";
import { adminClient, anonClient, createCookieSession, hasTestDb, signInTestUser, testEnv } from "./helpers";

// ───────────────────────── Google simulado ─────────────────────────

const session = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...session.jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void session.jar.set(name, value),
  }),
}));

interface GEvent {
  id: string;
  body: Record<string, unknown> & { summary?: string; extendedProperties?: { private?: Record<string, string> } };
}

/** Un Google de mentira: OAuth y Calendar en memoria, con fallos que se pueden inyectar. */
class FakeGoogle {
  calendars = new Map<string, Map<string, GEvent>>();
  calls: { method: string; url: string; body: unknown }[] = [];
  revoked: string[] = [];
  refreshFails = false;
  grantedScope = CALENDAR_SCOPE;
  returnRefreshToken = true;
  private failures: { test: (call: string) => boolean; status: number; body: unknown; times: number }[] = [];
  private n = 0;

  fail(test: RegExp, status: number, body: unknown = {}, times = 1) {
    this.failures.push({ test: (call) => test.test(call), status, body, times });
  }
  reset() {
    this.calendars.clear();
    this.calls = [];
    this.revoked = [];
    this.refreshFails = false;
    this.grantedScope = CALENDAR_SCOPE;
    this.returnRefreshToken = true;
    this.failures = [];
    this.n = 0;
  }
  count(match: RegExp) {
    return this.calls.filter((call) => match.test(`${call.method} ${call.url}`)).length;
  }
  events(calendarId?: string) {
    const id = calendarId ?? [...this.calendars.keys()][0];
    return id ? [...(this.calendars.get(id)?.values() ?? [])] : [];
  }

  handle = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    const rawBody = typeof init?.body === "string" ? init.body : "";
    const isForm = (init?.headers as Record<string, string> | undefined)?.["Content-Type"]?.includes("x-www-form-urlencoded");
    const body: unknown = isForm ? Object.fromEntries(new URLSearchParams(rawBody)) : rawBody ? JSON.parse(rawBody) : null;
    this.calls.push({ method, url, body });
    const call = `${method} ${url}`;
    const json = (status: number, payload: unknown) => new Response(status === 204 ? null : JSON.stringify(payload), { status });

    const failure = this.failures.find((f) => f.times > 0 && f.test(call));
    if (failure) {
      failure.times -= 1;
      return json(failure.status, failure.body);
    }

    if (url === "https://oauth2.googleapis.com/token") {
      const form = body as Record<string, string>;
      if (form.grant_type === "refresh_token") {
        return this.refreshFails ? json(400, { error: "invalid_grant" }) : json(200, { access_token: `acceso-${++this.n}`, expires_in: 3600 });
      }
      return json(200, { access_token: "acceso-inicial", ...(this.returnRefreshToken ? { refresh_token: "1//refresh-token-secreto" } : {}), scope: this.grantedScope, expires_in: 3600 });
    }
    if (url === "https://oauth2.googleapis.com/revoke") {
      this.revoked.push((body as Record<string, string>).token ?? "");
      return json(200, {});
    }

    const base = "https://www.googleapis.com/calendar/v3";
    if (method === "POST" && url === `${base}/calendars`) {
      const id = `cal-${++this.n}`;
      this.calendars.set(id, new Map());
      return json(200, { id, summary: (body as { summary: string }).summary });
    }
    // Un calendario por sí solo: existe o no existe (para distinguir "borró el evento" de "borró el calendario")
    const only = url.match(/^https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/([^/]+)$/);
    if (only && method === "GET") return this.calendars.has(decodeURIComponent(only[1]!)) ? json(200, { id: decodeURIComponent(only[1]!) }) : json(404, { error: { message: "Not Found" } });
    const match = url.match(/^https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^?]+))?(\?.*)?$/);
    if (!match) return json(404, {});
    const calendar = this.calendars.get(decodeURIComponent(match[1]!));
    if (!calendar) return json(404, { error: { message: "Not Found" } });
    const eventId = match[2] ? decodeURIComponent(match[2]) : null;

    if (method === "POST") {
      const id = `evt-${++this.n}`;
      calendar.set(id, { id, body: body as GEvent["body"] });
      return json(200, { id });
    }
    if (method === "GET" && !eventId) {
      const key = new URLSearchParams(match[3]).get("privateExtendedProperty")?.replace("intercede=", "");
      const items = [...calendar.values()].filter((e) => e.body.extendedProperties?.private?.intercede === key).map((e) => ({ id: e.id, status: "confirmed" }));
      return json(200, { items });
    }
    if (!eventId || !calendar.has(eventId)) return json(404, { error: { message: "Not Found" } });
    if (method === "PATCH") {
      calendar.get(eventId)!.body = { ...calendar.get(eventId)!.body, ...(body as GEvent["body"]) };
      return json(200, { id: eventId });
    }
    if (method === "DELETE") {
      calendar.delete(eventId);
      return json(204, null);
    }
    return json(400, {});
  };
}

const google = new FakeGoogle();
const KEY = randomBytes(32);
const realFetch = globalThis.fetch;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();

describe.skipIf(!hasTestDb)("Google Calendar nivel 2 (sincronización en un sentido)", () => {
  const admin = adminClient();
  const userIds: string[] = [];
  const communityIds: string[] = [];
  let ana: Awaited<ReturnType<typeof signInTestUser>>;
  let beto: Awaited<ReturnType<typeof signInTestUser>>;
  let deps: SyncDeps;

  beforeAll(async () => {
    [ana, beto] = await Promise.all([signInTestUser("Ana"), signInTestUser("Beto")]);
    userIds.push(ana.user.id, beto.user.id);
    deps = { admin, config: { clientId: "cliente", clientSecret: "secreto" }, siteUrl: "https://intercede.test", key: KEY };
  });

  beforeEach(async () => {
    google.reset();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return url.includes("googleapis.com") ? google.handle(url, init) : realFetch(input, init);
    });
    await admin.from("calendar_sync_jobs").delete().in("user_id", userIds);
    await admin.from("calendar_event_links").delete().in("user_id", userIds);
    await admin.from("calendar_connections").delete().in("user_id", userIds);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (communityIds.length) await admin.from("communities").delete().in("id", communityIds.splice(0));
    await admin.from("notifications").delete().in("user_id", userIds);
  });

  afterAll(async () => {
    await Promise.all(userIds.map((id) => admin.auth.admin.deleteUser(id)));
  });

  // ───────────────────────── Datos de apoyo ─────────────────────────

  async function connect(userId: string, over: Record<string, unknown> = {}) {
    const { error } = await admin.from("calendar_connections").upsert({
      user_id: userId,
      scope: CALENDAR_SCOPE,
      refresh_token_encrypted: encryptSecret("1//refresh-token-secreto", userId, KEY),
      calendar_id: null,
      status: "connected",
      sync_events: true,
      sync_schedules: true,
      ...over,
    });
    expect(error).toBeNull();
  }

  async function community() {
    const { data: id } = await ana.client.rpc("create_community", { p_name: "Iglesia", p_kind: "church" });
    communityIds.push(id!);
    const token = (await ana.client.rpc("get_community_invite", { p_community_id: id! })).data!;
    await beto.client.rpc("join_community", { p_token: token });
    return id!;
  }

  async function event(communityId: string, title = "Vigilia", startsInDays = 3) {
    const date = new Date(Date.now() + startsInDays * DAY).toISOString().slice(0, 10);
    const { data, error } = await ana.client.rpc("create_event", { p_community_id: communityId, p_title: title, p_description: "Una noche de oración", p_date: date, p_time: "20:00", p_timezone: "America/Mexico_City", p_duration_minutes: 120, p_opens_room: false, p_reminder_minutes: 30 });
    expect(error).toBeNull();
    return data!;
  }

  const jobs = async (userId: string) => (await admin.from("calendar_sync_jobs").select("*").eq("user_id", userId)).data ?? [];
  const links = async (userId: string) => (await admin.from("calendar_event_links").select("*").eq("user_id", userId)).data ?? [];
  const run = () => processCalendarJobs(deps);

  // ───────────────────────── Cola ─────────────────────────

  describe("qué pone en cola", () => {
    it("confirmar asistencia, cambiar la respuesta y cambiar el evento ponen en cola solo a quien tiene la conexión", async () => {
      const id = await community();
      const eventId = await event(id);
      await connect(beto.user.id);
      expect((await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "going" })).error).toBeNull();
      expect(await jobs(beto.user.id)).toMatchObject([{ source_type: "event", source_id: eventId, attempts: 0 }]);
      expect(await jobs(ana.user.id)).toEqual([]); // Ana no conectó nada

      // Muchos cambios seguidos = un solo trabajo
      await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "maybe" });
      await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "going" });
      expect(await jobs(beto.user.id)).toHaveLength(1);

      await admin.from("calendar_sync_jobs").delete().eq("user_id", beto.user.id);
      await admin.from("events").update({ title: "Vigilia de jóvenes" }).eq("id", eventId);
      expect(await jobs(beto.user.id)).toHaveLength(1);
    });

    it("sin conexión, con la conexión desconectada o con el tipo apagado no se encola nada", async () => {
      const id = await community();
      const eventId = await event(id);
      await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "going" });
      expect(await jobs(beto.user.id)).toEqual([]);

      await connect(beto.user.id, { status: "disconnected" });
      await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "maybe" });
      expect(await jobs(beto.user.id)).toEqual([]);

      await connect(beto.user.id, { sync_events: false });
      await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "going" });
      expect(await jobs(beto.user.id)).toEqual([]);
    });

    it("seguir una sala programada, cambiarla o pausarla pone en cola a quienes la siguen", async () => {
      const id = await community();
      await connect(ana.user.id);
      const date = new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10);
      const { data: scheduleId } = await ana.client.rpc("create_schedule", { p_name: "Oración diaria", p_recurrence: "daily", p_local_time: "06:00", p_start_date: date, p_weekdays: [], p_timezone: "America/Mexico_City", p_community_id: id });
      expect(await jobs(ana.user.id)).toMatchObject([{ source_type: "schedule", source_id: scheduleId }]);
      await admin.from("calendar_sync_jobs").delete().eq("user_id", ana.user.id);
      await ana.client.rpc("set_schedule_active", { p_schedule_id: scheduleId!, p_active: false });
      expect(await jobs(ana.user.id)).toHaveLength(1);
    });
  });

  // ───────────────────────── Sincronizar ─────────────────────────

  describe("sincronizar con Google", () => {
    it("crea el calendario INTERCEDE y el evento (con enlace, recordatorio y propiedad privada); un cambio lo actualiza", async () => {
      const id = await community();
      const eventId = await event(id, "Vigilia");
      await connect(beto.user.id);
      await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "going" });

      expect(await run()).toMatchObject({ processed: 1, retried: 0, disconnected: 0 });
      expect(google.calendars.size).toBe(1);
      expect(google.calls.find((c) => c.url.endsWith("/calendars"))!.body).toMatchObject({ summary: "INTERCEDE" });
      const [created] = google.events();
      expect(created!.body).toMatchObject({
        summary: "Vigilia",
        reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 10 }] },
        extendedProperties: { private: { intercede: `event:${eventId}` } },
      });
      expect(String(created!.body.description)).toContain(`https://intercede.test/es/comunidades/${id}/eventos`);
      expect(await links(beto.user.id)).toMatchObject([{ source_type: "event", source_id: eventId, google_event_id: created!.id, status: "active" }]);
      expect(await jobs(beto.user.id)).toEqual([]);
      expect((await admin.from("calendar_connections").select("calendar_id").eq("user_id", beto.user.id).single()).data!.calendar_id).toBe([...google.calendars.keys()][0]);

      // Cambiar la fecha o el título lo ACTUALIZA (no duplica)
      await admin.from("events").update({ title: "Vigilia de jóvenes" }).eq("id", eventId);
      await run();
      expect(google.events()).toHaveLength(1);
      expect(google.events()[0]!.body.summary).toBe("Vigilia de jóvenes");
      expect(google.count(/^POST .*\/events$/)).toBe(1);
    });

    it("cancelar la asistencia (o borrar el evento) lo elimina de Google y quita el vínculo", async () => {
      const id = await community();
      const eventId = await event(id);
      await connect(beto.user.id);
      await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "going" });
      await run();
      expect(google.events()).toHaveLength(1);

      await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "no" });
      await run();
      expect(google.events()).toHaveLength(0);
      expect(await links(beto.user.id)).toEqual([]);

      // Volver a confirmar lo crea de nuevo; borrar el evento en INTERCEDE también lo quita
      await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "maybe" });
      await run();
      expect(google.events()).toHaveLength(1);
      await ana.client.from("events").delete().eq("id", eventId);
      await run();
      expect(google.events()).toHaveLength(0);
      expect(await links(beto.user.id)).toEqual([]);
    });

    it("si la persona borra el evento en Google NO se vuelve a crear, aunque el evento cambie", async () => {
      const id = await community();
      const eventId = await event(id);
      await connect(beto.user.id);
      await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "going" });
      await run();
      const calendar = [...google.calendars.values()][0]!;
      calendar.clear(); // la persona lo borró a mano en Google

      await admin.from("events").update({ title: "Otro título" }).eq("id", eventId);
      await run();
      expect(await links(beto.user.id)).toMatchObject([{ status: "user_deleted" }]);
      expect(google.events()).toHaveLength(0);

      await admin.from("events").update({ title: "Y otro más" }).eq("id", eventId);
      await run();
      expect(google.events()).toHaveLength(0);
      expect(google.count(/^POST .*\/events$/)).toBe(1); // solo la creación original

      // Si cancela la asistencia y la vuelve a confirmar, se entiende que lo quiere de nuevo
      await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "no" });
      await run();
      expect(await links(beto.user.id)).toEqual([]);
      await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "going" });
      await run();
      expect(google.events()).toHaveLength(1);
    });

    it("si la persona borra el calendario INTERCEDE completo, se crea de nuevo una vez y se reintenta", async () => {
      const id = await community();
      const eventId = await event(id);
      await connect(beto.user.id);
      await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "going" });
      await run();
      const first = [...google.calendars.keys()][0]!;
      google.calendars.delete(first);

      await admin.from("events").update({ title: "Cambió" }).eq("id", eventId);
      expect(await run()).toMatchObject({ processed: 1, disconnected: 0 });
      const second = [...google.calendars.keys()][0]!;
      expect(second).not.toBe(first);
      expect(google.events(second)).toHaveLength(1);
      expect((await admin.from("calendar_connections").select("calendar_id").eq("user_id", beto.user.id).single()).data!.calendar_id).toBe(second);
    });

    it("es idempotente: si un intento anterior sí creó el evento pero no se confirmó, se reutiliza en vez de duplicar", async () => {
      const id = await community();
      const eventId = await event(id);
      await connect(beto.user.id);
      await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "going" });
      await run();
      // Se pierde el vínculo (como si el guardado hubiera fallado) pero el evento sigue en Google
      await admin.from("calendar_event_links").delete().eq("user_id", beto.user.id);
      await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "maybe" });
      await run();
      expect(google.events()).toHaveLength(1);
      expect(google.count(/^POST .*\/events$/)).toBe(1);
      expect(await links(beto.user.id)).toHaveLength(1);
    });

    it("una sala programada diaria se crea con su repetición, hora de pared y zona; pausarla la quita", async () => {
      const id = await community();
      await connect(ana.user.id);
      const date = new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10);
      const { data: scheduleId } = await ana.client.rpc("create_schedule", { p_name: "Oración diaria", p_recurrence: "daily", p_local_time: "06:00", p_start_date: date, p_weekdays: [], p_timezone: "America/Mexico_City", p_community_id: id });
      await run();
      expect(google.events()).toHaveLength(1);
      expect(google.events()[0]!.body).toMatchObject({
        summary: "Oración diaria",
        recurrence: ["RRULE:FREQ=DAILY"],
        start: { timeZone: "America/Mexico_City", dateTime: expect.stringMatching(/T06:00:00$/) },
        extendedProperties: { private: { intercede: `schedule:${scheduleId}` } },
      });

      await ana.client.rpc("set_schedule_active", { p_schedule_id: scheduleId!, p_active: false });
      await run();
      expect(google.events()).toHaveLength(0);
      await ana.client.rpc("set_schedule_active", { p_schedule_id: scheduleId!, p_active: true });
      await run();
      expect(google.events()).toHaveLength(1);
    });
  });

  // ───────────────────────── Fallos ─────────────────────────

  describe("cuando algo falla", () => {
    it("si la persona revocó el permiso: se desconecta, se descarta la cola, se le avisa y no se vuelve a encolar", async () => {
      const id = await community();
      const eventId = await event(id);
      const second = await event(id, "Retiro", 5);
      await connect(beto.user.id);
      await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "going" });
      await beto.client.rpc("set_rsvp", { p_event_id: second, p_status: "going" });
      google.refreshFails = true;

      expect(await run()).toMatchObject({ disconnected: 1 });
      expect((await admin.from("calendar_connections").select("status, last_error").eq("user_id", beto.user.id).single()).data).toMatchObject({ status: "disconnected" });
      expect(await jobs(beto.user.id)).toEqual([]);
      const note = (await admin.from("notifications").select("kind, url").eq("user_id", beto.user.id).eq("kind", "calendar_disconnected")).data!;
      expect(note).toEqual([{ kind: "calendar_disconnected", url: "/perfil" }]);

      await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "maybe" });
      expect(await jobs(beto.user.id)).toEqual([]);
    });

    it("límite de uso o error de Google: se reintenta más tarde con espera creciente; el resto de esa persona espera", async () => {
      const id = await community();
      const a = await event(id, "Uno");
      const b = await event(id, "Dos", 4);
      await connect(beto.user.id, { calendar_id: "cal-previo" });
      google.calendars.set("cal-previo", new Map());
      await beto.client.rpc("set_rsvp", { p_event_id: a, p_status: "going" });
      await beto.client.rpc("set_rsvp", { p_event_id: b, p_status: "going" });
      google.fail(/^POST .*\/events$/, 429, { error: { errors: [{ reason: "rateLimitExceeded" }] } }, 1);

      const result = await run();
      expect(result.retried).toBeGreaterThanOrEqual(1);
      const pending = await jobs(beto.user.id);
      expect(pending).toHaveLength(2); // ninguno se perdió
      expect(pending.every((job) => new Date(job.run_after).getTime() > Date.now())).toBe(true);
      expect(pending.some((job) => job.attempts === 1)).toBe(true);
      expect(google.events("cal-previo")).toHaveLength(0);

      // Pasada la espera todo se completa
      await admin.from("calendar_sync_jobs").update({ run_after: iso(Date.now() - 1000) }).eq("user_id", beto.user.id);
      await run();
      expect(google.events("cal-previo")).toHaveLength(2);
    });

    it("un error de Google (500) se reintenta y tras 6 intentos se descarta con su error", async () => {
      const id = await community();
      const eventId = await event(id);
      await connect(beto.user.id, { calendar_id: "cal-previo" });
      google.calendars.set("cal-previo", new Map());
      await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "going" });
      google.fail(/^POST .*\/events$/, 503, {}, 99);

      await run();
      expect((await jobs(beto.user.id))[0]).toMatchObject({ attempts: 1, last_error: expect.stringContaining("503") });
      await admin.from("calendar_sync_jobs").update({ run_after: iso(Date.now() - 1000), attempts: 5 }).eq("user_id", beto.user.id);
      await run();
      expect(await jobs(beto.user.id)).toEqual([]); // descartado tras el sexto intento
    });

    it("un error que reintentar no arregla (400) se descarta y queda anotado en la conexión", async () => {
      const id = await community();
      const eventId = await event(id);
      await connect(beto.user.id, { calendar_id: "cal-previo" });
      google.calendars.set("cal-previo", new Map());
      await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "going" });
      google.fail(/^POST .*\/events$/, 400, { error: { message: "mal" } }, 1);

      expect(await run()).toMatchObject({ dropped: 1 });
      expect(await jobs(beto.user.id)).toEqual([]);
      expect((await admin.from("calendar_connections").select("last_error, status").eq("user_id", beto.user.id).single()).data).toMatchObject({ status: "connected", last_error: expect.stringContaining("400") });
    });

    it("dos procesos a la vez no toman el mismo trabajo", async () => {
      const id = await community();
      await connect(beto.user.id);
      for (let i = 0; i < 6; i++) {
        const eventId = await event(id, `Evento ${i}`, 3 + i);
        await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "going" });
      }
      const [first, second] = await Promise.all([admin.rpc("claim_calendar_jobs", { p_limit: 4 }), admin.rpc("claim_calendar_jobs", { p_limit: 4 })]);
      const ids = [...(first.data ?? []), ...(second.data ?? [])].map((job) => job.id);
      expect(ids.length).toBe(6);
      expect(new Set(ids).size).toBe(6);
      expect((await admin.rpc("claim_calendar_jobs", { p_limit: 10 })).data ?? []).toEqual([]); // ya están reservados
    });
  });

  // ───────────────────────── Preferencias y desconexión ─────────────────────────

  describe("preferencias y desconectar", () => {
    it("apagar un tipo borra sus eventos de Google; encenderlo vuelve a sincronizar; sin conexión no se puede", async () => {
      const id = await community();
      const eventId = await event(id);
      expect((await beto.client.rpc("set_calendar_preferences", { p_sync_events: false, p_sync_schedules: true })).error?.message).toBe("not_connected");

      await connect(beto.user.id);
      await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "going" });
      await run();
      expect(google.events()).toHaveLength(1);

      expect((await beto.client.rpc("set_calendar_preferences", { p_sync_events: false, p_sync_schedules: true })).error).toBeNull();
      await run();
      expect(google.events()).toHaveLength(0);
      expect(await links(beto.user.id)).toEqual([]);

      expect((await beto.client.rpc("set_calendar_preferences", { p_sync_events: true, p_sync_schedules: true })).error).toBeNull();
      await run();
      expect(google.events()).toHaveLength(1);
    });

    it("desconectar revoca el permiso en Google y borra la conexión, los vínculos y la cola (también si ya no hay nada)", async () => {
      const id = await community();
      const eventId = await event(id);
      await connect(beto.user.id);
      await beto.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "going" });
      await run();

      await disconnectGoogleCalendar(deps, beto.user.id);
      expect(google.revoked).toEqual(["1//refresh-token-secreto"]);
      expect((await admin.from("calendar_connections").select("user_id").eq("user_id", beto.user.id)).data).toEqual([]);
      expect(await links(beto.user.id)).toEqual([]);
      expect(await jobs(beto.user.id)).toEqual([]);
      await expect(disconnectGoogleCalendar(deps, beto.user.id)).resolves.toBeUndefined();
    });
  });

  // ───────────────────────── Seguridad ─────────────────────────

  describe("seguridad", () => {
    it("el token se guarda CIFRADO y atado a la persona; nadie lo lee por la API, solo el estado", async () => {
      await connect(beto.user.id, { calendar_id: "cal-1" });
      const stored = (await admin.from("calendar_connections").select("refresh_token_encrypted").eq("user_id", beto.user.id).single()).data!.refresh_token_encrypted;
      expect(stored).not.toContain("1//refresh-token-secreto");
      expect(decryptSecret(stored, beto.user.id, KEY)).toBe("1//refresh-token-secreto");
      expect(() => decryptSecret(stored, ana.user.id, KEY)).toThrow(); // copiarlo a otra fila no sirve

      // La persona ve el estado de su conexión, nunca el token
      expect((await beto.client.from("calendar_connections").select("refresh_token_encrypted")).error?.code).toBe("42501");
      expect((await beto.client.from("calendar_connections").select("*")).error?.code).toBe("42501");
      const status = (await beto.client.from("calendar_connections").select("status, sync_events, sync_schedules, scope")).data!;
      expect(status).toEqual([{ status: "connected", sync_events: true, sync_schedules: true, scope: CALENDAR_SCOPE }]);
      // Ni otra persona ni sin sesión
      expect((await ana.client.from("calendar_connections").select("status")).data).toEqual([]);
      expect((await anonClient().from("calendar_connections").select("status")).error).not.toBeNull();
    });

    it("nadie escribe la conexión, los vínculos ni la cola; las funciones del servidor son solo del servidor", async () => {
      await connect(beto.user.id);
      expect((await beto.client.from("calendar_connections").update({ sync_events: false }).eq("user_id", beto.user.id)).error?.code).toBe("42501");
      expect((await beto.client.from("calendar_connections").insert({ user_id: beto.user.id, scope: "x", refresh_token_encrypted: "x" })).error?.code).toBe("42501");
      expect((await beto.client.from("calendar_event_links").select("*")).data).toEqual([]);
      expect((await beto.client.from("calendar_sync_jobs").select("*")).data).toEqual([]);
      for (const client of [beto.client, anonClient()]) {
        expect((await client.rpc("claim_calendar_jobs", { p_limit: 5 })).error?.code).toBe("42501");
        expect((await client.rpc("finish_calendar_job", { p_id: crypto.randomUUID() })).error?.code).toBe("42501");
        expect((await client.rpc("calendar_backfill", { p_user_id: beto.user.id })).error?.code).toBe("42501");
        expect((await client.rpc("enqueue_calendar_sync", { p_user_id: beto.user.id, p_type: "event", p_source_id: crypto.randomUUID() })).error?.code).toBe("42501");
      }
    });

    it("borrar la cuenta borra la conexión (y con ella el token)", async () => {
      const temp = await signInTestUser("Temporal");
      await connect(temp.user.id);
      await admin.auth.admin.deleteUser(temp.user.id);
      expect((await admin.from("calendar_connections").select("user_id").eq("user_id", temp.user.id)).data).toEqual([]);
    });
  });

  // ───────────────────────── Rutas ─────────────────────────

  describe("rutas de autorización y cola", () => {
    const HOST = "https://intercede.test";
    let ana2: Awaited<ReturnType<typeof createCookieSession>>;
    let connectGet: () => Promise<Response>;
    let callbackGet: (request: Request) => Promise<Response>;
    let syncPost: (request: Request) => Promise<Response>;
    let disconnectPost: (request: Request) => Promise<Response>;

    beforeAll(async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = testEnv.url;
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = testEnv.publishableKey;
      process.env.SUPABASE_SERVICE_ROLE_KEY = testEnv.serviceRoleKey;
      process.env.NEXT_PUBLIC_SITE_URL = HOST;
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = "cliente";
      process.env.GOOGLE_CLIENT_SECRET = "secreto";
      process.env.CALENDAR_ENCRYPTION_KEY = KEY.toString("base64");
      process.env.CALENDAR_SYNC_SECRET = "secreto-de-la-cola-de-prueba";
      ana2 = await createCookieSession("Ana2");
      userIds.push(ana2.userId);
      connectGet = (await import("@/app/api/calendar/google/connect/route")).GET;
      callbackGet = (await import("@/app/api/calendar/google/callback/route")).GET;
      syncPost = (await import("@/app/api/calendar/sync/route")).POST;
      disconnectPost = (await import("@/app/api/calendar/google/disconnect/route")).POST;
    });

    const as = (who: { jar: Map<string, string> } | null) => {
      session.jar = who ? new Map(who.jar) : new Map();
    };
    const callback = (query: string, state: string | null) =>
      callbackGet(new Request(`${HOST}/api/calendar/google/callback?${query}`, { headers: state ? { cookie: `gcal_state=${state}` } : {} }));

    it("conectar: sin sesión va a entrar; con sesión redirige a Google con SOLO el permiso acotado y deja el state en una cookie", async () => {
      as(null);
      expect((await connectGet()).headers.get("location")).toContain("/es/entrar");

      as(ana2);
      const res = await connectGet();
      const location = new URL(res.headers.get("location")!);
      expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
      expect(location.searchParams.get("scope")).toBe(CALENDAR_SCOPE);
      expect(location.searchParams.get("redirect_uri")).toBe(`${HOST}/api/calendar/google/callback`);
      const cookie = res.headers.get("set-cookie")!;
      expect(cookie).toMatch(/gcal_state=[A-Za-z0-9_-]{40,}/);
      expect(cookie.toLowerCase()).toContain("httponly");
      expect(cookie).toContain(`gcal_state=${location.searchParams.get("state")}`);
    });

    it("el regreso exige el mismo state; rechaza cancelación, falta de token y permisos de más (y los revoca)", async () => {
      as(ana2);
      expect((await callback("code=abc&state=uno", "otro")).headers.get("location")).toContain("calendario=error");
      expect((await callback("code=abc&state=uno", null)).headers.get("location")).toContain("calendario=error");
      expect((await callback("error=access_denied&state=uno", "uno")).headers.get("location")).toContain("calendario=cancelado");
      expect((await callback("state=uno", "uno")).headers.get("location")).toContain("calendario=error");

      google.returnRefreshToken = false;
      expect((await callback("code=abc&state=uno", "uno")).headers.get("location")).toContain("calendario=sin_token");

      google.returnRefreshToken = true;
      google.grantedScope = `${CALENDAR_SCOPE} https://www.googleapis.com/auth/calendar`;
      expect((await callback("code=abc&state=uno", "uno")).headers.get("location")).toContain("calendario=permiso");
      expect(google.revoked).toEqual(["1//refresh-token-secreto"]);
      expect((await admin.from("calendar_connections").select("user_id").eq("user_id", ana2.userId)).data).toEqual([]);

      google.grantedScope = "openid email";
      expect((await callback("code=abc&state=uno", "uno")).headers.get("location")).toContain("calendario=permiso");
    });

    it("el regreso correcto guarda el token cifrado, crea el calendario INTERCEDE y pone en cola lo que ya le corresponde", async () => {
      const id = await community();
      const eventId = await event(id);
      // Ana2 es de la comunidad y ya había confirmado asistencia antes de conectar
      const token = (await ana.client.rpc("get_community_invite", { p_community_id: id })).data!;
      await ana2.client.rpc("join_community", { p_token: token });
      await ana2.client.rpc("set_rsvp", { p_event_id: eventId, p_status: "going" });
      expect(await jobs(ana2.userId)).toEqual([]);

      as(ana2);
      expect((await callback("code=abc&state=bueno", "bueno")).headers.get("location")).toContain("calendario=ok");
      const stored = (await admin.from("calendar_connections").select("*").eq("user_id", ana2.userId).single()).data!;
      expect(stored).toMatchObject({ scope: CALENDAR_SCOPE, status: "connected", sync_events: true });
      expect(stored.refresh_token_encrypted).not.toContain("1//refresh-token-secreto");
      expect(decryptSecret(stored.refresh_token_encrypted, ana2.userId, KEY)).toBe("1//refresh-token-secreto");
      expect(stored.calendar_id).toBe([...google.calendars.keys()][0]);
      expect(await jobs(ana2.userId)).toMatchObject([{ source_type: "event", source_id: eventId }]);

      // La cola se procesa por la ruta con el secreto compartido
      const unauthorized = await syncPost(new Request(`${HOST}/api/calendar/sync`, { method: "POST" }));
      expect(unauthorized.status).toBe(401);
      expect((await syncPost(new Request(`${HOST}/api/calendar/sync`, { method: "POST", headers: { "x-calendar-secret": "otro" } }))).status).toBe(401);
      const ok = await syncPost(new Request(`${HOST}/api/calendar/sync`, { method: "POST", headers: { "x-calendar-secret": "secreto-de-la-cola-de-prueba" } }));
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ processed: 1 });
      expect(google.events()).toHaveLength(1);
    });

    it("desconectar desde la ruta revoca el permiso y borra todo; exige sesión y mismo origen", async () => {
      await connect(ana2.userId);
      const request = (headers: Record<string, string> = {}) =>
        new Request(`${HOST}/api/calendar/google/disconnect`, { method: "POST", headers: { "content-type": "application/json", origin: HOST, "x-forwarded-host": "intercede.test", ...headers }, body: "{}" });

      as(null);
      expect((await disconnectPost(request())).status).toBe(401);
      as(ana2);
      expect((await disconnectPost(request({ origin: "https://malo.example" }))).status).toBe(403);
      expect((await disconnectPost(request())).status).toBe(200);
      expect(google.revoked).toEqual(["1//refresh-token-secreto"]);
      expect((await admin.from("calendar_connections").select("user_id").eq("user_id", ana2.userId)).data).toEqual([]);
    });
  });
});
