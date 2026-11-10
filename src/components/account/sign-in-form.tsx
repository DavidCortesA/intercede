"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";
import { Turnstile } from "@/components/shared/turnstile";
import { Button } from "@/components/ui/button";
import { FormError, FormField } from "@/components/ui/form-field";
import { signInAction, type AuthActionState } from "@/features/auth/account-actions";
import { Link } from "@/i18n/navigation";

const INITIAL: AuthActionState = {};

export function SignInForm({ next, showGuestWarning }: { next: string; showGuestWarning: boolean }) {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(signInAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="next" value={next} />
      <FormField
        id="signin-email"
        name="email"
        type="email"
        label={t("email")}
        placeholder={t("emailPlaceholder")}
        autoComplete="email"
        required
      />
      <FormField id="signin-password" name="password" type="password" label={t("password")} autoComplete="current-password" required />
      <Turnstile resetKey={state} />
      {state.error ? <FormError>{t(`errors.${state.error}`)}</FormError> : null}
      <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
        {pending ? t("signIn.submitting") : t("signIn.submit")}
      </Button>
      <Link href="/recuperar" className="text-center text-sm font-semibold text-primary-text underline-offset-4 hover:underline">
        {t("signIn.forgot")}
      </Link>
      {showGuestWarning ? <p className="rounded-xl bg-muted px-4 py-3 text-xs text-muted-foreground">{t("signIn.guestWarning")}</p> : null}
    </form>
  );
}
