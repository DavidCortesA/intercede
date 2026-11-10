// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TablesUpdate } from "@/types/database";
import { adminClient, anonClient, hasTestDb, signInGuest, type TestClient } from "./helpers";

// RLS de `profiles`: la persona A nunca accede a datos de la persona B (CLAUDE.md §7).
describe.skipIf(!hasTestDb)("profiles — trigger y RLS", () => {
  const createdUserIds: string[] = [];
  let a: Awaited<ReturnType<typeof signInGuest>>;
  let b: Awaited<ReturnType<typeof signInGuest>>;

  beforeAll(async () => {
    a = await signInGuest("Ana");
    b = await signInGuest("Beto");
    createdUserIds.push(a.user.id, b.user.id);
  });

  afterAll(async () => {
    const admin = adminClient();
    await Promise.all(createdUserIds.map((id) => admin.auth.admin.deleteUser(id)));
  });

  describe("alta automática del perfil", () => {
    it("se crea al entrar como invitado con el nombre elegido", async () => {
      const { data } = await a.client.from("profiles").select("*").eq("id", a.user.id).single();
      expect(data).toMatchObject({ id: a.user.id, display_name: "Ana", locale: "es", timezone: "UTC" });
    });

    it("el nombre queda nulo si no se elige uno", async () => {
      const guest = await signInGuest();
      createdUserIds.push(guest.user.id);
      const { data } = await guest.client.from("profiles").select("display_name").eq("id", guest.user.id).single();
      expect(data?.display_name).toBeNull();
    });

    it("recorta espacios y limita el nombre a 40 caracteres", async () => {
      const guest = await signInGuest(`   ${"x".repeat(60)}   `);
      createdUserIds.push(guest.user.id);
      const { data } = await guest.client.from("profiles").select("display_name").eq("id", guest.user.id).single();
      // El trigger toma los primeros 40 caracteres (3 espacios + 37 x) y luego recorta los espacios
      expect(data?.display_name).toBe("x".repeat(37));
    });

    it("un nombre en blanco se guarda como nulo", async () => {
      const guest = await signInGuest("    ");
      createdUserIds.push(guest.user.id);
      const { data } = await guest.client.from("profiles").select("display_name").eq("id", guest.user.id).single();
      expect(data?.display_name).toBeNull();
    });
  });

  describe("lectura", () => {
    it("A solo ve su propio perfil aunque pida todos", async () => {
      const { data, error } = await a.client.from("profiles").select("id");
      expect(error).toBeNull();
      expect(data).toEqual([{ id: a.user.id }]);
    });

    it("A no puede leer el perfil de B por id", async () => {
      const { data, error } = await a.client.from("profiles").select("*").eq("id", b.user.id);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("sin sesión (rol anon) no se puede leer ningún perfil", async () => {
      const { data, error } = await anonClient().from("profiles").select("*");
      expect(data).toBeNull();
      expect(error?.code).toBe("42501"); // permission denied
    });
  });

  describe("escritura", () => {
    it("A puede editar su nombre, idioma y zona horaria; updated_at cambia", async () => {
      const before = await a.client.from("profiles").select("updated_at").eq("id", a.user.id).single();
      const { data, error } = await a.client
        .from("profiles")
        .update({ display_name: "Ana M.", locale: "en", timezone: "America/Mexico_City" })
        .eq("id", a.user.id)
        .select()
        .single();
      expect(error).toBeNull();
      expect(data).toMatchObject({ display_name: "Ana M.", locale: "en", timezone: "America/Mexico_City" });
      expect(new Date(data!.updated_at).getTime()).toBeGreaterThan(new Date(before.data!.updated_at).getTime());
    });

    it("A no puede editar el perfil de B (0 filas afectadas)", async () => {
      const { data, error } = await a.client
        .from("profiles")
        .update({ display_name: "Hackeado" })
        .eq("id", b.user.id)
        .select();
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const check = await adminClient().from("profiles").select("display_name").eq("id", b.user.id).single();
      expect(check.data?.display_name).toBe("Beto");
    });

    it("A no puede cambiar columnas protegidas (id, created_at)", async () => {
      const changeId = await a.client.from("profiles").update({ id: b.user.id }).eq("id", a.user.id);
      expect(changeId.error?.code).toBe("42501");

      const changeCreated = await a.client
        .from("profiles")
        .update({ created_at: "2000-01-01T00:00:00Z" })
        .eq("id", a.user.id);
      expect(changeCreated.error?.code).toBe("42501");
    });

    it("A no puede insertar perfiles (ni propios ni ajenos)", async () => {
      const own = await a.client.from("profiles").insert({ id: a.user.id });
      const other = await a.client.from("profiles").insert({ id: crypto.randomUUID() });
      expect(own.error).not.toBeNull();
      expect(other.error).not.toBeNull();
    });

    it("A no puede borrar perfiles", async () => {
      const own = await a.client.from("profiles").delete().eq("id", a.user.id);
      const other = await a.client.from("profiles").delete().eq("id", b.user.id);
      expect(own.error?.code).toBe("42501");
      expect(other.error?.code).toBe("42501");
      const still = await adminClient().from("profiles").select("id").in("id", [a.user.id, b.user.id]);
      expect(still.data).toHaveLength(2);
    });
  });

  describe("validación de datos", () => {
    const update = (client: TestClient, id: string, patch: TablesUpdate<"profiles">) =>
      client.from("profiles").update(patch).eq("id", id);

    it("rechaza nombres vacíos o de más de 40 caracteres", async () => {
      expect((await update(a.client, a.user.id, { display_name: "   " })).error?.code).toBe("23514");
      expect((await update(a.client, a.user.id, { display_name: "x".repeat(41) })).error?.code).toBe("23514");
    });

    it("rechaza idiomas no soportados", async () => {
      expect((await update(a.client, a.user.id, { locale: "fr" })).error?.code).toBe("23514");
    });

    it("rechaza zonas horarias inexistentes", async () => {
      expect((await update(a.client, a.user.id, { timezone: "Marte/Olimpo" })).error?.code).toBe("22023");
    });
  });

  it("al eliminar la cuenta se elimina el perfil (cascada)", async () => {
    const guest = await signInGuest("Temporal");
    const admin = adminClient();
    await admin.auth.admin.deleteUser(guest.user.id);
    const { data } = await admin.from("profiles").select("id").eq("id", guest.user.id);
    expect(data).toEqual([]);
  });
});
