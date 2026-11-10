import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

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
