// @vitest-environment node
import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { updateSession } from "@/lib/supabase/proxy";
import { adminClient, hasTestDb, testEnv } from "./helpers";

describe.skipIf(!hasTestDb)("proxy: refresco de sesión de Supabase", () => {
  let cookieHeader = "";
  let userId = "";

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = testEnv.url;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = testEnv.publishableKey;

    // Crea una sesión real y captura las cookies tal como las escribe @supabase/ssr
    const jar = new Map<string, string>();
    const supabase = createServerClient(testEnv.url!, testEnv.publishableKey!, {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
      },
    });
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.user) throw new Error(`No se pudo crear la sesión de prueba: ${error?.message}`);
    userId = data.user.id;
    cookieHeader = [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ");
  });

  afterAll(async () => {
    if (userId) await adminClient().auth.admin.deleteUser(userId);
  });

  it("sin cookies de sesión no hace nada (la landing no paga costo ni recibe cookies)", async () => {
    const request = new NextRequest("http://localhost:3000/es");
    const response = NextResponse.next();
    const result = await updateSession(request, response);

    expect(result).toBe(response);
    expect(result.headers.get("set-cookie")).toBeNull();
  });

  it("con una sesión válida la respeta y devuelve la misma respuesta (el i18n no se pierde)", async () => {
    const request = new NextRequest("http://localhost:3000/es/orar", { headers: { cookie: cookieHeader } });
    const response = NextResponse.rewrite(new URL("http://localhost:3000/es/orar"));
    response.headers.set("x-prueba", "intl");

    const result = await updateSession(request, response);

    expect(result).toBe(response);
    expect(result.headers.get("x-prueba")).toBe("intl");
  });

  it("ignora cookies que no son de sesión de Supabase", async () => {
    const request = new NextRequest("http://localhost:3000/es", { headers: { cookie: "tema=oscuro" } });
    const response = NextResponse.next();
    expect(await updateSession(request, response)).toBe(response);
  });
});
