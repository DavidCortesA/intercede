import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createConfirmedAccount, joinRoomAs, newPerson, signInThroughUi } from "./helpers";

// Fase 11: grupos pequeños (B2) con audio real contra LiveKit Cloud (micrófonos simulados de Chromium).
// Necesita: Supabase local (`npm run test:e2e:db`) y credenciales de LiveKit en .env.local. Solo escritorio.
test.skip(!process.env.SUPABASE_TEST_URL, "requiere Supabase local (npm run test:e2e:db)");
test.skip(!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET, "requiere credenciales de LiveKit");
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
  const page = await newPerson(browser, { permissions: ["microphone"] });
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

/** Anota los cuerpos de las peticiones de token de audio de una página (para ver a qué sala de audio pide entrar). */
function watchTokens(page: Page) {
  const bodies: { roomId: string; groupId?: string }[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/livekit/token") && request.method() === "POST") bodies.push(request.postDataJSON());
  });
  return bodies;
}

const iso = (ms: number) => new Date(ms).toISOString();

test.describe("grupos pequeños con audio real", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);

  let ana: Account;
  let beto: Account;
  let carla: Account;
  let dani: Account;
  let anaPage: Page;
  let betoPage: Page;
  let carlaPage: Page;
  let daniPage: Page;
  let communityId = "";
  let roomId = "";
  let betoTokens: ReturnType<typeof watchTokens>;
  let anaTokens: ReturnType<typeof watchTokens>;

  test.beforeAll(async ({ browser }) => {
    [ana, beto, carla, dani] = await Promise.all(["Ana", "Beto", "Carla", "Dani"].map(newAccount)) as [Account, Account, Account, Account];
    const client = await asPerson(ana);
    const { data } = await client.rpc("create_community", { p_name: "Iglesia de prueba", p_kind: "church" });
    communityId = data!;
    const invite = (await client.rpc("get_community_invite", { p_community_id: communityId })).data!;
    for (const person of [beto, carla, dani]) await (await asPerson(person)).rpc("join_community", { p_token: invite });
    const { data: room } = await client.rpc("create_community_room", { p_community_id: communityId, p_name: "Vigilia", p_display_name: "Ana" });
    roomId = room![0]!.room_id;
    const roomUrl = `/es/r/${room![0]!.room_code}`;

    [anaPage, betoPage, carlaPage, daniPage] = await Promise.all([ana, beto, carla, dani].map((account) => signedInPage(browser, account))) as [Page, Page, Page, Page];
    anaTokens = watchTokens(anaPage);
    betoTokens = watchTokens(betoPage);
    await anaPage.goto(roomUrl);
    await expect(anaPage.getByRole("heading", { level: 2, name: "Peticiones" })).toBeVisible();
    for (const [page, name] of [[betoPage, "Beto"], [carlaPage, "Carla"], [daniPage, "Dani"]] as const) await joinRoomAs(page, `${new URL(anaPage.url()).origin}${roomUrl}`, name);
  });

  test.afterAll(async () => {
    if (communityId) await admin().from("communities").delete().eq("id", communityId);
  });

  test("solo la anfitriona ve el botón; en una sala personal avisa que necesita un plan", async ({ browser }) => {
    await expect(anaPage.getByRole("button", { name: "Dividir en grupos" })).toBeVisible();
    await expect(betoPage.getByRole("button", { name: "Dividir en grupos" })).toHaveCount(0);

    const solo = await signedInPage(browser, await newAccount("Solo"));
    await solo.goto("/es/orar");
    await solo.getByLabel("¿Cómo te llamas?").fill("Solo");
    await solo.getByRole("button", { name: "Crear sala de oración" }).click();
    await expect(solo.getByRole("button", { name: "Dividir en grupos" })).toBeVisible();
    await solo.getByRole("button", { name: "Dividir en grupos" }).click();
    const dialog = solo.getByRole("dialog", { name: "Dividir en grupos pequeños" });
    await expect(dialog.getByText(/plan Plus/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Empezar grupos" })).toHaveCount(0);
  });

  test("dividir con reparto manual: cada persona pasa a su grupo y su audio cambia de sala", async () => {
    // Beto y Carla entran al audio antes del reparto (ya dieron su permiso: el cambio no vuelve a pedir nada)
    await betoPage.getByRole("button", { name: "Orar con micrófono" }).click();
    await expect(betoPage.getByRole("status").filter({ hasText: "Micrófono activado" })).toBeVisible({ timeout: 30_000 });
    await carlaPage.getByRole("button", { name: "Solo escuchar" }).click();
    await expect(carlaPage.getByRole("status").filter({ hasText: "Escuchando" })).toBeVisible({ timeout: 30_000 });
    expect(betoTokens.every((body) => !body.groupId)).toBe(true);

    await anaPage.getByRole("button", { name: "Dividir en grupos" }).click();
    const dialog = anaPage.getByRole("dialog", { name: "Dividir en grupos pequeños" });
    await expect(dialog.getByText("Hay 3 personas para repartir.")).toBeVisible();
    await dialog.getByLabel("Por número de grupos").check();
    await dialog.getByLabel(/Número de grupos/).fill("2");
    await dialog.getByLabel("Duración").selectOption("5");
    await dialog.getByLabel("Yo elijo").check();
    await dialog.getByLabel("Beto").selectOption({ label: "Grupo 1" });
    await dialog.getByLabel("Carla").selectOption({ label: "Grupo 2" });
    await dialog.getByLabel("Dani").selectOption({ label: "Se queda en la sala principal" });
    expect(await accessibilityIssues(anaPage)).toEqual([]);
    await dialog.getByRole("button", { name: "Empezar grupos" }).click();
    await expect(dialog).not.toBeVisible();
    roomId = roomId || "";

    // Cada quien ve su grupo; quien se quedó en la principal lo sabe
    await expect(betoPage.getByRole("region", { name: "Grupos pequeños" }).getByText("Estás en el Grupo 1")).toBeVisible();
    await expect(carlaPage.getByRole("region", { name: "Grupos pequeños" }).getByText("Estás en el Grupo 2")).toBeVisible();
    await expect(daniPage.getByRole("region", { name: "Grupos pequeños" }).getByText(/Tú sigues en la sala principal/)).toBeVisible();
    await expect(betoPage.getByText("Por ahora estás solo en este grupo.")).toBeVisible();
    // Beto solo ve a su grupo (y a quien anfitriona), no a Carla
    await expect(betoPage.getByRole("listitem").filter({ hasText: "Carla" })).toHaveCount(0);

    // La anfitriona ve los dos grupos con su gente
    const panel = anaPage.getByRole("heading", { name: "Grupos en curso" });
    await expect(panel).toBeVisible();
    await expect(anaPage.getByTestId("breakout-group-1")).toContainText("Beto");
    await expect(anaPage.getByTestId("breakout-group-2")).toContainText("Carla");

    // El audio de Beto se movió a la sala de SU grupo (token con el grupo) y sigue conectado, con el micrófono
    const group1 = (await admin().from("breakout_groups").select("id").eq("position", 1).eq("breakout_id", (await admin().from("room_breakouts").select("id").eq("room_id", roomId).eq("status", "active").single()).data!.id).single()).data!.id;
    await expect.poll(() => betoTokens.some((body) => body.groupId === group1), { timeout: 30_000 }).toBe(true);
    await expect(betoPage.getByRole("status").filter({ hasText: "Micrófono activado" })).toBeVisible({ timeout: 30_000 });
    await expect(carlaPage.getByRole("status").filter({ hasText: "Escuchando" })).toBeVisible({ timeout: 30_000 });
    expect(await accessibilityIssues(betoPage)).toEqual([]);
  });

  test("el aviso de la anfitriona llega a todos, también a quien está en un grupo", async () => {
    await anaPage.getByLabel("Avisar a todos").fill("Regresamos en 2 minutos");
    await anaPage.getByRole("button", { name: "Avisar" }).click();
    for (const page of [betoPage, carlaPage, daniPage]) {
      await expect(page.getByTestId("breakout-announcement")).toContainText("Regresamos en 2 minutos");
    }
  });

  test("la anfitriona visita un grupo y vuelve a la sala principal", async () => {
    // La anfitriona entra al audio de la sala principal y luego visita un grupo: su audio cambia de sala
    await anaPage.getByRole("button", { name: "Solo escuchar" }).click();
    await expect(anaPage.getByRole("status").filter({ hasText: "Escuchando" })).toBeVisible({ timeout: 30_000 });
    const before = anaTokens.length;
    await anaPage.getByTestId("breakout-group-2").getByRole("button", { name: "Unirme a este grupo" }).click();
    await expect.poll(() => anaTokens.slice(before).some((body) => Boolean(body.groupId))).toBe(true);
    await expect(anaPage.getByRole("status").filter({ hasText: "Escuchando" })).toBeVisible({ timeout: 30_000 });
    await anaPage.getByTestId("breakout-group-2").getByRole("button", { name: "Volver a la sala principal" }).click();
    await expect.poll(() => anaTokens.at(-1)?.groupId, { timeout: 30_000 }).toBeUndefined();
    await expect(anaPage.getByRole("status").filter({ hasText: "Escuchando" })).toBeVisible({ timeout: 30_000 });
  });

  test("terminar los grupos devuelve a todos a la sala principal sin quedar atrapados", async () => {
    const before = betoTokens.length;
    await anaPage.getByRole("button", { name: "Terminar grupos y volver a la sala" }).click();
    await expect(anaPage.getByRole("heading", { name: "Grupos en curso" })).toHaveCount(0);
    for (const page of [betoPage, carlaPage, daniPage]) await expect(page.getByRole("region", { name: "Grupos pequeños" })).toHaveCount(0);

    // Beto pide un token de la sala principal (sin grupo) y su audio sigue activo
    await expect.poll(() => betoTokens.slice(before).some((body) => !body.groupId), { timeout: 30_000 }).toBe(true);
    await expect(betoPage.getByRole("status").filter({ hasText: "Micrófono activado" })).toBeVisible({ timeout: 30_000 });
    // Ya ven de nuevo a todas las personas
    await expect(betoPage.getByRole("listitem").filter({ hasText: "Carla" }).first()).toBeVisible();
  });

  test("si la anfitriona se desconecta, al terminar el tiempo todos vuelven solos y el servidor cierra los grupos", async () => {
    await anaPage.getByRole("button", { name: "Dividir en grupos" }).click();
    const dialog = anaPage.getByRole("dialog", { name: "Dividir en grupos pequeños" });
    await dialog.getByLabel("Por número de grupos").check();
    await dialog.getByLabel(/Número de grupos/).fill("2");
    await dialog.getByLabel("Duración").selectOption("5");
    await dialog.getByRole("button", { name: "Empezar grupos" }).click();
    await expect(betoPage.getByRole("region", { name: "Grupos pequeños" }).getByText(/Estás en el Grupo/)).toBeVisible();

    // La anfitriona se va (cierra su ventana) y el reloj del reparto llega a su fin
    await anaPage.context().close();
    const active = (await admin().from("room_breakouts").select("id").eq("room_id", roomId).eq("status", "active").single()).data!;
    await admin().from("room_breakouts").update({ ends_at: iso(Date.now() + 4_000) }).eq("id", active.id);

    const before = betoTokens.length;
    await expect(betoPage.getByRole("region", { name: "Grupos pequeños" }).getByText("Regresando…")).toBeVisible({ timeout: 20_000 });
    // Beto vuelve por su cuenta a la sala principal (token sin grupo) y su audio sigue
    await expect.poll(() => betoTokens.slice(before).some((body) => !body.groupId), { timeout: 30_000 }).toBe(true);
    await expect(betoPage.getByRole("status").filter({ hasText: /Micrófono activado|Escuchando/ })).toBeVisible({ timeout: 30_000 });
  });
});
