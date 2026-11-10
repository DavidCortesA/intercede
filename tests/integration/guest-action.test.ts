// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminClient, hasTestDb, testEnv } from "./helpers";

// Almacén de cookies en memoria que sustituye a `next/headers` (la acción corre fuera de Next).
const cookieJar = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    api: {
      getAll: () => [...store].map(([name, value]) => ({ name, value })),
      set: (name: string, value: string) => void store.set(name, value),
    },
  };
});
vi.mock("next/headers", () => ({ cookies: async () => cookieJar.api }));

describe.skipIf(!hasTestDb)("signInAsGuest y getCurrentSession", () => {
  const createdUserIds: string[] = [];

  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = testEnv.url;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = testEnv.publishableKey;
  });

  beforeEach(() => cookieJar.store.clear());

  afterAll(async () => {
    const admin = adminClient();
    await Promise.all(createdUserIds.map((id) => admin.auth.admin.deleteUser(id)));
  });

  it("entra con solo un nombre: crea la sesión, las cookies y el perfil", async () => {
    const { signInAsGuest } = await import("@/features/auth/actions");
    const result = await signInAsGuest({ displayName: "  María  " });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdUserIds.push(result.userId);

    expect([...cookieJar.store.keys()].some((name) => name.includes("-auth-token"))).toBe(true);

    const { data: user } = await adminClient().auth.admin.getUserById(result.userId);
    expect(user.user?.is_anonymous).toBe(true);
    const { data: profile } = await adminClient().from("profiles").select("display_name").eq("id", result.userId).single();
    expect(profile?.display_name).toBe("María");
  });

  it("si ya hay sesión no crea otro usuario: solo actualiza el nombre", async () => {
    const { signInAsGuest } = await import("@/features/auth/actions");
    const first = await signInAsGuest({ displayName: "Luis" });
    const second = await signInAsGuest({ displayName: "Luis Á." });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    createdUserIds.push(first.userId);
    expect(second.userId).toBe(first.userId);

    const { data } = await adminClient().from("profiles").select("display_name").eq("id", first.userId).single();
    expect(data?.display_name).toBe("Luis Á.");
  });

  it("rechaza nombres inválidos sin tocar Auth", async () => {
    const { signInAsGuest } = await import("@/features/auth/actions");
    expect(await signInAsGuest({ displayName: "   " })).toEqual({ ok: false, error: "invalid_name" });
    expect(await signInAsGuest({ displayName: "x".repeat(41) })).toEqual({ ok: false, error: "invalid_name" });
    expect(cookieJar.store.size).toBe(0);
  });

  it("getCurrentSession devuelve el perfil del invitado, y null sin sesión", async () => {
    const { signInAsGuest } = await import("@/features/auth/actions");
    const { getCurrentSession } = await import("@/features/auth/queries");

    expect(await getCurrentSession()).toBeNull();

    const result = await signInAsGuest({ displayName: "Sofía" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdUserIds.push(result.userId);

    const session = await getCurrentSession();
    expect(session).toMatchObject({ userId: result.userId, isAnonymous: true });
    expect(session?.profile?.display_name).toBe("Sofía");
  });
});
