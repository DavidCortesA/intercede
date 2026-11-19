import { describe, expect, it } from "vitest";
import { contrastRatio, ensureAccessibleAccent, isAccessibleAccent, normalizeHex, relativeLuminance } from "@/features/brand/contrast";

describe("contraste WCAG del color de acento", () => {
  it("luminancia y razón de contraste conocidas", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 3);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 3);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1); // el gris clásico que apenas no pasa
  });

  it("los colores de la marca: el violeta y el azul marino pasan; el dorado y el cian no (como dice el CLAUDE.md §8.2)", () => {
    expect(isAccessibleAccent("#5b2ee6")).toBe(true);
    expect(isAccessibleAccent("#0a1240")).toBe(true);
    expect(isAccessibleAccent("#f5a640")).toBe(false);
    expect(isAccessibleAccent("#12b8da")).toBe(false);
    expect(isAccessibleAccent("#ffffff")).toBe(false);
  });

  it("normalizeHex acepta con o sin #, mayúsculas y espacios, y rechaza lo que no es un color", () => {
    expect(normalizeHex(" 5B2EE6 ")).toBe("#5b2ee6");
    expect(normalizeHex("#5b2ee6")).toBe("#5b2ee6");
    for (const bad of ["", "#fff", "#12345", "#gggggg", "rojo", "#5b2ee6ff"]) expect(normalizeHex(bad)).toBeNull();
  });

  it("ensureAccessibleAccent deja igual lo que pasa y oscurece lo que no, conservando el tono", () => {
    expect(ensureAccessibleAccent("#5b2ee6")).toMatchObject({ hex: "#5b2ee6", adjusted: false });

    for (const bad of ["#f5a640", "#12b8da", "#ffd700", "#ffffff", "#aaff00", "#ff8080"]) {
      const result = ensureAccessibleAccent(bad);
      expect(result.adjusted).toBe(true);
      expect(isAccessibleAccent(result.hex)).toBe(true);
      expect(result.ratio).toBeGreaterThanOrEqual(4.5);
      // Lo más cercano posible: no se pasa a negro si con poco oscurecer alcanza
      expect(result.hex).not.toBe("#000000");
    }
    // El dorado oscurecido sigue siendo dorado (rojo > azul)
    const gold = ensureAccessibleAccent("#f5a640").hex;
    expect(Number.parseInt(gold.slice(1, 3), 16)).toBeGreaterThan(Number.parseInt(gold.slice(5, 7), 16));
  });

  it("el blanco y los tonos muy claros se oscurecen hasta pasar", () => {
    expect(isAccessibleAccent(ensureAccessibleAccent("#ffffff").hex)).toBe(true);
    expect(isAccessibleAccent(ensureAccessibleAccent("#fafafa").hex)).toBe(true);
  });
});
