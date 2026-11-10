import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";
import sharp from "sharp";
import { createConfirmedAccount, newPerson, signInThroughUi } from "./helpers";

// Fase 7: comunidades (capa 3). Requieren el Supabase local (`npm run test:e2e:db`). Solo escritorio.
test.skip(!process.env.SUPABASE_TEST_URL, "requiere Supabase local (npm run test:e2e:db)");
test.skip(({ isMobile }) => isMobile, "se corre solo en escritorio");

const admin = () =>
  createClient(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const cleanups: (() => Promise<unknown>)[] = [];
test.afterAll(async () => {
  await Promise.all(cleanups.map((cleanup) => cleanup()));
});

type Account = Awaited<ReturnType<typeof createConfirmedAccount>>;

async function newAccount(name: string): Promise<Account> {
  const account = await createConfirmedAccount(name);
  cleanups.push(account.cleanup);
  return account;
}

async function signedInPage(browser: Browser, account: Account): Promise<Page> {
  const page = await newPerson(browser);
  await signInThroughUi(page, account.email, account.password);
  return page;
}

const accessibilityIssues = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );

const sections = (page: Page) => page.getByRole("navigation", { name: "Secciones de la comunidad" });
/** Va directo a la sección (las pestañas se comprueban una vez, en la prueba de crear). */
const goTo = async (page: Page, communityUrl: string, _section: string, path: string) => {
  await page.goto(`${communityUrl}${path}`);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
};

