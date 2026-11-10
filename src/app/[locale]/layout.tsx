import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { notFound } from "next/navigation";
import { Analytics } from "@vercel/analytics/next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BRAND } from "@/config/brand";
import { PwaProvider } from "@/components/shared/pwa-provider";
import { SITE_URL } from "@/config/site";
import { routing } from "@/i18n/routing";
import { scrubAnalyticsEvent } from "@/lib/sentry/scrub";
import "../globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });

  return {
    metadataBase: new URL(SITE_URL),
    title: t("title"),
    description: t("description"),
    applicationName: BRAND.name,
    // Íconos generados desde el logo oficial (npm run icons)
    icons: {
      icon: [
        { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/icons/icon-48.png", sizes: "48x48", type: "image/png" },
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      ],
      apple: "/icons/apple-touch-icon.png",
    },
    appleWebApp: { capable: true, title: BRAND.name, statusBarStyle: "black-translucent" },
  };
}

export const viewport: Viewport = {
  themeColor: BRAND.colors.navy900,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "A11y" });

  return (
    <html lang={locale} className={`${inter.variable} ${jakarta.variable}`}>
      <body className="min-h-dvh antialiased">
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          {t("skipToContent")}
        </a>
        <NextIntlClientProvider>
          <PwaProvider>{children}</PwaProvider>
        </NextIntlClientProvider>
        {/* Analítica sin cookies, solo en Vercel; las rutas con llaves (/r/código, /p/…, /c/…) se generalizan antes de enviarse */}
        {process.env.VERCEL ? <Analytics beforeSend={scrubAnalyticsEvent} /> : null}
      </body>
    </html>
  );
}
