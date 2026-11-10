"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormError, FormField } from "@/components/ui/form-field";
import { updatePasswordAction, type AuthActionState } from "@/features/auth/account-actions";
import { Link } from "@/i18n/navigation";

const INITIAL: AuthActionState = {};

/** Elegir una contraseña nueva (tras el enlace de recuperación o desde el perfil). */
export function PasswordForm({ variant }: { variant: "reset" | "profile" }) {
  const t = useTranslations("Auth");
  const account = useTranslations("Account");
  const [state, formAction, pending] = useActionState(updatePasswordAction, INITIAL);
  const done = state.done === "password_updated";

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormField
        id={`${variant}-password`}
        name="password"
        type="password"
        label={t("newPassword")}
        hint={t("passwordHint")}
        autoComplete="new-password"
        minLength={8}
        required
      />
      <FormField id={`${variant}-confirm`} name="confirm" type="password" label={t("confirmPassword")} autoComplete="new-password" required />
      {state.error ? <FormError>{t(`errors.${state.error}`)}</FormError> : null}
      {done ? (
        <p role="status" className="rounded-xl bg-success/15 px-4 py-3 text-sm font-semibold text-success">
          {t("reset.done")}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
        {pending ? t("reset.submitting") : variant === "reset" ? t("reset.submit") : account("password.submit")}
      </Button>
      {done && variant === "reset" ? (
        <Link href="/orar" className={buttonVariants({ variant: "secondary", size: "md" })}>
          {t("reset.continue")}
        </Link>
      ) : null}
    </form>
  );
}
