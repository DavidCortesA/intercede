import { expect, test } from "@playwright/test";

// El service worker solo se registra en producción (en `npm run dev` está desactivado),
// por eso esta prueba se salta fuera de CI. Ejecutar con `npm run build` + CI=1.
test.skip(!process.env.CI, "requiere build de producción (CI=1)");

test("sin red, una navegación muestra la página offline", async ({ page, context }) => {
  await page.goto("/es");
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Asegura que el worker controle la página antes de cortar la red.
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  await page.goto("/es", { waitUntil: "domcontentloaded" }).catch(() => undefined);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sin conexión");
});

test("el service worker no guarda páginas HTML en caché", async ({ page }) => {
  await page.goto("/es");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();

  const cachedUrls = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) urls.push(new URL(req.url).pathname);
    }
    return urls;
  });

  // Solo estáticos y la página offline; nunca la raíz del locale ni /api.
  expect(cachedUrls).toContain("/es/offline");
  expect(cachedUrls).not.toContain("/es");
  expect(cachedUrls.some((p) => p.startsWith("/api/"))).toBe(false);
});
