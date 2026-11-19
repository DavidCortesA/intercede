// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { contrastRatio, BACKGROUND_HEX, isAccessibleAccent } from "@/features/brand/contrast";
import { adminClient, anonClient, hasTestDb, signInTestUser } from "./helpers";

type Person = Awaited<ReturnType<typeof signInTestUser>>;

const errorOf = (res: { error: { message: string } | null }) => res.error?.message;
const MIN = 60_000;

describe.skipIf(!hasTestDb)("marca de la iglesia (B6)", () => {
  const admin = adminClient();
  const userIds: string[] = [];
  const communityIds: string[] = [];
  let ana: Person; // administra
  let beto: Person; // miembro
  let carla: Person; // sin relación

  beforeAll(async () => {
    [ana, beto, carla] = await Promise.all([signInTestUser("Ana"), signInTestUser("Beto"), signInTestUser("Carla")]);
    userIds.push(ana.user.id, beto.user.id, carla.user.id);
  });

  afterEach(async () => {
    if (communityIds.length) await admin.from("communities").delete().in("id", communityIds.splice(0));
  });

  afterAll(async () => {
    await Promise.all(userIds.map((id) => admin.auth.admin.deleteUser(id)));
  });

  /** Comunidad con plan Pro (la prueba de Plus no incluye marca). */
  async function proCommunity(name = "Iglesia Vida Nueva") {
    const { data: id } = await ana.client.rpc("create_community", { p_name: name, p_kind: "church" });
    communityIds.push(id!);
    const token = (await ana.client.rpc("get_community_invite", { p_community_id: id! })).data!;
    await beto.client.rpc("join_community", { p_token: token });
    await admin.from("subscriptions").update({ plan_code: "pro", current_period_end: new Date(Date.now() + 30 * 24 * 60 * MIN).toISOString() }).eq("community_id", id!);
    return id!;
  }
  const setBrand = (id: string, name: string | null, accent: string, who: Person = ana) =>
    who.client.rpc("set_community_brand", { p_community_id: id, p_display_name: name as string, p_accent: accent });

  it("la fórmula de contraste de la base coincide con la de la interfaz (WCAG)", async () => {
    // Colores repartidos por todo el espacio; se evita la franja justo en el límite donde el redondeo puede diferir
    const colors = ["#5b2ee6", "#2563ff", "#12b8da", "#f5a640", "#0a1240", "#131c4f", "#fbf5ea", "#ffffff", "#000000", "#777777", "#767676", "#e11d48", "#16a34a", "#d97706", "#7c3aed", "#0ea5e9", "#b91c1c", "#facc15", "#64748b", "#475569"];
    for (let i = 0; i < 20; i++) colors.push(`#${((i * 2654435761) % 0xffffff).toString(16).padStart(6, "0")}`);
    for (const color of colors) {
      if (Math.abs(contrastRatio(BACKGROUND_HEX, color) - 4.5) < 0.02) continue;
      const { data } = await admin.rpc("accent_contrast_ok", { p_hex: color });
      expect({ color, ok: data }).toEqual({ color, ok: isAccessibleAccent(color) });
    }
  });

  it("solo con plan Pro; solo la administración", async () => {
    const free = await ana.client.rpc("create_community", { p_name: "Iglesia Libre", p_kind: "church" });
    communityIds.push(free.data!);
    // La prueba de Plus (14 días) no incluye marca
    expect(errorOf(await setBrand(free.data!, "Mi marca", "#5b2ee6"))).toBe("plan_required");

    const id = await proCommunity();
    expect(errorOf(await setBrand(id, "Mi marca", "#5b2ee6", beto))).toBe("not_admin");
    expect(errorOf(await setBrand(id, "Mi marca", "#5b2ee6", carla))).toBe("not_admin");
    expect(errorOf(await setBrand(id, "Mi marca", "#5b2ee6", { client: anonClient() } as unknown as Person))).toBeDefined();
    expect((await setBrand(id, "Mi marca", "#5b2ee6")).error).toBeNull();
  });

  it("el color debe tener contraste AA: el dorado y el cian se rechazan; el formato debe ser #rrggbb", async () => {
    const id = await proCommunity();
    expect(errorOf(await setBrand(id, null, "#f5a640"))).toBe("low_contrast");
    expect(errorOf(await setBrand(id, null, "#12b8da"))).toBe("low_contrast");
    expect(errorOf(await setBrand(id, null, "#ffffff"))).toBe("low_contrast");
    for (const bad of ["", "rojo", "#fff", "#12345g", "5b2ee6", "javascript:alert(1)"]) expect(errorOf(await setBrand(id, null, bad))).toBe("invalid_accent");
    expect((await setBrand(id, null, "#5B2EE6")).error).toBeNull(); // mayúsculas: se guarda normalizado
    expect((await admin.from("community_brands").select("accent").eq("community_id", id).single()).data!.accent).toBe("#5b2ee6");
  });

  it("nadie escribe la marca directamente ni se salta la regla de contraste", async () => {
    const id = await proCommunity();
    expect((await ana.client.from("community_brands").insert({ community_id: id, accent: "#5b2ee6" })).error?.code).toBe("42501");
    // Ni siquiera la service role puede guardar un color que no pasa (restricción de la tabla)
    expect((await admin.from("community_brands").insert({ community_id: id, accent: "#f5a640" })).error).not.toBeNull();
    expect((await admin.from("community_brands").insert({ community_id: id, accent: "red" })).error).not.toBeNull();
  });

  it("el nombre visible: no suplanta a INTERCEDE ni a otra comunidad (sin importar acentos, mayúsculas ni signos)", async () => {
    const id = await proCommunity("Iglesia Central");
    expect(errorOf(await setBrand(id, "INTERCEDE Oficial", "#5b2ee6"))).toBe("reserved_name");
    expect(errorOf(await setBrand(id, "Inter-Cede", "#5b2ee6"))).toBe("reserved_name");
    expect(errorOf(await setBrand(id, "!!!", "#5b2ee6"))).toBe("invalid_name");
    expect(errorOf(await setBrand(id, "x".repeat(41), "#5b2ee6"))).toBe("invalid_name");

    // Otra comunidad ya se llama así (aunque la escriban distinto)
    const other = await ana.client.rpc("create_community", { p_name: "Iglesia Vida Nueva", p_kind: "church" });
    communityIds.push(other.data!);
    expect(errorOf(await setBrand(id, "iglesia  VIDA nueva", "#5b2ee6"))).toBe("name_taken");
    expect(errorOf(await setBrand(id, "Iglesia Vída-Nueva", "#5b2ee6"))).toBe("name_taken");

    // El nombre visible de otra comunidad con marca también cuenta
    const second = await proCommunity("Otra Iglesia");
    expect((await setBrand(second, "La Roca", "#5b2ee6")).error).toBeNull();
    expect(errorOf(await setBrand(id, "la roca", "#5b2ee6"))).toBe("name_taken");
    // Pero la misma comunidad puede repetir el suyo (actualizar)
    expect((await setBrand(second, "La Roca", "#0a1240")).error).toBeNull();
  });

  it("community_brand: la ven las personas de la comunidad (nombre visible o el nombre; acento y logo); quien no es de ella, nada", async () => {
    const id = await proCommunity("Iglesia Central");
    await setBrand(id, "Casa de Oración", "#be123c");
    const mine = (await beto.client.rpc("community_brand", { p_community_id: id })).data as { name: string; accent: string; logo_url: string | null };
    expect(mine).toMatchObject({ name: "Casa de Oración", accent: "#be123c" });
    expect((await ana.client.rpc("community_brand", { p_community_id: id })).data).toMatchObject({ name: "Casa de Oración" });

    expect((await carla.client.rpc("community_brand", { p_community_id: id })).data).toBeNull();
    expect((await carla.client.from("community_brands").select("accent").eq("community_id", id)).data).toEqual([]);
    expect((await beto.client.from("community_brands").select("accent").eq("community_id", id)).data).toHaveLength(1);
    expect((await anonClient().rpc("community_brand", { p_community_id: id })).error?.code).toBe("42501");

    // Sin nombre visible se usa el de la comunidad
    await setBrand(id, null, "#5b2ee6");
    expect((await beto.client.rpc("community_brand", { p_community_id: id })).data).toMatchObject({ name: "Iglesia Central" });
  });

  it("si el plan Pro termina, la marca deja de aplicarse (queda guardada); al volver, reaparece", async () => {
    const id = await proCommunity();
    await setBrand(id, "Casa de Oración", "#5b2ee6");
    await admin.from("subscriptions").update({ current_period_end: new Date(Date.now() - MIN).toISOString() }).eq("community_id", id);
    expect((await beto.client.rpc("community_brand", { p_community_id: id })).data).toBeNull();
    expect((await admin.from("community_brands").select("accent").eq("community_id", id)).data).toHaveLength(1);
    expect(errorOf(await setBrand(id, "Otro", "#5b2ee6"))).toBe("plan_required");

    await admin.from("subscriptions").update({ current_period_end: new Date(Date.now() + 30 * 24 * 60 * MIN).toISOString() }).eq("community_id", id);
    expect((await beto.client.rpc("community_brand", { p_community_id: id })).data).toMatchObject({ name: "Casa de Oración" });
  });

  it("quitar la marca: solo la administración, y funciona aunque el plan ya no sea Pro", async () => {
    const id = await proCommunity();
    await setBrand(id, "Casa de Oración", "#5b2ee6");
    expect(errorOf(await beto.client.rpc("clear_community_brand", { p_community_id: id }))).toBe("not_admin");
    await admin.from("subscriptions").update({ current_period_end: new Date(Date.now() - MIN).toISOString() }).eq("community_id", id);
    expect((await ana.client.rpc("clear_community_brand", { p_community_id: id })).error).toBeNull();
    expect((await admin.from("community_brands").select("accent").eq("community_id", id)).data).toEqual([]);
  });

  it("borrar la comunidad borra su marca", async () => {
    const id = await proCommunity();
    await setBrand(id, "Casa de Oración", "#5b2ee6");
    await admin.from("communities").delete().eq("id", id);
    expect((await admin.from("community_brands").select("community_id").eq("community_id", id)).data).toEqual([]);
  });
});
