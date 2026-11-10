import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

// Lee .env.local para que las pruebas vean, por ejemplo, si hay credenciales de LiveKit
// (las de audio se saltan si no existen). Lo que ya esté en el entorno tiene prioridad.
loadEnvConfig(process.cwd());

const PORT = 3000;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  // El servidor de desarrollo compila cada ruta en su primera visita: margen para eso.
  expect: { timeout: 10_000 },
  retries: isCI ? 2 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Una acción que no encuentra su elemento debe fallar con un mensaje claro, no agotar la prueba entera
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "on-first-retry",
  },
  projects: [
    // Móvil primero (CLAUDE.md §8.7)
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    {
      name: "desktop-chrome",
      use: {
        ...devices["Desktop Chrome"],
        // Micrófono y cámara simulados que aceptan el permiso solos: pruebas de audio sin hardware
        launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
      },
    },
  ],
  webServer: {
    // En CI se ejecuta el build de producción (el job de CI hace `npm run build` antes).
    // Con NEXT_PUBLIC_SUPABASE_* en el entorno (Supabase local) la app habla con él y no con el remoto.
    command: isCI ? "npm run start" : "npm run dev",
    url: `http://localhost:${PORT}/es`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
