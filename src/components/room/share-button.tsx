"use client";

import { Check, Copy, Maximize2, MessageCircle, QrCode as QrIcon, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { QrCode } from "@/components/shared/qr-code";
import { Button, buttonVariants } from "@/components/ui/button";
import { cleanRoomUrl, defaultShareMessage, SHARE_MESSAGE_MAX, whatsappUrl } from "@/features/rooms/share";

/**
 * Compartir la sala (CLAUDE.md §16 A1): hoja nativa del celular, WhatsApp con un mensaje editable, copiar el enlace y
 * un código QR a pantalla completa para proyectarlo. El mensaje nunca lleva peticiones ni datos personales.
 */
export function ShareButton({ roomName }: { roomName: string }) {
  const t = useTranslations("Room.share");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const qrRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  function open() {
    const clean = cleanRoomUrl(window.location.href);
    setUrl(clean);
    setMessage(defaultShareMessage(clean));
    setCanShare(typeof navigator.share === "function");
    setShowQr(false);
    dialogRef.current?.showModal();
  }

  async function nativeShare() {
    try {
      await navigator.share({ title: roomName, text: message, url });
    } catch {
      // Cancelar la hoja de compartir lanza AbortError: no es un error para la persona.
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Sin permiso del portapapeles: el enlace sigue visible en el mensaje para copiarlo a mano
    }
  }

  async function fullscreen() {
    try {
      await qrRef.current?.requestFullscreen();
    } catch {
      // Algunos navegadores móviles no permiten pantalla completa: el QR ya es grande en el diálogo
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={open}>
        <Share2 className="size-4" aria-hidden="true" />
        {/* En pantallas pequeñas solo el ícono; el texto sigue disponible para lectores de pantalla */}
        <span className="sr-only sm:not-sr-only">{t("button")}</span>
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby="share-room-title"
        className="dark m-auto w-[min(94vw,28rem)] rounded-3xl border border-border bg-brand-navy-800 p-0 text-foreground backdrop:bg-black/70"
      >
        <div className="flex max-h-[88dvh] flex-col gap-4 overflow-y-auto p-6">
          <h2 id="share-room-title" className="font-heading text-xl font-extrabold">
            {t("title")}
          </h2>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="share-message" className="text-sm font-semibold">
              {t("messageLabel")}
            </label>
            <textarea
              id="share-message"
              value={message}
              maxLength={SHARE_MESSAGE_MAX}
              rows={3}
              onChange={(event) => setMessage(event.target.value)}
              className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-sm"
            />
            <p className="text-xs text-muted-foreground">{t("privacyNote")}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {canShare ? (
              <Button size="sm" onClick={() => void nativeShare()}>
                <Share2 className="size-4" aria-hidden="true" />
                {t("native")}
              </Button>
            ) : null}
            <a href={whatsappUrl(message)} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: "sm", variant: canShare ? "secondary" : "primary" })}>
              <MessageCircle className="size-4" aria-hidden="true" />
              {t("whatsapp")}
            </a>
            <Button size="sm" variant="secondary" onClick={() => void copyLink()} aria-live="polite">
              {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
              {copied ? t("copied") : t("copy")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setShowQr((value) => !value)} aria-expanded={showQr}>
              <QrIcon className="size-4" aria-hidden="true" />
              {t("qr")}
            </Button>
          </div>

          {showQr ? (
            <div ref={qrRef} className="flex flex-col items-center gap-3 rounded-2xl bg-brand-navy-900 p-4 [&:fullscreen]:justify-center [&:fullscreen]:p-8">
              <QrCode value={url} label={t("qrLabel")} className="w-full max-w-72 [:fullscreen_&]:max-w-[min(80vh,80vw)]" />
              <p className="text-center text-sm text-muted-foreground">{t("qrHelp")}</p>
              <Button size="sm" variant="secondary" onClick={() => void fullscreen()}>
                <Maximize2 className="size-4" aria-hidden="true" />
                {t("fullscreen")}
              </Button>
            </div>
          ) : null}

          <Button variant="secondary" size="md" onClick={() => dialogRef.current?.close()}>
            {t("close")}
          </Button>
        </div>
      </dialog>
    </>
  );
}
