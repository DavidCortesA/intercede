import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createConfirmedAccount, createRoomAs, joinRoomAs, newPerson, signInThroughUi } from "./helpers";

// Fase 9: planes, límites y cobros. Requieren el Supabase local (`npm run test:e2e:db`). Solo escritorio.
// El pago real con Conekta NO se ejercita aquí (necesita llaves de pruebas con permiso de escritura): se simula la
// respuesta de /api/billing/checkout; el webhook y el cumplimiento se prueban en las pruebas de integración.
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
  const page = await newPerson(browser);
  await signInThroughUi(page, account.email, account.password);
  return page;
}

/** Cliente de Supabase que actúa como la persona (RLS), para preparar datos por las mismas funciones que usa la app. */
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

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

test.describe("precios (página pública)", () => {
  test("muestra planes, pases y extras desde la base, sin cuenta, y es accesible", async ({ page }) => {
    await page.goto("/es/precios");
    await expect(page.getByRole("heading", { level: 1, name: /Orar es gratis/ })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Plus" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Pro" })).toBeVisible();
    await expect(page.getByText("$499").first()).toBeVisible();
    await expect(page.getByText("$14,990").first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Vigilia Grande" })).toBeVisible();
    await expect(page.getByText("$799")).toBeVisible();
    await expect(page.getByText("Con Plus o Pro: $149")).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Bolsa de +100 horas-persona" })).toBeVisible();
    expect(await accessibilityIssues(page)).toEqual([]);
  });

  test("se llega desde el pie y el menú de la landing, y está en el sitemap", async ({ page, request }) => {
    await page.goto("/es");
    await page.getByRole("contentinfo").getByRole("link", { name: "Precios" }).click();
    await expect(page).toHaveURL(/\/es\/precios$/);
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("/es/precios");
  });
});

