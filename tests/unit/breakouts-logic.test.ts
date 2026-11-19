import { describe, expect, it } from "vitest";
import { activeGroupId, breakoutRemainingMs, countByGroup, groupCountForSize, groupSizes, randomAssignments, type Breakout } from "@/features/breakouts/logic";

const NOW = Date.UTC(2026, 10, 20, 15, 0, 0);
const breakout = (over: Partial<Breakout> = {}): Breakout => ({
  id: "b1",
  room_id: "r1",
  status: "active",
  minutes: 10,
  ends_at: new Date(NOW + 10 * 60_000).toISOString(),
  announcement: null,
  announced_at: null,
  ...over,
});

describe("a qué sala de audio le toca a cada quien", () => {
  it("durante el reparto, su grupo; sin grupo asignado, la sala principal", () => {
    expect(activeGroupId(breakout(), "g1", NOW)).toBe("g1");
    expect(activeGroupId(breakout(), null, NOW)).toBeNull();
    expect(activeGroupId(null, "g1", NOW)).toBeNull();
  });

  it("al terminar el tiempo vuelve sola a la sala principal, sin esperar a la anfitriona", () => {
    const b = breakout();
    expect(activeGroupId(b, "g1", NOW + 10 * 60_000 - 1)).toBe("g1");
    expect(activeGroupId(b, "g1", NOW + 10 * 60_000)).toBeNull();
    expect(activeGroupId(b, "g1", NOW + 99 * 60_000)).toBeNull();
  });

  it("si la anfitriona terminó el reparto, vuelve aunque falte tiempo", () => {
    expect(activeGroupId(breakout({ status: "ended" }), "g1", NOW)).toBeNull();
  });

  it("dos dispositivos con relojes distintos vuelven en el mismo instante del servidor", () => {
    const b = breakout();
    // La hora que usa cada dispositivo ya viene corregida con la del servidor (ver clockOffset)
    const serverNow = NOW + 10 * 60_000 - 500;
    expect(activeGroupId(b, "g1", serverNow)).toBe("g1");
    expect(activeGroupId(b, "g1", serverNow + 600)).toBeNull();
  });

  it("breakoutRemainingMs nunca es negativo", () => {
    expect(breakoutRemainingMs(breakout().ends_at, NOW)).toBe(10 * 60_000);
    expect(breakoutRemainingMs(breakout().ends_at, NOW + 20 * 60_000)).toBe(0);
  });
});

describe("armar los grupos", () => {
  it("groupCountForSize: por tamaño, entre 2 y el límite del plan y sin pasar de las personas", () => {
    expect(groupCountForSize(20, 4, 10)).toBe(5);
    expect(groupCountForSize(20, 2, 10)).toBe(10); // límite del plan
    expect(groupCountForSize(7, 3, 10)).toBe(3);
    expect(groupCountForSize(3, 5, 10)).toBe(2); // mínimo 2 grupos
    expect(groupCountForSize(2, 2, 10)).toBe(2);
    expect(groupCountForSize(0, 3, 10)).toBe(2);
  });

  it("groupSizes reparte parejo: los primeros reciben una persona más", () => {
    expect(groupSizes(19, 4)).toEqual([5, 5, 5, 4]);
    expect(groupSizes(20, 4)).toEqual([5, 5, 5, 5]);
    expect(groupSizes(5, 2)).toEqual([3, 2]);
  });

  it("randomAssignments: nadie se repite ni se queda fuera y los grupos quedan parejos", () => {
    const ids = Array.from({ length: 19 }, (_, i) => `u${i}`);
    const result = randomAssignments(ids, 4);
    expect(Object.keys(result).sort()).toEqual([...ids].sort());
    const counts = countByGroup(result, 4);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(19);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(Object.values(result).every((n) => n >= 1 && n <= 4)).toBe(true);
  });

  it("randomAssignments es reproducible con el mismo azar y cambia con otro", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const constant = () => 0.3;
    expect(randomAssignments(ids, 3, constant)).toEqual(randomAssignments(ids, 3, constant));
    expect(randomAssignments(ids, 3, () => 0.99)).not.toEqual(randomAssignments(ids, 3, () => 0));
  });

  it("countByGroup ignora grupos fuera de rango y cuenta los vacíos como 0", () => {
    expect(countByGroup({ a: 1, b: 1, c: 3, d: 0, e: 9 }, 3)).toEqual([2, 0, 1]);
  });
});
