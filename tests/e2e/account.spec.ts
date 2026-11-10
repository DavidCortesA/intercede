import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { createConfirmedAccount, createRoomAs, joinRoomAs, newPerson, signInOnCurrentPage, signInThroughUi } from "./helpers";
import { confirmLink, waitForEmail } from "./mail";

// Cuentas, diario, "estoy orando por esto" y perfil. Necesitan el Supabase local con Mailpit
// (`npm run test:e2e:db`): los correos de confirmación y recuperación caen ahí, nunca salen.
test.skip(!process.env.SUPABASE_TEST_URL, "requiere Supabase local (npm run test:e2e:db)");
// Solo escritorio: cada prueba crea usuarios reales y las altas anónimas tienen tope por hora
test.skip(({ isMobile }) => isMobile, "se corre solo en escritorio");

const PASSWORD = "Clave-segura-123";
const createdEmails: string[] = [];
const cleanups: (() => Promise<unknown>)[] = [];

const admin = () =>
  createClient(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

test.afterAll(async () => {
  const client = admin();
  const { data } = await client.auth.admin.listUsers({ perPage: 500 });
  for (const user of data.users) if (user.email && createdEmails.includes(user.email)) await client.auth.admin.deleteUser(user.id);
  await Promise.all(cleanups.map((cleanup) => cleanup()));
});

async function newAccount(name: string) {
  const account = await createConfirmedAccount(name);
  cleanups.push(account.cleanup);
  return account;
}

const tabs = (page: Page) => page.getByRole("navigation", { name: "Navegación de tu cuenta" });
const accessibilityIssues = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );

