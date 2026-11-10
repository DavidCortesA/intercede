"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormError, FormField } from "@/components/ui/form-field";
import { requestPasswordResetAction, type AuthActionState } from "@/features/auth/account-actions";
import { Link } from "@/i18n/navigation";

const INITIAL: AuthActionState = {};

export function RecoverForm() {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, INITIAL);

  if (state.done === "reset_sent") {
    return (
      <div className="flex flex-col gap-4 text-center" role="status">
        <h2 className="font-heading text-2xl font-extrabold">{t("recover.sentTitle")}</h2>
        <p className="leading-relaxed">{t("recover.sentBody", { email: state.email ?? "" })}</p>
        <Link href="/entrar" className={buttonVariants({ variant: "secondary", size: "md" })}>
          {t("recover.back")}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="locale" value={locale} />
      <FormField
        id="recover-email"
        name="email"
        type="email"
        label={t("email")}
        placeholder={t("emailPlaceholder")}
        autoComplete="email"
        required
      />
      {state.error ? <FormError>{t(`errors.${state.error}`)}</FormError> : null}
      <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
        {pending ? t("recover.submitting") : t("recover.submit")}
      </Button>
    </form>
  );
}
