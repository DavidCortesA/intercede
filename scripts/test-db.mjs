/**
 * Corre pruebas contra el Supabase LOCAL (nunca contra el remoto).
 * Requiere Docker y `npx supabase start` (la primera vez descarga imágenes).
 *
 *   npm run test:db        → pruebas de integración y RLS (Vitest)
 *   npm run test:e2e:db    → pruebas e2e con dos personas (Playwright, app en modo desarrollo)
 *
 * En local reinicia el contenedor de Auth antes de correr: así se reinicia el tope de altas
 * anónimas por hora y por IP (30), que se alcanza al repetir las pruebas.
 */
import { spawnSync } from "node:child_process";
import { getLocalSupabaseEnv } from "./lib/local-supabase.mjs";

const e2e = process.argv.includes("--e2e");
const extraArgs = process.argv.slice(2).filter((arg) => arg !== "--e2e");

let supabaseEnv;
try {
  supabaseEnv = getLocalSupabaseEnv();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

if (!process.env.CI) {
  const restart = spawnSync("docker", ["restart", "supabase_auth_intercede"], { encoding: "utf8", shell: true });
  if (restart.status === 0) {
    // Espera a que Auth vuelva a responder
    for (let i = 0; i < 20; i++) {
      const ping = await fetch(`${supabaseEnv.SUPABASE_TEST_URL}/auth/v1/health`, {
        headers: { apikey: supabaseEnv.SUPABASE_TEST_PUBLISHABLE_KEY },
      }).catch(() => null);
      if (ping?.ok) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

// e2e en modo desarrollo: por defecto solo el flujo de salas (el resto de e2e se corre con el
// build de producción en el CI: `npm run build` + `CI=1 npm run test:e2e`, ambos con estas variables).
const e2eDefaults = extraArgs.some((arg) => arg.endsWith(".spec.ts"))
  ? []
  : ["tests/e2e/rooms.spec.ts", "--project=desktop-chrome"];
const command = e2e
  ? ["playwright", "test", ...e2eDefaults, ...extraArgs]
  : ["vitest", "run", "tests/integration", ...extraArgs];
const result = spawnSync("npx", command, {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, ...supabaseEnv },
});
process.exit(result.status ?? 1);
