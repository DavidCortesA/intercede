"use client";

import { WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ConnectionState } from "@/features/rooms/use-room-live";

/** Avisa con claridad cuando no hay internet o se está reconectando (sin bloquear la pantalla). */
export function ConnectionBanner({ online, connection }: { online: boolean; connection: ConnectionState }) {
  const t = useTranslations("Room.connection");
  if (online && connection !== "reconnecting") return null;

  return (
    <p
      role="status"
      className="flex items-center justify-center gap-2 bg-answered-surface px-4 py-2 text-center text-sm text-answered-foreground"
    >
      <WifiOff className="size-4 shrink-0" aria-hidden="true" />
      {online ? t("reconnecting") : t("offline")}
    </p>
  );
}
