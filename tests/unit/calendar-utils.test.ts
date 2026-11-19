import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eventPayload, schedulePayload, sourceKey } from "@/features/calendar/payload";
import { retryDelaySeconds } from "@/features/calendar/sync";
import { decryptSecret, encryptSecret, getEncryptionKey } from "@/lib/crypto/secret-box";
import { buildAuthUrl, CALENDAR_SCOPE, GoogleApiError, refreshAccessToken, revokeToken } from "@/lib/google/client";

const CONFIG = { clientId: "cliente-123", clientSecret: "secreto-de-prueba" };

describe("cifrado de secretos (AES-256-GCM)", () => {
  const key = randomBytes(32);

  it("cifra y descifra, y el texto cifrado no contiene el secreto ni se repite", () => {
    const secret = "1//refresh-token-de-google";
    const a = encryptSecret(secret, "user-1", key);
    const b = encryptSecret(secret, "user-1", key);
    expect(a).not.toContain(secret);
    expect(a).not.toBe(b); // cada cifrado usa su propio vector inicial
    expect(a.startsWith("v1.")).toBe(true);
    expect(decryptSecret(a, "user-1", key)).toBe(secret);
  });

  it("copiar el cifrado a la fila de otra persona no sirve (atado a su id) y una llave distinta tampoco", () => {
    const cipher = encryptSecret("token", "user-1", key);
    expect(() => decryptSecret(cipher, "user-2", key)).toThrow();
    expect(() => decryptSecret(cipher, "user-1", randomBytes(32))).toThrow();
  });

  it("detecta que el texto cifrado fue alterado o tiene mal formato", () => {
    const cipher = encryptSecret("token", "user-1", key);
    const [v, iv, tag, data] = cipher.split(".") as [string, string, string, string];
    const flipped = `${v}.${iv}.${tag}.${data.slice(0, -2)}${data.endsWith("AA") ? "BB" : "AA"}`;
    expect(() => decryptSecret(flipped, "user-1", key)).toThrow();
    expect(() => decryptSecret("basura", "user-1", key)).toThrow();
    expect(() => decryptSecret(`v9.${iv}.${tag}.${data}`, "user-1", key)).toThrow();
  });

  it("la llave debe existir y ser de 32 bytes en base64", () => {
    expect(() => getEncryptionKey(undefined)).toThrow(/CALENDAR_ENCRYPTION_KEY/);
    expect(() => getEncryptionKey(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
    expect(getEncryptionKey(randomBytes(32).toString("base64"))).toHaveLength(32);
  });
});

describe("evento de Google a partir de un evento de INTERCEDE", () => {
  const event = { id: "e1", title: "Vigilia", description: "Una noche de oración", starts_at: "2026-12-05T02:00:00Z", ends_at: "2026-12-05T04:00:00Z", timezone: "America/Mexico_City", community_id: "c1" };

  it("lleva título, enlace, recordatorio de 10 minutos y la propiedad privada para ser idempotente", () => {
    const payload = eventPayload(event, "https://intercede.test");
    expect(payload.summary).toBe("Vigilia");
    expect(payload.description).toContain("Una noche de oración");
    expect(payload.description).toContain("https://intercede.test/es/comunidades/c1/eventos");
    expect(payload.start).toEqual({ dateTime: "2026-12-05T02:00:00.000Z", timeZone: "America/Mexico_City" });
    expect(payload.reminders).toEqual({ useDefault: false, overrides: [{ method: "popup", minutes: 10 }] });
    expect(payload.extendedProperties.private.intercede).toBe(sourceKey("event", "e1"));
    expect(payload.recurrence).toBeUndefined();
  });

  it("sin descripción solo lleva el enlace", () => {
    const payload = eventPayload({ ...event, description: null }, "https://intercede.test");
    expect(payload.description).toBe("https://intercede.test/es/comunidades/c1/eventos");
  });
});

describe("evento de Google a partir de una sala programada", () => {
  const base = { id: "s1", name: "Oración diaria", timezone: "America/Mexico_City", weekdays: [] as number[] };
  // 6:00 a. m. en Ciudad de México (UTC−6) = 12:00 UTC
  const next = "2026-12-07T12:00:00Z";

  it("diaria: hora de pared con su zona (así respeta el horario de verano) y repetición diaria", () => {
    const payload = schedulePayload({ ...base, recurrence: "daily", next_occurrence_at: next }, "https://intercede.test");
    expect(payload.start).toEqual({ dateTime: "2026-12-07T06:00:00", timeZone: "America/Mexico_City" });
    expect(payload.end).toEqual({ dateTime: "2026-12-07T07:00:00", timeZone: "America/Mexico_City" });
    expect(payload.recurrence).toEqual(["RRULE:FREQ=DAILY"]);
    expect(payload.extendedProperties.private.intercede).toBe("schedule:s1");
  });

  it("semanal: días de la semana (0 = domingo) y sin repetidos; una sola vez: sin repetición", () => {
    const weekly = schedulePayload({ ...base, recurrence: "weekly", weekdays: [3, 1, 1, 0], next_occurrence_at: next }, "https://intercede.test");
    expect(weekly.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=SU,MO,WE"]);
    expect(schedulePayload({ ...base, recurrence: "once", next_occurrence_at: next }, "https://intercede.test").recurrence).toBeUndefined();
  });

  it("la hora local no cambia con el horario de verano (julio, Nueva York: 7:00 a. m. = 11:00 UTC)", () => {
    const payload = schedulePayload({ ...base, timezone: "America/New_York", recurrence: "daily", next_occurrence_at: "2026-07-07T11:00:00Z" }, "https://intercede.test");
    expect(payload.start.dateTime).toBe("2026-07-07T07:00:00");
  });
});

describe("cliente de Google (fetch simulado)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("el enlace de autorización pide SOLO el permiso acotado, sin conexión y con consentimiento, y no arrastra otros permisos", () => {
    const url = new URL(buildAuthUrl(CONFIG, "https://intercede.test/api/calendar/google/callback", "estado-123"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe(CALENDAR_SCOPE);
    expect(CALENDAR_SCOPE).toBe("https://www.googleapis.com/auth/calendar.app.created");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("include_granted_scopes")).toBe("false");
    expect(url.searchParams.get("state")).toBe("estado-123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://intercede.test/api/calendar/google/callback");
  });

  const respond = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })));

  it("clasifica los fallos: permiso revocado, no existe, límite de uso, error de Google y sin conexión", async () => {
    const kindOf = async (status: number, body: unknown) => {
      respond(status, body);
      return refreshAccessToken(CONFIG, "t").catch((error: unknown) => (error as GoogleApiError).kind);
    };
    expect(await kindOf(400, { error: "invalid_grant" })).toBe("auth");
    expect(await kindOf(401, {})).toBe("auth");
    expect(await kindOf(403, { error: { errors: [{ reason: "rateLimitExceeded" }] } })).toBe("rate");
    expect(await kindOf(403, { error: { errors: [{ reason: "insufficientPermissions" }] } })).toBe("auth");
    expect(await kindOf(403, { error: { errors: [{ reason: "otra" }] } })).toBe("permanent");
    expect(await kindOf(404, {})).toBe("not_found");
    expect(await kindOf(429, {})).toBe("rate");
    expect(await kindOf(503, {})).toBe("transient");
    expect(await kindOf(400, { error: "bad_request" })).toBe("permanent");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("red caída")));
    expect(await refreshAccessToken(CONFIG, "t").catch((error: unknown) => (error as GoogleApiError).kind)).toBe("transient");
  });

  it("renovar el acceso manda el token de actualización y las credenciales del cliente por formulario", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: "acceso-nuevo", expires_in: 3600 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await refreshAccessToken(CONFIG, "1//token")).toBe("acceso-nuevo");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(init.body as string);
    expect(Object.fromEntries(body)).toMatchObject({ refresh_token: "1//token", client_id: "cliente-123", client_secret: "secreto-de-prueba", grant_type: "refresh_token" });
  });

  it("revocar no falla si el permiso ya estaba revocado, pero sí si Google no responde", async () => {
    respond(400, { error: "invalid_token" });
    await expect(revokeToken("t")).resolves.toBeUndefined();
    respond(503, {});
    await expect(revokeToken("t")).rejects.toBeInstanceOf(GoogleApiError);
  });
});

describe("reintentos", () => {
  it("la espera crece (30 s, 1 min, 2 min…) con tope de 1 hora", () => {
    expect([0, 1, 2, 3].map(retryDelaySeconds)).toEqual([30, 60, 120, 240]);
    expect(retryDelaySeconds(20)).toBe(3600);
  });
});
