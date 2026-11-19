"use client";

import { Check, Copy, ExternalLink, MonitorPlay } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/**
 * Enlace de pantalla para proyectar la sala en el templo (CLAUDE.md §16 B4). Solo quien anfitriona lo ve y lo maneja.
 * Es secreto y revocable: generar otro invalida el anterior. La pantalla no entra a la sala ni usa audio.
 */
export function DisplayLink({ roomId, roomCode }: { roomId: string; roomCode: string }) {
  const t = useTranslations("Room.display");
  const locale = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const url = token ? `${window.location.origin}/${locale}/r/${roomCode}/display?t=${encodeURIComponent(token)}` : "";

  async function open() {
    dialogRef.current?.showModal();
    if (loaded) return;
    const { data } = await createClient().from("room_display_links").select("token").eq("room_id", roomId).maybeSingle();
    setToken(data?.token ?? null);
    setLoaded(true);
  }

  async function generate() {
    setBusy(true);
    setFailed(false);
    const { data, error } = await createClient().rpc("create_display_link", { p_room_id: roomId });
    setBusy(false);
    if (error || !data) return setFailed(true);
    setToken(data);
  }

  async function revoke() {
    setBusy(true);
    setFailed(false);
    const { error } = await createClient().rpc("revoke_display_link", { p_room_id: roomId });
    setBusy(false);
    if (error) return setFailed(true);
    setToken(null);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setFailed(true);
    }
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => void open()}>
        <MonitorPlay className="size-4" aria-hidden="true" />
        {t("button")}
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby="display-link-title"
        className="dark m-auto w-[min(94vw,28rem)] rounded-3xl border border-border bg-brand-navy-800 p-0 text-foreground backdrop:bg-black/70"
      >
        <div className="flex max-h-[88dvh] flex-col gap-4 overflow-y-auto p-6">
          <div>
            <h2 id="display-link-title" className="font-heading text-xl font-extrabold">
              {t("title")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("body")}</p>
          </div>

          {!loaded ? (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          ) : token ? (
            <>
              <p className="rounded-xl bg-surface px-3 py-2 font-mono text-xs break-all" data-testid="display-url">
                {url}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => void copy()} aria-live="polite">
                  {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                  {copied ? t("copied") : t("copy")}
                </Button>
                <a href={url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: "sm" })}>
                  <ExternalLink className="size-4" aria-hidden="true" />
                  {t("open")}
                </a>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void generate()}>
                  {t("renew")}
                </Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void revoke()}>
                  {t("revoke")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("privacy")}</p>
            </>
          ) : (
            <Button size="md" disabled={busy} onClick={() => void generate()}>
              {t("generate")}
            </Button>
          )}

          {failed ? (
            <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {t("error")}
            </p>
          ) : null}

          <Button size="md" variant="secondary" onClick={() => dialogRef.current?.close()}>
            {t("close")}
          </Button>
        </div>
      </dialog>
    </>
  );
}
