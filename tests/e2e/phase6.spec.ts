import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createConfirmedAccount, createRoomAs, newPerson, signInThroughUi } from "./helpers";

// Fase 6: devocional, salas programadas con invitación, avisos y preferencias. Requieren el Supabase
// local (`npm run test:e2e:db`). Solo escritorio: cada prueba crea cuentas reales.
test.skip(!process.env.SUPABASE_TEST_URL, "requiere Supabase local (npm run test:e2e:db)");
test.skip(({ isMobile }) => isMobile, "se corre solo en escritorio");

const admin = () =>
  createClient(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const cleanups: (() => Promise<unknown>)[] = [];
test.afterAll(async () => {
  await Promise.all(cleanups.map((cleanup) => cleanup()));
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

const tabs = (page: Page) => page.getByRole("navigation", { name: "Navegación de tu cuenta" });

// ───────────────────────── Devocional ─────────────────────────

test.describe("devocional", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await admin().from("devotionals").delete().not("id", "is", null);
  });
  test.afterAll(async () => {
    await admin().from("devotionals").delete().not("id", "is", null);
  });

  test("sin devocional publicado lo dice; con uno, se lee, se marca, se anota y cuenta la racha", async ({ browser }) => {
    const ana = await newAccount("Ana");
    const page = await signedInPage(browser, ana);

    await expect(tabs(page).getByRole("link", { name: "Devocional" })).toBeVisible();
    await tabs(page).getByRole("link", { name: "Devocional" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Hoy no hay devocional" })).toBeVisible();
    expect(await accessibilityIssues(page)).toEqual([]);

    // Los perfiles nuevos parten de UTC: "hoy" es la fecha UTC
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await admin()
      .from("devotionals")
      .insert({
        devotional_date: today,
        passage_reference: "Pasaje de prueba 3:16",
        passage_text: "Texto de prueba para el devocional.",
        bible_version: "Versión de prueba",
        reflection: "Una reflexión de prueba.",
        question: "¿Qué harás hoy con esto?",
        suggested_prayer: "Señor, gracias.",
      });
    expect(error).toBeNull();

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Devocional de hoy" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Pasaje de prueba 3:16" })).toBeVisible();
    await expect(page.getByText("Texto de prueba para el devocional.")).toBeVisible();
    await expect(page.getByText("Versión: Versión de prueba")).toBeVisible();
    await expect(page.getByText("¿Qué harás hoy con esto?")).toBeVisible();
    await expect(page.getByText("Señor, gracias.")).toBeVisible();
    await expect(page.getByText("Empieza tu racha hoy")).toBeVisible();
    expect(await accessibilityIssues(page)).toEqual([]);

    await page.getByRole("button", { name: "Marcar como leído" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Leído" })).toBeVisible();
    await expect(page.getByText("1 día seguido")).toBeVisible();
    await expect(page.getByText("1 devocional leído")).toBeVisible();

    await page.getByRole("textbox", { name: "Mis notas" }).fill("Dios me recordó esperar en Él.");
    await page.getByRole("button", { name: "Guardar nota" }).click();
    await expect(page.getByText("Nota guardada")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("textbox", { name: "Mis notas" })).toHaveValue("Dios me recordó esperar en Él.");
    await expect(page.getByRole("status").filter({ hasText: "Leído" })).toBeVisible();
    await expect(page.getByText("1 día seguido")).toBeVisible();

    // Otra cuenta no ve la nota ni el progreso de Ana
    const beto = await newAccount("Beto");
    const betoPage = await signedInPage(browser, beto);
    await betoPage.goto("/es/devocional");
    await expect(betoPage.getByRole("textbox", { name: "Mis notas" })).toHaveValue("");
    await expect(betoPage.getByRole("button", { name: "Marcar como leído" })).toBeVisible();
  });

  test("un invitado ve la invitación a crear cuenta, no el devocional", async ({ page }) => {
    await createRoomAs(page, "Invitada");
    await page.goto("/es/devocional");
    await expect(page.getByRole("heading", { name: "El devocional es para quienes tienen cuenta" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Crear cuenta" })).toBeVisible();
    await expect(tabs(page).getByRole("link", { name: "Devocional" })).toHaveCount(0);
  });
});

// ───────────────────────── Salas programadas ─────────────────────────

test.describe("salas programadas", () => {
  test.describe.configure({ mode: "serial" });

  let ana: Account;
  let beto: Account;
  let carla: Account;
  let anaPage: Page;
  let betoPage: Page;
  let carlaPage: Page;
  let inviteUrl = "";

  const inviteUrlOnPage = async () => {
    await expect(anaPage.getByTestId("invite-url")).toHaveText(/\/es\/p\/[A-Za-z0-9_-]+$/);
    return ((await anaPage.getByTestId("invite-url").textContent()) ?? "").trim();
  };

  test.beforeAll(async ({ browser }) => {
    [ana, beto, carla] = await Promise.all([newAccount("Ana"), newAccount("Beto"), newAccount("Carla")]);
    anaPage = await signedInPage(browser, ana);
    betoPage = await signedInPage(browser, beto);
    carlaPage = await signedInPage(browser, carla);
  });

  test("el formulario explica qué falta antes de programar", async () => {
    await anaPage.goto("/es/programadas");
    await expect(anaPage.getByRole("heading", { level: 1, name: "Salas programadas" })).toBeVisible();
    expect(await accessibilityIssues(anaPage)).toEqual([]);

    await anaPage.getByRole("button", { name: "Programar sala" }).click();
    await expect(anaPage.getByRole("alert").filter({ hasText: "Escribe un nombre" })).toBeVisible();

    await anaPage.getByLabel("Nombre").fill("Vigilia e2e");
    await anaPage.getByText("Cada semana", { exact: true }).click();
    await anaPage.getByRole("button", { name: "Programar sala" }).click();
    await expect(anaPage.getByRole("alert").filter({ hasText: "Elige al menos un día de la semana." })).toBeVisible();
  });

  test("crear una programación diaria deja su tarjeta y su enlace de invitación", async () => {
    await anaPage.getByText("Todos los días", { exact: true }).click();
    await anaPage.getByRole("button", { name: "Programar sala" }).click();

    const card = anaPage.getByRole("article").filter({ hasText: "Vigilia e2e" });
    await expect(card.getByRole("heading", { level: 3, name: "Vigilia e2e" })).toBeVisible();
    await expect(card.getByText("Todos los días a las 06:00")).toBeVisible();
    await expect(card.getByText("Zona horaria: UTC")).toBeVisible();
    await expect(card.getByText("Próxima:")).toBeVisible();
    await expect(card.getByText("0 personas la siguen")).toBeVisible();

    inviteUrl = await inviteUrlOnPage();
    expect(inviteUrl).toMatch(/\/es\/p\/[A-Za-z0-9_-]{20,}$/);
    expect(await accessibilityIssues(anaPage)).toEqual([]);
  });

  test("quien no tiene cuenta ve la invitación y se le pide crear una", async ({ page }) => {
    await page.goto(inviteUrl);
    await expect(page.getByRole("heading", { level: 1, name: "Vigilia e2e" })).toBeVisible();
    await expect(page.getByText("Todos los días a las 06:00")).toBeVisible();
    await expect(page.getByText("necesitas una cuenta gratuita")).toBeVisible();
    const next = encodeURIComponent(new URL(inviteUrl).pathname.replace(/^\/es/, ""));
    await expect(page.getByRole("link", { name: "Crear cuenta" })).toHaveAttribute("href", `/es/registro?next=${next}`);
    await expect(page.getByRole("link", { name: "Ya tengo cuenta" })).toHaveAttribute("href", `/es/entrar?next=${next}`);
    expect(await accessibilityIssues(page)).toEqual([]);
  });

  test("una cuenta con el enlace puede seguir la sala y la ve en sus programadas", async () => {
    await betoPage.goto(inviteUrl);
    await expect(betoPage.getByRole("heading", { level: 1, name: "Vigilia e2e" })).toBeVisible();
    await betoPage.getByRole("button", { name: "Seguir esta sala" }).click();
    await expect(betoPage.getByRole("status").filter({ hasText: "ya la sigues" })).toBeVisible();

    await betoPage.getByRole("link", { name: "Ver mis salas programadas" }).click();
    await expect(betoPage).toHaveURL(/\/es\/programadas$/);
    const following = betoPage.getByRole("region", { name: "Las que sigo" });
    await expect(following.getByRole("heading", { level: 3, name: "Vigilia e2e" })).toBeVisible();
    // Quien sigue no ve el enlace de invitación ni los controles de quien la creó
    await expect(betoPage.getByTestId("invite-url")).toHaveCount(0);
    await expect(following.getByRole("button", { name: "Pausar" })).toHaveCount(0);

    await anaPage.reload();
    await expect(anaPage.getByRole("article").filter({ hasText: "Vigilia e2e" }).getByText("1 persona la sigue")).toBeVisible();
  });

  test("a la hora llega el recordatorio, luego el aviso de inicio y la sala se abre para todos", async () => {
    const service = admin();
    const { data: schedule } = await service.from("room_schedules").select("id").eq("owner_id", ana.userId).single();
    const scheduleId = schedule!.id;

    // Faltan 5 minutos: recordatorio para quien la sigue (Beto) y para quien la creó
    await service.from("room_schedules").update({ next_occurrence_at: new Date(Date.now() + 5 * 60_000).toISOString() }).eq("id", scheduleId);
    expect((await service.rpc("process_scheduled_work")).error).toBeNull();

    await betoPage.goto("/es/avisos");
    await expect(betoPage.getByRole("heading", { level: 1, name: "Avisos" })).toBeVisible();
    const recent = betoPage.getByRole("region", { name: "Recientes" });
    await expect(recent.getByText("Vigilia e2e")).toBeVisible();
    await expect(recent.getByText(/Empieza en [45] minutos/)).toBeVisible();

    // Llega la hora: se abre la sala y se avisa con el enlace
    await service.from("room_schedules").update({ next_occurrence_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", scheduleId);
    expect((await service.rpc("process_scheduled_work")).error).toBeNull();

    await betoPage.reload();
    const started = betoPage.getByRole("link").filter({ hasText: "Ya empezó la sala de oración" });
    await expect(started).toBeVisible();
    await started.click();
    await expect(betoPage).toHaveURL(/\/es\/r\/[a-hj-km-np-z2-9]{6}$/);
    await expect(betoPage.getByRole("heading", { level: 1, name: "Unirte a Vigilia e2e" })).toBeVisible();
    await betoPage.getByLabel("¿Cómo te llamas?").fill("Beto");
    await betoPage.getByRole("button", { name: "Entrar a la sala" }).click();
    await expect(betoPage.getByRole("heading", { level: 2, name: "Peticiones" })).toBeVisible();

    // Quien la creó entra desde su pantalla y conserva los controles de anfitriona
    await anaPage.reload();
    await anaPage.getByRole("link", { name: "Entrar a la sala abierta" }).click();
    await expect(anaPage).toHaveURL(/\/es\/r\/[a-hj-km-np-z2-9]{6}$/);
    await anaPage.getByLabel("¿Cómo te llamas?").fill("Ana");
    await anaPage.getByRole("button", { name: "Entrar a la sala" }).click();
    await expect(anaPage.getByRole("heading", { level: 2, name: "Peticiones" })).toBeVisible();
    await expect(anaPage.getByRole("button", { name: "Cerrar sala" })).toBeVisible();

    // Cerrar la sala del día no cancela la programación: sigue con la próxima
    await anaPage.getByRole("button", { name: "Cerrar sala" }).click();
    await anaPage.getByRole("button", { name: "Sí, cerrar sala" }).click();
    await anaPage.goto("/es/programadas");
    await expect(anaPage.getByRole("article").filter({ hasText: "Vigilia e2e" }).getByText("Próxima:")).toBeVisible();
  });

  test("revocar el enlace deja sin efecto el anterior", async () => {
    await anaPage.goto("/es/programadas");
    const before = await inviteUrlOnPage();
    await anaPage.getByRole("button", { name: "Revocar y crear otro enlace" }).click();
    await expect(anaPage.getByText("Enlace nuevo creado. El anterior ya no sirve.")).toBeVisible();
    await expect.poll(inviteUrlOnPage).not.toBe(before);
    const after = await inviteUrlOnPage();

    await carlaPage.goto(before);
    await expect(carlaPage.getByRole("heading", { level: 1, name: "Este enlace ya no sirve" })).toBeVisible();
    await carlaPage.goto(after);
    await expect(carlaPage.getByRole("button", { name: "Seguir esta sala" })).toBeVisible();
  });

  test("se puede pausar, reanudar y eliminar; quien la seguía deja de verla", async () => {
    await anaPage.goto("/es/programadas");
    const card = anaPage.getByRole("article").filter({ hasText: "Vigilia e2e" });

    await card.getByRole("button", { name: "Pausar" }).click();
    await expect(card.getByText("Pausada")).toBeVisible();
    await expect(card.getByText("Próxima:")).toHaveCount(0);
    await card.getByRole("button", { name: "Reanudar" }).click();
    await expect(card.getByText("Pausada")).toHaveCount(0);
    await expect(card.getByText("Próxima:")).toBeVisible();

    await card.getByRole("button", { name: "Eliminar" }).click();
    await card.getByRole("group").getByRole("button", { name: "Eliminar" }).click();
    await expect(anaPage.getByText("Aún no has programado ninguna.")).toBeVisible();

    await betoPage.goto("/es/programadas");
    await expect(betoPage.getByText("Cuando alguien te invite a una sala programada, aparecerá aquí.")).toBeVisible();
  });

  test("un invitado ve la invitación a crear cuenta en vez de la pantalla de programadas", async ({ page }) => {
    await createRoomAs(page, "Invitado");
    await page.goto("/es/programadas");
    await expect(page.getByRole("heading", { name: "Programa tus salas con una cuenta" })).toBeVisible();
  });
});

// ───────────────────────── Avisos ─────────────────────────

test.describe("avisos y preferencias", () => {
  test("las preferencias se guardan y se conservan", async ({ browser }) => {
    const ana = await newAccount("Ana");
    const page = await signedInPage(browser, ana);

    await page.goto("/es/perfil");
    await page.getByRole("link", { name: /Avisos y recordatorios/ }).click();
    await expect(page).toHaveURL(/\/es\/avisos$/);
    await expect(page.getByRole("heading", { level: 1, name: "Avisos" })).toBeVisible();
    await expect(page.getByText("Todavía no tienes avisos.")).toBeVisible();

    await expect(page.getByLabel("Recibir avisos en mis dispositivos")).toBeChecked();
    await expect(page.getByLabel("Recordarme el devocional del día")).not.toBeChecked();
    await expect(page.getByLabel("Hora del recordatorio")).toHaveCount(0);

    await page.getByLabel("Recordarme el devocional del día").check();
    await page.getByLabel("Hora del recordatorio").fill("06:30");
    await page.getByLabel("Recibirlos también por correo").check();
    await page.getByLabel("Avisarme de mis salas programadas").uncheck();
    expect(await accessibilityIssues(page)).toEqual([]);

    await page.getByRole("button", { name: "Guardar preferencias" }).click();
    await expect(page.getByText("Preferencias guardadas")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Recordarme el devocional del día")).toBeChecked();
    await expect(page.getByLabel("Hora del recordatorio")).toHaveValue("06:30");
    await expect(page.getByLabel("Recibirlos también por correo")).toBeChecked();
    await expect(page.getByLabel("Avisarme de mis salas programadas")).not.toBeChecked();

    const { data } = await admin().from("notification_preferences").select("*").eq("user_id", ana.userId).single();
    expect(data).toMatchObject({ push_enabled: true, email_enabled: true, schedule_reminders: false, devotional_reminder: true, devotional_reminder_time: "06:30:00" });
  });

  test("activar y desactivar los avisos de este dispositivo (con un PushManager simulado)", async ({ browser }) => {
    test.skip(!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, "requiere NEXT_PUBLIC_VAPID_PUBLIC_KEY");
    const ana = await newAccount("Ana");
    const page = await signedInPage(browser, ana);

    // Chromium no puede suscribirse a un servicio push real en pruebas: se simula el navegador
    // (permiso y PushManager). Lo que se verifica de verdad es la pantalla, la ruta /api/push/subscribe
    // y la base de datos.
    const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${crypto.randomUUID()}`;
    await page.addInitScript((fakeEndpoint) => {
      let current: unknown = null;
      const subscription = {
        endpoint: fakeEndpoint,
        toJSON: () => ({ endpoint: fakeEndpoint, keys: { p256dh: "BClavePublicaDePrueba", auth: "ClaveAuthDePrueba" } }),
        unsubscribe: async () => {
          current = null;
          return true;
        },
      };
      const registration = {
        pushManager: {
          getSubscription: async () => current,
          subscribe: async () => (current = subscription),
        },
      };
      Object.defineProperty(navigator.serviceWorker, "ready", { get: () => Promise.resolve(registration) });
      let permission: NotificationPermission = "default";
      Object.defineProperty(Notification, "permission", { get: () => permission });
      Notification.requestPermission = async () => (permission = "granted");
    }, endpoint);

    await page.goto("/es/avisos");
    await expect(page.getByText("Los avisos están activados en este dispositivo.")).toHaveCount(0);
    await page.getByRole("button", { name: "Activar avisos" }).click();
    await expect(page.getByText("Los avisos están activados en este dispositivo.")).toBeVisible();

    const stored = await admin().from("push_subscriptions").select("user_id, p256dh, auth").eq("endpoint", endpoint);
    expect(stored.data).toEqual([{ user_id: ana.userId, p256dh: "BClavePublicaDePrueba", auth: "ClaveAuthDePrueba" }]);

    await page.getByRole("button", { name: "Desactivar en este dispositivo" }).click();
    await expect(page.getByRole("button", { name: "Activar avisos" })).toBeVisible();
    await expect.poll(async () => (await admin().from("push_subscriptions").select("id").eq("endpoint", endpoint)).data?.length).toBe(0);
  });

  test("la ruta de suscripción rechaza servidores que no son servicios push y peticiones de otro origen", async ({ browser }) => {
    const ana = await newAccount("Ana");
    const page = await signedInPage(browser, ana);

    const post = (body: unknown, headers: Record<string, string> = { "Content-Type": "application/json" }) =>
      page.request.post("/api/push/subscribe", { data: JSON.stringify(body), headers });
    const valid = { keys: { p256dh: "k", auth: "a" } };

    const internal = await post({ ...valid, endpoint: "https://169.254.169.254/latest/meta-data/" });
    expect(internal.status()).toBe(400);
    expect(await internal.json()).toEqual({ error: "invalid_endpoint" });

    const notJson = await post({ ...valid, endpoint: "https://fcm.googleapis.com/fcm/send/x" }, { "Content-Type": "text/plain" });
    expect(notJson.status()).toBe(403);
    const badShape = await post({ endpoint: "https://fcm.googleapis.com/fcm/send/x" });
    expect(badShape.status()).toBe(400);
  });

  test("sin sesión, la ruta de suscripción responde 401/403 y no guarda nada", async ({ request }) => {
    const response = await request.post("/api/push/subscribe", {
      data: JSON.stringify({ endpoint: "https://fcm.googleapis.com/fcm/send/anon", keys: { p256dh: "k", auth: "a" } }),
      headers: { "Content-Type": "application/json" },
    });
    expect([401, 403]).toContain(response.status());
    const stored = await admin().from("push_subscriptions").select("id").eq("endpoint", "https://fcm.googleapis.com/fcm/send/anon");
    expect(stored.data).toEqual([]);
  });
});
