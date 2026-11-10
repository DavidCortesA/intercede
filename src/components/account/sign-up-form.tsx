"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormError, FormField } from "@/components/ui/form-field";
import { signUpAction, type AuthActionState } from "@/features/auth/account-actions";
import { Link } from "@/i18n/navigation";

const INITIAL: AuthActionState = {};

/**
 * Crear cuenta. Si la persona ya está orando como invitada no se le pide el nombre (ya lo tiene)
 * y su mismo usuario se convierte en cuenta: conserva su historial.
 */
export function SignUpForm({ isGuest }: { isGuest: boolean }) {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(signUpAction, INITIAL);

  if (state.done === "check_email") {
    return (
      <div className="flex flex-col gap-4 text-center" role="status">
        <h2 className="font-heading text-2xl font-extrabold">{t("checkEmail.title")}</h2>
        <p className="leading-relaxed">{t("checkEmail.body", { email: state.email ?? "" })}</p>
        <p className="text-sm text-muted-foreground">{t("checkEmail.spam")}</p>
        <Link href="/" className={buttonVariants({ variant: "secondary", size: "md" })}>
          {t("checkEmail.back")}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="locale" value={locale} />
      {isGuest ? null : (
        <FormField id="signup-name" name="displayName" label={t("name")} autoComplete="given-name" autoCapitalize="words" maxLength={40} />
      )}
      <FormField
        id="signup-email"
        name="email"
        type="email"
        label={t("email")}
        placeholder={t("emailPlaceholder")}
        autoComplete="email"
        required
      />
      <FormField
        id="signup-password"
        name="password"
        type="password"
        label={t("password")}
        hint={t("passwordHint")}
        autoComplete="new-password"
        minLength={8}
        required
      />
      {state.error ? <FormError>{t(`errors.${state.error}`)}</FormError> : null}
      <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
        {pending ? t("signUp.submitting") : t("signUp.submit")}
      </Button>
    </form>
  );
}
