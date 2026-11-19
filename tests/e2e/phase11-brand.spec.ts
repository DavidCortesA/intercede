import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { contrastRatio, isAccessibleAccent } from "../../src/features/brand/contrast";
import { createConfirmedAccount, newPerson, signInThroughUi } from "./helpers";

// Fase 11 (B6): marca de la iglesia (plan Pro), sin subdominio. Requieren el Supabase local. Solo escritorio.
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

/** "rgb(190, 18, 60)" → "#be123c" */
const rgbToHex = (rgb: string) => {
  const [r, g, b] = rgb.match(/\d+/g)!.slice(0, 3).map(Number) as [number, number, number];
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

test.describe("marca de la comunidad (plan Pro)", () => {
  test.describe.configure({ mode: "serial" });

  let ana: Account; // administra
  let beto: Account; // miembro
  let anaPage: Page;
  let betoPage: Page;
  let communityId = "";
  let roomCode = "";

  test.beforeAll(async ({ browser }) => {
    [ana, beto] = await Promise.all([newAccount("Ana"), newAccount("Beto")]);
    const client = await asPerson(ana);
    const { data } = await client.rpc("create_community", { p_name: "Iglesia de prueba", p_kind: "church" });
    communityId = data!;
    const invite = (await client.rpc("get_community_invite", { p_community_id: communityId })).data!;
    await (await asPerson(beto)).rpc("join_community", { p_token: invite });
    [anaPage, betoPage] = await Promise.all([signedInPage(browser, ana), signedInPage(browser, beto)]);
  });

  test.afterAll(async () => {
    if (communityId) await admin().from("communities").delete().eq("id", communityId);
  });

  test("sin plan Pro la marca no está disponible y no hay formulario", async () => {
    await anaPage.goto(`/es/comunidades/${communityId}/ajustes`);
    await expect(anaPage.getByRole("heading", { name: "Marca de tu comunidad" })).toBeVisible();
    await expect(anaPage.getByText("La marca de la comunidad es del plan Pro.")).toBeVisible();
    await expect(anaPage.getByRole("button", { name: "Guardar marca" })).toHaveCount(0);
    await anaPage.goto(`/es/comunidades/${communityId}`);
    await expect(anaPage.getByText("Con tecnología de INTERCEDE")).toHaveCount(0);
  });

  test("con Pro: un color muy claro se oscurece solo hasta pasar el contraste, se ve la vista previa y se guarda", async () => {
    await admin().from("subscriptions").update({ plan_code: "pro", current_period_end: new Date(Date.now() + 30 * 24 * 3_600_000).toISOString() }).eq("community_id", communityId);
    await anaPage.goto(`/es/comunidades/${communityId}/ajustes`);

    await anaPage.getByLabel("Nombre que se muestra").fill("Casa de Oración");
    await anaPage.getByLabel("Color de acento", { exact: true }).fill("#f5a640"); // el dorado: no pasa sobre blanco
    await expect(anaPage.getByTestId("brand-adjusted")).toContainText("Lo oscurecimos a");
    const previewBg = rgbToHex(await anaPage.getByTestId("brand-preview-button").evaluate((el) => getComputedStyle(el).backgroundColor));
    expect(previewBg).not.toBe("#f5a640");
    expect(isAccessibleAccent(previewBg)).toBe(true);
    expect(contrastRatio("#ffffff", previewBg)).toBeGreaterThanOrEqual(4.5);
    expect(await accessibilityIssues(anaPage)).toEqual([]);

    // Un color que ya pasa se acepta tal cual
    await anaPage.getByLabel("Color de acento", { exact: true }).fill("#be123c");
    await expect(anaPage.getByText(/Se lee bien con letras blancas/)).toBeVisible();
    await anaPage.getByRole("button", { name: "Guardar marca" }).click();
    await expect(anaPage.getByRole("status").filter({ hasText: "Marca guardada." })).toBeVisible();
    expect((await admin().from("community_brands").select("display_name, accent").eq("community_id", communityId).single()).data).toEqual({ display_name: "Casa de Oración", accent: "#be123c" });
  });

  test("las páginas de la comunidad muestran el nombre y el acento, y siempre \"Con tecnología de INTERCEDE\"", async () => {
    for (const page of [anaPage, betoPage]) {
      await page.goto(`/es/comunidades/${communityId}`);
      await expect(page.getByRole("heading", { level: 1, name: "Casa de Oración" })).toBeVisible();
      await expect(page.getByText("Con tecnología de INTERCEDE")).toBeVisible();
      // La pestaña activa usa el color de la comunidad (antes era el degradado violeta-azul)
      const pill = page.getByRole("navigation", { name: "Secciones de la comunidad" }).getByRole("link", { name: "Muro" });
      expect(rgbToHex(await pill.evaluate((el) => getComputedStyle(el).backgroundColor))).toBe("#be123c");
    }
    expect(await accessibilityIssues(betoPage)).toEqual([]);
    // Otra comunidad (sin marca) no cambia
    const other = await (await asPerson(ana)).rpc("create_community", { p_name: "Sin marca", p_kind: "group" });
    await anaPage.goto(`/es/comunidades/${other.data}`);
    await expect(anaPage.getByRole("heading", { level: 1, name: "Sin marca" })).toBeVisible();
    await expect(anaPage.getByText("Con tecnología de INTERCEDE")).toHaveCount(0);
    await admin().from("communities").delete().eq("id", other.data!);
  });

  test("las salas de la comunidad llevan su marca; la app instalable sigue siendo la de INTERCEDE", async () => {
    const client = await asPerson(ana);
    const { data } = await client.rpc("create_community_room", { p_community_id: communityId, p_name: "Vigilia", p_display_name: "Ana" });
    roomCode = data![0]!.room_code;
    await anaPage.goto(`/es/r/${roomCode}`);
    await expect(anaPage.getByTestId("room-brand-name")).toHaveText("Casa de Oración");
    await expect(anaPage.getByText("Con tecnología de INTERCEDE")).toBeVisible();
    expect(await accessibilityIssues(anaPage)).toEqual([]);

    // Una sala personal no lleva marca
    await anaPage.goto("/es/orar");
    await anaPage.getByLabel("¿Cómo te llamas?").fill("Ana");
    await anaPage.getByRole("button", { name: "Crear sala de oración" }).click();
    await expect(anaPage.getByRole("heading", { level: 2, name: "Peticiones" })).toBeVisible();
    await expect(anaPage.getByTestId("room-brand-name")).toHaveCount(0);

    const manifest = await (await anaPage.request.get("/manifest.webmanifest")).json();
    expect(manifest.name).toContain("INTERCEDE");
  });

  test("el nombre no puede suplantar a INTERCEDE ni a otra comunidad, y un color ilegible se rechaza en el servidor", async () => {
    await anaPage.goto(`/es/comunidades/${communityId}/ajustes`);
    await anaPage.getByLabel("Nombre que se muestra").fill("INTERCEDE Oficial");
    await anaPage.getByRole("button", { name: "Guardar marca" }).click();
    await expect(anaPage.getByRole("alert").filter({ hasText: "se parece demasiado a INTERCEDE" })).toBeVisible();

    // Aunque alguien salte la interfaz, la base rechaza el color
    const client = await asPerson(ana);
    expect((await client.rpc("set_community_brand", { p_community_id: communityId, p_display_name: "x", p_accent: "#f5a640" })).error?.message).toBe("low_contrast");
  });

  test("si el plan Pro termina la marca deja de verse; quitarla devuelve el nombre de la comunidad", async () => {
    await admin().from("subscriptions").update({ current_period_end: new Date(Date.now() - 60_000).toISOString() }).eq("community_id", communityId);
    await betoPage.goto(`/es/comunidades/${communityId}`);
    await expect(betoPage.getByRole("heading", { level: 1, name: "Iglesia de prueba" })).toBeVisible();
    await expect(betoPage.getByText("Con tecnología de INTERCEDE")).toHaveCount(0);

    await admin().from("subscriptions").update({ plan_code: "pro", current_period_end: new Date(Date.now() + 30 * 24 * 3_600_000).toISOString() }).eq("community_id", communityId);
    await anaPage.goto(`/es/comunidades/${communityId}/ajustes`);
    await anaPage.getByRole("button", { name: "Quitar marca" }).click();
    await expect.poll(async () => (await admin().from("community_brands").select("community_id").eq("community_id", communityId)).data).toEqual([]);
    await betoPage.goto(`/es/comunidades/${communityId}`);
    await expect(betoPage.getByRole("heading", { level: 1, name: "Iglesia de prueba" })).toBeVisible();
    await expect(betoPage.getByText("Con tecnología de INTERCEDE")).toHaveCount(0);
  });
});