test.describe("facturación de la comunidad y pases personales", () => {
  test.describe.configure({ mode: "serial" });

  let ana: Account; // administra
  let beto: Account; // miembro
  let anaPage: Page;
  let betoPage: Page;
  let communityId = "";

  test.beforeAll(async ({ browser }) => {
    [ana, beto] = await Promise.all([newAccount("Ana"), newAccount("Beto")]);
    const client = await asPerson(ana);
    const { data, error } = await client.rpc("create_community", { p_name: "Iglesia de prueba", p_kind: "church" });
    if (error || !data) throw new Error(error?.message);
    communityId = data;
    const token = (await client.rpc("get_community_invite", { p_community_id: communityId })).data!;
    await (await asPerson(beto)).rpc("join_community", { p_token: token });
    [anaPage, betoPage] = await Promise.all([signedInPage(browser, ana), signedInPage(browser, beto)]);
  });

  test.afterAll(async () => {
    if (communityId) await admin().from("communities").delete().eq("id", communityId);
  });

  test("la administración ve su plan (prueba de Plus), límites, uso y compras; es accesible", async () => {
    await anaPage.goto(`/es/comunidades/${communityId}`);
    await anaPage.getByRole("navigation", { name: "Secciones de la comunidad" }).getByRole("link", { name: "Facturación" }).click();
    await expect(anaPage).toHaveURL(new RegExp(`/comunidades/${communityId}/facturacion$`));

    await expect(anaPage.getByText("Plus", { exact: true }).first()).toBeVisible();
    await expect(anaPage.getByText(/Prueba de Plus hasta el/)).toBeVisible();
    await expect(anaPage.getByRole("heading", { name: "Límites de hoy" })).toBeVisible();
    await expect(anaPage.getByText("Horas-persona al mes").first()).toBeVisible();
    await expect(anaPage.getByText("0 de 500 horas-persona incluidas")).toBeVisible();
    await expect(anaPage.getByRole("progressbar", { name: "Uso de este mes" })).toBeVisible();
    await expect(anaPage.getByText("Solo vemos el total de la comunidad")).toBeVisible();
    // Con plan de pago la vigilia cuesta menos
    await expect(anaPage.getByRole("heading", { name: "Pases para salas de la comunidad" })).toBeVisible();
    await expect(anaPage.locator("li").filter({ has: anaPage.getByRole("heading", { name: "Vigilia", exact: true }) }).getByText("$149")).toBeVisible();
    expect(await accessibilityIssues(anaPage)).toEqual([]);
  });

  test("quien no administra no ve la facturación (404)", async () => {
    await expect(betoPage.goto(`/es/comunidades/${communityId}`)).resolves.not.toBeNull();
    const response = await betoPage.goto(`/es/comunidades/${communityId}/facturacion`);
    expect(response?.status()).toBe(404);
    await betoPage.goto(`/es/comunidades/${communityId}`);
    await expect(betoPage.getByRole("navigation", { name: "Secciones de la comunidad" }).getByRole("link", { name: "Facturación" })).toHaveCount(0);
  });

  test("comprar manda al pago con lo que se eligió y muestra el error si el pago no está disponible", async () => {
    await anaPage.goto(`/es/comunidades/${communityId}/facturacion`);
    let sent: Record<string, unknown> | null = null;
    await anaPage.route("**/api/billing/checkout", async (route) => {
      sent = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "payment_unavailable" }) });
    });
    await anaPage.getByRole("button", { name: /Anual \(2 meses gratis\) · \$14,990/ }).click();
    await expect(anaPage.getByRole("alert").filter({ hasText: "El pago no está disponible por ahora" })).toBeVisible();
    expect(sent).toEqual({ kind: "plan", code: "pro", period: "annual", communityId });
    // Nunca viaja un monto desde el navegador
    expect(Object.keys(sent!)).not.toContain("amount");

    await anaPage.unroute("**/api/billing/checkout");
    await anaPage.route("**/api/billing/checkout", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: `${new URL(anaPage.url()).origin}/es/precios`, orderId: crypto.randomUUID() }) }),
    );
    await anaPage.getByRole("button", { name: /Mensual · \$499/ }).first().click();
    await expect(anaPage).toHaveURL(/\/es\/precios$/);
  });

  test("al volver del pago se muestra el estado REAL de la orden (pendiente, pagada)", async () => {
    const client = admin();
    const order = (await (await asPerson(ana)).rpc("create_order", { p_kind: "pass", p_code: "vigilia", p_community_id: communityId })).data![0]!;
    await anaPage.goto(`/es/comunidades/${communityId}/facturacion?orden=${order.order_id}`);
    await expect(anaPage.getByRole("status").filter({ hasText: "Esperando la confirmación del pago" })).toBeVisible();

    // Volver del pago NO activa nada: solo el webhook verificado marca la orden como pagada
    expect((await client.from("passes").select("id").eq("community_id", communityId)).data).toEqual([]);

    await client.rpc("fulfill_order", { p_order_id: order.order_id });
    await anaPage.reload();
    await expect(anaPage.getByRole("status").filter({ hasText: "Pago confirmado" })).toBeVisible();
    await expect(anaPage.getByRole("listitem").filter({ hasText: "Vigilia" }).filter({ hasText: "Pagado" })).toBeVisible();
    expect(await accessibilityIssues(anaPage)).toEqual([]);
  });

  test("Pases y pagos en el perfil: se ven los pases propios y las compras", async () => {
    await anaPage.goto("/es/perfil");
    await anaPage.getByRole("link", { name: /Pases y pagos/ }).click();
    await expect(anaPage).toHaveURL(/\/es\/facturacion$/);
    await expect(anaPage.getByRole("heading", { level: 1, name: "Pases y pagos" })).toBeVisible();
    await expect(anaPage.getByText("Todavía no tienes pases.")).toBeVisible();
    await expect(anaPage.getByRole("heading", { name: "Sala Larga" })).toBeVisible();
    expect(await accessibilityIssues(anaPage)).toEqual([]);
  });
});

