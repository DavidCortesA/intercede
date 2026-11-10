import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createConfirmedAccount, createRoomAs, joinRoomAs, newPerson, signInThroughUi } from "./helpers";

// Fase 8: moderación (reportes y bloqueos), eliminación de cuenta y endurecimiento. Requieren el Supabase local
// (`npm run test:e2e:db`). Solo escritorio: cada prueba crea cuentas reales.
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

const accessibilityIssues = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );

const postRequest = async (page: Page, text: string) => {
  await page.getByLabel("Nueva petición de oración").fill(text);
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: text })).toBeVisible();
};

// ───────────────────────── Reportar y bloquear en una sala ─────────────────────────

test.describe("reportes y bloqueos en una sala", () => {
  test.describe.configure({ mode: "serial" });

  let ana: Account;
  let beto: Account;
  let carla: Account;
  let anaPage: Page;
  let betoPage: Page;
  let carlaPage: Page;

  test.beforeAll(async ({ browser }) => {
    [ana, beto, carla] = await Promise.all([newAccount("Ana"), newAccount("Beto"), newAccount("Carla")]);
    [anaPage, betoPage, carlaPage] = await Promise.all([signedInPage(browser, ana), signedInPage(browser, beto), signedInPage(browser, carla)]);
  });

  test("reportar una petición: motivo, detalle, aviso de gracias y sin duplicados", async () => {
    const roomUrl = await createRoomAs(anaPage, "Ana");
    await joinRoomAs(betoPage, roomUrl, "Beto");
    await joinRoomAs(carlaPage, roomUrl, "Carla");
    await postRequest(betoPage, "Petición ofensiva de Beto");

    const item = carlaPage.getByRole("listitem").filter({ hasText: "Petición ofensiva de Beto" });
    await expect(item).toBeVisible();
    // Quien escribió la petición no ve el botón en la suya
    await expect(betoPage.getByRole("listitem").filter({ hasText: "Petición ofensiva de Beto" }).getByRole("button", { name: "Reportar o bloquear" })).toHaveCount(0);

    await item.getByRole("button", { name: "Reportar o bloquear" }).click();
    expect(await accessibilityIssues(carlaPage)).toEqual([]);
    await item.getByRole("button", { name: "Enviar reporte" }).waitFor({ state: "visible" });
    await expect(item.getByRole("button", { name: "Enviar reporte" })).toBeDisabled(); // falta el motivo
    await item.getByLabel("Spam o publicidad").check();
    await item.getByLabel("Detalles (opcional)").fill("  Es publicidad  ");
    await item.getByRole("button", { name: "Enviar reporte" }).click();
    await expect(item.getByRole("status").filter({ hasText: "Recibimos tu reporte" })).toBeVisible();

    const { data } = await admin().from("reports").select("reporter_id, target_type, target_user_id, reason, details, status").eq("reporter_id", carla.userId);
    expect(data).toEqual([{ reporter_id: carla.userId, target_type: "prayer_request", target_user_id: beto.userId, reason: "spam", details: "Es publicidad", status: "open" }]);

    // Otra vez sobre lo mismo: se avisa que ya existe
    await carlaPage.reload();
    const again = carlaPage.getByRole("listitem").filter({ hasText: "Petición ofensiva de Beto" });
    await again.getByRole("button", { name: "Reportar o bloquear" }).click();
    await again.getByLabel("Acoso o maltrato").check();
    await again.getByRole("button", { name: "Enviar reporte" }).click();
    await expect(again.getByRole("alert").filter({ hasText: "Ya enviaste un reporte" })).toBeVisible();
  });

  test("bloquear a alguien oculta lo suyo al instante; la anfitriona sigue viendo todo; se desbloquea desde el perfil", async () => {
    await carlaPage.reload(); // el panel del reporte anterior quedó abierto
    const item = carlaPage.getByRole("listitem").filter({ hasText: "Petición ofensiva de Beto" });
    await item.getByRole("button", { name: "Reportar o bloquear" }).click();
    await item.getByRole("button", { name: "Bloquear a Beto" }).click();
    // Desaparece al instante (la lista oculta lo de quien se bloquea) y sigue oculto tras recargar
    await expect(carlaPage.getByText("Petición ofensiva de Beto")).toHaveCount(0);
    await carlaPage.reload();
    await expect(carlaPage.getByText("Petición ofensiva de Beto")).toHaveCount(0);

    await expect(anaPage.getByText("Petición ofensiva de Beto")).toBeVisible(); // la anfitriona modera con todo a la vista
    // La petición de Carla tampoco le llega a Beto
    await postRequest(carlaPage, "Petición de Carla");
    await betoPage.reload();
    await expect(betoPage.getByText("Petición de Carla")).toHaveCount(0);

    await carlaPage.goto("/es/perfil");
    const blocked = carlaPage.getByRole("region", { name: "Personas bloqueadas" });
    await expect(blocked.getByText("Beto")).toBeVisible();
    expect(await accessibilityIssues(carlaPage)).toEqual([]);
    await blocked.getByRole("button", { name: "Desbloquear" }).click();
    await expect(blocked.getByText("No has bloqueado a nadie.")).toBeVisible();
    await carlaPage.goBack();
    await expect(carlaPage.getByText("Petición ofensiva de Beto")).toBeVisible();
  });

  test("reportar la sala entera", async () => {
    await carlaPage.reload();
    await carlaPage.getByRole("button", { name: "Reportar esta sala" }).click();
    await carlaPage.getByLabel("Contenido inapropiado").check();
    await carlaPage.getByRole("button", { name: "Enviar reporte" }).click();
    await expect(carlaPage.getByRole("status").filter({ hasText: "Recibimos tu reporte" })).toBeVisible();
    expect((await admin().from("reports").select("id").eq("reporter_id", carla.userId).eq("target_type", "room")).data).toHaveLength(1);
    // La anfitriona no se reporta a sí misma: no ve el botón
    await expect(anaPage.getByRole("button", { name: "Reportar esta sala" })).toHaveCount(0);
  });
});