test.describe("registro, entrada y recuperación", () => {
  test("crear una cuenta nueva: correo en español, confirmar, entrar y salir", async ({ page }) => {
    const email = `e2e-${crypto.randomUUID()}@example.test`;
    createdEmails.push(email);

    await page.goto("/es/registro");
    await page.getByLabel("Tu nombre").fill("Lucía");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill(PASSWORD);
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByRole("heading", { name: "Revisa tu correo" })).toBeVisible();

    const mail = await waitForEmail(email);
    expect(mail.subject).toBe("Confirma tu correo en INTERCEDE");
    await page.goto(confirmLink(mail));
    await expect(page).toHaveURL(/\/es\/perfil$/);
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByLabel("Nombre")).toHaveValue("Lucía");

    // Con cuenta aparecen Diario y Salas (navegación progresiva)
    await expect(tabs(page).getByRole("link", { name: "Diario" })).toBeVisible();
    await expect(tabs(page).getByRole("link", { name: "Salas" })).toBeVisible();

    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page).toHaveURL(/\/es$/);

    // Contraseña equivocada: mensaje claro; correcta: entra
    await page.goto("/es/entrar");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña", { exact: true }).fill("incorrecta-123");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Correo o contraseña incorrectos" })).toBeVisible();
    await signInThroughUi(page, email, PASSWORD);
  });

  test("un invitado crea cuenta y conserva su historial (se convierte el mismo usuario)", async ({ browser }) => {
    const email = `e2e-${crypto.randomUUID()}@example.test`;
    createdEmails.push(email);
    const ana = await newPerson(browser);
    await createRoomAs(ana, "Ana");

    // Como invitada: solo ve Orar y Perfil, y el diario le propone crear cuenta
    await ana.goto("/es/perfil");
    await expect(ana.getByRole("heading", { name: "Estás orando como invitado" })).toBeVisible();
    await expect(tabs(ana).getByRole("link", { name: "Diario" })).toHaveCount(0);
    await ana.goto("/es/diario");
    await expect(ana.getByRole("heading", { name: "El diario es para quienes tienen cuenta" })).toBeVisible();

    await ana.getByRole("link", { name: "Crear cuenta" }).click();
    await expect(ana).toHaveURL(/\/es\/registro$/);
    await expect(ana.getByRole("heading", { level: 1, name: "Guarda tu historial con una cuenta" })).toBeVisible();
    await expect(ana.getByLabel("Tu nombre")).toHaveCount(0); // ya tiene nombre
    await ana.getByLabel("Correo electrónico").fill(email);
    await ana.getByLabel("Contraseña").fill(PASSWORD);
    await ana.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(ana.getByRole("heading", { name: "Revisa tu correo" })).toBeVisible();

    await ana.goto(confirmLink(await waitForEmail(email)));
    await expect(ana).toHaveURL(/\/es\/perfil$/);
    await expect(ana.getByText(email)).toBeVisible();
    await expect(tabs(ana).getByRole("link", { name: "Salas" })).toBeVisible();

    // La sala de cuando era invitada sigue en su historial
    await ana.goto("/es/salas");
    await expect(ana.getByText("Sala de Ana")).toBeVisible();
    await expect(ana.getByText("Anfitrión")).toBeVisible();

    // Y tras salir y volver a entrar con la contraseña, también
    await ana.goto("/es/perfil");
    await ana.getByRole("button", { name: "Cerrar sesión" }).click();
    await signInThroughUi(ana, email, PASSWORD);
    await ana.goto("/es/salas");
    await expect(ana.getByText("Sala de Ana")).toBeVisible();
  });

  test("recuperar la contraseña con el enlace del correo", async ({ browser }) => {
    const account = await newAccount("Rosa");
    const page = await newPerson(browser);

    await page.goto("/es/entrar");
    await page.getByRole("link", { name: "¿Olvidaste tu contraseña?" }).click();
    await expect(page).toHaveURL(/\/es\/recuperar$/);
    await page.getByLabel("Correo electrónico").fill(account.email);
    await page.getByRole("button", { name: "Enviar enlace" }).click();
    await expect(page.getByRole("heading", { name: "Revisa tu correo" })).toBeVisible();

    const mail = await waitForEmail(account.email, { subject: "Restablece" });
    await page.goto(confirmLink(mail));
    await expect(page).toHaveURL(/\/es\/restablecer$/);
    await expect(page.getByRole("heading", { level: 1, name: "Elige una contraseña nueva" })).toBeVisible();

    await page.getByLabel("Contraseña nueva").fill("Otra-clave-nueva-456");
    await page.getByLabel("Repite la contraseña").fill("no-coincide-123");
    await page.getByRole("button", { name: "Guardar contraseña" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "no coinciden" })).toBeVisible();

    await page.getByLabel("Contraseña nueva").fill("Otra-clave-nueva-456");
    await page.getByLabel("Repite la contraseña").fill("Otra-clave-nueva-456");
    await page.getByRole("button", { name: "Guardar contraseña" }).click();
    await expect(page.getByRole("status").filter({ hasText: "tu contraseña se actualizó" })).toBeVisible();

    // La nueva sirve; la vieja ya no
    const other = await newPerson(browser);
    await signInThroughUi(other, account.email, "Otra-clave-nueva-456");
    const old = await newPerson(browser);
    await old.goto("/es/entrar");
    await old.getByLabel("Correo electrónico").fill(account.email);
    await old.getByLabel("Contraseña", { exact: true }).fill(account.password);
    await old.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(old.getByRole("alert").filter({ hasText: "Correo o contraseña incorrectos" })).toBeVisible();
  });

  test("enlaces inválidos y redirecciones seguras", async ({ page, baseURL }) => {
    await page.goto("/auth/confirm?token_hash=falso&type=recovery&next=/es/restablecer");
    await expect(page).toHaveURL(/\/es\/entrar\?error=link$/);
    await expect(page.getByRole("alert").filter({ hasText: "no es válido o ya caducó" })).toBeVisible();

    // Un ?next= hacia otro sitio nunca se sigue
    for (const path of [
      "/auth/confirm?token_hash=x&type=email&next=https%3A%2F%2Fmalo.example",
      "/auth/confirm?token_hash=x&type=email&next=%2F%2Fmalo.example",
      "/auth/callback?code=x&next=https%3A%2F%2Fmalo.example",
    ]) {
      await page.goto(path);
      expect(page.url().startsWith(baseURL ?? "http://localhost:3000")).toBe(true);
      await expect(page).toHaveURL(/\/es\/entrar\?error=link$/);
    }

    // Sin sesión, la pantalla de restablecer lo explica
    await page.goto("/es/restablecer");
    await expect(page.getByRole("heading", { level: 1, name: "El enlace ya no sirve" })).toBeVisible();
  });

  test("las pantallas protegidas llevan a entrar y regresan a donde ibas", async ({ browser }) => {
    const account = await newAccount("Pablo");
    const page = await newPerson(browser);
    await page.goto("/es/diario");
    await expect(page).toHaveURL(/\/es\/entrar\?next=%2Fdiario$/);
    await signInOnCurrentPage(page, account.email, account.password, /\/es\/diario$/);
    await expect(page.getByRole("heading", { level: 1, name: "Mi diario de oración" })).toBeVisible();
  });
});

