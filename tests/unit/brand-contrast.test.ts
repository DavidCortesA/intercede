import { describe, expect, it } from "vitest";
import { BRAND } from "@/config/brand";

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;

describe("contraste de la paleta de marca (WCAG AA)", () => {
  const { violet, blue, cyan, gold, cream, navy900 } = BRAND.colors;

  it("blanco sobre violeta y sobre azul (botones con degradado)", () => {
    expect(contrast("#FFFFFF", violet)).toBeGreaterThanOrEqual(AA);
    expect(contrast("#FFFFFF", blue)).toBeGreaterThanOrEqual(AA);
  });

  it("texto navy sobre blanco y sobre crema (modo claro)", () => {
    expect(contrast(navy900, "#FFFFFF")).toBeGreaterThanOrEqual(AA);
    expect(contrast(navy900, cream)).toBeGreaterThanOrEqual(AA);
  });

  it("texto crema y lavanda sobre navy (modo oscuro)", () => {
    expect(contrast(cream, navy900)).toBeGreaterThanOrEqual(AA);
    expect(contrast("#B9A8FF", navy900)).toBeGreaterThanOrEqual(AA);
  });

  it("cian y dorado cumplen sobre navy pero NO sobre blanco (por eso se restringen)", () => {
    expect(contrast(cyan, navy900)).toBeGreaterThanOrEqual(AA);
    expect(contrast(gold, navy900)).toBeGreaterThanOrEqual(AA);
    expect(contrast(cyan, "#FFFFFF")).toBeLessThan(AA);
    expect(contrast(gold, "#FFFFFF")).toBeLessThan(AA);
  });
});
