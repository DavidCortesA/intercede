import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Footer } from "@/components/marketing/footer";
import { Header } from "@/components/marketing/header";
import { StickyCta } from "@/components/marketing/sticky-cta";
import { routing } from "@/i18n/routing";

export default async function MarketingLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <>
      <Header />
      <main id="contenido">{children}</main>
      <Footer />
      <StickyCta />
    </>
  );
}
