import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createConfirmedAccount, createRoomAs, joinRoomAs, newPerson, signInThroughUi } from "./helpers";

// Fase 10 (lote 1): compartir por WhatsApp/QR, Google Calendar, guías con temporizador, modo pantalla y estadísticas.
// Requieren el Supabase local (`npm run test:e2e:db`). Solo escritorio.
test.skip(!process.env.SUPABASE_TEST_URL, "requiere Supabase local (npm run test:e2e:db)");
test.skip(({ isMobile }) => isMobile, "se corre solo en escritorio");

const admin = () =>
  createClient(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const cleanups: (() => Promise<unknown>)[] = [];
test.afterAll(async () => {
  await Promise.all(cleanups.map((cleanup) => cleanup().catch(() => undefined)));
});

type Account = Awaited<ReturnType<typeof createConfirmedAccount>>;

async function newAccount(name: string): Promise<Account> {
  const account = await createConfirmedAccount(name);
  cleanups.push(account.cleanup);
  return account;
}

async function signedInPage(browser: Browser, account: Account): Promise<Page> {
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  await signInThroughUi(page, account.email, account.password);
  return page;
}

async function asPerson(account: Account) {
  const client = createClient(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email: account.email, password: account.password });
  if (error) throw new Error(error.message);
  return client;
}

const accessibilityIssues = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );

const roomIdOf = async (roomUrl: string) => (await admin().from("rooms").select("id").eq("code", roomUrl.split("/").pop()!).single()).data!.id;

// ───────────────────────── Compartir (A1) ─────────────────────────

