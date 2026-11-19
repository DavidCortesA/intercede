import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { DisplayScreen } from "@/components/room/display-screen";
import { roomCodeSchema } from "@/features/rooms/schemas";
import { routing } from "@/i18n/routing";

// Pantalla de proyección: privada y nunca indexada (el enlace es secreto)
export async function generateMetadata({ params }: PageProps<"/[locale]/r/[code]/display">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Display" });
  return { title: t("metaTitle"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function DisplayPage({ params, searchParams }: PageProps<"/[locale]/r/[code]/display">) {
  const { locale, code } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const parsedCode = roomCodeSchema.safeParse(code);
  const { t } = await searchParams;
  const token = typeof t === "string" ? t : "";
  if (!parsedCode.success) notFound();

  return <DisplayScreen code={parsedCode.data} token={token} />;
}
