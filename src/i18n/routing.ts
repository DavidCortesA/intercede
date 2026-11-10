import { defineRouting } from "next-intl/routing";

/**
 * Español primero. Para añadir inglés o portugués: agregar el código aquí,
 * crear `src/messages/<locale>.json` con las mismas claves que `es.json`.
 */
export const routing = defineRouting({
  locales: ["es"],
  defaultLocale: "es",
  localePrefix: "always",
});
