import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createRoomAs, joinRoomAs, newPerson } from "./helpers";

// Audio real contra LiveKit Cloud con micrófonos simulados de Chromium (un tono de prueba).
// Necesita: Supabase local (`npm run test:e2e:db`) y credenciales de LiveKit en .env.local.
test.skip(!process.env.SUPABASE_TEST_URL, "requiere Supabase local (npm run test:e2e:db)");
test.skip(!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET, "requiere credenciales de LiveKit");
test.skip(({ isMobile }) => isMobile, "se corre solo en escritorio");

// Chromium simula micrófono y acepta el permiso (la persona real vería el aviso del navegador)
const fakeMic = { permissions: ["microphone" as const] };

test("audio: hablar, escuchar, orador activo y controles del anfitrión", async ({ browser }) => {
  test.setTimeout(150_000);
  const ana = await newPerson(browser, fakeMic);
  const beto = await newPerson(browser, fakeMic);

  const roomUrl = await createRoomAs(ana, "Ana");
  await joinRoomAs(beto, roomUrl, "Beto");

  // El audio NO arranca solo ni pide el micrófono al cargar: hay que elegir
  await expect(ana.getByRole("button", { name: "Orar con micrófono" })).toBeVisible();
  await expect(ana.getByRole("button", { name: "Solo escuchar" })).toBeVisible();

  // Ana entra hablando; Beto solo escucha
  await ana.getByRole("button", { name: "Orar con micrófono" }).click();
  await expect(ana.getByRole("status").filter({ hasText: "Micrófono activado" })).toBeVisible({ timeout: 30_000 });
  await beto.getByRole("button", { name: "Solo escuchar" }).click();
  await expect(beto.getByRole("status").filter({ hasText: "Escuchando" })).toBeVisible({ timeout: 30_000 });

  // Cada quien ve el estado de audio de la otra persona
  const anaTileForBeto = beto.getByRole("listitem").filter({ hasText: "Ana" });
  await expect(anaTileForBeto.getByText(/Micrófono activado|Hablando/)).toBeAttached({ timeout: 20_000 });
  await expect(ana.getByRole("listitem").filter({ hasText: "Beto" }).getByText("Micrófono apagado")).toBeAttached({ timeout: 20_000 });

  // Orador activo: el micrófono simulado emite un tono; Beto lo ve como "Está orando"
  await expect(beto.getByText("Está orando")).toBeVisible({ timeout: 30_000 });

  // Accesibilidad (axe) con el audio conectado: panel, orador activo y acciones del anfitrión
  for (const page of [ana, beto]) {
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  }

  // Beto pasa de escuchar a hablar (ahora sí se pide el micrófono)
  await beto.getByRole("button", { name: "Activar mi micrófono" }).click();
  await expect(beto.getByRole("status").filter({ hasText: "Micrófono activado" })).toBeVisible({ timeout: 15_000 });
  await expect(ana.getByRole("listitem").filter({ hasText: "Beto" }).getByText(/Micrófono activado|Hablando/)).toBeAttached({ timeout: 20_000 });

  // El anfitrión silencia a Beto: su micrófono se apaga desde el servidor
  await ana.getByRole("button", { name: "Silenciar a Beto" }).click();
  await expect(beto.getByRole("button", { name: "Activar mi micrófono" })).toBeVisible({ timeout: 20_000 });
  await expect(beto.getByRole("status").filter({ hasText: "Micrófono silenciado" })).toBeVisible();

  // Silenciar a todos
  await beto.getByRole("button", { name: "Activar mi micrófono" }).click();
  await expect(beto.getByRole("button", { name: "Silenciar mi micrófono" })).toBeVisible({ timeout: 15_000 });
  await ana.getByRole("button", { name: "Silenciar a todos" }).click();
  await expect(beto.getByRole("button", { name: "Activar mi micrófono" })).toBeVisible({ timeout: 20_000 });
  // El anfitrión no se silencia a sí mismo
  await expect(ana.getByRole("button", { name: "Silenciar mi micrófono" })).toBeVisible();

  // Expulsar: Beto sale de la sala y del audio, y no puede volver
  await ana.getByRole("button", { name: "Sacar a Beto de la sala" }).click();
  await ana.getByRole("button", { name: "Sí, sacar" }).click();
  await expect(beto.getByRole("heading", { level: 1, name: "El anfitrión te sacó de la sala" })).toBeVisible({ timeout: 20_000 });
  await beto.goto(roomUrl);
  await expect(beto.getByRole("heading", { level: 1, name: "El anfitrión te sacó de la sala" })).toBeVisible();
  await expect(ana.getByRole("listitem").filter({ hasText: "Beto" })).toHaveCount(0, { timeout: 15_000 });

  // Cerrar la sala corta el audio de la anfitriona
  await ana.getByRole("button", { name: "Cerrar sala" }).click();
  await ana.getByRole("button", { name: "Sí, cerrar sala" }).click();
  await expect(ana.getByRole("heading", { level: 1, name: "La sala se cerró" })).toBeVisible();
});

