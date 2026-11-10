/**
 * Corre las pruebas de integración contra el Supabase LOCAL.
 * Requiere Docker y `npx supabase start` (la primera vez descarga imágenes).
 *
 * Uso: npm run test:db
 */
import { spawnSync } from "node:child_process";

const status = spawnSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8", shell: true });
if (status.status !== 0) {
  console.error("No se pudo leer `supabase status`. ¿Está corriendo `npx supabase start`?\n", status.stderr);
  process.exit(1);
}

/** Lee KEY="valor" de la salida en formato env. */
const env = Object.fromEntries(
  status.stdout
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z0-9_]+)="?(.*?)"?$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);

const url = env.API_URL;
const publishableKey = env.PUBLISHABLE_KEY ?? env.ANON_KEY;
const serviceRoleKey = env.SECRET_KEY ?? env.SERVICE_ROLE_KEY;
if (!url || !publishableKey || !serviceRoleKey) {
  console.error("`supabase status` no devolvió URL y claves. Claves disponibles:", Object.keys(env).join(", "));
  process.exit(1);
}

const result = spawnSync("npx", ["vitest", "run", "tests/integration", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    SUPABASE_TEST_URL: url,
    SUPABASE_TEST_PUBLISHABLE_KEY: publishableKey,
    SUPABASE_TEST_SERVICE_ROLE_KEY: serviceRoleKey,
  },
});
process.exit(result.status ?? 1);
