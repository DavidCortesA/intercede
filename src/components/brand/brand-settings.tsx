"use client";

import { Palette } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { contrastRatio, BACKGROUND_HEX, ensureAccessibleAccent, normalizeHex } from "@/features/brand/contrast";
import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";

const ERROR_KEYS = ["generic", "not_admin", "plan_required", "invalid_name", "reserved_name", "name_taken", "invalid_accent", "low_contrast"] as const;
type ErrorKey = (typeof ERROR_KEYS)[number];
const toErrorKey = (message: string | undefined): ErrorKey => ((ERROR_KEYS as readonly string[]).includes(message ?? "") ? (message as ErrorKey) : "generic");

interface Props {
  communityId: string;
  communityName: string;
  /** ¿El plan incluye marca (Pro)? */
  canBrand: boolean;
  initial: { displayName: string | null; accent: string } | null;
}

const DEFAULT_ACCENT = "#5b2ee6";

/**
 * Marca de la comunidad (plan Pro): nombre visible y color de acento. La persona elige el color y se le muestra cómo quedará
 * con el contraste exigido (AA): si no pasa, se oscurece de a poco, y lo que se envía ya es accesible. La base lo vuelve a
 * comprobar y también rechaza nombres que suplanten a INTERCEDE o a otra comunidad.
 */
export function BrandSettings({ communityId, communityName, canBrand, initial }: Props) {
  const t = useTranslations("Brand");
  const errors = useTranslations("Brand.errors");
  const router = useRouter();
  const [name, setName] = useState(initial?.displayName ?? "");
  const [rawAccent, setRawAccent] = useState(initial?.accent ?? DEFAULT_ACCENT);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);

  const typed = normalizeHex(rawAccent);
  const check = typed ? ensureAccessibleAccent(typed) : null;
  const shownName = name.trim() || communityName;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!check) return setError("invalid_accent");
    setBusy(true);
    setError(null);
    setSaved(false);
    const { error: failure } = await createClient().rpc("set_community_brand", { p_community_id: communityId, p_display_name: name.trim() as string, p_accent: check.hex });
    setBusy(false);
    if (failure) return setError(toErrorKey(failure.message));
    setRawAccent(check.hex);
    setSaved(true);
    router.refresh();
  }

  async function clear() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const { error: failure } = await createClient().rpc("clear_community_brand", { p_community_id: communityId });
    setBusy(false);
    if (failure) return setError(toErrorKey(failure.message));
    setName("");
    setRawAccent(DEFAULT_ACCENT);
    router.refresh();
  }

  return (
    <section aria-labelledby="brand-title" className="flex flex-col gap-4 rounded-3xl bg-background p-6 shadow-sm ring-1 ring-border">
      <div>
        <h2 id="brand-title" className="flex items-center gap-2 font-heading text-lg font-extrabold">
          <Palette className="size-5 text-primary-text" aria-hidden="true" />
          {t("title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("intro")}</p>
      </div>

      {!canBrand ? (
        <div className="flex flex-col items-start gap-3">
          <p role="status" className="rounded-2xl bg-surface px-4 py-3 text-sm">
            {t("proOnly")}
          </p>
          <Link href={`/comunidades/${communityId}/facturacion`} className="text-sm font-semibold underline underline-offset-4">
            {t("seePlans")}
          </Link>
        </div>
      ) : (
        <form onSubmit={save} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="brand-name" className="text-sm font-semibold">
              {t("nameLabel")}
            </label>
            <Input id="brand-name" value={name} maxLength={40} placeholder={communityName} onChange={(e) => setName(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t("nameHelp")}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="brand-accent" className="text-sm font-semibold">
              {t("accentLabel")}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                aria-label={t("picker")}
                value={typed ?? DEFAULT_ACCENT}
                onChange={(e) => setRawAccent(e.target.value)}
                className="size-12 cursor-pointer rounded-xl border border-border bg-background p-1"
              />
              <Input id="brand-accent" value={rawAccent} maxLength={7} onChange={(e) => setRawAccent(e.target.value)} className="max-w-36 font-mono" spellCheck={false} />
            </div>
            {!check ? (
              <p role="alert" className="text-sm text-destructive">
                {errors("invalid_accent")}
              </p>
            ) : check.adjusted ? (
              <p role="status" className="text-sm" data-testid="brand-adjusted">
                {t("adjusted", { color: check.hex.toUpperCase(), ratio: check.ratio.toFixed(1) })}
              </p>
            ) : (
              <p role="status" className="text-sm text-muted-foreground">
                {t("contrastOk", { ratio: contrastRatio(BACKGROUND_HEX, check.hex).toFixed(1) })}
              </p>
            )}
          </div>

          {/* Vista previa con el color que de verdad se guardará */}
          {check ? (
            <div className="flex flex-col gap-3 rounded-2xl p-4 ring-1 ring-border" style={{ backgroundColor: BACKGROUND_HEX }} aria-label={t("preview")} role="group">
              <p className="font-heading text-lg font-extrabold" style={{ color: "#0a1240" }}>
                {shownName}
              </p>
              <span className="inline-flex min-h-11 w-fit items-center rounded-full px-5 font-heading font-bold text-white" style={{ backgroundColor: check.hex }} data-testid="brand-preview-button">
                {t("previewButton")}
              </span>
              <p className="text-xs" style={{ color: "#4b5563" }}>
                {t("poweredBy")}
              </p>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {errors(error)}
            </p>
          ) : null}
          {saved ? (
            <p role="status" className="text-sm font-semibold text-success">
              {t("saved")}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="md" disabled={busy || !check}>
              {busy ? t("saving") : t("save")}
            </Button>
            {initial ? (
              <Button type="button" size="md" variant="secondary" className="text-foreground" disabled={busy} onClick={() => void clear()}>
                {t("clear")}
              </Button>
            ) : null}
          </div>
        </form>
      )}
    </section>
  );
}
