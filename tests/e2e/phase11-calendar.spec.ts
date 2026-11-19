import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { createConfirmedAccount, newPerson, signInThroughUi } from "./helpers";

// Fase 11 (C6 nivel 2): pantalla de "Conectar Google Calendar" en el perfil. Google NO se contacta: el cliente de Google es de prueba, la
// ida a Google se intercepta y la conexión se siembra con la base. Requiere el Supabase local y las variables de Google Calendar
// (NEXT_PUBLIC_GOOGLE_CALENDAR=1, cliente de Google y CALENDAR_ENCRYPTION_KEY de prueba) en la compilación. Solo escritorio.
test.skip(!process.env.SUPABASE_TEST_URL, "requiere Supabase local (npm run test:e2e:db)");
test.skip(process.env.NEXT_PUBLIC_GOOGLE_CALENDAR !== "1" || !process.env.CALENDAR_ENCRYPTION_KEY || !process.env.CALENDAR_SYNC_SECRET, "requiere NEXT_PUBLIC_GOOGLE_CALENDAR=1, CALENDAR_ENCRYPTION_KEY y CALENDAR_SYNC_SECRET de prueba");
test.skip(({ isMobile }) => isMobile, "se corre solo en escritorio");

const admin = () =>
  createClient(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const accessibilityIssues = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );

test("conectar, ajustar qué se sincroniza y desconectar Google Calendar", async ({ browser }) => {
  const account = await createConfirmedAccount("Lidia");
  try {
    const page = await newPerson(browser);
    await signInThroughUi(page, account.email, account.password);
    await page.goto("/es/perfil");

    const section = page.getByRole("region", { name: "Google Calendar" });
    await expect(section.getByRole("link", { name: "Conectar Google Calendar" })).toBeVisible();
    await expect(section).toContainText('calendario aparte llamado "INTERCEDE"');
    expect(await accessibilityIssues(page)).toEqual([]);

    // La ida a Google lleva SOLO el permiso acotado, la pantalla de permiso y un state; la cookie del state queda httpOnly.
    // Se pide sin seguir la redirección (la persona llega a Google con ese mismo enlace).
    const connect = await page.context().request.get("/api/calendar/google/connect", { maxRedirects: 0 });
    expect(connect.status()).toBe(307);
    const googleUrl = new URL(connect.headers()["location"]!);
    expect(googleUrl.origin + googleUrl.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(googleUrl.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/calendar.app.created");
    expect(googleUrl.searchParams.get("access_type")).toBe("offline");
    expect(googleUrl.searchParams.get("prompt")).toBe("consent");
    expect(googleUrl.searchParams.get("redirect_uri")).toMatch(/\/api\/calendar\/google\/callback$/);
    expect(googleUrl.searchParams.get("state")?.length).toBeGreaterThan(20);
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "gcal_state")?.httpOnly).toBe(true);
    await expect(section.getByRole("link", { name: "Conectar Google Calendar" })).toHaveAttribute("href", "/api/calendar/google/connect");

    // Una devolución sin el state correcto no conecta nada
    await page.goto("/api/calendar/google/callback?code=falso&state=otro");
    await expect(page).toHaveURL(/\/es\/perfil\?calendario=error/);
    await expect(page.getByTestId("calendar-result")).toContainText("No pudimos conectar con Google");

    // Con la conexión sembrada (el intercambio real con Google no se prueba aquí)
    await admin().from("calendar_connections").insert({
      user_id: account.userId,
      scope: "https://www.googleapis.com/auth/calendar.app.created",
      refresh_token_encrypted: "v1.no-descifrable",
      calendar_id: "calendario-de-prueba",
    });
    await page.goto("/es/perfil?calendario=ok");
    await expect(page.getByTestId("calendar-status")).toBeVisible();
    await expect(page.getByTestId("calendar-result")).toContainText("conectamos tu Google Calendar");
    expect(await accessibilityIssues(page)).toEqual([]);

    const events = section.getByLabel("Eventos de comunidades a los que confirmo asistencia");
    const schedules = section.getByLabel("Salas programadas que sigo");
    await expect(events).toBeChecked();
    await expect(schedules).toBeChecked();
    await schedules.click(); // controlada por el servidor: cambia al guardar, no al instante
    await expect.poll(async () => (await admin().from("calendar_connections").select("sync_schedules, sync_events").eq("user_id", account.userId).single()).data).toEqual({ sync_schedules: false, sync_events: true });
    await page.reload();
    await expect(section.getByLabel("Salas programadas que sigo")).not.toBeChecked();

    // La ruta de sincronización exige el secreto compartido, no la sesión de la persona
    const status = await page.evaluate(async () => (await fetch("/api/calendar/sync", { method: "POST" })).status);
    expect(status).toBe(401);

    // Desconectar pide confirmación y borra todo
    await section.getByRole("button", { name: "Desconectar" }).click();
    await section.getByRole("button", { name: "Sí, desconectar" }).click();
    await expect(section.getByRole("link", { name: "Conectar Google Calendar" })).toBeVisible();
    const { data: left } = await admin().from("calendar_connections").select("user_id").eq("user_id", account.userId);
    expect(left).toEqual([]);
  } finally {
    await account.cleanup();
  }
});
