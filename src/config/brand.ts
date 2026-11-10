/**
 * Valores de marca (fuente: tabla de marca del CLAUDE.md §8.2).
 * Los tokens de color de la UI viven en `src/app/globals.css`; estos hex se usan
 * donde CSS no llega (manifest, theme-color, pruebas de contraste).
 * Confirmar contra los archivos originales del propietario cuando lleguen.
 */
export const BRAND = {
  name: "INTERCEDE",
  tagline: "Ora. Conecta. Permanece.",
  colors: {
    violet: "#5B2EE6",
    blue: "#2563FF",
    cyan: "#12B8DA",
    gold: "#F5A640",
    cream: "#FBF5EA",
    navy900: "#0A1240",
    navy800: "#131C4F",
  },
} as const;