/** Cuenta las veces que la página pide el micrófono y, si se indica, hace que falle como en un dispositivo real. */
async function spyOnMicrophone(page: Page, failWith?: "NotAllowedError" | "NotFoundError" | "NotReadableError") {
  await page.addInitScript((errorName) => {
    const counter = { audioRequests: 0 };
    (window as unknown as { __mic: typeof counter }).__mic = counter;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints?.audio) {
        counter.audioRequests += 1;
        if (errorName) throw new DOMException("simulado por la prueba", errorName);
      }
      return original(constraints);
    };
  }, failWith);
}

const micRequests = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mic?: { audioRequests: number } }).__mic?.audioRequests ?? 0);

test("solo escuchar nunca pide el micrófono; hablar lo pide recién cuando se decide", async ({ browser }) => {
  test.setTimeout(90_000);
  const ana = await newPerson(browser, fakeMic);
  const beto = await newPerson(browser, fakeMic);
  await spyOnMicrophone(beto);
  const roomUrl = await createRoomAs(ana, "Ana");
  await joinRoomAs(beto, roomUrl, "Beto");

  // Cargar la sala no pide el micrófono
  expect(await micRequests(beto)).toBe(0);

  // Entrar como oyente tampoco
  await beto.getByRole("button", { name: "Solo escuchar" }).click();
  await expect(beto.getByRole("status").filter({ hasText: "Escuchando" })).toBeVisible({ timeout: 30_000 });
  expect(await micRequests(beto)).toBe(0);

  // Solo al decidir hablar se pide
  await beto.getByRole("button", { name: "Activar mi micrófono" }).click();
  await expect(beto.getByRole("status").filter({ hasText: "Micrófono activado" })).toBeVisible({ timeout: 15_000 });
  expect(await micRequests(beto)).toBeGreaterThan(0);
});

const MIC_ERRORS = [
  { name: "NotAllowedError", message: "No tenemos permiso para usar tu micrófono" },
  { name: "NotFoundError", message: "No encontramos un micrófono en este dispositivo" },
  { name: "NotReadableError", message: "Otra aplicación está usando tu micrófono" },
] as const;

for (const failure of MIC_ERRORS) {
  test(`micrófono con ${failure.name}: mensaje claro y la sala sigue funcionando`, async ({ browser }) => {
    test.setTimeout(90_000);
    const ana = await newPerson(browser, fakeMic);
    await spyOnMicrophone(ana, failure.name);
    await createRoomAs(ana, "Ana");

    await ana.getByRole("button", { name: "Orar con micrófono" }).click();
    await expect(ana.getByRole("alert").filter({ hasText: failure.message })).toBeVisible({ timeout: 30_000 });

    // Queda conectada como oyente y puede seguir con las peticiones
    await expect(ana.getByRole("status").filter({ hasText: "Escuchando" })).toBeVisible();
    await ana.getByLabel("Nueva petición de oración").fill("Sigue funcionando");
    await ana.getByRole("button", { name: "Enviar" }).click();
    await expect(ana.getByText("Sigue funcionando")).toBeVisible();
  });
}

