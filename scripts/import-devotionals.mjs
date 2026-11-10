/**
 * Carga devocionales desde un archivo JSON (solo administración: usa la service role).
 *
 *   npm run devotionals:import -- ruta/devocionales.json             # Supabase LOCAL
 *   npm run devotionals:import -- ruta/devocionales.json --remote    # proyecto remoto (.env.local)
 *   npm run devotionals:import -- ruta/devocionales.json --dry-run   # solo valida
 *
 * Formato: ver `docs/operaciones/devocionales.md` (arreglo de objetos con `date`, `passage_reference`,
 * `passage_text`, `bible_version`, `reflection`, `question` y `suggested_prayer` opcional).
 * Si ya existe un devocional general para esa fecha, se actualiza; si no, se crea.
 *
 * El contenido (y su licencia) es responsabilidad de quien lo carga: la app no trae ninguno de fábrica.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { devotionalImportSchema, toDevotionalRow } from "../src/features/devotionals/import-schema.ts";
import { getLocalSupabaseEnv } from "./lib/local-supabase.mjs";

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith("--"));
const remote = args.includes("--remote");
const dryRun = args.includes("--dry-run");

if (!file) {
  console.error("Uso: npm run devotionals:import -- <archivo.json> [--remote] [--dry-run]");
  process.exit(1);
}

let json;
try {
  json = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
  console.error(`No se pudo leer ${file}: ${error.message}`);
  process.exit(1);
}

const parsed = devotionalImportSchema.safeParse(json);
if (!parsed.success) {
  console.error("El archivo no es válido:");
  for (const issue of parsed.error.issues) console.error(` - ${issue.path.join(".") || "(raíz)"}: ${issue.message}`);
  process.exit(1);
}
const rows = parsed.data.map(toDevotionalRow);
console.log(`Archivo válido: ${rows.length} devocionales (${rows[0].devotional_date} … ${rows.at(-1).devotional_date}).`);
if (dryRun) process.exit(0);

let url;
let serviceRoleKey;
if (remote) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    /* el entorno ya puede traer las variables */
  }
  url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local.");
    process.exit(1);
  }
} else {
  const env = getLocalSupabaseEnv();
  url = env.SUPABASE_TEST_URL;
  serviceRoleKey = env.SUPABASE_TEST_SERVICE_ROLE_KEY;
}

console.log(`Destino: ${remote ? "REMOTO" : "local"} (${new URL(url).host})`);
const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

const dates = rows.map((row) => row.devotional_date);
const { data: existing, error: readError } = await supabase
  .from("devotionals")
  .select("id, devotional_date")
  .is("community_id", null)
  .in("devotional_date", dates);
if (readError) {
  console.error(`No se pudo consultar: ${readError.message}`);
  process.exit(1);
}

const idByDate = new Map(existing.map((row) => [row.devotional_date, row.id]));
const toInsert = rows.filter((row) => !idByDate.has(row.devotional_date));
const toUpdate = rows.filter((row) => idByDate.has(row.devotional_date));

if (toInsert.length > 0) {
  const { error } = await supabase.from("devotionals").insert(toInsert);
  if (error) {
    console.error(`No se pudo insertar: ${error.message}`);
    process.exit(1);
  }
}
for (const row of toUpdate) {
  const { error } = await supabase.from("devotionals").update(row).eq("id", idByDate.get(row.devotional_date));
  if (error) {
    console.error(`No se pudo actualizar ${row.devotional_date}: ${error.message}`);
    process.exit(1);
  }
}
console.log(`Listo: ${toInsert.length} nuevos, ${toUpdate.length} actualizados.`);
