"use client";

import { Check, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/** Comparte el enlace de la sala: hoja nativa del celular si existe; si no, copia al portapapeles. */
export function ShareButton({ roomName }: { roomName: string }) {
  const t = useTranslations("Room.header");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function share() {
    const url = window.location.href;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: roomName, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Cancelar la hoja de compartir lanza AbortError: no es un error para la persona.
    }
  }

  return (
    <Button variant="secondary" size="sm" onClick={share} aria-live="polite">
      {copied ? <Check className="size-4" aria-hidden="true" /> : <Share2 className="size-4" aria-hidden="true" />}
      {/* En pantallas pequeñas solo el ícono; el texto sigue disponible para lectores de pantalla */}
      <span className="sr-only sm:not-sr-only">{copied ? t("copied") : t("share")}</span>
    </Button>
  );
}