test.describe("aviso de tiempo y ampliación de la sala", () => {
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
    const code = roomUrl.split("/").pop()!;
    roomId = (await admin().from("rooms").select("id").eq("code", code).single()).data!.id;
  });

  test("a 10 minutos del límite todos ven el aviso; solo quien anfitriona puede ampliar", async () => {
    await expect(anaPage.getByRole("status").filter({ hasText: "por el límite de su plan" })).toHaveCount(0);
    await admin().from("rooms").update({ ends_at: iso(Date.now() + 8 * MIN) }).eq("id", roomId);

    for (const page of [anaPage, betoPage]) {
      await expect(page.getByRole("status").filter({ hasText: /Esta sala termina en \d+ minutos? por el límite de su plan/ })).toBeVisible();
    }
    await expect(anaPage.getByRole("button", { name: "Ampliar sala" })).toBeVisible();
    await expect(betoPage.getByRole("button", { name: "Ampliar sala" })).toHaveCount(0);
  });

  test("a 2 minutos el aviso es urgente y durante la gracia dice cuánto queda", async () => {
    await admin().from("rooms").update({ ends_at: iso(Date.now() + 90_000) }).eq("id", roomId);
    await expect(anaPage.getByRole("status").filter({ hasText: /Quedan \d+ minutos?\. Termina la oración con calma/ })).toBeVisible();

    await admin().from("rooms").update({ ends_at: iso(Date.now() - MIN) }).eq("id", roomId);
    await expect(betoPage.getByRole("status").filter({ hasText: /Se acabó el tiempo de la sala\. Tienes \d+ minutos?/ })).toBeVisible();
  });

  test("un pase disponible se usa desde la sala: se amplía para todos sin desconectar a nadie", async () => {
    const client = admin();
    await client.from("passes").insert({
      buyer_id: ana.userId,
      product_code: "vigilia",
      limits: { max_room_minutes: 1440, max_room_participants: 30 },
      expires_at: iso(Date.now() + 30 * 24 * 60 * MIN),
    });
    await client.from("rooms").update({ ends_at: iso(Date.now() + 5 * MIN) }).eq("id", roomId);
    await anaPage.getByRole("button", { name: "Ampliar sala" }).click();
    const dialog = anaPage.getByRole("dialog", { name: "Ampliar esta sala" });
    await expect(dialog.getByRole("heading", { name: "Tus pases disponibles" })).toBeVisible();
    await expect(dialog.getByText("Vigilia", { exact: true }).first()).toBeVisible();
    // Los precios de las opciones de compra salen de la base
    await expect(dialog.getByText("$39")).toBeVisible();
    expect(await accessibilityIssues(anaPage)).toEqual([]);

    await dialog.getByRole("button", { name: "Usar" }).click();
    await expect(dialog).not.toBeVisible();

    await expect.poll(async () => (await client.from("rooms").select("max_participants").eq("id", roomId).single()).data!.max_participants).toBe(30);
    const ends = new Date((await client.from("rooms").select("ends_at").eq("id", roomId).single()).data!.ends_at).getTime();
    expect(ends - Date.now()).toBeGreaterThan(23 * 60 * MIN);
    // El aviso desaparece para todos (Realtime) y nadie salió de la sala
    for (const page of [anaPage, betoPage]) {
      await expect(page.getByRole("status").filter({ hasText: /Se acabó el tiempo|por el límite de su plan|Quedan/ })).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 2, name: "Peticiones" })).toBeVisible();
    }
  });

  test("un invitado que anfitriona ve que necesita una cuenta para comprar (sin perder su sala)", async ({ browser }) => {
    const guest = await newPerson(browser);
    await createRoomAs(guest, "Invitada");
    const code = guest.url().split("/").pop()!;
    const id = (await admin().from("rooms").select("id").eq("code", code).single()).data!.id;
    await admin().from("rooms").update({ ends_at: iso(Date.now() + 6 * MIN) }).eq("id", id);

    await guest.getByRole("button", { name: "Ampliar sala" }).click();
    const dialog = guest.getByRole("dialog", { name: "Ampliar esta sala" });
    await expect(dialog.getByText(/necesitas una cuenta/)).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Crear cuenta" })).toBeVisible();
    await dialog.getByRole("button", { name: "Cerrar" }).click();
    await expect(guest.getByRole("heading", { level: 2, name: "Peticiones" })).toBeVisible();
  });
});
