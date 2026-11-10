import type { routing } from "@/i18n/routing";
import type messages from "@/messages/es.json";

// Tipado estricto de claves de traducción y de locales (next-intl AppConfig).
declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
  }
}
