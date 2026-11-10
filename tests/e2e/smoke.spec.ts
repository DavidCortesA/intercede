import { expect, test } from "@playwright/test";

test("la raíz redirige al locale y muestra el titular de marca", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/es$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Una comunidad que ora junta.");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
});

test("el service worker se sirve con alcance raíz y precachea la página offline", async ({ request }) => {
  const res = await request.get("/serwist/sw.js");
  expect(res.ok()).toBe(true);
  expect(res.headers()["content-type"]).toContain("javascript");
  expect(res.headers()["service-worker-allowed"]).toBe("/");
  expect(await res.text()).toContain("/es/offline");
});

test("el manifest declara la app instalable", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.theme_color).toBe("#0A1240");
  expect(manifest.background_color).toBe("#0A1240");
  const sizes = manifest.icons.map((i: { sizes: string; purpose?: string }) => `${i.sizes}:${i.purpose ?? "any"}`);
  expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
});
