import { describe, expect, it } from "vitest";
import { overviewSchema, parseLabels, toPartnerError } from "@/features/partners/schemas";

describe("compañero de oración: utilidades", () => {
  it("parseLabels separa por líneas o comas, sin vacíos ni repetidos (sin importar mayúsculas)", () => {
    expect(parseLabels("Norte\nSur\n\n  Jóvenes  ")).toEqual(["Norte", "Sur", "Jóvenes"]);
    expect(parseLabels("Norte, norte, SUR,sur")).toEqual(["Norte", "SUR"]);
    expect(parseLabels("")).toEqual([]);
    expect(parseLabels(" , \n ,")).toEqual([]);
  });

  it("toPartnerError conserva los códigos conocidos y manda el resto a generic", () => {
    expect(toPartnerError("adult_required")).toBe("adult_required");
    expect(toPartnerError("pair_ended")).toBe("pair_ended");
    expect(toPartnerError("algo raro")).toBe("generic");
    expect(toPartnerError(undefined)).toBe("generic");
  });

  it("overviewSchema acepta la respuesta de la base (con y sin pareja) y rechaza una mal formada", () => {
    const base = { program: { active: true, mode: "random", labels: [] }, adult_confirmed: true, is_leader: false, stats: null, signup: { group_label: null, paused: false }, pair: null };
    expect(overviewSchema.safeParse(base).success).toBe(true);
    const withPair = {
      ...base,
      pair: {
        id: "p1",
        week_start: "2026-11-16",
        ended: false,
        partner_id: "u2",
        partner_name: "Carla",
        my_requests: [{ id: "r1", content: "Por mi examen" }],
        partner_requests: [],
        i_pray: false,
        partner_prays: true,
        my_checkin: null,
        partner_checkin: { status: "good", note: null },
      },
    };
    expect(overviewSchema.safeParse(withPair).success).toBe(true);
    expect(overviewSchema.safeParse({ ...base, program: { active: true, mode: "otro", labels: [] } }).success).toBe(false);
    expect(overviewSchema.safeParse({ ...withPair, pair: { ...withPair.pair, partner_checkin: { status: "genial", note: null } } }).success).toBe(false);
  });
});
