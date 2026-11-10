import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { RoomShell } from "./room-shell";

export type RoomMessageKind = "notFound" | "closed" | "locked" | "full" | "closedLive" | "removed";

/** Mensaje claro cuando no se puede entrar (enlace inválido, sala cerrada, bloqueada o llena). */
export async function RoomMessage({ kind, roomName }: { kind: RoomMessageKind; roomName?: string }) {
  const t = await getTranslations("Room.states");

  return (
    <RoomShell>
      <h1 className="font-heading text-3xl font-extrabold text-balance">{t(`${kind}.title`)}</h1>
      {roomName ? <p className="mt-2 text-sm text-muted-foreground">{roomName}</p> : null}
      <p className="mt-4 text-lg leading-relaxed text-brand-cream/85">{t(`${kind}.body`)}</p>
      <div className="mt-8 flex flex-col gap-3">
        <Link href="/orar" className={buttonVariants({ size: "md" })}>
          {t("newRoom")}
        </Link>
        <Link href="/" className={buttonVariants({ variant: "secondary", size: "md" })}>
          {t("home")}
        </Link>
      </div>
    </RoomShell>
  );
}
