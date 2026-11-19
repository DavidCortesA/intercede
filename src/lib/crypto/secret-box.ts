import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cifrado de secretos guardados en la base (hoy: el token de actualización de Google Calendar). AES-256-GCM con una llave que vive
 * SOLO en el servidor (`CALENDAR_ENCRYPTION_KEY`, 32 bytes en base64): quien lea la base no puede usar el token. El texto cifrado va
 * atado a un dato asociado (el id de la persona), así que copiarlo a la fila de otra persona no sirve.
 *
 * Formato: `v1.<iv>.<etiqueta>.<texto cifrado>` (base64url).
 */
const VERSION = "v1";

export function getEncryptionKey(raw: string | undefined = process.env.CALENDAR_ENCRYPTION_KEY): Buffer {
  if (!raw) throw new Error("Falta CALENDAR_ENCRYPTION_KEY (solo servidor).");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("CALENDAR_ENCRYPTION_KEY debe ser de 32 bytes en base64.");
  return key;
}

export function encryptSecret(plain: string, associatedData: string, key: Buffer = getEncryptionKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, associatedData: string, key: Buffer = getEncryptionKey()): string {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== VERSION || !iv || !tag || !data) throw new Error("Formato de secreto no válido.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(associatedData, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
