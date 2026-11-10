"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Textarea } from "@/components/ui/input";
import { REQUEST_MAX_LENGTH, requestContentSchema } from "@/features/rooms/schemas";

const formSchema = z.object({ content: requestContentSchema });
type FormValues = z.input<typeof formSchema>;

/** Escribir y compartir una petición con la sala (se valida igual que en la base: 1 a 500 caracteres). */
export function RequestComposer({ onSubmit }: { onSubmit: (content: string) => Promise<boolean> }) {
  const t = useTranslations("Room.requests");
  const errors = useTranslations("Room.errors");
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors: formErrors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: { content: "" } });

  const length = (useWatch({ control, name: "content" }) ?? "").length;
  const errorCode = formErrors.content?.message;

  const submit = handleSubmit(async ({ content }) => {
    if (await onSubmit(content)) reset();
  });

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
      <label htmlFor="request-content" className="sr-only">
        {t("label")}
      </label>
      <div className="flex items-end gap-2">
        <Textarea
          id="request-content"
          rows={2}
          maxLength={REQUEST_MAX_LENGTH}
          placeholder={t("placeholder")}
          aria-invalid={errorCode ? true : undefined}
          aria-describedby={errorCode ? "request-error" : undefined}
          className="max-h-32 min-h-12 flex-1 rounded-3xl"
          onKeyDown={(event) => {
            // Enter envía; Mayús+Enter agrega una línea
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          {...register("content")}
        />
        <button
          type="submit"
          disabled={isSubmitting || length === 0}
          aria-label={isSubmitting ? t("sending") : t("send")}
          className="bg-brand-gradient grid size-12 shrink-0 cursor-pointer place-items-center rounded-full text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="size-5" aria-hidden="true" />
        </button>
      </div>
      <div className="flex justify-between px-2 text-xs text-muted-foreground">
        <span id="request-error" role={errorCode ? "alert" : undefined} className="text-destructive">
          {errorCode ? errors(errorCode as "request_empty" | "request_too_long") : ""}
        </span>
        {length > REQUEST_MAX_LENGTH * 0.8 ? <span>{t("counter", { count: length, max: REQUEST_MAX_LENGTH })}</span> : null}
      </div>
    </form>
  );
}
