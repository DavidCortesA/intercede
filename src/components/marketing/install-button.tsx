"use client";

import { Share } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";

/** Evento no estándar de Chromium para instalar la PWA. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Platform = "ios" | "android" | "desktop";

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  // iPadOS 13+ se presenta como Mac con pantalla táctil
  const isIpadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (/iPad|iPhone|iPod/.test(ua) || isIpadOs) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia("(display-mode: standalone)").matches;
}

const noopSubscribe = () => () => {};

/**
 * Botón "Instalar la app". Si el navegador ofrece la instalación nativa (Chromium) la lanza;
 * si no (iOS Safari, Firefox, Safari de escritorio) abre una guía con los pasos de cada plataforma.
 * No se muestra si la app ya está instalada y abierta como aplicación.
 */
export function InstallButton(props: Pick<ButtonProps, "variant" | "size" | "className">) {
  const t = useTranslations("Install");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  // Lecturas del navegador sin romper la hidratación: en el servidor devuelven null/false.
  const platform = useSyncExternalStore<Platform | null>(noopSubscribe, detectPlatform, () => null);
  const standalone = useSyncExternalStore(noopSubscribe, isStandalone, () => false);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (standalone) return null;

  async function handleClick() {
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice;
      setDeferred(null);
      return;
    }
    dialogRef.current?.showModal();
  }

  const blocks: { key: string; title: string; steps: string[]; platform: Platform }[] = [
    { key: "ios", title: t("iosTitle"), steps: [t("ios1"), t("ios2"), t("ios3")], platform: "ios" },
    { key: "android", title: t("androidTitle"), steps: [t("android1"), t("android2")], platform: "android" },
    { key: "desktop", title: t("desktopTitle"), steps: [t("desktop1"), t("desktop2")], platform: "desktop" },
    { key: "safari", title: t("safariTitle"), steps: [t("safari1")], platform: "desktop" },
  ];
  // La plataforma detectada va primero
  const ordered = [...blocks].sort((a, b) => Number(b.platform === platform) - Number(a.platform === platform));

  return (
    <>
      <Button variant="secondary" size="lg" onClick={handleClick} {...props}>
        <Share className="size-5" aria-hidden="true" />
        {t("button")}
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby="install-title"
        className="dark m-auto w-[min(92vw,30rem)] rounded-3xl border border-border bg-brand-navy-800 p-0 text-foreground backdrop:bg-black/70"
      >
        <form method="dialog" className="flex max-h-[85dvh] flex-col gap-5 overflow-y-auto p-6 sm:p-8">
          <div>
            <h2 id="install-title" className="font-heading text-2xl font-extrabold">
              {t("dialogTitle")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("intro")}</p>
          </div>
          {ordered.map((block) => (
            <section key={block.key}>
              <h3 className="font-heading text-sm font-bold text-primary-text">{block.title}</h3>
              <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed">
                {block.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </section>
          ))}
          <Button type="submit" size="md" className="w-full">
            {t("close")}
          </Button>
        </form>
      </dialog>
    </>
  );
}