test.describe("comunidades", () => {
  test.describe.configure({ mode: "serial" });

  let ana: Account; // administración
  let beto: Account; // liderazgo
  let carla: Account; // miembro
  let dani: Account; // sin relación
  let anaPage: Page;
  let betoPage: Page;
  let carlaPage: Page;
  let daniPage: Page;
  let communityUrl = "";
  let communityId = "";
  let inviteUrl = "";

  test.beforeAll(async ({ browser }) => {
    [ana, beto, carla, dani] = await Promise.all([newAccount("Ana"), newAccount("Beto"), newAccount("Carla"), newAccount("Dani")]);
    [anaPage, betoPage, carlaPage, daniPage] = await Promise.all([
      signedInPage(browser, ana),
      signedInPage(browser, beto),
      signedInPage(browser, carla),
      signedInPage(browser, dani),
    ]);
  });

  test("sin comunidades no hay pestaña; el perfil enlaza a la pantalla para crear o unirse", async () => {
    const tabs = anaPage.getByRole("navigation", { name: "Navegación de tu cuenta" });
    await expect(tabs.getByRole("link", { name: "Comunidades" })).toHaveCount(0);
    await anaPage.goto("/es/perfil");
    await anaPage.getByRole("link", { name: /Comunidades/ }).click();
    await expect(anaPage).toHaveURL(/\/es\/comunidades$/);
    await expect(anaPage.getByRole("heading", { level: 1, name: "Comunidades" })).toBeVisible();
    await expect(anaPage.getByText("Todavía no perteneces a ninguna comunidad.")).toBeVisible();
    expect(await accessibilityIssues(anaPage)).toEqual([]);
  });

  test("crear una comunidad: quedas como administración y aparece la pestaña", async () => {
    await anaPage.getByRole("button", { name: "Crear comunidad" }).click();
    await expect(anaPage.getByRole("alert").filter({ hasText: "Escribe un nombre" })).toBeVisible();

    await anaPage.getByLabel("Nombre").fill("Iglesia e2e");
    await anaPage.getByLabel("Tipo").selectOption("church");
    await anaPage.getByLabel("Descripción (opcional)").fill("Orando juntos desde la prueba");
    await anaPage.getByRole("button", { name: "Crear comunidad" }).click();

    await expect(anaPage).toHaveURL(/\/es\/comunidades\/[0-9a-f-]{36}$/);
    communityUrl = new URL(anaPage.url()).pathname;
    communityId = communityUrl.split("/").pop()!;
    await expect(anaPage.getByRole("heading", { level: 1, name: "Iglesia e2e" })).toBeVisible();
    await expect(anaPage.getByText("Iglesia · Administración")).toBeVisible();
    await expect(anaPage.getByText("Orando juntos desde la prueba")).toBeVisible();
    await expect(sections(anaPage).getByRole("link", { name: "Ajustes" })).toBeVisible();
    for (const [name, path] of [["Muro", ""], ["Salas", "/salas"], ["Eventos", "/eventos"], ["Devocional", "/devocional"], ["Miembros", "/miembros"]] as const) {
      await expect(sections(anaPage).getByRole("link", { name, exact: true })).toHaveAttribute("href", `${communityUrl}${path}`);
    }
    await expect(anaPage.getByRole("navigation", { name: "Navegación de tu cuenta" }).getByRole("link", { name: "Comunidades" })).toBeVisible();
    expect(await accessibilityIssues(anaPage)).toEqual([]);
  });

  test("el enlace de invitación: quien no tiene cuenta debe crearla; con cuenta se une", async ({ page }) => {
    await goTo(anaPage, communityUrl, "Miembros", "/miembros");
    await expect(anaPage.getByTestId("community-invite-url")).toHaveText(/\/es\/c\/[A-Za-z0-9_-]{16,}$/);
    inviteUrl = ((await anaPage.getByTestId("community-invite-url").textContent()) ?? "").trim();
    expect(await accessibilityIssues(anaPage)).toEqual([]);

    // Sin sesión: se ve de qué comunidad es y se pide cuenta (con el regreso a la invitación)
    await page.goto(inviteUrl);
    await expect(page.getByRole("heading", { level: 1, name: "Iglesia e2e" })).toBeVisible();
    await expect(page.getByText("Iglesia · 1 persona")).toBeVisible();
    const next = encodeURIComponent(new URL(inviteUrl).pathname.replace(/^\/es/, ""));
    await expect(page.getByRole("link", { name: "Crear cuenta" })).toHaveAttribute("href", `/es/registro?next=${next}`);
    expect(await accessibilityIssues(page)).toEqual([]);

    for (const [person, name] of [
      [betoPage, "Beto"],
      [carlaPage, "Carla"],
    ] as const) {
      await person.goto(inviteUrl);
      await expect(person.getByRole("heading", { level: 1, name: "Iglesia e2e" })).toBeVisible();
      await person.getByRole("button", { name: "Unirme a la comunidad" }).click();
      await expect(person).toHaveURL(communityUrl);
      await expect(person.getByText("Iglesia · Miembro")).toBeVisible();
      expect(name).toBeTruthy();
    }
  });

  test("quien no es de la comunidad no la ve (404) ni por la dirección directa", async () => {
    const response = await daniPage.goto(communityUrl);
    expect(response?.status()).toBe(404);
    await daniPage.goto("/es/comunidades");
    await expect(daniPage.getByText("Todavía no perteneces a ninguna comunidad.")).toBeVisible();
    // Un código inválido no revela nada
    await daniPage.getByLabel("Enlace o código de invitación").fill("esto-no-es-un-enlace-valido-de-verdad-1234567890");
    await daniPage.getByRole("button", { name: "Unirme", exact: true }).click();
    await expect(daniPage.getByRole("alert").filter({ hasText: "Ese enlace ya no sirve" })).toBeVisible();
  });

  test("la administración nombra al liderazgo; el liderazgo ve el enlace y los miembros no", async () => {
    await anaPage.reload();
    await anaPage.waitForLoadState("networkidle"); // que la pantalla ya esté lista para recibir el cambio
    await anaPage.getByLabel("Rol de Beto").selectOption("leader");
    await expect.poll(async () => (await admin().from("community_members").select("role").eq("community_id", communityId).eq("user_id", beto.userId).single()).data?.role).toBe("leader");

    await betoPage.goto(`${communityUrl}/miembros`);
    await expect(betoPage.getByText("Iglesia · Liderazgo")).toBeVisible();
    await expect(betoPage.getByTestId("community-invite-url")).toBeVisible();
    await expect(betoPage.getByRole("button", { name: "Revocar y crear otro" })).toHaveCount(0); // solo administración
    await expect(sections(betoPage).getByRole("link", { name: "Ajustes" })).toHaveCount(0);

    await carlaPage.goto(`${communityUrl}/miembros`);
    await expect(carlaPage.getByTestId("community-invite-url")).toHaveCount(0);
    await expect(carlaPage.getByRole("button", { name: "Quitar" })).toHaveCount(0);
    expect((await carlaPage.goto(`${communityUrl}/ajustes`))?.status()).toBe(404);
  });

  test("muro de oración: visibilidad, apoyo, testimonio y moderación", async ({ browser }) => {
    await carlaPage.goto(communityUrl);
    await expect(carlaPage.getByText("Aún no hay peticiones")).toBeVisible();
    expect(await accessibilityIssues(carlaPage)).toEqual([]);

    const post = async (page: Page, text: string, visibility: "community" | "leaders" = "community") => {
      await page.getByRole("textbox", { name: "Nueva petición" }).fill(text);
      await page.getByLabel("¿Quién la ve?").selectOption(visibility);
      await page.getByRole("button", { name: "Publicar" }).click();
      await expect(page.getByRole("article").filter({ hasText: text })).toBeVisible();
    };
    await post(carlaPage, "Por mi familia");
    await post(carlaPage, "Algo pastoral", "leaders");
    await expect(carlaPage.getByRole("article").filter({ hasText: "Algo pastoral" }).getByText("Solo liderazgo")).toBeVisible();

    // Beto (liderazgo) ve las dos; un miembro corriente (Dani, tras unirse) solo la abierta
    await betoPage.goto(communityUrl);
    await expect(betoPage.getByRole("article").filter({ hasText: "Algo pastoral" })).toBeVisible();
    await expect(betoPage.getByRole("article").filter({ hasText: "Por mi familia" })).toBeVisible();

    await daniPage.goto(inviteUrl);
    await daniPage.getByRole("button", { name: "Unirme a la comunidad" }).click();
    await expect(daniPage).toHaveURL(communityUrl);
    await expect(daniPage.getByRole("article").filter({ hasText: "Por mi familia" })).toBeVisible();
    await expect(daniPage.getByText("Algo pastoral")).toHaveCount(0);

    // Orar por una petición ajena (no hay botón en la propia)
    const familyOnDani = daniPage.getByRole("article").filter({ hasText: "Por mi familia" });
    await familyOnDani.getByRole("button", { name: "Estoy orando por esto" }).click();
    await expect(familyOnDani.getByText("1 persona ora por esto")).toBeVisible();
    await expect(familyOnDani.getByRole("button", { name: "Dejar de orar por esto" })).toHaveAttribute("aria-pressed", "true");
    // El muro no es en vivo: Beto recarga para ver lo que ya oraron los demás
    await betoPage.reload();
    const familyOnBeto = betoPage.getByRole("article").filter({ hasText: "Por mi familia" });
    await familyOnBeto.getByRole("button", { name: "Estoy orando por esto" }).click();
    await expect(familyOnBeto.getByText("2 personas oran por esto")).toBeVisible();
    await expect(carlaPage.getByRole("article").filter({ hasText: "Por mi familia" }).getByRole("button", { name: "Estoy orando por esto" })).toHaveCount(0);
    await carlaPage.reload();
    await expect(carlaPage.getByRole("article").filter({ hasText: "Por mi familia" }).getByText("2 personas oran por esto")).toBeVisible();

    // La autora la marca como respondida con testimonio
    const mine = carlaPage.getByRole("article").filter({ hasText: "Por mi familia" });
    await mine.getByRole("button", { name: "Marcar como respondida" }).click();
    await mine.getByLabel("Testimonio").fill("Dios abrió camino");
    await mine.getByRole("button", { name: "Guardar testimonio" }).click();
    await expect(mine.getByText("Oración respondida")).toBeVisible();
    await expect(mine.getByText("Dios abrió camino")).toBeVisible();
    // Un miembro corriente no puede borrarla; el liderazgo sí (moderación)
    await daniPage.reload();
    await expect(daniPage.getByRole("article").filter({ hasText: "Por mi familia" }).getByRole("button", { name: "Eliminar" })).toHaveCount(0);
    await betoPage.reload();
    const pastoral = betoPage.getByRole("article").filter({ hasText: "Algo pastoral" });
    await pastoral.getByRole("button", { name: "Eliminar" }).click();
    await pastoral.getByRole("button", { name: "Sí, eliminar" }).click();
    await expect(betoPage.getByText("Algo pastoral")).toHaveCount(0);
    expect(browser).toBeTruthy();
  });

  test("salas: el liderazgo abre una; la comunidad entra y los de fuera no", async ({ browser }) => {
    await goTo(betoPage, communityUrl, "Salas", "/salas");
    await expect(betoPage.getByText("No hay salas abiertas en este momento.")).toBeVisible();
    await betoPage.getByLabel("Nombre de la sala").fill("Oración de jóvenes");
    await betoPage.getByLabel("¿Cómo te llamas en la sala?").fill("Beto");
    await betoPage.getByRole("button", { name: "Abrir sala" }).click();
    await expect(betoPage).toHaveURL(/\/es\/r\/[a-hj-km-np-z2-9]{6}$/);
    await expect(betoPage.getByRole("heading", { level: 2, name: "Peticiones" })).toBeVisible();
    const roomUrl = betoPage.url();

    // Carla (miembro) no ve el formulario de abrir; ve la sala abierta y entra
    await goTo(carlaPage, communityUrl, "Salas", "/salas");
    await expect(carlaPage.getByRole("button", { name: "Abrir sala" })).toHaveCount(0);
    await expect(carlaPage.getByRole("listitem").filter({ hasText: "Oración de jóvenes" })).toBeVisible();
    await carlaPage.getByRole("link", { name: "Entrar" }).click();
    await carlaPage.getByLabel("¿Cómo te llamas?").fill("Carla");
    await carlaPage.getByRole("button", { name: "Entrar a la sala" }).click();
    await expect(carlaPage.getByRole("heading", { level: 2, name: "Peticiones" })).toBeVisible();

    // Alguien de fuera con el código no entra
    const outsider = await newAccount("Fuera");
    const outsiderPage = await signedInPage(browser, outsider);
    await outsiderPage.goto(roomUrl);
    await outsiderPage.getByLabel("¿Cómo te llamas?").fill("Fuera");
    await outsiderPage.getByRole("button", { name: "Entrar a la sala" }).click();
    await expect(outsiderPage.getByRole("alert").filter({ hasText: "Esta sala es de una comunidad" })).toBeVisible();
  });

  test("salas programadas de la comunidad: el liderazgo programa, los miembros siguen y las ven en sus programadas", async () => {
    await goTo(betoPage, communityUrl, "Salas", "/salas");
    await betoPage.getByLabel("Nombre", { exact: true }).fill("Vigilia semanal");
    await betoPage.getByText("Todos los días", { exact: true }).click();
    await betoPage.getByRole("button", { name: "Programar sala" }).click();
    const card = betoPage.getByRole("article").filter({ hasText: "Vigilia semanal" });
    await expect(card.getByText("Todos los días a las 06:00")).toBeVisible();
    expect(await accessibilityIssues(betoPage)).toEqual([]);
    // Una programación de comunidad no ofrece enlace de invitación (se sigue siendo miembro)
    await expect(card.getByTestId("invite-url")).toHaveCount(0);

    await goTo(carlaPage, communityUrl, "Salas", "/salas");
    const carlasCard = carlaPage.getByRole("article").filter({ hasText: "Vigilia semanal" });
    await expect(carlasCard.getByRole("button", { name: "Pausar" })).toHaveCount(0);
    await expect(carlasCard.getByRole("button", { name: "Eliminar" })).toHaveCount(0);
    await carlasCard.getByRole("button", { name: "Seguir" }).click();
    await expect(carlasCard.getByRole("button", { name: "Dejar de seguir" })).toBeVisible();

    await carlaPage.goto("/es/programadas");
    await expect(carlaPage.getByRole("region", { name: "Las que sigo" }).getByRole("heading", { level: 3, name: "Vigilia semanal" })).toBeVisible();
    // En la pantalla personal de quien la creó no aparece: se administra en la comunidad
    await betoPage.goto("/es/programadas");
    await expect(betoPage.getByRole("heading", { level: 3, name: "Vigilia semanal" })).toHaveCount(0);
    // La administración puede pausarla aunque no la creó
    await anaPage.goto(`${communityUrl}/salas`);
    const anaCard = anaPage.getByRole("article").filter({ hasText: "Vigilia semanal" });
    await anaCard.getByRole("button", { name: "Pausar" }).click();
    await expect(anaCard.getByText("Pausada")).toBeVisible();
  });

  test("devocional de la comunidad: el liderazgo publica y los miembros lo leen", async () => {
    await goTo(carlaPage, communityUrl, "Devocional", "/devocional");
    await expect(carlaPage.getByRole("heading", { level: 2, name: "Hoy no hay devocional de la comunidad" })).toBeVisible();
    await expect(carlaPage.getByText("Publicar un devocional")).toHaveCount(0);

    await goTo(betoPage, communityUrl, "Devocional", "/devocional");
    await betoPage.getByRole("textbox", { name: "Versión bíblica" }).fill("Versión de prueba");
    await betoPage.getByRole("textbox", { name: "Pasaje (referencia)" }).fill("Pasaje comunitario 2:2");
    await betoPage.getByRole("textbox", { name: "Texto del pasaje" }).fill("Texto del pasaje de la comunidad.");
    await betoPage.getByRole("textbox", { name: "Reflexión" }).fill("Reflexión para la comunidad.");
    await betoPage.getByRole("textbox", { name: "Para pensar" }).fill("¿Cómo oraremos juntos?");
    await betoPage.getByRole("button", { name: "Publicar devocional" }).click();
    await expect(betoPage.getByText("Devocional publicado")).toBeVisible();
    // Repetir el mismo día no se permite
    await betoPage.getByRole("textbox", { name: "Pasaje (referencia)" }).fill("Otro 1:1");
    await betoPage.getByRole("textbox", { name: "Texto del pasaje" }).fill("Otro texto");
    await betoPage.getByRole("textbox", { name: "Reflexión" }).fill("Otra");
    await betoPage.getByRole("textbox", { name: "Para pensar" }).fill("¿Otra?");
    await betoPage.getByRole("button", { name: "Publicar devocional" }).click();
    await expect(betoPage.getByRole("alert").filter({ hasText: "Ya hay un devocional de la comunidad para ese día" })).toBeVisible();

    await carlaPage.reload();
    await expect(carlaPage.getByRole("heading", { level: 2, name: "Pasaje comunitario 2:2" })).toBeVisible();
    expect(await accessibilityIssues(carlaPage)).toEqual([]);
    expect(await accessibilityIssues(betoPage)).toEqual([]);
    await expect(carlaPage.getByText("Texto del pasaje de la comunidad.")).toBeVisible();
    await carlaPage.getByRole("button", { name: "Marcar como leído" }).click();
    await expect(carlaPage.getByRole("status").filter({ hasText: "Leído" })).toBeVisible();
    // La racha del devocional general no se mezcla con el de la comunidad
    await expect(carlaPage.getByText("Empieza tu racha hoy")).toHaveCount(0);
  });

  test("eventos: crear, confirmar asistencia, añadir al calendario y abrir la sala a su hora", async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await goTo(betoPage, communityUrl, "Eventos", "/eventos");
    await expect(betoPage.getByText("No hay eventos próximos.")).toBeVisible();

    await betoPage.getByLabel("Título", { exact: true }).fill("Vigilia de ayuno");
    await betoPage.getByLabel("Descripción (opcional)").fill("Toda la noche, trae tu Biblia");
    await betoPage.getByLabel("Fecha", { exact: true }).fill(tomorrow);
    await betoPage.getByLabel("Hora", { exact: true }).fill("20:00");
    await betoPage.getByLabel("Zona horaria", { exact: true }).selectOption("America/Mexico_City");
    await betoPage.getByLabel("Abrir una sala de oración a la hora del evento").check();
    await betoPage.getByRole("button", { name: "Crear evento" }).click();
    const card = betoPage.getByRole("article").filter({ hasText: "Vigilia de ayuno" });
    await expect(card.getByRole("heading", { level: 3, name: "Vigilia de ayuno" })).toBeVisible();
    await expect(card.getByText("Hora de America/Mexico_City")).toBeVisible();
    await expect(card.getByText("20:00")).toBeVisible(); // la hora local del lugar del evento
    await expect(card.getByText("Se abrirá una sala de oración a la hora del evento")).toBeVisible();
    expect(await accessibilityIssues(betoPage)).toEqual([]);

    // Carla confirma y cambia su respuesta
    await goTo(carlaPage, communityUrl, "Eventos", "/eventos");
    const carlasCard = carlaPage.getByRole("article").filter({ hasText: "Vigilia de ayuno" });
    await expect(carlasCard.getByText("Nadie confirmó aún")).toBeVisible();
    await carlasCard.getByRole("button", { name: "Tal vez" }).click();
    await expect(carlasCard.getByText("Nadie confirmó aún · 1 tal vez")).toBeVisible();
    await carlasCard.getByRole("button", { name: "Voy", exact: true }).click();
    await expect(carlasCard.getByTestId("rsvp-summary")).toHaveText("1 persona va");
    await expect(carlasCard.getByRole("button", { name: "Voy", exact: true })).toHaveAttribute("aria-pressed", "true");
    await carlaPage.reload();
    await expect(carlaPage.getByRole("article").filter({ hasText: "Vigilia de ayuno" }).getByTestId("rsvp-summary")).toHaveText("1 persona va");

    // Calendario (.ics): solo quien es de la comunidad lo descarga
    const eventId = (await admin().from("events").select("id").eq("community_id", communityId).single()).data!.id;
    const ics = await carlaPage.request.get(`/api/events/${eventId}/ics`);
    expect(ics.status()).toBe(200);
    expect(ics.headers()["content-type"]).toContain("text/calendar");
    expect(ics.headers()["content-disposition"]).toContain("vigilia-de-ayuno.ics");
    expect(ics.headers()["cache-control"]).toContain("no-store");
    const body = await ics.text();
    expect(body).toContain("BEGIN:VEVENT");
    expect(body).toContain("SUMMARY:Vigilia de ayuno");
    expect(body).toContain("DESCRIPTION:Toda la noche\\, trae tu Biblia");
    // 20:00 en Ciudad de México (UTC−6) = 02:00 UTC del día siguiente
    expect(body).toMatch(/DTSTART:\d{8}T020000Z/);
    expect((await daniPage.request.get(`/api/events/${crypto.randomUUID()}/ics`)).status()).toBe(404);
    const stranger = await newAccount("Extraña");
    const strangerPage = await signedInPage(carlaPage.context().browser()!, stranger);
    expect((await strangerPage.request.get(`/api/events/${eventId}/ics`)).status()).toBe(404);
    expect((await carlaPage.context().browser()!.newContext().then((c) => c.request.get(`${new URL(carlaPage.url()).origin}/api/events/${eventId}/ics`))).status()).toBe(401);

    // A la hora del evento se abre la sala y se avisa a quien va
    const now = Date.now();
    await admin().from("events").update({ starts_at: new Date(now - 60_000).toISOString(), ends_at: new Date(now + 3_600_000).toISOString() }).eq("id", eventId);
    expect((await admin().rpc("process_scheduled_work")).error).toBeNull();
    await carlaPage.reload();
    await expect(carlaPage.getByRole("link", { name: "Entrar a la sala" })).toBeVisible();
    await carlaPage.goto("/es/avisos");
    await expect(carlaPage.getByRole("region", { name: "Recientes" }).getByText("Ya empezó: entra a la sala de oración")).toBeVisible();
  });

  test("ajustes: la administración edita, sube el logo y elimina; los demás no", async () => {
    await goTo(anaPage, communityUrl, "Ajustes", "/ajustes");
    expect(await accessibilityIssues(anaPage)).toEqual([]);
    await anaPage.getByLabel("Nombre", { exact: true }).fill("Iglesia e2e (editada)");
    await anaPage.getByLabel("Tipo").selectOption("ministry");
    await anaPage.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(anaPage.getByText("Cambios guardados")).toBeVisible();
    await expect(anaPage.getByRole("heading", { level: 1, name: "Iglesia e2e (editada)" })).toBeVisible();
    await expect(anaPage.getByText("Ministerio · Administración")).toBeVisible();
    await carlaPage.goto(communityUrl);
    await expect(carlaPage.getByRole("heading", { level: 1, name: "Iglesia e2e (editada)" })).toBeVisible();

    const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#5B2EE6" } }).png().toBuffer();
    await anaPage.locator('input[type="file"]').setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
    await expect(anaPage.locator('img[src*="/community-logos/"]').first()).toBeVisible();
    await expect(anaPage.getByRole("button", { name: "Quitar logo" })).toBeVisible();
    await carlaPage.reload();
    await expect(carlaPage.locator('img[src*="/community-logos/"]').first()).toBeVisible();
    const logo = await carlaPage.locator('img[src*="/community-logos/"]').first().getAttribute("src");
    expect((await carlaPage.request.get(logo!)).status()).toBe(200); // el logo es público: se ve en la invitación

    await anaPage.getByRole("button", { name: "Quitar logo" }).click();
    await expect(anaPage.locator('img[src*="/community-logos/"]')).toHaveCount(0);

    // Salir: Carla se va; la única administradora no puede irse sin nombrar a otra
    await carlaPage.goto(`${communityUrl}/miembros`);
    await carlaPage.getByRole("button", { name: "Salir de la comunidad" }).click();
    await carlaPage.getByRole("button", { name: "Sí, salir" }).click();
    await expect(carlaPage).toHaveURL(/\/es\/comunidades$/);
    expect((await carlaPage.goto(communityUrl))?.status()).toBe(404);
    await anaPage.goto(`${communityUrl}/miembros`);
    await anaPage.getByRole("button", { name: "Salir de la comunidad" }).click();
    await anaPage.getByRole("button", { name: "Sí, salir" }).click();
    await expect(anaPage.getByRole("alert").filter({ hasText: "Debe quedar al menos una persona en la administración" })).toBeVisible();

    await goTo(anaPage, communityUrl, "Ajustes", "/ajustes");
    await anaPage.getByRole("button", { name: "Eliminar comunidad" }).click();
    await anaPage.getByRole("button", { name: "Sí, eliminar para siempre" }).click();
    await expect(anaPage).toHaveURL(/\/es\/comunidades$/);
    await expect(anaPage.getByText("Todavía no perteneces a ninguna comunidad.")).toBeVisible();
    expect((await betoPage.goto(communityUrl))?.status()).toBe(404);
  });
});
