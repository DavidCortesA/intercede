"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { Input } from "@/components/ui/input";
import { DELETE_CONFIRMATION } from "@/features/moderation/schemas";

type ErrorKey = "generic" | "invalid_password" | "confirmation";

/**
 * Eliminar la cuenta y todos sus datos. Pide escribir ELIMINAR y, si la cuenta tiene contraseña, la
 * contraseña (una sesión abierta en un equipo ajeno no debería bastar). La ruta del servidor hace el
 * trabajo con la service role; aquí solo se recoge la confirmación.
 */
export function DeleteAccountForm({ needsPassword, isGuest }: { needsPassword: boolean; isGuest: boolean }) {
  const t = useTranslations("Moderation.delete");
  const id = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (confirm.trim().toUpperCase() !== DELETE_CONFIRMATION) return setError("confirmation");
    setBusy(true);
    setError(null);
    const response = await fetch("/api/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm, password: needsPassword ? password : undefined }),
    }).catch(() => null);
    if (response?.ok) {
      // La sesión ya no existe: se vuelve al inicio y se vuelve a leer todo
      router.replace("/");
      router.refresh();
      return;
    }
    setBusy(false);
    const body: { error?: string } | null = await response?.json().catch(() => null) ?? null;
    setError(body?.error === "invalid_password" ? "invalid_password" : "generic");
  }

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3 rounded-3xl bg-background p-6 shadow-sm ring-1 ring-destructive/40">
      <h2 id={`${id}-title`} className="font-heading text-lg font-extrabold">
        {isGuest ? t("titleGuest") : t("title")}
      </h2>
      <p className="text-sm leading-relaxed text-muted-foreground">{t("body")}</p>
      {isGuest ? null : <p className="text-sm leading-relaxed text-muted-foreground">{t("bodyCommunities")}</p>}

      {open ? (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-confirm`} className="text-sm font-semibold">
              {t("confirmLabel")}
            </label>
            <Input id={`${id}-confirm`} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" autoCapitalize="characters" required />
          </div>
          {needsPassword ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-password`} className="text-sm font-semibold">
                {t("password")}
              </label>
              <Input id={`${id}-password`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {t(`errors.${error}`)}
            </p>
          ) : null}
          <Button type="submit" variant="danger" size="md" className="self-start" disabled={busy} aria-busy={busy}>
            {busy ? t("submitting") : t("submit")}
          </Button>
        </form>
      ) : (
        <Button variant="secondary" size="md" className="self-start text-destructive" onClick={() => setOpen(true)}>
          {t("open")}
        </Button>
      )}
    </section>
  );
}