test.describe("compartir la sala por WhatsApp y con QR", () => {
  test("mensaje editable, enlace de WhatsApp sin datos de la sala, copiar y QR; es accesible", async ({ browser }) => {
    const ana = await newAccount("Ana");
    const page = await signedInPage(browser, ana);
    const roomUrl = await createRoomAs(page, "Ana");
    await page.getByLabel("Nueva petición de oración").fill("Una petición privada que NO debe salir");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Una petición privada" })).toBeVisible();

    await page.getByRole("button", { name: "Compartir" }).click();
    const dialog = page.getByRole("dialog", { name: "Compartir la sala" });
    const message = dialog.getByLabel("Mensaje");
    await expect(message).toHaveValue(`Te invito a orar conmigo en INTERCEDE: ${roomUrl}`);

    // El mensaje es editable y el enlace de WhatsApp lo lleva tal cual (y nada más)
    await message.fill(`Ven a orar con nosotros: ${roomUrl}`);
    const href = await dialog.getByRole("link", { name: "WhatsApp" }).getAttribute("href");
    expect(href).toBe(`https://wa.me/?text=${encodeURIComponent(`Ven a orar con nosotros: ${roomUrl}`)}`);
    expect(decodeURIComponent(href!)).not.toContain("petición privada");
    await expect(dialog.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("target", "_blank");
    await expect(dialog.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("rel", /noopener/);

    await dialog.getByRole("button", { name: "Copiar enlace" }).click();
    await expect(dialog.getByRole("button", { name: "Enlace copiado" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(roomUrl);

    await dialog.getByRole("button", { name: "Código QR" }).click();
    const qr = dialog.getByRole("img", { name: "Código QR con el enlace de la sala" });
    await expect(qr).toBeVisible();
    expect(await qr.locator("path").getAttribute("d")).toMatch(/^M\d+ \d+h1v1h-1z/);
    await expect(dialog.getByRole("button", { name: "Pantalla completa" })).toBeVisible();
    expect(await accessibilityIssues(page)).toEqual([]);

    await dialog.getByRole("button", { name: "Cerrar" }).click();
    await expect(dialog).not.toBeVisible();
  });
});

// ───────────────────────── Google Calendar (C6 nivel 1) ─────────────────────────

test.describe("agregar a Google Calendar", () => {
  test("eventos y salas programadas abren Google Calendar ya llenos, sin pedir permisos", async ({ browser }) => {
    const ana = await newAccount("Ana");
    const client = await asPerson(ana);
    const { data: communityId } = await client.rpc("create_community", { p_name: "Iglesia", p_kind: "church" });
    const date = new Date(Date.now() + 3 * 24 * 3_600_000).toISOString().slice(0, 10);
    const { error } = await client.rpc("create_event", { p_community_id: communityId!, p_title: "Vigilia de prueba", p_description: "Una noche de oración", p_date: date, p_time: "20:00", p_timezone: "America/Mexico_City", p_duration_minutes: 120, p_opens_room: false, p_reminder_minutes: 30 });
    expect(error).toBeNull();
    const { error: scheduleError } = await client.rpc("create_schedule", { p_name: "Oración diaria", p_timezone: "America/Mexico_City", p_local_time: "06:00", p_start_date: date, p_weekdays: [], p_recurrence: "daily", p_reminder_minutes: 10 } as never);
    expect(scheduleError).toBeNull();

    const page = await signedInPage(browser, ana);
    await page.goto(`/es/comunidades/${communityId}/eventos`);
    const eventLink = page.getByRole("link", { name: "Google Calendar" }).first();
    const url = new URL((await eventLink.getAttribute("href"))!);
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("Vigilia de prueba");
    expect(url.searchParams.get("ctz")).toBe("America/Mexico_City");
    expect(url.searchParams.get("dates")).toBe(`${date.replaceAll("-", "")}T200000/${date.replaceAll("-", "")}T220000`);
    expect(url.searchParams.get("details")).toContain("Una noche de oración");
    await expect(eventLink).toHaveAttribute("target", "_blank");
    // El .ics para Apple y Outlook sigue disponible
    await expect(page.getByRole("link", { name: "Añadir al calendario" }).first()).toBeVisible();

    await page.goto("/es/programadas");
    const scheduleLink = page.getByRole("link", { name: "Google Calendar" }).first();
    const sched = new URL((await scheduleLink.getAttribute("href"))!);
    expect(sched.searchParams.get("text")).toBe("Oración diaria");
    expect(sched.searchParams.get("recur")).toBe("RRULE:FREQ=DAILY");
    expect(sched.searchParams.get("dates")).toMatch(/^\d{8}T060000\/\d{8}T070000$/);

    await admin().from("communities").delete().eq("id", communityId!);
  });
});

// ───────────────────────── Guías, pantalla y petición en foco ─────────────────────────

test.describe("guías con temporizador y modo pantalla", () => {
  test.describe.configure({ mode: "serial" });

  let ana: Account;
  let beto: Account;
  let anaPage: Page;
  let betoPage: Page;
  let roomUrl = "";
  let roomId = "";

  test.beforeAll(async ({ browser }) => {
    [ana, beto] = await Promise.all([newAccount("Ana"), newAccount("Beto")]);
    [anaPage, betoPage] = await Promise.all([signedInPage(browser, ana), signedInPage(browser, beto)]);
    roomUrl = await createRoomAs(anaPage, "Ana");
    await joinRoomAs(betoPage, roomUrl, "Beto");
    roomId = await roomIdOf(roomUrl);
  });

  test("la anfitriona inicia una guía y todos ven el momento actual y la cuenta regresiva", async () => {
    await expect(betoPage.getByRole("heading", { name: "Guía de oración" })).toHaveCount(0); // sin guía, solo la anfitriona ve el selector
    await anaPage.getByRole("button", { name: "Iniciar una guía" }).click();
    await expect(anaPage.getByText("Silencio y escucha").first()).toBeVisible();
    await expect(anaPage.getByText("El Padre Nuestro, guiado")).toBeVisible();
    expect(await accessibilityIssues(anaPage)).toEqual([]);
    await anaPage.getByRole("listitem").filter({ hasText: "Silencio y escucha" }).getByRole("button", { name: "Comenzar" }).click();

    for (const page of [anaPage, betoPage]) {
      const panel = page.getByRole("region", { name: "Silencio y escucha" });
      await expect(panel.getByText("Momento 1 de 3")).toBeVisible();
      await expect(panel.getByText("Llegar", { exact: true }).first()).toBeVisible();
      await expect(panel.getByText(/^[01]:\d\d$/).first()).toBeVisible();
    }
    // Los demás no ven los controles
    await expect(betoPage.getByRole("button", { name: "Pausar" })).toHaveCount(0);
    await expect(anaPage.getByRole("button", { name: "Pausar" })).toBeVisible();
    expect(await accessibilityIssues(betoPage)).toEqual([]);
  });

  test("pausar, reanudar, siguiente y sumar un minuto llegan a todos al instante", async () => {
    await anaPage.getByRole("button", { name: "Pausar" }).click();
    await expect(betoPage.getByText(/En pausa/).first()).toBeVisible();
    await anaPage.getByRole("button", { name: "Reanudar" }).click();
    await expect(betoPage.getByText(/En pausa/)).toHaveCount(0);

    await anaPage.getByRole("button", { name: "+1 minuto" }).click();
    await expect.poll(async () => (await admin().from("room_guide_runs").select("extra_ms").eq("room_id", roomId).single()).data!.extra_ms).toEqual([60_000, 0, 0]);
    await expect(betoPage.getByText("3 min", { exact: true }).first()).toBeVisible(); // el primer momento pasó de 2 a 3 min

    await anaPage.getByRole("button", { name: "Siguiente" }).click();
    for (const page of [anaPage, betoPage]) {
      await expect(page.getByText("Momento 2 de 3")).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "Silencio y escucha" })).toBeVisible();
    }
    // La cuenta regresiva del segundo momento (10 min) coincide en ambos dispositivos
    const read = async (page: Page) => {
      const text = (await page.getByRole("region", { name: "Silencio y escucha" }).locator("p.font-mono").innerText()).trim();
      const [m, s] = text.split(":").map(Number);
      return m! * 60 + s!;
    };
    const [a, b] = [await read(anaPage), await read(betoPage)];
    expect(Math.abs(a - b)).toBeLessThanOrEqual(2);
    expect(a).toBeGreaterThan(9 * 60);
  });

  test("terminar la guía la quita para todos", async () => {
    await anaPage.getByRole("button", { name: "Terminar guía" }).click();
    await expect(betoPage.getByRole("region", { name: "Silencio y escucha" })).toHaveCount(0);
    await expect(anaPage.getByRole("button", { name: "Iniciar una guía" })).toBeVisible();
  });

  test("petición en foco: la anfitriona la elige y todos ven 'Orando ahora'", async () => {
    await betoPage.getByLabel("Nueva petición de oración").fill("Por la salud de la abuela");
    await betoPage.getByRole("button", { name: "Enviar" }).click();
    const item = anaPage.getByRole("listitem").filter({ hasText: "Por la salud de la abuela" });
    await expect(item).toBeVisible();
    await expect(betoPage.getByRole("button", { name: "Orar por esta" })).toHaveCount(0);

    await item.getByRole("button", { name: "Orar por esta" }).click();
    for (const page of [anaPage, betoPage]) {
      await expect(page.getByRole("listitem").filter({ hasText: "Por la salud de la abuela" }).getByText("Orando ahora")).toBeVisible();
    }
    await expect(item.getByRole("button", { name: "Quitar del foco" })).toBeVisible();
  });

  test("modo pantalla: enlace secreto, proyecta la petición en foco sin nombres y se puede revocar", async ({ browser }) => {
    await anaPage.getByRole("button", { name: "Pantalla" }).click();
    const dialog = anaPage.getByRole("dialog", { name: "Pantalla para proyectar" });
    await dialog.getByRole("button", { name: "Crear enlace de pantalla" }).click();
    const url = (await dialog.getByTestId("display-url").innerText()).trim();
    expect(url).toMatch(/\/es\/r\/[a-hj-km-np-z2-9]{6}\/display\?t=[A-Za-z0-9_-]{20,}$/);
    // El participante no ve el enlace (RLS): solo la anfitriona
    expect((await admin().from("room_display_links").select("token").eq("room_id", roomId)).data).toHaveLength(1);
    await dialog.getByRole("button", { name: "Cerrar" }).click();

    // La pantalla no tiene sesión: es otra persona (contexto limpio)
    const screen = await newPerson(browser);
    await screen.goto(url);
    await expect(screen.getByTestId("display-focus")).toHaveText("Por la salud de la abuela");
    await expect(screen.getByTestId("display-code")).toHaveText(roomUrl.split("/").pop()!);
    await expect(screen.getByRole("img", { name: "Código QR para entrar a la sala" })).toBeVisible();
    // Nada de personas en lo que se proyecta
    const body = await screen.locator("body").innerText();
    expect(body).not.toMatch(/Beto/); // el nombre de quien escribió la petición nunca se proyecta
    expect(await accessibilityIssues(screen)).toEqual([]);
    expect(await screen.locator('meta[name="robots"]').getAttribute("content")).toContain("noindex");

    // Cambiar el foco se refleja en la pantalla (se actualiza sola)
    await betoPage.getByLabel("Nueva petición de oración").fill("Por el trabajo de Luis");
    await betoPage.getByRole("button", { name: "Enviar" }).click();
    await anaPage.getByRole("listitem").filter({ hasText: "Por el trabajo de Luis" }).getByRole("button", { name: "Orar por esta" }).click();
    await expect(screen.getByTestId("display-focus")).toHaveText("Por el trabajo de Luis", { timeout: 15_000 });

    // Una guía en curso también se proyecta
    await anaPage.getByRole("button", { name: "Iniciar una guía" }).click();
    await anaPage.getByRole("listitem").filter({ hasText: "Oración por la nación" }).getByRole("button", { name: "Comenzar" }).click();
    await expect(screen.getByText("Gratitud por nuestra nación")).toBeVisible({ timeout: 15_000 });

    // Revocar el enlace lo apaga
    await anaPage.getByRole("button", { name: "Pantalla" }).click();
    await anaPage.getByRole("dialog", { name: "Pantalla para proyectar" }).getByRole("button", { name: "Desactivar" }).click();
    await expect(anaPage.getByRole("dialog", { name: "Pantalla para proyectar" }).getByRole("button", { name: "Crear enlace de pantalla" })).toBeVisible();
    await expect(screen.getByRole("heading", { name: "Este enlace ya no sirve" })).toBeVisible({ timeout: 15_000 });
    // Un enlace con token inventado tampoco entra
    await screen.goto(url.replace(/t=.*$/, "t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
    await expect(screen.getByRole("heading", { name: "Este enlace ya no sirve" })).toBeVisible();
  });
});

// ───────────────────────── Guías propias y estadísticas de la comunidad ─────────────────────────

test.describe("guías propias y estadísticas", () => {
  test.describe.configure({ mode: "serial" });

  let ana: Account; // administra
  let beto: Account; // miembro
  let anaPage: Page;
  let betoPage: Page;
  let communityId = "";

  test.beforeAll(async ({ browser }) => {
    [ana, beto] = await Promise.all([newAccount("Ana"), newAccount("Beto")]);
    const client = await asPerson(ana);
    const { data } = await client.rpc("create_community", { p_name: "Iglesia de prueba", p_kind: "church" });
    communityId = data!;
    const token = (await client.rpc("get_community_invite", { p_community_id: communityId })).data!;
    await (await asPerson(beto)).rpc("join_community", { p_token: token });
    [anaPage, betoPage] = await Promise.all([signedInPage(browser, ana), signedInPage(browser, beto)]);
  });

  test.afterAll(async () => {
    if (communityId) await admin().from("communities").delete().eq("id", communityId);
  });

  test("el liderazgo crea una guía propia; los miembros no ven el panel ni las secciones", async () => {
    await anaPage.goto(`/es/comunidades/${communityId}`);
    const nav = anaPage.getByRole("navigation", { name: "Secciones de la comunidad" });
    await nav.getByRole("link", { name: "Guías" }).click();
    await expect(anaPage).toHaveURL(new RegExp(`/comunidades/${communityId}/guias$`));

    await anaPage.getByRole("button", { name: "Nueva guía" }).click();
    await anaPage.getByLabel("Título", { exact: true }).fill("Vigilia de jóvenes");
    await anaPage.getByLabel("Título del momento 1").fill("Alabanza");
    await anaPage.getByLabel("Minutos").first().fill("4");
    await anaPage.getByLabel("Título del momento 2").fill("Intercesión");
    await anaPage.getByLabel("Minutos").nth(1).fill("12");
    await expect(anaPage.getByText("16 minutos en total")).toBeVisible();
    expect(await accessibilityIssues(anaPage)).toEqual([]);
    await anaPage.getByRole("button", { name: "Guardar guía" }).click();
    await expect(anaPage.getByRole("heading", { level: 3, name: "Vigilia de jóvenes" })).toBeVisible();
    await expect(anaPage.getByText("Alabanza · 4 min")).toBeVisible();

    // Un momento sin título no se envía (el campo es obligatorio)
    await anaPage.getByRole("button", { name: "Nueva guía" }).click();
    await anaPage.getByLabel("Título", { exact: true }).fill("Incompleta");
    await anaPage.getByRole("button", { name: "Guardar guía" }).click();
    await expect(anaPage.getByLabel("Título del momento 1")).toBeFocused();
    await expect(anaPage.getByRole("heading", { level: 3, name: "Incompleta" })).toHaveCount(0);
    await anaPage.getByRole("button", { name: "Cancelar" }).first().click();

    // Quien solo es miembro no ve las secciones del liderazgo y las páginas responden 404
    await betoPage.goto(`/es/comunidades/${communityId}`);
    const betoNav = betoPage.getByRole("navigation", { name: "Secciones de la comunidad" });
    await expect(betoNav.getByRole("link", { name: "Guías" })).toHaveCount(0);
    await expect(betoNav.getByRole("link", { name: "Estadísticas" })).toHaveCount(0);
    expect((await betoPage.goto(`/es/comunidades/${communityId}/guias`))?.status()).toBe(404);
    expect((await betoPage.goto(`/es/comunidades/${communityId}/estadisticas`))?.status()).toBe(404);
  });

  test("la guía de la comunidad se puede usar en sus salas y solo ahí", async () => {
    const guideId = (await admin().from("prayer_guides").select("id").eq("community_id", communityId).single()).data!.id;
    const client = await asPerson(ana);
    const { data } = await client.rpc("create_community_room", { p_community_id: communityId, p_name: "Sala", p_display_name: "Ana" });
    expect((await client.rpc("start_guide", { p_room_id: data![0]!.room_id, p_guide_id: guideId })).error).toBeNull();
    const personal = (await client.rpc("create_room", { p_name: "Personal", p_display_name: "Ana" })).data![0]!;
    expect((await client.rpc("start_guide", { p_room_id: personal.room_id, p_guide_id: guideId })).error?.message).toBe("guide_wrong_community");
  });

  test("estadísticas: con pocas personas el tiempo sale oculto; el CSV trae solo agregados", async () => {
    // Una sala con actividad de 2 personas: no llega a 5, así que el tiempo se oculta
    const client = await asPerson(ana);
    const { data } = await client.rpc("create_community_room", { p_community_id: communityId, p_name: "Sala con gente", p_display_name: "Ana" });
    const roomId = data![0]!.room_id;
    for (const [i, userId] of [ana.userId, beto.userId].entries()) {
      await admin().rpc("record_usage", { p_event_id: `e2e_${crypto.randomUUID()}_${i}`, p_room_id: roomId, p_user_id: userId, p_joined_at: new Date(Date.now() - 30 * 60_000).toISOString(), p_left_at: new Date().toISOString() });
    }

    await anaPage.goto(`/es/comunidades/${communityId}/estadisticas`);
    await expect(anaPage.getByText("Solo se muestran totales de la comunidad")).toBeVisible();
    const hours = anaPage.getByRole("term").filter({ hasText: "Horas de oración" }).locator("xpath=following-sibling::dd[1]");
    await expect(hours).toHaveText("Oculto");
    await expect(anaPage.getByText("Menos de 5 personas").first()).toBeVisible();
    await expect(anaPage.getByRole("table", { name: "Indicadores agregados por semana de la comunidad" })).toBeVisible();
    expect(await accessibilityIssues(anaPage)).toEqual([]);

    const csv = await anaPage.request.get(`/api/communities/${communityId}/stats`);
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const text = await csv.text();
    expect(text.startsWith("﻿semana,salas,horas_persona")).toBe(true);
    expect(text).not.toContain(ana.userId);
    expect(text).not.toContain(beto.userId);
    // El último renglón (semana actual): 1+ sala y horas vacías
    const last = text.trim().split("\r\n").at(-1)!.split(",");
    expect(Number(last[1])).toBeGreaterThanOrEqual(1);
    expect(last[2]).toBe("");
    // Sin sesión no hay CSV
    expect((await (await anaPage.context().browser()!.newContext()).request.get(`${new URL(anaPage.url()).origin}/api/communities/${communityId}/stats`)).status()).toBe(401);
  });

  test("con 5 personas el tiempo se muestra; sin plan de pago las estadísticas están bloqueadas", async () => {
    const extra = await Promise.all(Array.from({ length: 3 }, async () => (await admin().auth.admin.createUser({ email: `st-${crypto.randomUUID()}@example.test`, email_confirm: true })).data.user!.id));
    cleanups.push(...extra.map((id) => () => admin().auth.admin.deleteUser(id)));
    const client = await asPerson(ana);
    const { data } = await client.rpc("create_community_room", { p_community_id: communityId, p_name: "Sala llena", p_display_name: "Ana" });
    for (const [i, userId] of [ana.userId, beto.userId, ...extra].entries()) {
      await admin().rpc("record_usage", { p_event_id: `e2e5_${crypto.randomUUID()}_${i}`, p_room_id: data![0]!.room_id, p_user_id: userId, p_joined_at: new Date(Date.now() - 60 * 60_000).toISOString(), p_left_at: new Date().toISOString() });
    }
    // Las pruebas anteriores dejaron una semana con 2 personas, pero ahora ya son 5 distintas en la semana
    await anaPage.goto(`/es/comunidades/${communityId}/estadisticas`);
    await expect(anaPage.getByRole("term").filter({ hasText: "Horas de oración" }).locator("xpath=following-sibling::dd[1]")).toHaveText(/^\d+(,\d+)? h$/);

    await admin().from("subscriptions").update({ current_period_end: new Date(Date.now() - 60_000).toISOString() }).eq("community_id", communityId);
    await anaPage.goto(`/es/comunidades/${communityId}/estadisticas`);
    await expect(anaPage.getByRole("heading", { name: "Las estadísticas son de los planes Plus y Pro" })).toBeVisible();
    await anaPage.getByRole("link", { name: "Ver planes" }).click();
    await expect(anaPage).toHaveURL(new RegExp(`/comunidades/${communityId}/facturacion$`));
    // Y las guías propias avisan que necesitan plan
    await anaPage.goto(`/es/comunidades/${communityId}/guias`);
    await expect(anaPage.getByText("Las guías propias son de comunidades con plan Plus o Pro.")).toBeVisible();
  });
});
