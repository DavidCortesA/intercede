// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PartnerOverview } from "@/features/partners/schemas";
import { adminClient, anonClient, signInGuest, signInTestUser } from "./helpers";
import { hasTestDb } from "./helpers";

type Person = Awaited<ReturnType<typeof signInTestUser>>;

const errorOf = (res: { error: { message: string } | null }) => res.error?.message;
const DAY = 24 * 3_600_000;
/** Lunes (UTC) de la semana de una fecha, como "AAAA-MM-DD" */
const monday = (ms: number) => {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
};
const addDays = (date: string, days: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY).toISOString().slice(0, 10);

describe.skipIf(!hasTestDb)("compañero de oración (B7, solo personas adultas)", () => {
  const admin = adminClient();
  const userIds: string[] = [];
  const communityIds: string[] = [];
  let ana: Person; // administra
  let people: Person[]; // 5 miembros
  let outsider: Person;

  beforeAll(async () => {
    const all = await Promise.all(["Ana", "Fuera", "Beto", "Carla", "Dani", "Eli", "Fran"].map((n) => signInTestUser(n)));
    ana = all[0]!;
    outsider = all[1]!;
    people = all.slice(2);
    userIds.push(...all.map((p) => p.user.id));
    for (const person of all) await person.client.rpc("confirm_adult");
  });

  afterEach(async () => {
    if (communityIds.length) await admin.from("communities").delete().in("id", communityIds.splice(0));
    await admin.from("notifications").delete().in("user_id", userIds);
    await admin.from("blocks").delete().in("blocker_id", userIds);
  });

  afterAll(async () => {
    await Promise.all(userIds.map((id) => admin.auth.admin.deleteUser(id)));
  });

  async function community(mode: "random" | "group" = "random", labels: string[] = []) {
    const { data: id } = await ana.client.rpc("create_community", { p_name: "Iglesia", p_kind: "church" });
    communityIds.push(id!);
    const token = (await ana.client.rpc("get_community_invite", { p_community_id: id! })).data!;
    for (const person of people) await person.client.rpc("join_community", { p_token: token });
    expect((await ana.client.rpc("configure_partner_program", { p_community_id: id!, p_mode: mode, p_active: true, p_labels: labels })).error).toBeNull();
    return id!;
  }
  const join = (person: Person, id: string, label?: string) => person.client.rpc("join_partner_program", { p_community_id: id, p_group_label: label as string });
  const pairsOf = async (id: string) => (await admin.from("partner_pairs").select("*").eq("community_id", id)).data ?? [];
  const overview = async (person: Person, id: string) =>
    (await person.client.rpc("partner_overview", { p_community_id: id })).data as unknown as PartnerOverview & { pair: NonNullable<PartnerOverview["pair"]> };

  // ───────────────────────── Adultos ─────────────────────────

  describe("solo personas adultas", () => {
    it("sin confirmar la mayoría de edad no se puede anotar; confirmar es una declaración propia y única", async () => {
      const id = await community();
      const fresh = await signInTestUser("Nueva");
      userIds.push(fresh.user.id);
      const token = (await ana.client.rpc("get_community_invite", { p_community_id: id })).data!;
      await fresh.client.rpc("join_community", { p_token: token });

      expect(errorOf(await join(fresh, id))).toBe("adult_required");
      expect((await fresh.client.rpc("confirm_adult")).error).toBeNull();
      expect((await join(fresh, id)).error).toBeNull();

      const first = (await admin.from("profiles").select("adult_confirmed_at").eq("id", fresh.user.id).single()).data!.adult_confirmed_at;
      await fresh.client.rpc("confirm_adult"); // repetir no cambia la fecha
      expect((await admin.from("profiles").select("adult_confirmed_at").eq("id", fresh.user.id).single()).data!.adult_confirmed_at).toBe(first);
      // Nadie se la escribe por la API
      expect((await fresh.client.from("profiles").update({ adult_confirmed_at: null } as never).eq("id", fresh.user.id)).error).not.toBeNull();
    });

    it("el registro puede traer la declaración (metadata) y queda en el perfil", async () => {
      const { data } = await admin.auth.admin.createUser({ email: `adulto-${crypto.randomUUID()}@example.test`, email_confirm: true, user_metadata: { adult_confirmed: true } });
      userIds.push(data.user!.id);
      expect((await admin.from("profiles").select("adult_confirmed_at").eq("id", data.user!.id).single()).data!.adult_confirmed_at).not.toBeNull();
      const { data: other } = await admin.auth.admin.createUser({ email: `sin-${crypto.randomUUID()}@example.test`, email_confirm: true });
      userIds.push(other.user!.id);
      expect((await admin.from("profiles").select("adult_confirmed_at").eq("id", other.user!.id).single()).data!.adult_confirmed_at).toBeNull();
    });

    it("quien perdió la confirmación (o no la tiene) nunca entra al emparejamiento", async () => {
      const id = await community();
      for (const person of people.slice(0, 3)) await join(person, id);
      await admin.from("profiles").update({ adult_confirmed_at: null }).eq("id", people[2]!.user.id);
      await ana.client.rpc("pair_partners_now", { p_community_id: id });
      const pairs = await pairsOf(id);
      expect(pairs).toHaveLength(1);
      expect([pairs[0]!.user_a, pairs[0]!.user_b]).not.toContain(people[2]!.user.id);
      await admin.from("profiles").update({ adult_confirmed_at: new Date().toISOString() }).eq("id", people[2]!.user.id);
    });
  });

  // ───────────────────────── Programa y anotarse ─────────────────────────

  describe("programa y anotarse", () => {
    it("solo el liderazgo lo configura; modo y etiquetas se validan", async () => {
      const id = await community();
      expect(errorOf(await people[0]!.client.rpc("configure_partner_program", { p_community_id: id, p_mode: "random", p_active: true }))).toBe("not_leader");
      expect(errorOf(await ana.client.rpc("configure_partner_program", { p_community_id: id, p_mode: "otro", p_active: true }))).toBe("invalid_mode");
      expect(errorOf(await ana.client.rpc("configure_partner_program", { p_community_id: id, p_mode: "group", p_active: true, p_labels: [] }))).toBe("labels_required");
      expect(errorOf(await ana.client.rpc("configure_partner_program", { p_community_id: id, p_mode: "group", p_active: true, p_labels: ["x".repeat(31)] }))).toBe("invalid_labels");
      expect(errorOf(await ana.client.rpc("configure_partner_program", { p_community_id: id, p_mode: "group", p_active: true, p_labels: Array.from({ length: 21 }, (_, i) => `G${i}`) }))).toBe("invalid_labels");

      // Etiquetas sin repetir (aunque cambien las mayúsculas) y sin espacios de más
      expect((await ana.client.rpc("configure_partner_program", { p_community_id: id, p_mode: "group", p_active: true, p_labels: ["Célula Norte ", "célula norte", "Jóvenes"] })).error).toBeNull();
      expect((await admin.from("partner_programs").select("labels").eq("community_id", id).single()).data!.labels).toEqual(["Célula Norte", "Jóvenes"]);
    });

    it("anotarse: solo cuentas de la comunidad con el programa abierto; con etiqueta válida si es por grupo", async () => {
      const id = await community("group", ["Norte", "Sur"]);
      const guest = await signInGuest("Invitada");
      userIds.push(guest.user.id);
      expect(errorOf(await join(guest, id, "Norte"))).toBe("account_required");
      expect(errorOf(await join(outsider, id, "Norte"))).toBe("not_member");
      expect(errorOf(await join(people[0]!, id))).toBe("invalid_label");
      expect(errorOf(await join(people[0]!, id, "Este"))).toBe("invalid_label");
      expect((await join(people[0]!, id, "Norte")).error).toBeNull();

      await ana.client.rpc("configure_partner_program", { p_community_id: id, p_mode: "random", p_active: false });
      expect(errorOf(await join(people[1]!, id))).toBe("program_inactive");
      expect(errorOf(await anonClient().rpc("join_partner_program", { p_community_id: id }))).toBeDefined();
    });

    it("en modo aleatorio no se guarda etiqueta; pausar y volver; cada quien ve solo lo suyo", async () => {
      const id = await community();
      await join(people[0]!, id, "ignorada");
      expect((await admin.from("partner_signups").select("group_label, paused").eq("user_id", people[0]!.user.id).single()).data).toEqual({ group_label: null, paused: false });
      await people[0]!.client.rpc("set_partner_paused", { p_community_id: id, p_paused: true });
      expect((await admin.from("partner_signups").select("paused").eq("user_id", people[0]!.user.id).single()).data!.paused).toBe(true);

      await join(people[1]!, id);
      expect((await people[1]!.client.from("partner_signups").select("user_id")).data).toEqual([{ user_id: people[1]!.user.id }]);
      expect((await ana.client.from("partner_signups").select("user_id")).data).toEqual([]); // ni el liderazgo ve quiénes
      expect((await people[1]!.client.from("partner_signups").insert({ community_id: id, user_id: people[1]!.user.id })).error?.code).toBe("42501");
    });
  });

  // ───────────────────────── Emparejar ─────────────────────────

  describe("emparejar cada semana", () => {
    it("empareja a quienes se anotaron, solo una vez por semana, con aviso a las dos personas; el impar espera", async () => {
      const id = await community();
      for (const person of people.slice(0, 5)) await join(person, id);
      expect(errorOf(await people[0]!.client.rpc("pair_partners_now", { p_community_id: id }))).toBe("not_leader");

      const made = (await ana.client.rpc("pair_partners_now", { p_community_id: id })).data;
      expect(made).toBe(2); // 5 personas: 2 parejas y una espera
      const pairs = await pairsOf(id);
      const seen = pairs.flatMap((p) => [p.user_a, p.user_b]);
      expect(new Set(seen).size).toBe(4);
      expect(pairs.every((p) => p.week_start === monday(Date.now()))).toBe(true);

      // Idempotente: repetir la misma semana no vuelve a emparejar
      expect((await ana.client.rpc("pair_partners_now", { p_community_id: id })).data).toBe(0);
      expect(await pairsOf(id)).toHaveLength(2);

      // Aviso a cada persona emparejada (con el nombre de la pareja, sin contacto)
      const notes = (await admin.from("notifications").select("user_id, kind, url, body").eq("kind", "partner_paired").in("user_id", seen)).data!;
      expect(notes).toHaveLength(4);
      expect(notes[0]!.url).toBe(`/comunidades/${id}/companero`);
      expect(notes.every((n) => !/@|\d{7}/.test(n.body))).toBe(true);
    });

    it("quien pausó o no se anotó no entra; las anotadas de otra comunidad no se mezclan", async () => {
      const id = await community();
      for (const person of people.slice(0, 4)) await join(person, id);
      await people[0]!.client.rpc("set_partner_paused", { p_community_id: id, p_paused: true });
      await ana.client.rpc("pair_partners_now", { p_community_id: id });
      const seen = (await pairsOf(id)).flatMap((p) => [p.user_a, p.user_b]);
      expect(seen).not.toContain(people[0]!.user.id);
      expect(seen).not.toContain(people[4]!.user.id);
      expect(seen).toHaveLength(2); // 3 activas: una pareja y una espera
    });

    it("por grupo: solo dentro de la misma etiqueta", async () => {
      const id = await community("group", ["Norte", "Sur"]);
      const [beto, carla, dani, eli, fran] = people as [Person, Person, Person, Person, Person];
      await join(beto, id, "Norte");
      await join(carla, id, "Norte");
      await join(dani, id, "Sur");
      await join(eli, id, "Sur");
      await join(fran, id, "Sur");
      await ana.client.rpc("pair_partners_now", { p_community_id: id });
      const pairs = await pairsOf(id);
      expect(pairs).toHaveLength(2);
      const labelOf = async (userId: string) => (await admin.from("partner_signups").select("group_label").eq("user_id", userId).single()).data!.group_label;
      for (const pair of pairs) expect(await labelOf(pair.user_a)).toBe(await labelOf(pair.user_b));
    });

    it("no repite pareja en las últimas 4 semanas y sí después", async () => {
      const id = await community();
      for (const person of people.slice(0, 2)) await join(person, id);
      const week = monday(Date.now());
      expect((await admin.rpc("pair_program", { p_community_id: id, p_week: week })).data).toBe(1);
      expect((await admin.rpc("pair_program", { p_community_id: id, p_week: addDays(week, 7) })).data).toBe(0);
      expect((await admin.rpc("pair_program", { p_community_id: id, p_week: addDays(week, 21) })).data).toBe(0);
      expect((await admin.rpc("pair_program", { p_community_id: id, p_week: addDays(week, 35) })).data).toBe(1);
    });

    it("con un bloqueo entre dos personas NUNCA se emparejan (en cualquier sentido)", async () => {
      const id = await community();
      for (const person of people.slice(0, 2)) await join(person, id);
      const [a, b] = people as [Person, Person];
      expect((await a.client.rpc("block_user", { p_user_id: b.user.id })).error).toBeNull();
      const week = monday(Date.now());
      for (let i = 0; i < 4; i++) expect((await admin.rpc("pair_program", { p_community_id: id, p_week: addDays(week, 35 * (i + 1)) })).data).toBe(0);

      // Al revés también (quien fue bloqueada no se empareja con quien la bloqueó)
      await admin.from("blocks").delete().eq("blocker_id", a.user.id);
      expect((await b.client.rpc("block_user", { p_user_id: a.user.id })).error).toBeNull();
      expect((await admin.rpc("pair_program", { p_community_id: id, p_week: addDays(week, 400) })).data).toBe(0);
      expect(await pairsOf(id)).toEqual([]);
    });

    it("bloquear a la pareja de esta semana termina la pareja y oculta lo del otro", async () => {
      const id = await community();
      const [a, b] = people as [Person, Person];
      for (const person of [a, b]) await join(person, id);
      await ana.client.rpc("pair_partners_now", { p_community_id: id });
      const pair = (await pairsOf(id))[0]!;
      await a.client.rpc("add_partner_request", { p_pair_id: pair.id, p_content: "Por mi examen" });
      await b.client.rpc("add_partner_request", { p_pair_id: pair.id, p_content: "Por mi trabajo" });
      await b.client.rpc("set_partner_praying", { p_pair_id: pair.id, p_on: true });
      expect((await overview(a, id)).pair.partner_requests).toHaveLength(1);

      expect((await a.client.rpc("block_user", { p_user_id: b.user.id })).error).toBeNull();
      expect((await admin.from("partner_pairs").select("ended_at").eq("id", pair.id).single()).data!.ended_at).not.toBeNull();
      const after = await overview(a, id);
      expect(after.pair.ended).toBe(true);
      expect(after.pair.partner_requests).toEqual([]); // lo de la persona bloqueada ya no se ve
      expect(after.pair.partner_prays).toBe(false);
      expect((await a.client.from("partner_requests").select("content").eq("pair_id", pair.id)).data).toEqual([{ content: "Por mi examen" }]);
      expect((await b.client.from("partner_requests").select("content").eq("pair_id", pair.id)).data).toEqual([{ content: "Por mi trabajo" }]);
      expect(errorOf(await a.client.rpc("add_partner_request", { p_pair_id: pair.id, p_content: "Otra" }))).toBe("pair_ended");
    });

    it("la tarea semanal empareja todos los programas activos y solo la service role la ejecuta", async () => {
      const one = await community();
      const two = await community();
      for (const id of [one, two]) for (const person of people.slice(0, 2)) await join(person, id);
      const week = addDays(monday(Date.now()), 70);
      expect((await admin.rpc("run_partner_pairing", { p_week: week })).data).toBe(2);
      expect((await admin.rpc("run_partner_pairing", { p_week: week })).data).toBe(0);
      for (const client of [ana.client, anonClient()]) {
        expect((await client.rpc("run_partner_pairing", { p_week: week })).error?.code).toBe("42501");
        expect((await client.rpc("pair_program", { p_community_id: one, p_week: week })).error?.code).toBe("42501");
      }
    });
  });

  // ───────────────────────── La pareja de la semana ─────────────────────────

  describe("peticiones, oración y revisión", () => {
    async function pair() {
      const id = await community();
      const [a, b] = people as [Person, Person];
      for (const person of [a, b]) await join(person, id);
      await ana.client.rpc("pair_partners_now", { p_community_id: id });
      return { id, a, b, pair: (await pairsOf(id))[0]! };
    }

    it("1 a 3 peticiones de hasta 200 letras; solo las ve la pareja y solo su autor las borra", async () => {
      const { id, a, b, pair: p } = await pair();
      expect(errorOf(await a.client.rpc("add_partner_request", { p_pair_id: p.id, p_content: "   " }))).toBe("invalid_request");
      expect(errorOf(await a.client.rpc("add_partner_request", { p_pair_id: p.id, p_content: "x".repeat(201) }))).toBe("invalid_request");
      const first = (await a.client.rpc("add_partner_request", { p_pair_id: p.id, p_content: "Por mi familia" })).data!;
      for (const text of ["Por mi trabajo", "Por mi salud"]) expect((await a.client.rpc("add_partner_request", { p_pair_id: p.id, p_content: text })).error).toBeNull();
      expect(errorOf(await a.client.rpc("add_partner_request", { p_pair_id: p.id, p_content: "Una más" }))).toBe("too_many_requests");

      expect(errorOf(await outsider.client.rpc("add_partner_request", { p_pair_id: p.id, p_content: "Intruso" }))).toBe("not_in_pair");
      expect((await outsider.client.from("partner_requests").select("content")).data).toEqual([]);
      expect(errorOf(await b.client.rpc("delete_partner_request", { p_request_id: first }))).toBe("request_not_found");
      expect((await b.client.from("partner_requests").select("content").eq("pair_id", p.id)).data).toHaveLength(3); // la pareja las ve
      expect((await a.client.rpc("delete_partner_request", { p_request_id: first })).error).toBeNull();
      expect((await a.client.rpc("add_partner_request", { p_pair_id: p.id, p_content: "Otra" })).error).toBeNull();

      // Lo que ve cada quien: del compañero solo el nombre y su id (para reportar o bloquear), nunca contacto
      const mine = await overview(a, id);
      expect(Object.keys(mine.pair).sort()).toEqual(["ended", "i_pray", "id", "my_checkin", "my_requests", "partner_checkin", "partner_id", "partner_name", "partner_prays", "partner_requests", "week_start"]);
      expect(mine.pair.partner_id).toBe(b.user.id);
      expect(mine.pair.partner_name).toBeTruthy();
      expect(JSON.stringify(mine)).not.toMatch(/@|email/i);
    });

    it("\"Estoy orando por ti\" y la revisión semanal llegan a la pareja", async () => {
      const { id, a, b, pair: p } = await pair();
      expect((await a.client.rpc("set_partner_praying", { p_pair_id: p.id, p_on: true })).error).toBeNull();
      expect((await overview(b, id)).pair.partner_prays).toBe(true);
      expect((await overview(a, id)).pair.i_pray).toBe(true);
      await a.client.rpc("set_partner_praying", { p_pair_id: p.id, p_on: false });
      expect((await overview(b, id)).pair.partner_prays).toBe(false);

      expect(errorOf(await a.client.rpc("submit_partner_checkin", { p_pair_id: p.id, p_status: "excelente" }))).toBe("invalid_status");
      expect(errorOf(await a.client.rpc("submit_partner_checkin", { p_pair_id: p.id, p_status: "good", p_note: "x".repeat(141) }))).toBe("invalid_request");
      expect((await a.client.rpc("submit_partner_checkin", { p_pair_id: p.id, p_status: "hard", p_note: "Fue una semana difícil" })).error).toBeNull();
      expect((await a.client.rpc("submit_partner_checkin", { p_pair_id: p.id, p_status: "good", p_note: "Mejor" })).error).toBeNull(); // se puede corregir
      expect((await overview(b, id)).pair.partner_checkin).toEqual({ status: "good", note: "Mejor" });
      expect(errorOf(await outsider.client.rpc("set_partner_praying", { p_pair_id: p.id, p_on: true }))).toBe("not_in_pair");
    });
  });

  // ───────────────────────── Salir ─────────────────────────

  describe("salir del programa", () => {
    it("salir BORRA lo que escribió para su pareja, termina la pareja y no toca lo de la otra persona", async () => {
      const id = await community();
      const [a, b] = people as [Person, Person];
      for (const person of [a, b]) await join(person, id);
      await ana.client.rpc("pair_partners_now", { p_community_id: id });
      const pair = (await pairsOf(id))[0]!;
      await a.client.rpc("add_partner_request", { p_pair_id: pair.id, p_content: "Por mi hermano" });
      await b.client.rpc("add_partner_request", { p_pair_id: pair.id, p_content: "Por mi beca" });
      await a.client.rpc("set_partner_praying", { p_pair_id: pair.id, p_on: true });
      await a.client.rpc("submit_partner_checkin", { p_pair_id: pair.id, p_status: "ok" });

      expect((await a.client.rpc("leave_partner_program", { p_community_id: id })).error).toBeNull();
      expect((await admin.from("partner_requests").select("content").eq("pair_id", pair.id)).data).toEqual([{ content: "Por mi beca" }]);
      expect((await admin.from("partner_prayers").select("user_id").eq("pair_id", pair.id)).data).toEqual([]);
      expect((await admin.from("partner_checkins").select("user_id").eq("pair_id", pair.id)).data).toEqual([]);
      expect((await admin.from("partner_pairs").select("ended_at").eq("id", pair.id).single()).data!.ended_at).not.toBeNull();
      expect((await admin.from("partner_signups").select("user_id").eq("user_id", a.user.id)).data).toEqual([]);

      const theirs = await overview(b, id);
      expect(theirs.pair.ended).toBe(true);
      expect(theirs.pair.partner_requests).toEqual([]);
      expect(theirs.pair.my_requests).toHaveLength(1);
    });

    it("salir de la comunidad o que la saquen también la saca del programa y borra lo suyo", async () => {
      const id = await community();
      const [a, b] = people as [Person, Person];
      for (const person of [a, b]) await join(person, id);
      await ana.client.rpc("pair_partners_now", { p_community_id: id });
      const pair = (await pairsOf(id))[0]!;
      await a.client.rpc("add_partner_request", { p_pair_id: pair.id, p_content: "Por mi hermano" });
      expect((await a.client.rpc("leave_community", { p_community_id: id })).error).toBeNull();
      expect((await admin.from("partner_requests").select("id").eq("author_id", a.user.id)).data).toEqual([]);
      expect((await admin.from("partner_signups").select("user_id").eq("user_id", a.user.id)).data).toEqual([]);
    });

    it("borrar la cuenta borra sus peticiones y su pareja", async () => {
      const id = await community();
      const temp = await signInTestUser("Temporal");
      const token = (await ana.client.rpc("get_community_invite", { p_community_id: id })).data!;
      await temp.client.rpc("confirm_adult");
      await temp.client.rpc("join_community", { p_token: token });
      await join(temp, id);
      await join(people[0]!, id);
      await ana.client.rpc("pair_partners_now", { p_community_id: id });
      const pair = (await pairsOf(id))[0]!;
      await temp.client.rpc("add_partner_request", { p_pair_id: pair.id, p_content: "Por mí" });
      await admin.auth.admin.deleteUser(temp.user.id);
      expect(await pairsOf(id)).toEqual([]);
      expect((await admin.from("partner_requests").select("id").eq("pair_id", pair.id)).data).toEqual([]);
    });
  });

  // ───────────────────────── Vista y privacidad ─────────────────────────

  describe("lo que ve cada quien", () => {
    it("partner_overview: programa, mi anotación, mi pareja y (solo para el liderazgo) agregados sin nombres", async () => {
      const id = await community("group", ["Norte"]);
      const [a, b, c] = people as [Person, Person, Person];
      for (const person of [a, b, c]) await join(person, id, "Norte");
      await b.client.rpc("set_partner_paused", { p_community_id: id, p_paused: true });
      await ana.client.rpc("pair_partners_now", { p_community_id: id });

      const asLeader = await overview(ana, id);
      expect(asLeader.is_leader).toBe(true);
      expect(asLeader.stats).toEqual({ signups: 3, paused: 1, pairs_this_week: 1 });
      expect(asLeader.signup).toBeNull();
      expect(asLeader.pair).toBeNull();
      expect(JSON.stringify(asLeader)).not.toContain(a.user.id); // el liderazgo no ve quiénes

      const mine = await overview(a, id);
      expect(mine).toMatchObject({ program: { active: true, mode: "group", labels: ["Norte"] }, signup: { group_label: "Norte", paused: false }, adult_confirmed: true, is_leader: false, stats: null });
      expect(errorOf(await outsider.client.rpc("partner_overview", { p_community_id: id }))).toBe("not_member");
    });

    it("nadie escribe pareja, peticiones ni programa directamente", async () => {
      const id = await community();
      expect((await ana.client.from("partner_programs").update({ active: false }).eq("community_id", id)).data).toBeNull();
      expect((await admin.from("partner_programs").select("active").eq("community_id", id).single()).data!.active).toBe(true);
      expect((await people[0]!.client.from("partner_pairs").insert({ community_id: id, week_start: monday(Date.now()), user_a: people[0]!.user.id, user_b: people[1]!.user.id })).error?.code).toBe("42501");
      expect((await people[0]!.client.from("partner_requests").insert({ pair_id: crypto.randomUUID(), author_id: people[0]!.user.id, content: "x" })).error?.code).toBe("42501");
    });
  });
});
