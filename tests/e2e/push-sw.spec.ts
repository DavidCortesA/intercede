import { expect, test } from "@playwright/test";

// El service worker solo se registra en producción: se corre con `npm run build` + CI=1.
test.skip(!process.env.CI, "requiere build de producción (CI=1)");
// El Chromium "headless shell" que usa Playwright por defecto siempre deniega las notificaciones; el
// canal "chromium" (nuevo modo headless) sí respeta el permiso concedido.
test.use({ channel: "chromium" });

/**
 * Entrega un push de verdad al service worker (Chrome DevTools Protocol, sin servicio push externo) y
 * comprueba que muestra la notificación con el texto y el enlace del mensaje. Lo que NO cubre: el viaje
 * por FCM/APNs hasta un teléfono (ver docs/testing/avisos-dispositivos-reales.md).
 */
test("el service worker muestra la notificación que recibe por push", async ({ page, context }) => {
  await context.grantPermissions(["notifications"]);
  await page.goto("/es");
  await page.evaluate(() => navigator.serviceWorker.ready);

  const cdp = await context.newCDPSession(page);
  const registrationIds = new Set<string>();
  cdp.on("ServiceWorker.workerRegistrationUpdated", ({ registrations }) => {
    for (const registration of registrations) registrationIds.add(registration.registrationId);
  });
  await cdp.send("ServiceWorker.enable");
  await expect.poll(() => registrationIds.size).toBeGreaterThan(0);

  const payload = { title: "Vigilia de prueba", body: "Ya empezó la sala de oración", url: "/es/r/abc234", tag: "n-1" };
  const [registrationId] = [...registrationIds];
  await cdp.send("ServiceWorker.deliverPushMessage", {
    origin: new URL(page.url()).origin,
    registrationId: registrationId!,
    data: JSON.stringify(payload),
  });

  const shown = async () =>
    page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return (await registration.getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag, url: (n.data as { url?: string } | null)?.url }));
    });
  await expect.poll(shown).toEqual([{ title: payload.title, body: payload.body, tag: "n-1", url: "/es/r/abc234" }]);

  // Un push sin datos (o con datos que no son JSON) igual se muestra: los navegadores exigen que todo push sea visible
  await cdp.send("ServiceWorker.deliverPushMessage", {
    origin: new URL(page.url()).origin,
    registrationId: registrationId!,
    data: "esto no es json",
  });
  await expect.poll(async () => (await shown()).length).toBe(2);
  expect((await shown()).find((n) => n.title === "INTERCEDE")?.body).toBe("esto no es json");
});
