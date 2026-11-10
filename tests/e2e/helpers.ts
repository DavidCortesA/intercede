import { createClient } from "@supabase/supabase-js";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Crea una cuenta ya confirmada con la API de administración del Supabase local (rápido, sin
 * correo) y devuelve sus credenciales: para pruebas que no son del registro en sí.
 */
export async function createConfirmedAccount(displayName: string) {
  const admin = createClient(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `e2e-${crypto.randomUUID()}@example.test`;
  const password = `Clave-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (error || !data.user) throw new Error(`No se pudo crear la cuenta de prueba: ${error?.message}`);
  return { email, password, userId: data.user.id, cleanup: () => admin.auth.admin.deleteUser(data.user.id) };
}

/** Entra por la pantalla de "Entrar" y espera llegar a la pantalla de oración. */
export async function signInThroughUi(page: Page, email: string, password: string, expectUrl: RegExp = /\/es\/orar$/) {
  await page.goto("/es/entrar");
  await signInOnCurrentPage(page, email, password, expectUrl);
}

/** Llena el formulario de "Entrar" que ya está abierto (conserva el ?next= de la URL). */
export async function signInOnCurrentPage(page: Page, email: string, password: string, expectUrl: RegExp = /\/es\/orar$/) {
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(expectUrl);
}

/** Una persona = un contexto de navegador propio (sin cookies compartidas). */
export async function newPerson(
  browser: Browser,
  options: Parameters<Browser["newContext"]>[0] = {},
): Promise<Page> {
  const context: BrowserContext = await browser.newContext(options);
  return context.newPage();
}

export async function createRoomAs(page: Page, name: string): Promise<string> {
  await page.goto("/es");
  await page.locator("section").first().getByRole("link", { name: "Orar ahora" }).click();
  await expect(page).toHaveURL(/\/es\/orar$/);
  await page.getByLabel("¿Cómo te llamas?").fill(name);
  await page.getByRole("button", { name: "Crear sala de oración" }).click();
  await expect(page).toHaveURL(/\/es\/r\/[a-hj-km-np-z2-9]{6}$/);
  return page.url();
}

export async function joinRoomAs(page: Page, roomUrl: string, name: string) {
  await page.goto(roomUrl);
  await page.getByLabel("¿Cómo te llamas?").fill(name);
  await page.getByRole("button", { name: "Entrar a la sala" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Peticiones" })).toBeVisible();
}
