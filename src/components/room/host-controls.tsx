"use client";

import { Lock, LockOpen, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  isLocked: boolean;
  onSetLocked: (locked: boolean) => Promise<boolean>;
  onClose: () => Promise<boolean>;
}

/** Controles del anfitrión de la Fase 3: bloquear la sala y cerrarla. (Silenciar y expulsar llegan con el audio, Fase 4.) */
export function HostControls({ isLocked, onSetLocked, onClose }: Props) {
  const t = useTranslations("Room.host");
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <section aria-label={t("title")} className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface p-3">
      <Button size="sm" variant="secondary" onClick={() => onSetLocked(!isLocked)} aria-pressed={isLocked}>
        {isLocked ? <LockOpen className="size-4" aria-hidden="true" /> : <Lock className="size-4" aria-hidden="true" />}
        {isLocked ? t("unlock") : t("lock")}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => dialogRef.current?.showModal()}>
        <XCircle className="size-4" aria-hidden="true" />
        {t("close")}
      </Button>
      {isLocked ? <p className="w-full text-xs text-muted-foreground">{t("locked")}</p> : null}

      <dialog
        ref={dialogRef}
        aria-labelledby="close-room-title"
        className="dark m-auto w-[min(92vw,26rem)] rounded-3xl border border-border bg-brand-navy-800 p-0 text-foreground backdrop:bg-black/70"
      >
        <form method="dialog" className="flex flex-col gap-5 p-6">
          <div>
            <h2 id="close-room-title" className="font-heading text-xl font-extrabold">
              {t("closeTitle")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("closeBody")}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button type="submit" size="md" variant="danger" onClick={() => void onClose()}>
              {t("closeConfirm")}
            </Button>
            <Button type="submit" size="md" variant="secondary">
              {t("cancel")}
            </Button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
