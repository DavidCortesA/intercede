/**
 * Marca de la iglesia (CLAUDE.md §16 B6): el color de acento debe tener contraste AA (4.5:1). Misma fórmula que
 * `accent_contrast_ok` en la base (WCAG 2.x): luminancia relativa y razón de contraste contra el crema del fondo claro
 * (#FBF5EA), que es la más exigente de las bases (si pasa contra el crema, pasa contra el blanco). La base lo vuelve a
 * comprobar al guardar; aquí se usa para avisar y para oscurecer un color que no pasa.
 */

export const BACKGROUND_HEX = "#fbf5ea";
export const MIN_CONTRAST = 4.5;

export const HEX_PATTERN = /^#[0-9a-f]{6}$/;

/** Normaliza lo que escribe la persona ("5B2EE6", "#5b2ee6") a "#rrggbb" en minúsculas, o null si no es un color. */
export function normalizeHex(input: string): string | null {
  const text = input.trim().toLowerCase();
  const hex = text.startsWith("#") ? text : `#${text}`;
  return HEX_PATTERN.test(hex) ? hex : null;
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razón de contraste WCAG entre dos colores (1 a 21). */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

export function isAccessibleAccent(hex: string): boolean {
  return HEX_PATTERN.test(hex) && contrastRatio(BACKGROUND_HEX, hex) >= MIN_CONTRAST;
}

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return `#${[f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
}

export interface AccentCheck {
  /** Color final (el mismo si ya pasaba; si no, el más cercano que pasa, con el mismo tono). */
  hex: string;
  adjusted: boolean;
  ratio: number;
}

/**
 * Si el color no pasa AA, lo oscurece de a poco conservando el tono y la saturación hasta que pase (el dorado o el cian,
 * por ejemplo, quedan en una versión más oscura). Devuelve siempre un color que la base aceptará.
 */
export function ensureAccessibleAccent(hex: string): AccentCheck {
  if (isAccessibleAccent(hex)) return { hex, adjusted: false, ratio: contrastRatio(BACKGROUND_HEX, hex) };
  const [h, s, l] = toHsl(hex);
  for (let step = 1; step <= 100; step++) {
    const candidate = fromHsl(h, s, Math.max(0, l - step * 0.01));
    if (isAccessibleAccent(candidate)) return { hex: candidate, adjusted: true, ratio: contrastRatio(BACKGROUND_HEX, candidate) };
  }
  return { hex: "#000000", adjusted: true, ratio: contrastRatio(BACKGROUND_HEX, "#000000") };
}
