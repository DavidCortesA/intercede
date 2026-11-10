/**
 * Ejecuta `public.security_audit()` con la service role y muestra los hallazgos.
 *
 *   node scripts/security-audit.mjs            # Supabase LOCAL
 *   node scripts/security-audit.mjs --remote   # proyecto remoto (.env.local)
 *
 * Lo ÚNICO esperado: las tres vistas previas de invitación (peek_room, peek_schedule, peek_community),
 * que son públicas a propósito. Cualquier otra fila es un hallazgo (sale con código 1).
 */
import { createClient } from "@supabase/supabase-js";
import { getLocalSupabaseEnv } from "./lib/local-supabase.mjs";

const remote = process.argv.includes("--remote");
let url;
let key;
if (remote) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    /* el entorno ya puede traer las variables */
  }
  url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local.");
    process.exit(1);
  }
} else {
  const env = getLocalSupabaseEnv();
  url = env.SUPABASE_TEST_URL;
  key = env.SUPABASE_TEST_SERVICE_ROLE_KEY;
}

const { data, error } = await createClient(url, key, { auth: { persistSession: false } }).rpc("security_audit");
if (error) {
  console.error(`No se pudo ejecutar la auditoría: ${error.message}`);
  process.exit(1);
}

const expected = new Set(["peek_room(p_code text)", "peek_schedule(p_token text)", "peek_community(p_token text)"]);
const findings = (data ?? []).filter((row) => !(row.category === "anon_can_execute" && expected.has(row.object_name)));
console.log(`Destino: ${remote ? "REMOTO" : "local"} (${new URL(url).host})`);
console.log(`Públicas a propósito: ${(data ?? []).length - findings.length} de ${expected.size}`);
if (findings.length === 0) {
  console.log("Sin hallazgos.");
} else {
  for (const row of findings) console.log(`✗ ${row.category}: ${row.object_name} — ${row.detail}`);
  process.exit(1);
}
