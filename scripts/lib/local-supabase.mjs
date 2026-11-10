/**
 * Lee la URL y las claves del Supabase LOCAL (`supabase status -o env`).
 * Se usa desde `npm run test:db` / `test:e2e:db` y desde el CI (modo `--github-env`).
 */
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

export function getLocalSupabaseEnv() {
  const status = spawnSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8", shell: true });
  if (status.status !== 0) {
    throw new Error(`No se pudo leer \`supabase status\`. ¿Está corriendo \`npx supabase start\`?\n${status.stderr}`);
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
    throw new Error(`\`supabase status\` no devolvió URL y claves. Disponibles: ${Object.keys(env).join(", ")}`);
  }

  return {
    // Para las pruebas de integración y e2e
    SUPABASE_TEST_URL: url,
    SUPABASE_TEST_PUBLISHABLE_KEY: publishableKey,
    SUPABASE_TEST_SERVICE_ROLE_KEY: serviceRoleKey,
    // Para que la app (build/dev) hable con el Supabase local y no con el remoto de .env.local
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  };
}

// Uso en CI:  node scripts/lib/local-supabase.mjs --github-env
if (process.argv.includes("--github-env") && process.env.GITHUB_ENV) {
  const env = getLocalSupabaseEnv();
  for (const [key, value] of Object.entries(env)) {
    console.log(`::add-mask::${value}`);
    appendFileSync(process.env.GITHUB_ENV, `${key}=${value}\n`);
  }
}
