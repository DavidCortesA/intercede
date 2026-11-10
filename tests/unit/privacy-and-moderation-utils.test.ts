import { describe, expect, it } from "vitest";
import { deleteAccountSchema, toModerationError } from "@/features/moderation/schemas";
import { CAPTCHA_FIELD, getCaptchaToken } from "@/lib/captcha";
import { sentryOptions } from "@/lib/sentry/options";
import { scrubAnalyticsEvent, scrubBreadcrumb, scrubEvent, scrubUrl } from "@/lib/sentry/scrub";

describe("scrubUrl: lo que identifica salas e invitaciones no sale de la app", () => {
  it("generaliza el código de la sala, los tokens de invitación y los ids", () => {
    expect(scrubUrl("https://intercede.app/es/r/abc234")).toBe("https://intercede.app/es/r/[code]");
    expect(scrubUrl("/es/p/AbCdEfGhIjKlMnOpQrStUv_-12")).toBe("/es/p/[token]");
    expect(scrubUrl("/es/c/AbCdEfGhIjKlMnOpQrStUv_-12")).toBe("/es/c/[token]");
    expect(scrubUrl("/es/comunidades/6f1f6d0e-5a1c-4d3e-9d51-0a4c3d6a9b11/eventos")).toBe("/es/comunidades/[id]/eventos");
    expect(scrubUrl("/api/events/6f1f6d0e-5a1c-4d3e-9d51-0a4c3d6a9b11/ics")).toBe("/api/events/[id]/ics");
    expect(scrubUrl("/r/abc234")).toBe("/r/[code]");
  });

  it("quita la query y el hash (traen tokens de correo, códigos y rutas de regreso)", () => {
    expect(scrubUrl("https://x.test/auth/confirm?token_hash=secreto&type=signup&next=/es/r/abc234")).toBe("https://x.test/auth/confirm");
    expect(scrubUrl("https://x.test/es/entrar?next=%2Fp%2Ftoken#frag")).toBe("https://x.test/es/entrar");
    expect(scrubUrl("https://x.supabase.co/rest/v1/rooms?code=eq.abc234")).toBe("https://x.supabase.co/rest/v1/rooms");
  });

  it("no toca las rutas normales", () => {
    for (const path of ["/es", "/es/orar", "/es/diario", "/es/comunidades", "/es/privacidad", "/api/livekit/token"]) {
      expect(scrubUrl(path)).toBe(path);
    }
  });

  it("también sirve para la analítica", () => {
    expect(scrubAnalyticsEvent({ type: "pageview", url: "https://intercede.app/es/r/abc234?x=1" })).toEqual({ type: "pageview", url: "https://intercede.app/es/r/[code]" });
  });
});

describe("scrubEvent y scrubBreadcrumb", () => {
  it("el evento pierde usuario, cuerpo, cookies, encabezados y extras; conserva la URL generalizada", () => {
    const event = {
      message: "Falló algo",
      user: { id: "u1", email: "ana@example.test" },
      request: {
        url: "https://intercede.app/es/r/abc234?x=1",
        cookies: { sb: "secreto" },
        headers: { authorization: "Bearer x" },
        data: { content: "Por mi familia" },
      },
      extra: { peticion: "texto" },
      transaction: "GET /es/p/AbCdEfGhIjKlMnOpQrStUv_-12",
      breadcrumbs: [
        { category: "ui.input", message: "contraseña escrita" },
        { category: "console", message: "contenido de una petición" },
        { category: "fetch", data: { url: "https://x.supabase.co/rest/v1/rooms?code=eq.abc234", body: "x", method: "GET", status_code: 200 } },
        { category: "navigation", data: { from: "/es/r/abc234", to: "/es/orar" } },
      ],
    };
    const clean = scrubEvent(event) as typeof event & Record<string, unknown>;
    expect(clean.user).toBeUndefined();
    expect(clean.extra).toBeUndefined();
    expect(clean.request).toEqual({ url: "https://intercede.app/es/r/[code]" });
    expect(clean.transaction).toBe("GET /es/p/[token]");
    expect(clean.message).toBe("Falló algo");
    expect(clean.breadcrumbs).toEqual([
      { category: "fetch", data: { url: "https://x.supabase.co/rest/v1/rooms", method: "GET", status_code: 200 } },
      { category: "navigation", data: { from: "/es/r/[code]", to: "/es/orar" } },
    ]);
    // El original no se modifica
    expect(event.user.email).toBe("ana@example.test");
  });

  it("tolera eventos mínimos", () => {
    expect(scrubEvent({})).toEqual({});
    expect(scrubEvent({ request: {} })).toEqual({ request: {} });
    expect(scrubBreadcrumb({ category: "xhr" })).toEqual({ category: "xhr" });
  });
});

describe("sentryOptions", () => {
  it("sin DSN queda apagado", () => {
    expect(sentryOptions(undefined)).toMatchObject({ enabled: false, dsn: undefined, sendDefaultPii: false });
    expect(sentryOptions("")).toMatchObject({ enabled: false });
  });

  it("con DSN se enciende, sin datos personales y con la limpieza conectada", () => {
    const options = sentryOptions("https://abc@o0.ingest.sentry.io/1");
    expect(options).toMatchObject({ enabled: true, sendDefaultPii: false, dsn: "https://abc@o0.ingest.sentry.io/1" });
    expect(options.tracesSampleRate).toBeLessThanOrEqual(0.1);
    expect(options.beforeSend({ user: { id: "x" }, request: { url: "/es/r/abc234" } })).toEqual({ request: { url: "/es/r/[code]" } });
    expect(options.beforeBreadcrumb({ category: "ui.click", message: "texto" })).toBeNull();
  });
});

describe("CAPTCHA", () => {
  it("lee el token del formulario y descarta lo vacío o absurdo", () => {
    const form = (value: string | File) => {
      const data = new FormData();
      data.set(CAPTCHA_FIELD, value);
      return data;
    };
    expect(getCaptchaToken(form("0.abcdef"))).toBe("0.abcdef");
    expect(getCaptchaToken(form(""))).toBeUndefined();
    expect(getCaptchaToken(form("x".repeat(5000)))).toBeUndefined();
    expect(getCaptchaToken(new FormData())).toBeUndefined();
    expect(getCaptchaToken(form(new File(["x"], "x.txt")))).toBeUndefined();
  });
});

describe("moderación y borrado de cuenta", () => {
  it("el borrado exige escribir ELIMINAR (sin importar mayúsculas ni espacios)", () => {
    expect(deleteAccountSchema.safeParse({ confirm: "ELIMINAR" }).success).toBe(true);
    expect(deleteAccountSchema.safeParse({ confirm: "  eliminar " }).success).toBe(true);
    expect(deleteAccountSchema.safeParse({ confirm: "borrar" }).success).toBe(false);
    expect(deleteAccountSchema.safeParse({ confirm: "" }).success).toBe(false);
    expect(deleteAccountSchema.safeParse({}).success).toBe(false);
    expect(deleteAccountSchema.safeParse({ confirm: "ELIMINAR", password: "x".repeat(73) }).success).toBe(false);
  });

  it("traduce los errores de la base a claves conocidas", () => {
    expect(toModerationError({ message: "already_reported" })).toBe("already_reported");
    expect(toModerationError({ message: "no_shared_context" })).toBe("no_shared_context");
    expect(toModerationError({ message: "otra cosa" })).toBe("generic");
    expect(toModerationError(null)).toBe("generic");
  });
});
