/**
 * Crea la llave del webhook de Conekta y muestra su llave PÚBLICA (PEM), con la que la app verifica la firma
 * (cabecera DIGEST, RSA-SHA256) de cada evento. Hay una llave por ambiente (pruebas o producción): usa la llave
 * privada del ambiente que quieras configurar.
 *
 *   node scripts/conekta-webhook-key.mjs
 *
 * Lee CONEKTA_API_SECRET de .env.local o del entorno. La llave privada NO se imprime. La llave pública sí (es pública
 * por diseño): cópiala a CONEKTA_WEBHOOK_PUBLIC_KEY (en una línea, con \n literales; se imprime ya así).
 * Doc: https://developers.conekta.com/docs/autenticación-webhooks
 */
import { readFileSync } from "node:fs";

function readSecret() {
  if (process.env.CONEKTA_API_SECRET) return process.env.CONEKTA_API_SECRET.trim();
  try {
    const match = readFileSync(".env.local", "utf8").match(/^CONEKTA_API_SECRET=(.*)$/m);
    return match?.[1]?.trim() ?? "";
  } catch {
    return "";
  }
}

const secret = readSecret();
if (!secret) {
  console.error("Falta CONEKTA_API_SECRET (en .env.local o en el entorno).");
  process.exit(1);
}

const response = await fetch("https://api.conekta.io/webhook_keys", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${secret}`,
    Accept: "application/vnd.conekta-v2.3.0+json",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ active: true }),
});
const body = await response.json().catch(() => null);

if (!response.ok || !body?.public_key) {
  const detail = body?.details?.[0]?.message ?? `HTTP ${response.status}`;
  console.error(`Conekta no creó la llave: ${detail}`);
  console.error("Revisa que la llave privada tenga permiso de escritura en webhooks (o créala en el panel de Conekta).");
  process.exit(1);
}

console.log("Llave pública del webhook (CONEKTA_WEBHOOK_PUBLIC_KEY, una línea):");
console.log(String(body.public_key).trim().replace(/\r?\n/g, "\\n"));
console.log(`\nid de la llave: ${body.id ?? "(sin id)"}  ·  livemode: ${body.livemode ?? "?"}`);
