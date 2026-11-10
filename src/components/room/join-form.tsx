"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { joinRoomAction, type RoomActionState } from "@/features/rooms/actions";

const INITIAL: RoomActionState = {};

/** Entrar a una sala con solo un nombre (sin cuenta). */
export function JoinForm({ code, suggestedName }: { code: string; suggestedName: string }) {
  const t = useTranslations("Room.join");
  const errors = useTranslations("Room.errors");
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(joinRoomAction, INITIAL);
  const [name, setName] = useState(suggestedName);

  return (
    <form action={formAction} className="flex flex-col gap-4 text-left" noValidate>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="code" value={code} />
      <div className="flex flex-col gap-2">
        <label htmlFor="join-name" className="font-heading text-sm font-bold">
          {t("nameLabel")}
        </label>
        <Input
          id="join-name"
          name="displayName"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("namePlaceholder")}
          maxLength={40}
          autoComplete="given-name"
          autoCapitalize="words"
          aria-describedby={state.error ? "join-error" : "join-hint"}
          aria-invalid={state.error === "invalid_name" || undefined}
          required
        />
        <p id="join-hint" className="text-xs text-muted-foreground">
          {t("hint")}
        </p>
      </div>
      {state.error ? (
        <p id="join-error" role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errors(state.error)}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending || name.trim().length === 0} aria-busy={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
