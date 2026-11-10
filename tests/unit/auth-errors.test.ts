import { describe, expect, it } from "vitest";
import { safeNextPath, toAuthError } from "@/features/auth/errors";
import { emailSchema, isValidTimeZone, passwordSchema } from "@/features/auth/schemas";

describe("safeNextPath (evita redirecciones abiertas)", () => {
  it("acepta rutas internas simples", () => {
    for (const path of ["/", "/orar", "/es/perfil", "/diario", "/r/abc234", "/es/restablecer"]) {
      expect(safeNextPath(path, "/x")).toBe(path);
    }
  });

  it("rechaza dominios, esquemas, rutas relativas al protocolo y caracteres raros", () => {
    for (const bad of [
      "https://malo.example",
      "http://malo.example/es/perfil",
      "//malo.example",
      "//malo.example/es",
      "/\\malo.example",
      "javascript:alert(1)",
      "/es/perfil?x=1",
      "/es/perfil#h",
      "/es/../etc",
      "/ES/Perfil",
      "",
      "perfil",
    ]) {
      expect(safeNextPath(bad, "/seguro")).toBe("/seguro");
    }
    expect(safeNextPath(null, "/seguro")).toBe("/seguro");
    expect(safeNextPath(undefined, "/seguro")).toBe("/seguro");
  });
});

describe("toAuthError", () => {
  it("traduce los códigos de Supabase Auth a los de la app", () => {
    expect(toAuthError({ code: "invalid_credentials" })).toBe("invalid_credentials");
    expect(toAuthError({ code: "email_not_confirmed" })).toBe("email_not_confirmed");
    expect(toAuthError({ code: "weak_password" })).toBe("weak_password");
    expect(toAuthError({ code: "same_password" })).toBe("same_password");
    expect(toAuthError({ code: "email_exists" })).toBe("email_in_use");
    expect(toAuthError({ code: "over_email_send_rate_limit" })).toBe("rate_limited");
    expect(toAuthError({ code: "otp_expired" })).toBe("link_expired");
    expect(toAuthError({ status: 429 })).toBe("rate_limited");
  });

  it("lo desconocido es genérico y nunca filtra el mensaje interno", () => {
    expect(toAuthError({ code: "algo_raro", message: "detalle interno" })).toBe("generic");
    expect(toAuthError(null)).toBe("generic");
    expect(toAuthError(undefined)).toBe("generic");
  });
});

describe("validaciones de cuenta", () => {
  it("el correo se normaliza a minúsculas y se valida", () => {
    expect(emailSchema.parse("Ana@Correo.COM")).toBe("ana@correo.com");
    expect(emailSchema.safeParse("no-es-correo").success).toBe(false);
    expect(emailSchema.safeParse("a@b").success).toBe(false);
  });

  it("la contraseña pide entre 8 y 72 caracteres", () => {
    expect(passwordSchema.safeParse("1234567").success).toBe(false);
    expect(passwordSchema.safeParse("12345678").success).toBe(true);
    expect(passwordSchema.safeParse("x".repeat(72)).success).toBe(true);
    expect(passwordSchema.safeParse("x".repeat(73)).success).toBe(false);
  });

  it("reconoce zonas horarias IANA y rechaza el resto", () => {
    expect(isValidTimeZone("America/Mexico_City")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Marte/Olimpo")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});
