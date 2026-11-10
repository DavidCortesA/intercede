"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Turnstile } from "@/components/shared/turnstile";
import { createRoomAction, type RoomActionState } from "@/features/rooms/actions";

const INITIAL: RoomActionState = {};

/** Un campo (tu nombre) y un botón: la sala se crea sin cuenta y sin configurar nada. */
export function CreateRoomForm({ initialName, needsCaptcha = true }: { initialName: string; needsCaptcha?: boolean }) {
  const t = useTranslations("Pray");
  const errors = useTranslations("Room.errors");
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(createRoomAction, INITIAL);
  const [name, setName] = useState(initialName);

  return (
    <form action={formAction} className="flex flex-col gap-4 text-left" noValidate>
      <input type="hidden" name="locale" value={locale} />
      <div className="flex flex-col gap-2">
        <label htmlFor="create-name" className="font-heading text-sm font-bold">
          {t("nameLabel")}
        </label>
        <Input
          id="create-name"
          name="displayName"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("namePlaceholder")}
          maxLength={40}
          autoComplete="given-name"
          autoCapitalize="words"
          aria-describedby={state.error ? "create-error" : "create-hint"}
          aria-invalid={state.error === "invalid_name" || undefined}
          required
        />
        <p id="create-hint" className="text-xs text-muted-foreground">
          {t("nameHint")}
        </p>
      </div>
      {needsCaptcha ? <Turnstile resetKey={state} /> : null}
      {state.error ? (
        <p id="create-error" role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errors(state.error)}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending || name.trim().length === 0} aria-busy={pending}>
        {pending ? t("creating") : t("create")}
      </Button>
    </form>
  );
}
