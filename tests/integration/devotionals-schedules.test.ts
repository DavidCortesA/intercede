// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminClient, anonClient, hasTestDb, signInGuest, signInTestUser } from "./helpers";

type Person = Awaited<ReturnType<typeof signInTestUser>>;

const errorOf = (res: { error: { message: string } | null }) => res.error?.message;
const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function devotionalRow(date: string, extra: Record<string, string> = {}) {
  return {
    devotional_date: date,
    passage_reference: "Texto de prueba 1:1",
    passage_text: "Texto de prueba para las pruebas automatizadas.",
    bible_version: "Prueba",
    reflection: "Reflexión de prueba.",
    question: "¿Pregunta de prueba?",
    ...extra,
  };
}

describe.skipIf(!hasTestDb)("devocionales, programación y avisos", () => {
  const admin = adminClient();
  const userIds: string[] = [];
  let ana: Person;
  let beto: Person;
  let carla: Person;

  beforeAll(async () => {
    [ana, beto, carla] = await Promise.all([signInTestUser("Ana"), signInTestUser("Beto"), signInTestUser("Carla")]);
    userIds.push(ana.user.id, beto.user.id, carla.user.id);
    await admin.from("devotionals").delete().not("id", "is", null);
  });

  afterAll(async () => {
    await admin.from("devotionals").delete().not("id", "is", null);
    await Promise.all(userIds.map((id) => admin.auth.admin.deleteUser(id)));
  });

  // ───────────────────────── Devocionales ─────────────────────────

  describe("devocionales y progreso", () => {
    beforeEach(async () => {
      await admin.from("devotionals").delete().not("id", "is", null);
    });

    it("cualquier sesión lee los publicados; los futuros no; nadie escribe desde el cliente", async () => {
      const today = isoDay(Date.now());
      const future = isoDay(Date.now() + 5 * DAY);
      await admin.from("devotionals").insert([devotionalRow(today), devotionalRow(future)]);

      const guest = await signInGuest("Invitada");
      userIds.push(guest.user.id);

      for (const reader of [ana.client, guest.client]) {
        const { data } = await reader.from("devotionals").select("devotional_date");
        expect(data?.map((d) => d.devotional_date)).toEqual([today]);
      }

      const insert = await ana.client.from("devotionals").insert(devotionalRow(isoDay(Date.now() - DAY)));
      expect(insert.error?.code).toBe("42501");
    });

    it("hay un solo devocional general por día", async () => {
      const today = isoDay(Date.now());
      expect((await admin.from("devotionals").insert(devotionalRow(today))).error).toBeNull();
      expect((await admin.from("devotionals").insert(devotionalRow(today))).error?.code).toBe("23505");
    });

    it("una cuenta marca como leído y guarda notas; es privado y los invitados quedan fuera", async () => {
      const { data: dev } = await admin.from("devotionals").insert(devotionalRow(isoDay(Date.now()))).select().single();
      const id = dev!.id;

      const read = await ana.client
        .from("devotional_progress")
        .insert({ devotional_id: id, read_at: new Date().toISOString(), note: "Una nota" })
        .select()
        .single();
      expect(read.error).toBeNull();
      expect(read.data?.user_id).toBe(ana.user.id);

      // La hora de lectura se queda en la primera; editar la nota no la mueve
      const upd = await ana.client
        .from("devotional_progress")
        .update({ read_at: new Date(Date.now() + 3_600_000).toISOString(), note: "Otra nota" })
        .eq("devotional_id", id)
        .select()
        .single();
      expect(upd.data?.read_at).toBe(read.data?.read_at);
      expect(upd.data?.note).toBe("Otra nota");

      expect((await beto.client.from("devotional_progress").select("*").eq("devotional_id", id)).data).toEqual([]);
      // Beto no puede tocar el de Ana (ni siquiera sabiendo su user_id)
      expect((await beto.client.from("devotional_progress").insert({ devotional_id: id, user_id: ana.user.id } as never)).error?.code).toBe("42501");

      const guest = await signInGuest("Invitado");
      userIds.push(guest.user.id);
      expect((await guest.client.from("devotional_progress").insert({ devotional_id: id, read_at: new Date().toISOString() })).error?.code).toBe("42501");
    });

    it("rechaza notas vacías o enormes y devocionales que no existen", async () => {
      const { data: dev } = await admin.from("devotionals").insert(devotionalRow(isoDay(Date.now()))).select().single();
      expect((await beto.client.from("devotional_progress").insert({ devotional_id: dev!.id, note: "   " })).error?.code).toBe("23514");
      expect((await beto.client.from("devotional_progress").insert({ devotional_id: dev!.id, note: "x".repeat(2001) })).error?.code).toBe("23514");
      expect((await beto.client.from("devotional_progress").insert({ devotional_id: crypto.randomUUID(), read_at: new Date().toISOString() })).error).not.toBeNull();
    });

    it("la racha cuenta días seguidos; hoy sin leer no la rompe y un día sin leer sí", async () => {
      const now = Date.now();
      const rows = [0, 1, 2, 3, 4].map((n) => devotionalRow(isoDay(now - n * DAY)));
      const { data: devs } = await admin.from("devotionals").insert(rows).select();
      const byDate = new Map(devs!.map((d) => [d.devotional_date, d.id]));
      const dayId = (n: number) => byDate.get(isoDay(now - n * DAY))!;

      const person = await signInTestUser("Racha");
      userIds.push(person.user.id);
      const markRead = (n: number) =>
        person.client.from("devotional_progress").insert({ devotional_id: dayId(n), read_at: new Date().toISOString() });

      // Leyó ayer, antepasado y hace 4 días (no hace 3): la racha vigente es de 2
      for (const n of [1, 2, 4]) expect((await markRead(n)).error).toBeNull();
      let stats = (await person.client.rpc("devotional_stats")).data?.[0];
      expect(stats).toMatchObject({ streak: 2, total_read: 3, read_today: false });

      expect((await markRead(0)).error).toBeNull();
      stats = (await person.client.rpc("devotional_stats")).data?.[0];
      expect(stats).toMatchObject({ streak: 3, total_read: 4, read_today: true });

      expect((await markRead(3)).error).toBeNull();
      stats = (await person.client.rpc("devotional_stats")).data?.[0];
      expect(stats).toMatchObject({ streak: 5, total_read: 5, read_today: true });
    });

    it("una nota sin marcar como leído no cuenta para la racha", async () => {
      const { data: dev } = await admin.from("devotionals").insert(devotionalRow(isoDay(Date.now()))).select().single();
      const person = await signInTestUser("Solo nota");
      userIds.push(person.user.id);
      await person.client.from("devotional_progress").insert({ devotional_id: dev!.id, note: "Aún no lo leo" });
      const stats = (await person.client.rpc("devotional_stats")).data?.[0];
      expect(stats).toMatchObject({ streak: 0, total_read: 0, read_today: false });
    });
  });

  // ───────────────────────── Preferencias y push ─────────────────────────

  describe("preferencias de avisos y suscripciones push", () => {
    it("cada cuenta ve y edita solo sus preferencias; los invitados no las crean", async () => {
      const { data, error } = await ana.client.from("notification_preferences").insert({}).select().single();
      expect(error).toBeNull();
      expect(data).toMatchObject({ push_enabled: true, email_enabled: false, schedule_reminders: true, devotional_reminder: false });

      expect((await ana.client.from("notification_preferences").update({ email_enabled: true, devotional_reminder_time: "06:30" }).eq("user_id", ana.user.id).select().single()).data).toMatchObject({
        email_enabled: true,
        devotional_reminder_time: "06:30:00",
      });

      // Beto no ve ni cambia las de Ana
      expect((await beto.client.from("notification_preferences").select("*")).data).toEqual([]);
      const hijack = await beto.client.from("notification_preferences").update({ push_enabled: false }).eq("user_id", ana.user.id).select();
      expect(hijack.data).toEqual([]);
      expect((await beto.client.from("notification_preferences").insert({ user_id: ana.user.id })).error?.code).toBe("42501");

      const guest = await signInGuest("Invitado");
      userIds.push(guest.user.id);
      expect((await guest.client.from("notification_preferences").insert({})).error?.code).toBe("42501");
    });

    it("registrar un dispositivo es solo para cuentas; el endpoint pasa de una cuenta a otra", async () => {
      const endpoint = `https://push.example.test/${crypto.randomUUID()}`;
      const args = { p_endpoint: endpoint, p_p256dh: "clave", p_auth: "secreto", p_user_agent: "Prueba" };

      const guest = await signInGuest("Invitado");
      userIds.push(guest.user.id);
      expect(errorOf(await guest.client.rpc("upsert_push_subscription", args))).toBe("account_required");

      expect((await ana.client.rpc("upsert_push_subscription", args)).error).toBeNull();
      expect((await ana.client.from("push_subscriptions").select("endpoint")).data?.map((r) => r.endpoint)).toContain(endpoint);

      // Registrarlo otra vez no duplica
      expect((await ana.client.rpc("upsert_push_subscription", args)).error).toBeNull();
      expect((await admin.from("push_subscriptions").select("id").eq("endpoint", endpoint)).data).toHaveLength(1);

      // Beto no la ve ni la borra; el mismo navegador entra con la cuenta de Beto y se reasigna
      expect((await beto.client.from("push_subscriptions").select("*").eq("endpoint", endpoint)).data).toEqual([]);
      await beto.client.from("push_subscriptions").delete().eq("endpoint", endpoint);
      expect((await admin.from("push_subscriptions").select("id").eq("endpoint", endpoint)).data).toHaveLength(1);

      expect((await beto.client.rpc("upsert_push_subscription", args)).error).toBeNull();
      expect((await ana.client.from("push_subscriptions").select("*").eq("endpoint", endpoint)).data).toEqual([]);
      expect((await beto.client.from("push_subscriptions").select("*").eq("endpoint", endpoint)).data).toHaveLength(1);

      // Nadie inserta directo, y quien la tiene puede quitarla
      expect((await beto.client.from("push_subscriptions").insert({ user_id: beto.user.id, endpoint: "https://x.test/1", p256dh: "a", auth: "b" })).error?.code).toBe("42501");
      await beto.client.from("push_subscriptions").delete().eq("endpoint", endpoint);
      expect((await admin.from("push_subscriptions").select("id").eq("endpoint", endpoint)).data).toEqual([]);
    });

    it("solo acepta servicios push de navegadores (nada de http ni servidores internos)", async () => {
      const subscribe = (p_endpoint: string) => ana.client.rpc("upsert_push_subscription", { p_endpoint, p_p256dh: "k", p_auth: "a" });
      for (const bad of [
        "http://fcm.googleapis.com/fcm/send/abc",
        "https://169.254.169.254/latest/meta-data/",
        "https://localhost:8080/push",
        "https://fcm.googleapis.com@evil.example.com/x",
        "https://evil.example.com/fcm.googleapis.com/",
        "https://fcm.googleapis.com.evil.example.com/x",
        "https://127.0.0.1/",
      ]) {
        expect(errorOf(await subscribe(bad)), bad).toBe("invalid_endpoint");
      }
      for (const good of [
        "https://fcm.googleapis.com/fcm/send/abc",
        "https://updates.push.services.mozilla.com/wpush/v2/abc",
        "https://web.push.apple.com/abc",
        "https://wns2-by3p.notify.windows.com/w/?token=abc",
      ]) {
        expect((await subscribe(good)).error, good).toBeNull();
      }
      await admin.from("push_subscriptions").delete().eq("user_id", ana.user.id);
      // La restricción también está en la tabla, no solo en la función
      expect((await admin.from("push_subscriptions").insert({ user_id: ana.user.id, endpoint: "https://169.254.169.254/", p256dh: "k", auth: "a" })).error?.code).toBe("23514");
    });

    it("limita a 10 dispositivos por cuenta", async () => {
      const person = await signInTestUser("Muchos");
      userIds.push(person.user.id);
      for (let i = 0; i < 10; i++) {
        const res = await person.client.rpc("upsert_push_subscription", { p_endpoint: `https://push.example.test/m-${i}-${crypto.randomUUID()}`, p_p256dh: "a", p_auth: "b" });
        expect(res.error).toBeNull();
      }
      expect(errorOf(await person.client.rpc("upsert_push_subscription", { p_endpoint: "https://push.example.test/otro", p_p256dh: "a", p_auth: "b" }))).toBe("too_many_devices");
    });
  });

  // ───────────────────────── Programación ─────────────────────────

  describe("cálculo de la próxima ocurrencia (zonas horarias y horario de verano)", () => {
    const next = async (args: { r: string; t: string; start: string; days?: number[]; tz: string; after: string }) =>
      (
        await ana.client.rpc("compute_next_occurrence", {
          p_recurrence: args.r,
          p_local_time: args.t,
          p_start_date: args.start,
          p_weekdays: args.days ?? [],
          p_timezone: args.tz,
          p_after: args.after,
        })
      ).data;

    it("diaria a las 6:00 de Nueva York conserva la hora local al entrar el horario de verano", async () => {
      // El horario de verano de EE. UU. empezó el 8 de marzo de 2026 (6:00 pasa de 11:00Z a 10:00Z)
      expect(await next({ r: "daily", t: "06:00", start: "2026-03-01", tz: "America/New_York", after: "2026-03-06T12:00:00Z" })).toBe("2026-03-07T11:00:00+00:00");
      expect(await next({ r: "daily", t: "06:00", start: "2026-03-01", tz: "America/New_York", after: "2026-03-07T12:00:00Z" })).toBe("2026-03-08T10:00:00+00:00");
    });

    it("semanal respeta los días elegidos (0 = domingo)", async () => {
      // 7 de marzo de 2026 es sábado; el lunes 9 ya está en horario de verano
      expect(await next({ r: "weekly", t: "06:00", start: "2026-03-01", days: [1], tz: "America/New_York", after: "2026-03-07T12:00:00Z" })).toBe("2026-03-09T10:00:00+00:00");
      expect(await next({ r: "weekly", t: "06:00", start: "2026-03-01", days: [0, 3], tz: "America/New_York", after: "2026-03-07T12:00:00Z" })).toBe("2026-03-08T10:00:00+00:00");
    });

    it("el día local, no el UTC, decide: 23:30 en Tokio ya es otro día en UTC", async () => {
      // 2026-06-01 23:30 en Tokio = 2026-06-01 14:30Z → la siguiente de las 23:30 locales es la del día siguiente
      expect(await next({ r: "daily", t: "23:30", start: "2026-06-01", tz: "Asia/Tokyo", after: "2026-06-01T14:31:00Z" })).toBe("2026-06-02T14:30:00+00:00");
    });

    it("una sola vez: la fecha futura vale; la pasada no", async () => {
      expect(await next({ r: "once", t: "18:00", start: "2026-12-24", tz: "America/Mexico_City", after: "2026-11-10T00:00:00Z" })).toBe("2026-12-25T00:00:00+00:00");
      expect(await next({ r: "once", t: "18:00", start: "2026-01-01", tz: "America/Mexico_City", after: "2026-11-10T00:00:00Z" })).toBeNull();
    });

    it("no empieza antes de la fecha de inicio", async () => {
      expect(await next({ r: "daily", t: "06:00", start: "2027-01-10", tz: "UTC", after: "2026-11-10T00:00:00Z" })).toBe("2027-01-10T06:00:00+00:00");
    });
  });

  describe("crear y administrar programaciones", () => {
    const tomorrow = () => isoDay(Date.now() + DAY);
    const base = () => ({
      p_name: "Oración de la mañana",
      p_recurrence: "daily",
      p_local_time: "06:00",
      p_start_date: tomorrow(),
      p_weekdays: [] as number[],
      p_timezone: "UTC",
      p_reminder_minutes: 10,
    });

    it("solo una cuenta crea; valida nombre, zona horaria, fecha y días de la semana", async () => {
      const guest = await signInGuest("Invitado");
      userIds.push(guest.user.id);
      expect(errorOf(await guest.client.rpc("create_schedule", base()))).toBe("account_required");

      expect(errorOf(await ana.client.rpc("create_schedule", { ...base(), p_name: "   " }))).toBe("invalid_name");
      expect(errorOf(await ana.client.rpc("create_schedule", { ...base(), p_timezone: "Marte/Olimpo" }))).toBe("invalid_timezone");
      expect(errorOf(await ana.client.rpc("create_schedule", { ...base(), p_recurrence: "once", p_start_date: "2020-01-01" }))).toBe("schedule_in_past");
      // Semanal sin días válidos da un error claro; diaria con días rompe la restricción de la tabla
      expect(errorOf(await ana.client.rpc("create_schedule", { ...base(), p_recurrence: "weekly" }))).toBe("invalid_weekdays");
      expect((await ana.client.rpc("create_schedule", { ...base(), p_weekdays: [1] })).error?.code).toBe("23514");
      expect(errorOf(await ana.client.rpc("create_schedule", { ...base(), p_recurrence: "weekly", p_weekdays: [7] }))).toBe("invalid_weekdays");
      expect((await ana.client.rpc("create_schedule", { ...base(), p_reminder_minutes: 7 })).error?.code).toBe("23514");
    });

    it("quien la crea queda suscrito y es el único que ve el enlace de invitación; nadie la escribe directo", async () => {
      const { data: id, error } = await ana.client.rpc("create_schedule", base());
      expect(error).toBeNull();

      const mine = await ana.client.from("room_schedules").select("*").eq("id", id!).single();
      expect(mine.data).toMatchObject({ owner_id: ana.user.id, is_active: true, timezone: "UTC" });
      expect(mine.data?.next_occurrence_at).toBe(`${tomorrow()}T06:00:00+00:00`);
      expect((await ana.client.from("schedule_subscriptions").select("user_id").eq("schedule_id", id!)).data?.map((s) => s.user_id)).toEqual([ana.user.id]);

      const token = (await ana.client.rpc("get_schedule_invite", { p_schedule_id: id! })).data;
      expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      expect((await ana.client.from("schedule_invites").select("token").eq("schedule_id", id!).single()).data?.token).toBe(token);

      // Beto ni la ve, ni lee el token, ni cambia nada
      expect((await beto.client.from("room_schedules").select("id").eq("id", id!)).data).toEqual([]);
      expect((await beto.client.from("schedule_invites").select("token")).data).toEqual([]);
      expect((await beto.client.rpc("get_schedule_invite", { p_schedule_id: id! })).data).toBeNull();
      expect(errorOf(await beto.client.rpc("set_schedule_active", { p_schedule_id: id!, p_active: false }))).toBe("not_owner");
      expect(errorOf(await beto.client.rpc("regenerate_schedule_invite", { p_schedule_id: id! }))).toBe("not_owner");
      expect((await beto.client.from("room_schedules").update({ name: "X" } as never).eq("id", id!)).error?.code).toBe("42501");
      expect((await beto.client.from("room_schedules").delete().eq("id", id!).select()).data).toEqual([]);
      expect((await ana.client.from("room_schedules").insert({ owner_id: ana.user.id, name: "x", timezone: "UTC", recurrence: "daily", local_time: "06:00", start_date: tomorrow() })).error?.code).toBe("42501");
    });

    it("el enlace permite suscribirse; revocarlo invalida el anterior; pausar bloquea nuevas suscripciones", async () => {
      const { data: id } = await ana.client.rpc("create_schedule", base());
      const oldToken = (await ana.client.rpc("get_schedule_invite", { p_schedule_id: id! })).data!;

      // La vista previa no necesita sesión
      const peek = await anonClient().rpc("peek_schedule", { p_token: oldToken });
      expect(peek.data?.[0]).toMatchObject({ name: "Oración de la mañana", recurrence: "daily", timezone: "UTC", is_active: true });

      expect((await beto.client.rpc("subscribe_to_schedule", { p_token: oldToken })).data).toBe(id);
      expect((await beto.client.rpc("subscribe_to_schedule", { p_token: oldToken })).error).toBeNull(); // idempotente
      // La suscripción da lectura de la programación, pero no del enlace
      expect((await beto.client.from("room_schedules").select("name").eq("id", id!)).data).toHaveLength(1);
      expect((await beto.client.from("schedule_invites").select("token")).data).toEqual([]);
      // Ana ve a sus suscriptores; Carla no
      expect((await ana.client.from("schedule_subscriptions").select("user_id").eq("schedule_id", id!)).data).toHaveLength(2);

      const newToken = (await ana.client.rpc("regenerate_schedule_invite", { p_schedule_id: id! })).data!;
      expect(newToken).not.toBe(oldToken);
      expect(errorOf(await carla.client.rpc("subscribe_to_schedule", { p_token: oldToken }))).toBe("schedule_not_found");
      expect((await anonClient().rpc("peek_schedule", { p_token: oldToken })).data).toEqual([]);

      await ana.client.rpc("set_schedule_active", { p_schedule_id: id!, p_active: false });
      expect(errorOf(await carla.client.rpc("subscribe_to_schedule", { p_token: newToken }))).toBe("schedule_not_found");
      await ana.client.rpc("set_schedule_active", { p_schedule_id: id!, p_active: true });
      expect((await carla.client.rpc("subscribe_to_schedule", { p_token: newToken })).data).toBe(id);

      // Quien se suscribió puede darse de baja; otros no pueden quitar a nadie
      expect((await carla.client.from("schedule_subscriptions").delete().eq("schedule_id", id!).eq("user_id", beto.user.id).select()).data).toEqual([]);
      await beto.client.from("schedule_subscriptions").delete().eq("schedule_id", id!).eq("user_id", beto.user.id);
      expect((await beto.client.from("room_schedules").select("id").eq("id", id!)).data).toEqual([]);
    });

    it("un invitado no puede suscribirse", async () => {
      const { data: id } = await ana.client.rpc("create_schedule", base());
      const token = (await ana.client.rpc("get_schedule_invite", { p_schedule_id: id! })).data!;
      const guest = await signInGuest("Invitado");
      userIds.push(guest.user.id);
      expect(errorOf(await guest.client.rpc("subscribe_to_schedule", { p_token: token }))).toBe("account_required");
    });

    it("limita a 10 programaciones activas por persona", async () => {
      const person = await signInTestUser("Organizadora");
      userIds.push(person.user.id);
      for (let i = 0; i < 10; i++) {
        expect((await person.client.rpc("create_schedule", { ...base(), p_name: `Sala ${i}` })).error).toBeNull();
      }
      expect(errorOf(await person.client.rpc("create_schedule", base()))).toBe("too_many_schedules");
    });
  });

  // ───────────────────────── Trabajo programado ─────────────────────────

  describe("process_scheduled_work: recordatorios, apertura de salas y limpieza", () => {
    let organizer: Person;

    async function scheduleWith(opts: { recurrence?: string; subscribers?: Person[]; offsetMs: number; reminder?: number }) {
      const { data: id, error } = await organizer.client.rpc("create_schedule", {
        p_name: "Vigilia de prueba",
        p_recurrence: opts.recurrence ?? "daily",
        p_local_time: "06:00",
        p_start_date: isoDay(Date.now() + DAY),
        p_weekdays: [],
        p_timezone: "UTC",
        p_reminder_minutes: opts.reminder ?? 10,
      });
      expect(error).toBeNull();
      const token = (await organizer.client.rpc("get_schedule_invite", { p_schedule_id: id! })).data!;
      for (const p of opts.subscribers ?? []) await p.client.rpc("subscribe_to_schedule", { p_token: token });
      // Se mueve la ocurrencia al momento que necesita la prueba (la base calcula las futuras, aquí hace falta "ahora")
      const patch: Record<string, unknown> = { next_occurrence_at: new Date(Date.now() + opts.offsetMs).toISOString() };
      if (opts.recurrence === "once") patch.start_date = isoDay(Date.now() - DAY);
      await admin.from("room_schedules").update(patch as never).eq("id", id!);
      return id!;
    }

    const notificationsOf = async (scheduleKindPrefix: string, userId: string) =>
      (await admin.from("notifications").select("*").eq("user_id", userId).like("dedupe_key", `${scheduleKindPrefix}:%`)).data ?? [];

    beforeAll(async () => {
      organizer = await signInTestUser("Organizador");
      userIds.push(organizer.user.id);
    });

    beforeEach(async () => {
      await admin.from("room_schedules").delete().eq("owner_id", organizer.user.id);
      await admin.from("rooms").delete().eq("host_id", organizer.user.id);
      await admin.from("notifications").delete().in("user_id", [organizer.user.id, ana.user.id, beto.user.id, carla.user.id]);
      await admin.from("notification_preferences").delete().in("user_id", [beto.user.id, carla.user.id]);
    });

    it("avisa antes de que empiece, sin duplicar y respetando la preferencia de cada persona", async () => {
      await beto.client.from("notification_preferences").insert({ schedule_reminders: false });
      const id = await scheduleWith({ subscribers: [carla, beto], offsetMs: 5 * 60_000 });

      const first = (await admin.rpc("process_scheduled_work")).data as { reminders: number; rooms_opened: number };
      expect(first.rooms_opened).toBe(0);

      const forOrganizer = await notificationsOf("reminder", organizer.user.id);
      expect(forOrganizer).toHaveLength(1);
      expect(forOrganizer[0]).toMatchObject({ kind: "schedule_reminder", title: "Vigilia de prueba", url: "/programadas", push_state: "pending", email_state: "pending" });
      expect(forOrganizer[0]?.body).toMatch(/^Empieza en [45] minutos$/);
      expect(await notificationsOf("reminder", carla.user.id)).toHaveLength(1);
      expect(await notificationsOf("reminder", beto.user.id)).toHaveLength(0); // lo apagó
      expect(await notificationsOf("reminder", ana.user.id)).toHaveLength(0); // no está suscrita

      await admin.rpc("process_scheduled_work");
      await admin.rpc("process_scheduled_work");
      expect(await notificationsOf("reminder", organizer.user.id)).toHaveLength(1);
      expect((await admin.from("rooms").select("id").eq("schedule_id", id)).data).toEqual([]);
    });

    it("no avisa si el recordatorio está en 0 minutos ni cuando falta mucho", async () => {
      await scheduleWith({ offsetMs: 5 * 60_000, reminder: 0 });
      await scheduleWith({ offsetMs: 3 * 3_600_000, reminder: 10 });
      await admin.rpc("process_scheduled_work");
      expect(await notificationsOf("reminder", organizer.user.id)).toHaveLength(0);
    });

    it("abre la sala a la hora: avisa con el enlace, la anfitriona puede entrar y la programación avanza", async () => {
      const before = Date.now();
      const id = await scheduleWith({ subscribers: [carla], offsetMs: -60_000 });

      const result = (await admin.rpc("process_scheduled_work")).data as { rooms_opened: number };
      expect(result.rooms_opened).toBe(1);

      const rooms = (await admin.from("rooms").select("*").eq("schedule_id", id)).data!;
      expect(rooms).toHaveLength(1);
      const room = rooms[0]!;
      expect(room).toMatchObject({ host_id: organizer.user.id, status: "open", name: "Vigilia de prueba" });
      expect(new Date(room.scheduled_at!).getTime()).toBeLessThan(before + 1000);

      const started = await notificationsOf("start", carla.user.id);
      expect(started).toHaveLength(1);
      expect(started[0]).toMatchObject({ kind: "schedule_started", url: `/r/${room.code}` });
      expect(await notificationsOf("start", organizer.user.id)).toHaveLength(1);

      // La programación sigue: la siguiente ocurrencia es futura, y la sala se recuerda
      const sched = (await admin.from("rooms").select("id").eq("id", room.id)).data;
      expect(sched).toHaveLength(1);
      const after = (await admin.from("room_schedules").select("*").eq("id", id).single()).data!;
      expect(after.is_active).toBe(true);
      expect(after.last_room_id).toBe(room.id);
      expect(new Date(after.next_occurrence_at!).getTime()).toBeGreaterThan(Date.now());

      // La anfitriona figura fuera de la sala y entra con join_room conservando el rol de anfitriona
      const member = (await admin.from("room_members").select("*").eq("room_id", room.id).eq("user_id", organizer.user.id).single()).data!;
      expect(member).toMatchObject({ role: "host" });
      expect(member.left_at).not.toBeNull();
      expect((await organizer.client.rpc("join_room", { p_code: room.code, p_display_name: "Organizador" })).error).toBeNull();
      expect((await admin.from("room_members").select("role, left_at").eq("room_id", room.id).eq("user_id", organizer.user.id).single()).data).toEqual({ role: "host", left_at: null });
      // Carla también entra con el código del aviso
      expect((await carla.client.rpc("join_room", { p_code: room.code, p_display_name: "Carla" })).error).toBeNull();

      // Repetir el trabajo no abre otra sala ni duplica avisos
      await admin.rpc("process_scheduled_work");
      expect((await admin.from("rooms").select("id").eq("schedule_id", id)).data).toHaveLength(1);
      expect(await notificationsOf("start", carla.user.id)).toHaveLength(1);
    });

    it("una programación de una sola vez se desactiva tras abrir su sala", async () => {
      const id = await scheduleWith({ recurrence: "once", offsetMs: -60_000 });
      await admin.rpc("process_scheduled_work");
      const row = (await admin.from("room_schedules").select("is_active, next_occurrence_at").eq("id", id).single()).data!;
      expect(row).toEqual({ is_active: false, next_occurrence_at: null });
      expect((await admin.from("rooms").select("id").eq("schedule_id", id)).data).toHaveLength(1);
    });

    it("si el sistema estuvo caído más de 6 horas, omite esa ocurrencia sin abrir una sala a deshoras", async () => {
      const id = await scheduleWith({ subscribers: [carla], offsetMs: -7 * 3_600_000 });
      await admin.rpc("process_scheduled_work");
      expect((await admin.from("rooms").select("id").eq("schedule_id", id)).data).toEqual([]);
      expect(await notificationsOf("start", carla.user.id)).toHaveLength(0);
      const row = (await admin.from("room_schedules").select("next_occurrence_at").eq("id", id).single()).data!;
      expect(new Date(row.next_occurrence_at!).getTime()).toBeGreaterThan(Date.now());
    });

    it("las programaciones pausadas no abren salas ni avisan", async () => {
      const id = await scheduleWith({ subscribers: [carla], offsetMs: -60_000 });
      await organizer.client.rpc("set_schedule_active", { p_schedule_id: id, p_active: false });
      await admin.from("room_schedules").update({ next_occurrence_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", id);
      await admin.rpc("process_scheduled_work");
      expect((await admin.from("rooms").select("id").eq("schedule_id", id)).data).toEqual([]);
    });

    it("cierra las salas programadas que nadie ocupó en 3 horas, pero no las que tienen gente", async () => {
      const id = await scheduleWith({ offsetMs: -60_000 });
      await admin.rpc("process_scheduled_work");
      const room = (await admin.from("rooms").select("id, code").eq("schedule_id", id).single()).data!;

      // Dentro de las 3 horas sigue abierta aunque nadie haya entrado
      expect((await admin.from("rooms").select("status").eq("id", room.id).single()).data?.status).toBe("open");

      const old = new Date(Date.now() - 4 * 3_600_000).toISOString();
      await admin.from("rooms").update({ created_at: old }).eq("id", room.id);
      await organizer.client.rpc("join_room", { p_code: room.code, p_display_name: "Organizador" });
      await admin.rpc("process_scheduled_work");
      expect((await admin.from("rooms").select("status").eq("id", room.id).single()).data?.status).toBe("open");

      await organizer.client.rpc("leave_room", { p_room_id: room.id });
      await admin.rpc("process_scheduled_work");
      const closed = (await admin.from("rooms").select("status, closed_at").eq("id", room.id).single()).data!;
      expect(closed.status).toBe("closed");
      expect(closed.closed_at).not.toBeNull();
    });

    it("un aviso se queda solo con su dueño: lo lee y lo marca como leído, nada más", async () => {
      await scheduleWith({ subscribers: [carla], offsetMs: 5 * 60_000 });
      await admin.rpc("process_scheduled_work");

      const mine = (await carla.client.from("notifications").select("*")).data!;
      expect(mine).toHaveLength(1);
      expect((await beto.client.from("notifications").select("*")).data).toEqual([]);
      expect((await ana.client.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", mine[0]!.id).select()).data).toEqual([]);

      expect((await carla.client.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", mine[0]!.id)).error).toBeNull();
      expect((await carla.client.from("notifications").update({ title: "Otro" } as never).eq("id", mine[0]!.id)).error?.code).toBe("42501");
      expect((await carla.client.from("notifications").insert({ user_id: carla.user.id, kind: "schedule_reminder", title: "t", body: "b", url: "/x", dedupe_key: "k" } as never)).error?.code).toBe("42501");
      expect((await carla.client.from("notifications").delete().eq("id", mine[0]!.id).select()).error?.code).toBe("42501");
    });

    describe("recordatorio del devocional", () => {
      // Se elige una zona de desfase fijo en la que ahora son ~12:00, para no depender de la hora real
      const utcHour = new Date().getUTCHours();
      const offset = 12 - utcHour;
      const tz = offset === 0 ? "Etc/GMT" : offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
      const localToday = isoDay(Date.now() + offset * 3_600_000);

      it("avisa una vez a quien lo activó y aún no lo leyó, a la hora de su zona", async () => {
        await admin.from("devotionals").delete().not("id", "is", null);
        const { data: dev } = await admin.from("devotionals").insert(devotionalRow(localToday)).select().single();

        await admin.from("profiles").update({ timezone: tz }).in("id", [ana.user.id, beto.user.id, carla.user.id]);
        await ana.client.from("notification_preferences").upsert({ devotional_reminder: true, devotional_reminder_time: "11:00" });
        await beto.client.from("notification_preferences").upsert({ devotional_reminder: true, devotional_reminder_time: "11:00" });
        // Carla lo activó pero su hora aún no llega (13:00 local)
        await carla.client.from("notification_preferences").upsert({ devotional_reminder: true, devotional_reminder_time: "13:00" });
        // Beto ya lo leyó
        await admin.from("devotional_progress").insert({ user_id: beto.user.id, devotional_id: dev!.id, read_at: new Date().toISOString() });

        await admin.rpc("process_scheduled_work");
        await admin.rpc("process_scheduled_work");

        const anas = (await admin.from("notifications").select("*").eq("user_id", ana.user.id).eq("kind", "devotional_reminder")).data!;
        expect(anas).toHaveLength(1);
        expect(anas[0]).toMatchObject({ url: "/devocional", dedupe_key: `devotional:${localToday}` });
        expect((await admin.from("notifications").select("id").eq("user_id", beto.user.id).eq("kind", "devotional_reminder")).data).toEqual([]);
        expect((await admin.from("notifications").select("id").eq("user_id", carla.user.id).eq("kind", "devotional_reminder")).data).toEqual([]);

        await admin.from("profiles").update({ timezone: "UTC" }).in("id", [ana.user.id, beto.user.id, carla.user.id]);
        await admin.from("devotionals").delete().eq("id", dev!.id);
      });
    });
  });

  // ───────────────────────── Envío (solo la service role) ─────────────────────────

  describe("cola de envío", () => {
    let person: Person;

    const queue = async (key: string) => {
      const { data } = await admin
        .from("notifications")
        .insert({ user_id: person.user.id, kind: "schedule_reminder", title: "Aviso", body: "Cuerpo", url: "/orar", dedupe_key: key })
        .select()
        .single();
      return data!;
    };

    beforeAll(async () => {
      person = await signInTestUser("Destinataria");
      userIds.push(person.user.id);
    });

    beforeEach(async () => {
      await admin.from("notifications").delete().eq("user_id", person.user.id);
      await admin.from("push_subscriptions").delete().eq("user_id", person.user.id);
      await admin.from("notification_preferences").delete().eq("user_id", person.user.id);
    });

    it("solo la service role reclama y cierra avisos", async () => {
      for (const client of [person.client, anonClient()]) {
        expect((await client.rpc("claim_notifications", { p_limit: 10 })).error?.code).toBe("42501");
        expect((await client.rpc("finish_notification", { p_id: crypto.randomUUID(), p_push_state: "sent", p_email_state: "sent" })).error?.code).toBe("42501");
        expect((await client.rpc("process_scheduled_work")).error?.code).toBe("42501");
      }
    });

    it("decide los canales según las preferencias y los dispositivos", async () => {
      const n = await queue("c1");
      // Sin dispositivos ni correo activado no hay nada que enviar: queda 'skipped'
      let claimed = ((await admin.rpc("claim_notifications", { p_limit: 100 })).data as { id: string }[]).filter((c) => c.id === n.id);
      expect(claimed).toEqual([]);
      expect((await admin.from("notifications").select("push_state, email_state").eq("id", n.id).single()).data).toEqual({ push_state: "skipped", email_state: "skipped" });

      await person.client.rpc("upsert_push_subscription", { p_endpoint: `https://push.example.test/${crypto.randomUUID()}`, p_p256dh: "k", p_auth: "a" });
      await person.client.from("notification_preferences").insert({ email_enabled: true });
      const n2 = await queue("c2");
      claimed = ((await admin.rpc("claim_notifications", { p_limit: 100 })).data as { id: string }[]).filter((c) => c.id === n2.id);
      expect(claimed).toHaveLength(1);
      expect(claimed[0]).toMatchObject({ push_pending: true, email_pending: true, title: "Aviso", url: "/orar" });
      expect((claimed[0] as unknown as { subscriptions: unknown[] }).subscriptions).toHaveLength(1);
      expect((claimed[0] as unknown as { email: string }).email).toMatch(/^prueba-.+@example\.test$/);

      // Reclamado: otra ejecución inmediata no lo vuelve a tomar
      const again = ((await admin.rpc("claim_notifications", { p_limit: 100 })).data as { id: string }[]).filter((c) => c.id === n2.id);
      expect(again).toEqual([]);
    });

    it("respeta push apagado y correo apagado", async () => {
      await person.client.rpc("upsert_push_subscription", { p_endpoint: `https://push.example.test/${crypto.randomUUID()}`, p_p256dh: "k", p_auth: "a" });
      await person.client.from("notification_preferences").insert({ push_enabled: false, email_enabled: false });
      const n = await queue("c3");
      await admin.rpc("claim_notifications", { p_limit: 100 });
      expect((await admin.from("notifications").select("push_state, email_state").eq("id", n.id).single()).data).toEqual({ push_state: "skipped", email_state: "skipped" });
    });

    it("un aviso con más de una hora sin enviarse caduca; uno dejado en pendiente se reintenta", async () => {
      await person.client.rpc("upsert_push_subscription", { p_endpoint: `https://push.example.test/${crypto.randomUUID()}`, p_p256dh: "k", p_auth: "a" });

      const stale = await queue("c5");
      await admin.from("notifications").update({ created_at: new Date(Date.now() - 2 * 3_600_000).toISOString() }).eq("id", stale.id);
      const retry = await queue("c6");

      let claimed = ((await admin.rpc("claim_notifications", { p_limit: 100 })).data as { id: string }[]).map((c) => c.id);
      expect(claimed).toContain(retry.id);
      expect(claimed).not.toContain(stale.id);
      expect((await admin.from("notifications").select("push_state, delivery_error").eq("id", stale.id).single()).data).toEqual({ push_state: "failed", delivery_error: "expired" });

      // El envío tuvo un fallo temporal: se deja pendiente y, pasados los 2 minutos del reclamo, vuelve a salir
      await admin.rpc("finish_notification", { p_id: retry.id, p_push_state: "pending", p_email_state: "skipped", p_error: "push 503" });
      expect((await admin.from("notifications").select("push_state").eq("id", retry.id).single()).data?.push_state).toBe("pending");
      claimed = ((await admin.rpc("claim_notifications", { p_limit: 100 })).data as { id: string }[]).map((c) => c.id);
      expect(claimed).not.toContain(retry.id);
      await admin.from("notifications").update({ claimed_at: new Date(Date.now() - 3 * 60_000).toISOString() }).eq("id", retry.id);
      claimed = ((await admin.rpc("claim_notifications", { p_limit: 100 })).data as { id: string }[]).map((c) => c.id);
      expect(claimed).toContain(retry.id);
    });

    it("finish_notification guarda el resultado y borra los dispositivos dados de baja", async () => {
      const alive = `https://push.example.test/vivo-${crypto.randomUUID()}`;
      const dead = `https://push.example.test/muerto-${crypto.randomUUID()}`;
      for (const endpoint of [alive, dead]) {
        await person.client.rpc("upsert_push_subscription", { p_endpoint: endpoint, p_p256dh: "k", p_auth: "a" });
      }
      const n = await queue("c4");
      await admin.rpc("claim_notifications", { p_limit: 100 });

      const done = await admin.rpc("finish_notification", { p_id: n.id, p_push_state: "sent", p_email_state: "skipped", p_dead_endpoints: [dead] });
      expect(done.error).toBeNull();
      const row = (await admin.from("notifications").select("push_state, push_sent_at").eq("id", n.id).single()).data!;
      expect(row.push_state).toBe("sent");
      expect(row.push_sent_at).not.toBeNull();
      expect((await admin.from("push_subscriptions").select("endpoint").eq("user_id", person.user.id)).data?.map((s) => s.endpoint)).toEqual([alive]);

      // Ya enviado: no vuelve a la cola
      const requeued = ((await admin.rpc("claim_notifications", { p_limit: 100 })).data as { id: string }[]).filter((c) => c.id === n.id);
      expect(requeued).toEqual([]);
    });
  });
});

