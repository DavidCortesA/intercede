"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { extractRoomCode } from "@/features/rooms/schemas";
import { useRouter } from "@/i18n/navigation";

/** Para quien ya tiene un código o un enlace: lo normaliza y lleva a la sala. */
export function JoinByCodeForm() {
  const t = useTranslations("Pray");
  const errors = useTranslations("Room.errors");
  const router = useRouter();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = extractRoomCode(value);
    if (!code) return setInvalid(true);
    router.push(`/r/${code}`);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 text-left" noValidate>
      <label htmlFor="join-code" className="font-heading text-sm font-bold">
        {t("codeLabel")}
      </label>
      <div className="flex gap-2">
        <Input
          id="join-code"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setInvalid(false);
          }}
          placeholder={t("codePlaceholder")}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? "code-error" : undefined}
        />
        <Button type="submit" variant="secondary" size="md" disabled={value.trim().length === 0}>
          {t("join")}
        </Button>
      </div>
      {invalid ? (
        <p id="code-error" role="alert" className="text-sm text-destructive">
          {errors("room_not_found")}
        </p>
      ) : null}
    </form>
  );
}
