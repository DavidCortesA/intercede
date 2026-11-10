import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    // Móvil primero (CLAUDE.md §8.7)
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // En CI se ejecuta el build de producción (el job de CI hace `npm run build` antes).
    command: isCI ? "npm run start" : "npm run dev",
    url: `http://localhost:${PORT}/es`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