// ───────────────────────── Reportes en una comunidad ─────────────────────────

test("comunidad: el liderazgo ve los reportes (sin saber quién reportó) y modera la publicación", async ({ browser }) => {
  test.setTimeout(90_000); // tres inicios de sesión y una comunidad
  const [ana, beto, carla] = await Promise.all([newAccount("Ana"), newAccount("Beto"), newAccount("Carla")]);
  const [anaPage, betoPage, carlaPage] = await Promise.all([signedInPage(browser, ana), signedInPage(browser, beto), signedInPage(browser, carla)]);

  await anaPage.goto("/es/comunidades");
  await anaPage.getByLabel("Nombre").fill("Comunidad moderada");
  await anaPage.getByRole("button", { name: "Crear comunidad" }).click();
  await expect(anaPage).toHaveURL(/\/es\/comunidades\/[0-9a-f-]{36}$/);
  const communityUrl = new URL(anaPage.url()).pathname;
  await anaPage.goto(`${communityUrl}/miembros`);
  await expect(anaPage.getByTestId("community-invite-url")).toHaveText(/\/c\//);
  const inviteUrl = ((await anaPage.getByTestId("community-invite-url").textContent()) ?? "").trim();

  for (const page of [betoPage, carlaPage]) {
    await page.goto(inviteUrl);
    await page.waitForLoadState("networkidle"); // que el botón ya responda
    await page.getByRole("button", { name: "Unirme a la comunidad" }).click();
    await expect(page).toHaveURL(communityUrl);
  }

  // Beto publica algo; Carla lo reporta desde el muro
  await betoPage.getByRole("textbox", { name: "Nueva petición" }).fill("Publicación problemática");
  await betoPage.getByRole("button", { name: "Publicar" }).click();
  await expect(betoPage.getByRole("article").filter({ hasText: "Publicación problemática" })).toBeVisible();

  await carlaPage.reload();
  const post = carlaPage.getByRole("article").filter({ hasText: "Publicación problemática" });
  await post.getByRole("button", { name: "Reportar o bloquear" }).click();
  await post.getByLabel("Acoso o maltrato").check();
  await post.getByRole("button", { name: "Enviar reporte" }).click();
  await expect(post.getByRole("status").filter({ hasText: "Recibimos tu reporte" })).toBeVisible();

  // Carla (miembro corriente) no ve la sección de reportes; Ana (admin) sí
  await expect(carlaPage.getByRole("navigation", { name: "Secciones de la comunidad" }).getByRole("link", { name: "Reportes" })).toHaveCount(0);
  expect((await carlaPage.goto(`${communityUrl}/reportes`))?.status()).toBe(404);

  await anaPage.goto(`${communityUrl}/reportes`);
  const report = anaPage.getByRole("listitem").filter({ hasText: "Publicación del muro" });
  await expect(report.getByText("Acoso o maltrato")).toBeVisible();
  await expect(report.getByText("Publicación problemática")).toBeVisible();
  await expect(report.getByText("Sobre Beto")).toBeVisible();
  await expect(anaPage.getByText("Carla")).toHaveCount(0); // quien reportó permanece anónima
  expect(await accessibilityIssues(anaPage)).toEqual([]);

  await report.getByRole("button", { name: "Eliminar publicación" }).click();
  await report.getByRole("button", { name: "Sí, eliminar" }).click();
  await expect(anaPage.getByText("No hay reportes abiertos.")).toBeVisible();
  await expect(anaPage.getByRole("heading", { level: 3, name: "Atendidos" })).toBeVisible();
  await betoPage.reload();
  await expect(betoPage.getByText("Publicación problemática")).toHaveCount(0);
});

// ───────────────────────── Eliminar la cuenta ─────────────────────────

test.describe("eliminar la cuenta", () => {
  test("pide confirmación y contraseña; borra todo, transfiere la administración y limpia los archivos", async ({ browser }) => {
    test.setTimeout(90_000);
    const leaver = await newAccount("Se va");
    const stays = await newAccount("Se queda");
    const page = await signedInPage(browser, leaver);
    const service = admin();

    // Una comunidad con otra persona (se transfiere) y una sola (se elimina), más una foto subida
    const shared = (await service.from("communities").insert({ name: "Compartida", kind: "group", created_by: leaver.userId }).select().single()).data!;
    await service.from("community_members").insert([
      { community_id: shared.id, user_id: leaver.userId, role: "admin", display_name: "Se va" },
      { community_id: shared.id, user_id: stays.userId, role: "member", display_name: "Se queda" },
    ]);
    const alone = (await service.from("communities").insert({ name: "Sola", kind: "group", created_by: leaver.userId }).select().single()).data!;
    await service.from("community_members").insert({ community_id: alone.id, user_id: leaver.userId, role: "admin", display_name: "Se va" });
    const photo = new Blob([new Uint8Array([82, 73, 70, 70])], { type: "image/webp" });
    expect((await service.storage.from("avatars").upload(`${leaver.userId}/avatar.webp`, photo, { contentType: "image/webp" })).error).toBeNull();
    expect((await service.storage.from("community-logos").upload(`${alone.id}/logo.webp`, photo, { contentType: "image/webp" })).error).toBeNull();

    await page.goto("/es/perfil");
    await expect(page.getByRole("heading", { level: 2, name: "Eliminar mi cuenta" })).toBeVisible();
    expect(await accessibilityIssues(page)).toEqual([]);
    await page.getByRole("button", { name: "Quiero eliminar mi cuenta" }).click();
    expect(await accessibilityIssues(page)).toEqual([]);

    // Sin confirmar o con la contraseña equivocada no se borra nada
    await page.getByRole("button", { name: "Eliminar para siempre" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Escribe ELIMINAR" })).toBeVisible();
    await page.getByLabel("Escribe ELIMINAR para confirmar").fill("eliminar");
    await page.getByLabel("Tu contraseña").fill("contraseña-equivocada");
    await page.getByRole("button", { name: "Eliminar para siempre" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "La contraseña no es correcta" })).toBeVisible();
    expect((await service.auth.admin.getUserById(leaver.userId)).data.user).not.toBeNull();

    await page.getByLabel("Tu contraseña").fill(leaver.password);
    await page.getByRole("button", { name: "Eliminar para siempre" }).click();
    await expect(page).toHaveURL(/\/es$/);

    // La cuenta y lo suyo ya no existen
    expect((await service.auth.admin.getUserById(leaver.userId)).data.user).toBeNull();
    expect((await service.from("profiles").select("id").eq("id", leaver.userId)).data).toEqual([]);
    expect((await service.from("communities").select("id").eq("id", alone.id)).data).toEqual([]);
    expect((await service.from("community_members").select("role").eq("community_id", shared.id).eq("user_id", stays.userId).single()).data?.role).toBe("admin");
    // Los archivos también
    expect((await service.storage.from("avatars").list(leaver.userId)).data).toEqual([]);
    expect((await service.storage.from("community-logos").list(alone.id)).data).toEqual([]);

    // La sesión se cerró y las credenciales ya no sirven
    await page.goto("/es/perfil");
    await expect(page).toHaveURL(/\/es\/entrar/);
    await page.getByLabel("Correo electrónico").fill(leaver.email);
    await page.getByLabel("Contraseña", { exact: true }).fill(leaver.password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Correo o contraseña incorrectos" })).toBeVisible();
  });

  test("un invitado también puede borrar sus datos (solo con la confirmación)", async ({ page }) => {
    await createRoomAs(page, "Invitada");
    await page.goto("/es/perfil");
    await expect(page.getByRole("heading", { level: 2, name: "Borrar mis datos" })).toBeVisible();
    await page.getByRole("button", { name: "Quiero eliminar mi cuenta" }).click();
    await expect(page.getByLabel("Tu contraseña")).toHaveCount(0);
    await page.getByLabel("Escribe ELIMINAR para confirmar").fill("ELIMINAR");
    await page.getByRole("button", { name: "Eliminar para siempre" }).click();
    await expect(page).toHaveURL(/\/es$/);
    // Ya no tiene sesión: /orar vuelve a ofrecer crear una sala desde cero
    await page.goto("/es/orar");
    await expect(page.getByRole("button", { name: "Crear sala de oración" })).toBeVisible();
  });

  test("la ruta rechaza peticiones sin sesión, de otro origen o sin confirmación", async ({ request, browser }) => {
    const anonymous = await request.post("/api/account/delete", { data: JSON.stringify({ confirm: "ELIMINAR" }), headers: { "Content-Type": "application/json" } });
    expect(anonymous.status()).toBe(401);
    const notJson = await request.post("/api/account/delete", { data: "confirm=ELIMINAR", headers: { "Content-Type": "text/plain" } });
    expect(notJson.status()).toBe(403);

    const account = await newAccount("Protegida");
    const page = await signedInPage(browser, account);
    const missing = await page.request.post("/api/account/delete", { data: JSON.stringify({ confirm: "no" }), headers: { "Content-Type": "application/json" } });
    expect(missing.status()).toBe(400);
    const noPassword = await page.request.post("/api/account/delete", { data: JSON.stringify({ confirm: "ELIMINAR" }), headers: { "Content-Type": "application/json" } });
    expect(noPassword.status()).toBe(403); // una sesión robada no basta: falta la contraseña
    expect((await admin().auth.admin.getUserById(account.userId)).data.user).not.toBeNull();
  });
});

// ───────────────────────── Endurecimiento ─────────────────────────

test.describe("endurecimiento", () => {
  test("las cabeceras de seguridad llegan en las páginas y en la API", async ({ request }) => {
    for (const path of ["/es", "/es/orar", "/api/events/00000000-0000-0000-0000-000000000000/ics"]) {
      const response = await request.get(path);
      const headers = response.headers();
      expect(headers["x-frame-options"], path).toBe("DENY");
      expect(headers["x-content-type-options"], path).toBe("nosniff");
      expect(headers["strict-transport-security"], path).toContain("max-age=31536000");
      expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
      expect(headers["permissions-policy"], path).toContain("microphone=(self)");
      expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
      expect(headers["x-powered-by"], path).toBeUndefined();
    }
  });

  test("sin configuración no se carga ningún script de terceros (CAPTCHA, analítica)", async ({ page }) => {
    test.skip(Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY), "con CAPTCHA configurado sí se carga");
    const external: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (!["localhost", "127.0.0.1"].includes(url.hostname)) external.push(url.hostname);
    });
    await page.goto("/es/orar");
    await expect(page.getByRole("button", { name: "Crear sala de oración" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(external.filter((host) => /cloudflare|vercel|sentry/.test(host))).toEqual([]);
  });
});