test.describe("diario de oración", () => {
  test("escribir, filtrar, responder con testimonio, editar y eliminar", async ({ browser }) => {
    test.setTimeout(90_000);
    const account = await newAccount("Marta");
    const page = await newPerson(browser);
    await signInThroughUi(page, account.email, account.password);
    await page.goto("/es/diario");
    await expect(page.getByText("Tu diario está vacío").or(page.getByText("No tienes peticiones en oración"))).toBeVisible();

    const add = async (text: string, category: string) => {
      await page.getByLabel("Nueva petición").fill(text);
      await page.locator("#journal-category").selectOption({ label: category });
      await page.getByRole("button", { name: "Guardar en mi diario" }).click();
      // Se espera la entrada en la LISTA (getByText también coincidiría con el texto aún escrito en el campo)
      await expect(page.getByRole("listitem").filter({ hasText: text })).toBeVisible();
      await expect(page.getByLabel("Nueva petición")).toHaveValue("");
    };
    await add("Por la salud de mi mamá", "Salud");
    await add("Una oportunidad de trabajo", "Trabajo");

    // Filtro por categoría
    await page.getByRole("button", { name: "Salud", exact: true }).click();
    await expect(page.getByText("Por la salud de mi mamá")).toBeVisible();
    await expect(page.getByText("Una oportunidad de trabajo")).toHaveCount(0);
    await page.getByRole("button", { name: "Todas", exact: true }).first().click();

    // Marcar respondida con testimonio → pasa a "Respondidas"
    const work = page.getByRole("listitem").filter({ hasText: "Una oportunidad de trabajo" });
    await work.getByRole("button", { name: "Marcar como respondida" }).click();
    await work.getByLabel("Testimonio (opcional)").fill("Me llamaron de una empresa");
    await work.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("Una oportunidad de trabajo")).toHaveCount(0); // ya no está "En oración"
    await page.getByRole("tab", { name: "Respondidas" }).click();
    await expect(page.getByText("Me llamaron de una empresa")).toBeVisible();
    await expect(page.getByText("Respondida", { exact: true })).toBeVisible();

    // Quitar la marca limpia el testimonio
    await page.getByRole("button", { name: "Quitar “respondida”" }).click();
    await page.getByRole("tab", { name: "En oración" }).click();
    const back = page.getByRole("listitem").filter({ hasText: "Una oportunidad de trabajo" });
    await expect(back).toBeVisible();
    await expect(back.getByText("Me llamaron de una empresa")).toHaveCount(0);

    // Editar
    const health = page.getByRole("listitem").filter({ hasText: "Por la salud de mi mamá" });
    await health.getByRole("button", { name: "Editar" }).click();
    await health.getByRole("textbox").fill("Por la salud de mi mamá y de mi papá");
    await health.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("Por la salud de mi mamá y de mi papá")).toBeVisible();

    // Persiste al recargar; eliminar pide confirmación
    await page.reload();
    await expect(page.getByText("Por la salud de mi mamá y de mi papá")).toBeVisible();
    const target = page.getByRole("listitem").filter({ hasText: "Por la salud de mi mamá y de mi papá" });
    await target.getByRole("button", { name: "Eliminar" }).click();
    await expect(target.getByText("¿Eliminar esta petición? No se puede deshacer.")).toBeVisible();
    await target.getByRole("button", { name: "Sí, eliminar" }).click();
    await expect(page.getByText("Por la salud de mi mamá y de mi papá")).toHaveCount(0);

    // Accesibilidad con contenido
    expect(await accessibilityIssues(page)).toEqual([]);
  });

  test("el diario es privado: otra persona no ve las entradas", async ({ browser }) => {
    const [a, b] = await Promise.all([newAccount("Ana"), newAccount("Beto")]);
    const pageA = await newPerson(browser);
    const pageB = await newPerson(browser);
    await signInThroughUi(pageA, a.email, a.password);
    await signInThroughUi(pageB, b.email, b.password);

    await pageA.goto("/es/diario");
    await pageA.getByLabel("Nueva petición").fill("Algo muy personal de Ana");
    await pageA.getByRole("button", { name: "Guardar en mi diario" }).click();
    await expect(pageA.getByText("Algo muy personal de Ana")).toBeVisible();

    await pageB.goto("/es/diario");
    await expect(pageB.getByText("Algo muy personal de Ana")).toHaveCount(0);
  });
});

