"use client";

import { useTranslations } from "next-intl";
import { useActionState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { FormError, FormField } from "@/components/ui/form-field";
import { updateProfileAction, type AuthActionState } from "@/features/auth/account-actions";

const INITIAL: AuthActionState = {};

export function ProfileForm({
  defaultName,
  defaultTimezone,
  timezones,
}: {
  defaultName: string;
  defaultTimezone: string;
  timezones: string[];
}) {
  const t = useTranslations("Account");
  const auth = useTranslations("Auth");
  const [state, formAction, pending] = useActionState(updateProfileAction, INITIAL);
  const timezoneRef = useRef<HTMLSelectElement>(null);

  // Los perfiles nuevos parten de UTC: un botón evita buscar la zona a mano
  function useDeviceTimezone() {
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezoneRef.current && timezones.includes(device)) timezoneRef.current.value = device;
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormField id="profile-name" name="displayName" label={t("name")} hint={t("nameHelp")} defaultValue={defaultName} maxLength={40} autoComplete="given-name" required />

      <div className="flex flex-col gap-2">
        <label htmlFor="profile-timezone" className="font-heading text-sm font-bold">
          {t("timezone")}
        </label>
        <select
          id="profile-timezone"
          name="timezone"
          ref={timezoneRef}
          defaultValue={defaultTimezone}
          aria-describedby="profile-timezone-hint"
          className="min-h-12 w-full rounded-2xl border border-border bg-surface px-4 py-3 text-base text-surface-foreground focus-visible:border-ring"
        >
          {timezones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        <p id="profile-timezone-hint" className="text-xs text-muted-foreground">
          {t("timezoneHelp")}{" "}
          <button type="button" onClick={useDeviceTimezone} className="font-semibold text-primary-text underline underline-offset-2">
            {t("timezoneUseDevice")}
          </button>
        </p>
      </div>

      {state.error ? <FormError>{auth(`errors.${state.error}`)}</FormError> : null}
      {state.done === "saved" ? (
        <p role="status" className="rounded-xl bg-success/15 px-4 py-3 text-sm font-semibold text-success">
          {t("saved")}
        </p>
      ) : null}
      <Button type="submit" size="md" disabled={pending} aria-busy={pending}>
        {pending ? t("saving") : t("save")}
      </Button>
    </form>
  );
}
