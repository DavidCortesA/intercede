import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

// Estas pruebas necesitan el Supabase local: `npm run test:e2e:db` (o el job e2e del CI).
test.skip(!process.env.SUPABASE_TEST_URL, "requiere Supabase local (npm run test:e2e:db)");

// Dos personas en contextos distintos = dos navegadores sin cookies compartidas.
// Solo en escritorio: cada prueba crea invitados reales y las altas anónimas tienen tope por hora.
test.skip(({ isMobile }) => isMobile, "se corre solo en escritorio");

async function newPerson(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

async function createRoomAs(page: Page, name: string): Promise<string> {
  await page.goto("/es");
  await page.locator("section").first().getByRole("link", { name: "Orar ahora" }).click();
  await expect(page).toHaveURL(/\/es\/orar$/);
  await page.getByLabel("¿Cómo te llamas?").fill(name);
  await page.getByRole("button", { name: "Crear sala de oración" }).click();
  await expect(page).toHaveURL(/\/es\/r\/[a-hj-km-np-z2-9]{6}$/);
  return page.url();
}

async function joinRoomAs(page: Page, roomUrl: string, name: string) {
  await page.goto(roomUrl);
  await page.getByLabel("¿Cómo te llamas?").fill(name);
  await page.getByRole("button", { name: "Entrar a la sala" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Peticiones" })).toBeVisible();
}

test("flujo completo: crear sin cuenta, unirse, peticiones en vivo, bloquear y cerrar", async ({ browser }) => {
  test.setTimeout(90_000);
  const ana = await newPerson(browser);
  const beto = await newPerson(browser);
  const carla = await newPerson(browser);

  // 1. Ana crea la sala sin cuenta y queda dentro como anfitriona
  const roomUrl = await createRoomAs(ana, "Ana");
  await expect(ana.getByRole("heading", { level: 1, name: "Sala de Ana" })).toBeVisible();
  await expect(ana.getByText("1 persona", { exact: false })).toBeVisible();
  await expect(ana.getByText("Aún no hay peticiones")).toBeVisible();

  // 2. Beto abre el enlace, ve la vista previa, escribe solo su nombre y entra
  await beto.goto(roomUrl);
  await expect(beto.getByRole("heading", { level: 1, name: "Unirte a Sala de Ana" })).toBeVisible();
  await beto.getByLabel("¿Cómo te llamas?").fill("Beto");
  await beto.getByRole("button", { name: "Entrar a la sala" }).click();
  await expect(beto.getByRole("heading", { level: 1, name: "Sala de Ana" })).toBeVisible();

  // 3. Ana ve entrar a Beto en vivo (sin recargar)
  await expect(ana.getByText("2 personas", { exact: false })).toBeVisible();
  await expect(ana.getByRole("list").first().getByText("Beto")).toBeVisible();

  // 4. Beto publica una petición y Ana la ve al instante
  await beto.getByLabel("Nueva petición de oración").fill("Por la salud de mi papá");
  await beto.getByRole("button", { name: "Enviar" }).click();
  await expect(beto.getByText("Por la salud de mi papá")).toBeVisible();
  await expect(ana.getByText("Por la salud de mi papá")).toBeVisible({ timeout: 15_000 });

  // 5. Accesibilidad de la sala con contenido (modo oscuro)
  const results = await new AxeBuilder({ page: ana }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);

  // 6. Beto la marca como respondida con testimonio y Ana lo ve
  await beto.getByRole("button", { name: "Marcar como respondida" }).click();
  await beto.getByLabel("Testimonio (opcional)").fill("Salió bien de la cirugía");
  await beto.getByRole("button", { name: "Guardar" }).click();
  await expect(ana.getByText("Respondida")).toBeVisible({ timeout: 15_000 });
  await expect(ana.getByText("Salió bien de la cirugía")).toBeVisible();

  // 7. Ana (anfitriona) bloquea la sala: Carla no puede entrar
  await ana.getByRole("button", { name: "Bloquear sala", exact: true }).click();
  await expect(ana.getByRole("button", { name: "Desbloquear sala" })).toBeVisible();
  await carla.goto(roomUrl);
  await expect(carla.getByRole("heading", { level: 1, name: "La sala está bloqueada" })).toBeVisible();

  // 8. Ana desbloquea y Carla entra
  await ana.getByRole("button", { name: "Desbloquear sala" }).click();
  // exact: "Bloquear sala" también es subcadena de "Desbloquear sala" (esperaría antes de tiempo)
  await expect(ana.getByRole("button", { name: "Bloquear sala", exact: true })).toBeVisible();
  await joinRoomAs(carla, roomUrl, "Carla");
  await expect(ana.getByText("3 personas", { exact: false })).toBeVisible({ timeout: 15_000 });

  // 9. Beto elimina su petición; desaparece para todos
  await beto.getByRole("button", { name: "Eliminar petición" }).click();
  await expect(ana.getByText("Por la salud de mi papá")).toHaveCount(0, { timeout: 15_000 });

  // 10. Ana cierra la sala para todos
  await ana.getByRole("button", { name: "Cerrar sala" }).click();
  await ana.getByRole("button", { name: "Sí, cerrar sala" }).click();
  await expect(ana.getByRole("heading", { level: 1, name: "La sala se cerró" })).toBeVisible();
  await expect(beto.getByRole("heading", { level: 1, name: "La sala se cerró" })).toBeVisible({ timeout: 15_000 });
  await expect(carla.getByRole("heading", { level: 1, name: "La sala se cerró" })).toBeVisible({ timeout: 15_000 });

  // 11. Un enlace de una sala cerrada lo explica con claridad
  const late = await newPerson(browser);
  await late.goto(roomUrl);
  await expect(late.getByRole("heading", { level: 1, name: "Esta sala ya terminó" })).toBeVisible();
});

test("quien sale de la sala deja de ser participante y puede volver a entrar", async ({ browser }) => {
  const ana = await newPerson(browser);
  const beto = await newPerson(browser);
  const roomUrl = await createRoomAs(ana, "Ana");
  await joinRoomAs(beto, roomUrl, "Beto");
  await expect(ana.getByText("2 personas", { exact: false })).toBeVisible();

  await beto.getByRole("button", { name: "Salir de la sala" }).click();
  await expect(beto).toHaveURL(/\/es$/);
  await expect(ana.getByText("1 persona", { exact: false })).toBeVisible({ timeout: 15_000 });

  await joinRoomAs(beto, roomUrl, "Beto");
  await expect(ana.getByText("2 personas", { exact: false })).toBeVisible({ timeout: 15_000 });
});

test("unirse pegando el enlace o el código desde 'Orar ahora'", async ({ browser }) => {
  const ana = await newPerson(browser);
  const beto = await newPerson(browser);
  const roomUrl = await createRoomAs(ana, "Ana");

  await beto.goto("/es/orar");
  await beto.getByLabel("Código o enlace de la sala").fill("no es un código");
  await beto.getByRole("button", { name: "Unirme" }).click();
  await expect(beto.locator("#code-error")).toContainText("No encontramos una sala con ese código");

  await beto.getByLabel("Código o enlace de la sala").fill(roomUrl);
  await beto.getByRole("button", { name: "Unirme" }).click();
  await expect(beto.getByRole("heading", { level: 1, name: "Unirte a Sala de Ana" })).toBeVisible();
});

test("enlaces inválidos o de salas inexistentes se explican con claridad", async ({ page }) => {
  for (const path of ["/es/r/zzzzzz", "/es/r/abc", "/es/r/11111l"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: "No encontramos esta sala" })).toBeVisible();
  }
});

test("la sala no se indexa y la vista de unirse pasa accesibilidad", async ({ browser }) => {
  const ana = await newPerson(browser);
  const guest = await newPerson(browser);
  const roomUrl = await createRoomAs(ana, "Ana");

  await guest.goto(roomUrl);
  await expect(guest.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  const results = await new AxeBuilder({ page: guest }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
});

test("nombre vacío: el botón no deja crear la sala", async ({ page }) => {
  await page.goto("/es/orar");
  await expect(page.getByRole("button", { name: "Crear sala de oración" })).toBeDisabled();
  await page.getByLabel("¿Cómo te llamas?").fill("   ");
  await expect(page.getByRole("button", { name: "Crear sala de oración" })).toBeDisabled();
});