test.describe("estoy orando por esto y guardar en el diario", () => {
  test("se cuenta una vez por persona, llega en vivo y se puede guardar la petición", async ({ browser }) => {
    test.setTimeout(90_000);
    const account = await newAccount("Beto");
    const ana = await newPerson(browser);
    const beto = await newPerson(browser);
    const roomUrl = await createRoomAs(ana, "Ana");

    await signInThroughUi(beto, account.email, account.password);
    await joinRoomAs(beto, roomUrl, "Beto");

    await ana.getByLabel("Nueva petición de oración").fill("Por la paz en mi familia");
    await ana.getByRole("button", { name: "Enviar" }).click();
    await expect(beto.getByText("Por la paz en mi familia")).toBeVisible({ timeout: 15_000 });

    // Quien escribió la petición no tiene botón; ve cuántas personas oran por ella
    await expect(ana.getByRole("button", { name: /Estoy orando por esto/ })).toHaveCount(0);
    await expect(ana.getByText("Nadie ha dicho que ora por esto")).toBeVisible();

    const pray = beto.getByRole("button", { name: /Estoy orando por esto/ });
    await expect(pray).toHaveAttribute("aria-pressed", "false");
    await expect(pray).toContainText("· 0");
    await pray.click();
    await expect(pray).toHaveAttribute("aria-pressed", "true");
    await expect(pray).toContainText("· 1");
    await expect(ana.getByText("1 persona ora por esto")).toBeVisible({ timeout: 15_000 });

    await pray.click();
    await expect(pray).toHaveAttribute("aria-pressed", "false");
    await expect(ana.getByText("Nadie ha dicho que ora por esto")).toBeVisible({ timeout: 15_000 });

    // Guardar en el diario: solo cuentas (Ana, invitada, no ve el botón)
    await expect(ana.getByRole("button", { name: "Guardar en mi diario" })).toHaveCount(0);
    await beto.getByRole("button", { name: "Guardar en mi diario" }).click();
    await expect(beto.getByText("Guardada en tu diario")).toBeVisible();
    await beto.goto("/es/diario");
    await expect(beto.getByText("Por la paz en mi familia")).toBeVisible();
    await expect(beto.getByText("Guardada desde una sala")).toBeVisible();
  });
});

test.describe("perfil", () => {
  test("cambiar nombre y zona horaria, y subir una foto que ven en la sala", async ({ browser }) => {
    test.setTimeout(90_000);
    const account = await newAccount("Maria");
    const page = await newPerson(browser);
    await signInThroughUi(page, account.email, account.password);

    await page.goto("/es/perfil");
    await page.getByLabel("Nombre").fill("María José");
    await page.getByLabel("Zona horaria").selectOption("America/Mexico_City");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Cambios guardados" })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Nombre")).toHaveValue("María José");
    await expect(page.getByLabel("Zona horaria")).toHaveValue("America/Mexico_City");

    // Foto: se recorta, se sube a nuestra carpeta y se ve en el perfil
    const png = await sharp({ create: { width: 320, height: 200, channels: 3, background: "#5B2EE6" } }).png().toBuffer();
    await page.locator('input[type="file"]').setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: png });
    const avatar = page.locator('img[src*="/storage/v1/object/public/avatars/"]');
    await expect(avatar.first()).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(avatar.first()).toBeVisible();

    // En una sala, las demás personas ven la foto de quien entra
    const ana = await newPerson(browser);
    const roomUrl = await createRoomAs(ana, "Ana");
    await joinRoomAs(page, roomUrl, "María José");
    await expect(ana.locator('img[src*="/storage/v1/object/public/avatars/"]').first()).toBeVisible({ timeout: 15_000 });

    // Quitar la foto
    await page.goto("/es/perfil");
    await page.getByRole("button", { name: "Quitar foto" }).click();
    await expect(avatar).toHaveCount(0);
  });

  test("accesibilidad de las pantallas de cuenta (claro y oscuro)", async ({ browser }) => {
    test.setTimeout(90_000);
    const account = await newAccount("Axe");
    const page = await newPerson(browser);
    await signInThroughUi(page, account.email, account.password);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      for (const path of ["/es/perfil", "/es/diario", "/es/salas", "/es/orar"]) {
        await page.goto(path);
        expect(await accessibilityIssues(page), `${path} en ${scheme}`).toEqual([]);
      }
    }
  });
});
