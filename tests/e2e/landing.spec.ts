import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("landing", () => {
  test("tiene las secciones del CLAUDE.md §5.5 y el CTA arriba del pliegue", async ({ page }) => {
    await page.goto("/es");

    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toContainText("Una comunidad que ora junta.");

    // CTA doble del héroe, visibles sin hacer scroll
    const pray = page.locator("section").first().getByRole("link", { name: "Orar ahora" });
    await expect(pray).toBeInViewport();
    await expect(page.locator("section").first().getByRole("button", { name: "Instalar la app" })).toBeInViewport();

    for (const name of [
      "Una videollamada no fue hecha para orar.",
      "Tres pasos. Ninguno requiere registro.",
      "Todo lo que necesita una vida de oración compartida.",
      "Su comunidad, orando junta durante la semana.",
      "Tu oración es tuya.",
      "Lo que suelen preguntarnos.",
    ]) {
      await expect(page.getByRole("heading", { level: 2, name })).toBeAttached();
    }
  });

  test("las preguntas frecuentes se abren y cierran", async ({ page }) => {
    await page.goto("/es");
    const first = page.locator("details").first();
    await expect(first).not.toHaveAttribute("open", "");
    await first.locator("summary").click();
    await expect(first).toHaveAttribute("open", "");
  });

  test("el botón Instalar abre la guía y se cierra", async ({ page }) => {
    await page.goto("/es");
    await page.getByRole("button", { name: "Instalar la app" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Instala INTERCEDE" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Añadir a pantalla de inicio").first()).toBeVisible();
    await dialog.getByRole("button", { name: "Entendido" }).click();
    await expect(dialog).toBeHidden();
  });

  test("no hay desbordamiento horizontal", async ({ page }) => {
    await page.goto("/es");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("el CTA lleva a crear una sala sin cuenta (un campo y un botón)", async ({ page }) => {
    await page.goto("/es");
    await page.locator("section").first().getByRole("link", { name: "Orar ahora" }).click();
    await expect(page).toHaveURL(/\/es\/orar$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Orar ahora");
    await expect(page.getByLabel("¿Cómo te llamas?")).toBeVisible();
    await expect(page.getByRole("button", { name: "Crear sala de oración" })).toBeVisible();
  });
});

test.describe("SEO", () => {
  test("metadatos únicos, canonical, Open Graph y JSON-LD", async ({ page }) => {
    await page.goto("/es");
    await expect(page).toHaveTitle(/INTERCEDE/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Ora con otras personas/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/es$/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /opengraph-image/);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");

    const raw = await page.locator('script[type="application/ld+json"]').first().textContent();
    const graph = JSON.parse(raw ?? "{}")["@graph"] as { "@type": string }[];
    expect(graph.map((n) => n["@type"])).toEqual(
      expect.arrayContaining(["Organization", "WebSite", "SoftwareApplication", "FAQPage"]),
    );
  });

  test("cada página pública tiene su propio título", async ({ page }) => {
    const titles = new Set<string>();
    for (const path of ["/es", "/es/privacidad", "/es/terminos"]) {
      await page.goto(path);
      titles.add(await page.title());
    }
    expect(titles.size).toBe(3);
  });

  test("robots.txt, sitemap.xml e imagen OG existen", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(robots.ok()).toBe(true);
    expect(await robots.text()).toContain("Sitemap:");

    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.ok()).toBe(true);
    const xml = await sitemap.text();
    expect(xml).toContain("/es/privacidad");
    expect(xml).toContain("/es/terminos");
    expect(xml).not.toContain("/es/orar");

    const og = await request.get("/es/opengraph-image");
    expect(og.ok()).toBe(true);
    expect(og.headers()["content-type"]).toContain("image/png");
  });

  test("la página provisional de orar no se indexa", async ({ page }) => {
    await page.goto("/es/orar");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("una ruta inexistente muestra la 404 propia", async ({ page }) => {
    const res = await page.goto("/es/no-existe");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("No encontramos esta página");
  });
});

test.describe("accesibilidad (axe, WCAG AA)", () => {
  for (const path of ["/es", "/es/privacidad", "/es/terminos", "/es/orar", "/es/offline"]) {
    for (const scheme of ["light", "dark"] as const) {
      test(`${path} en modo ${scheme}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.goto(path);
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        expect(
          results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
        ).toEqual([]);
      });
    }
  }
});
