import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { JoinForm } from "@/components/room/join-form";
import { RoomMessage } from "@/components/room/room-message";
import { RoomScreen } from "@/components/room/room-screen";
import { RoomShell } from "@/components/room/room-shell";
import { getRoomSnapshot } from "@/features/rooms/queries";
import { routing } from "@/i18n/routing";

// La sala es privada por definición: nunca se indexa (el código es la llave de entrada).
export async function generateMetadata({ params }: PageProps<"/[locale]/r/[code]">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return { title: t("roomTitle"), robots: { index: false, follow: false } };
}

export default async function RoomPage({ params }: PageProps<"/[locale]/r/[code]">) {
  const { locale, code } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const snapshot = await getRoomSnapshot(code);

  switch (snapshot.kind) {
    case "not_found":
      return <RoomMessage kind="notFound" />;
    case "closed":
      return <RoomMessage kind="closed" roomName={snapshot.name} />;
    case "locked":
      return <RoomMessage kind="locked" roomName={snapshot.name} />;
    case "join": {
      const t = await getTranslations("Room.join");
      return (
        <RoomShell>
          <h1 className="font-heading text-3xl font-extrabold text-balance">{t("title", { name: snapshot.name })}</h1>
          <p className="mt-3 text-muted-foreground">{t("people", { count: snapshot.activeMembers })}</p>
          <div className="mt-8">
            <JoinForm code={snapshot.code} suggestedName={snapshot.suggestedName} />
          </div>
        </RoomShell>
      );
    }
    case "member":
      return (
        <RoomScreen room={snapshot.room} meId={snapshot.meId} members={snapshot.members} requests={snapshot.requests} />
      );
  }
}
