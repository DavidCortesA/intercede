import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createConfirmedAccount, newPerson, signInThroughUi } from "./helpers";

// Fase 11 (B7): compañero de oración, solo personas adultas. Requieren el Supabase local. Solo escritorio.
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

test.describe("compañero de oración", () => {
  test.describe.configure({ mode: "serial" });

  let ana: Account; // liderazgo
  let beto: Account;
  let carla: Account;
  let dani: Account;
  let anaPage: Page;
  let betoPage: Page;
  let carlaPage: Page;
  let daniPage: Page;
  let communityId = "";

  test.beforeAll(async ({ browser }) => {
    [ana, beto, carla, dani] = (await Promise.all(["Ana", "Beto", "Carla", "Dani"].map(newAccount))) as [Account, Account, Account, Account];
    const client = await asPerson(ana);
    const { data } = await client.rpc("create_community", { p_name: "Iglesia de prueba", p_kind: "church" });
    communityId = data!;
    const invite = (await client.rpc("get_community_invite", { p_community_id: communityId })).data!;
    for (const person of [beto, carla, dani]) await (await asPerson(person)).rpc("join_community", { p_token: invite });
    [anaPage, betoPage, carlaPage, daniPage] = (await Promise.all([ana, beto, carla, dani].map((account) => signedInPage(browser, account)))) as [Page, Page, Page, Page];
  });

  test.afterAll(async () => {
    if (communityId) await admin().from("communities").delete().eq("id", communityId);
  });

  test("con el programa cerrado solo el liderazgo ve la sección; la configura por grupos", async () => {
    await betoPage.goto(`/es/comunidades/${communityId}`);
    await expect(betoPage.getByRole("navigation", { name: "Secciones de la comunidad" }).getByRole("link", { name: "Compañero" })).toHaveCount(0);

    await anaPage.goto(`/es/comunidades/${communityId}/companero`);
    await expect(anaPage.getByRole("heading", { name: "Programa de la comunidad" })).toBeVisible();
    await anaPage.getByLabel("Programa abierto (la gente puede anotarse)").check();
    await anaPage.getByLabel("Dentro de un mismo grupo o célula").check();
    await anaPage.getByLabel("Grupos o células (uno por línea)").fill("Norte\nSur");
    expect(await accessibilityIssues(anaPage)).toEqual([]);
    await anaPage.getByRole("button", { name: "Guardar programa" }).click();
    await expect(anaPage.getByRole("status").filter({ hasText: "Programa guardado." })).toBeVisible();
    expect((await admin().from("partner_programs").select("active, mode, labels").eq("community_id", communityId).single()).data).toEqual({ active: true, mode: "group", labels: ["Norte", "Sur"] });
  });

  test("anotarse exige confirmar que se es mayor de edad y elegir grupo; después se ve el estado", async () => {
    await betoPage.goto(`/es/comunidades/${communityId}`);
    await betoPage.getByRole("navigation", { name: "Secciones de la comunidad" }).getByRole("link", { name: "Compañero" }).click();
    await expect(betoPage.getByRole("heading", { name: "Anótate" })).toBeVisible();
    await expect(betoPage.getByText("Solo ves su nombre")).toBeVisible();

    await betoPage.getByLabel("Tu grupo").selectOption("Norte");
    // Sin confirmar la mayoría de edad el botón no se puede usar
    const submit = betoPage.getByRole("button", { name: "Anotarme" });
    await expect(submit).toBeDisabled();
    expect(await accessibilityIssues(betoPage)).toEqual([]);
    await betoPage.getByLabel(/Confirmo que soy mayor de edad/).check();
    await submit.click();
    await expect(betoPage.getByRole("heading", { name: "Estás anotada/o" })).toBeVisible();
    expect((await admin().from("profiles").select("adult_confirmed_at").eq("id", beto.userId).single()).data!.adult_confirmed_at).not.toBeNull();

    for (const [page, label] of [[carlaPage, "Norte"], [daniPage, "Sur"]] as const) {
      await page.goto(`/es/comunidades/${communityId}/companero`);
      await page.getByLabel("Tu grupo").selectOption(label);
      await page.getByLabel(/Confirmo que soy mayor de edad/).check();
      await page.getByRole("button", { name: "Anotarme" }).click();
      await expect(page.getByRole("heading", { name: "Estás anotada/o" })).toBeVisible();
    }
  });

  test("el liderazgo empareja ahora (solo dentro del mismo grupo) y ve solo totales", async () => {
    await anaPage.goto(`/es/comunidades/${communityId}/companero`);
    await anaPage.getByRole("button", { name: "Emparejar ahora" }).click();
    await expect(anaPage.getByTestId("pair-now-result")).toHaveText("Se armó 1 pareja.");
    await expect(anaPage.getByTestId("partner-stats")).toContainText("3 personas anotadas");
    await expect(anaPage.getByTestId("partner-stats")).toContainText("1 pareja esta semana");
    // Ni nombres ni peticiones de nadie en la pantalla del liderazgo
    await expect(anaPage.getByText("Tu compañero esta semana")).toHaveCount(0);
    expect(await anaPage.locator("body").innerText()).not.toMatch(/Beto|Carla|Dani/);
  });

  test("la pareja (Norte: Beto y Carla) se ve el nombre, se escribe y se ora; Dani espera", async () => {
    await betoPage.goto(`/es/comunidades/${communityId}/companero`);
    await expect(betoPage.getByRole("heading", { name: "Tu compañero esta semana: Carla" })).toBeVisible();
    await betoPage.getByLabel("Nueva petición").fill("Por mi examen del jueves");
    await betoPage.getByRole("button", { name: "Agregar" }).click();
    await expect(betoPage.getByText("Por mi examen del jueves")).toBeVisible();

    await carlaPage.goto(`/es/comunidades/${communityId}/companero`);
    await expect(carlaPage.getByRole("heading", { name: "Tu compañero esta semana: Beto" })).toBeVisible();
    await expect(carlaPage.getByText("Por mi examen del jueves")).toBeVisible();
    await carlaPage.getByRole("button", { name: "Estoy orando por ti" }).click();
    await expect(carlaPage.getByRole("button", { name: "Le avisé que estoy orando" })).toBeVisible();
    await carlaPage.getByRole("button", { name: "Bien", exact: true }).click();
    await carlaPage.getByLabel("Una nota para tu compañero (opcional)").fill("Orando cada noche");
    await carlaPage.getByRole("button", { name: "Más o menos" }).click(); // se puede corregir
    await carlaPage.getByRole("button", { name: "Bien", exact: true }).click();

    await betoPage.reload();
    await expect(betoPage.getByTestId("partner-prays")).toHaveText("Carla está orando por ti.");
    await expect(betoPage.getByTestId("partner-checkin")).toContainText("Carla dice: Bien");
    expect(await accessibilityIssues(betoPage)).toEqual([]);
    // Nunca contacto de la pareja
    expect(await betoPage.locator("body").innerText()).not.toMatch(/@example\.test/);

    await daniPage.goto(`/es/comunidades/${communityId}/companero`);
    await expect(daniPage.getByText("Todavía no tienes compañero esta semana.")).toBeVisible();
  });

  test("al bloquear a la pareja termina la pareja y ya no se ve lo del otro; nunca se vuelven a emparejar", async () => {
    await (await asPerson(carla)).rpc("block_user", { p_user_id: beto.userId });
    await carlaPage.reload();
    await expect(carlaPage.getByTestId("pair-ended")).toBeVisible();
    await expect(carlaPage.getByText("Por mi examen del jueves")).toHaveCount(0);
    await expect(carlaPage.getByRole("button", { name: "Estoy orando por ti" })).toHaveCount(0);

    // Una semana más tarde (la base no repite pareja ni empareja con un bloqueo): nadie queda con ellos dos
    const week = new Date(Date.now() + 70 * 24 * 3_600_000).toISOString().slice(0, 10);
    const monday = new Date(new Date(`${week}T00:00:00Z`).getTime() - ((new Date(`${week}T00:00:00Z`).getUTCDay() + 6) % 7) * 24 * 3_600_000).toISOString().slice(0, 10);
    expect((await admin().rpc("pair_program", { p_community_id: communityId, p_week: monday })).data).toBe(0);
  });

  test("salir del programa pide confirmación y borra lo escrito para la pareja", async () => {
    await betoPage.goto(`/es/comunidades/${communityId}/companero`);
    await betoPage.getByRole("button", { name: "Salir del programa" }).click();
    await expect(betoPage.getByText("Se borrarán tus peticiones para tu compañero")).toBeVisible();
    await betoPage.getByRole("button", { name: "Sí, salir" }).click();
    await expect(betoPage.getByRole("heading", { name: "Anótate" })).toBeVisible();
    expect((await admin().from("partner_requests").select("id").eq("author_id", beto.userId)).data).toEqual([]);
    expect((await admin().from("partner_signups").select("user_id").eq("user_id", beto.userId)).data).toEqual([]);
  });
});
