import type { ComponentProps, ReactNode } from "react";
import { Input } from "./input";

interface Props extends Omit<ComponentProps<typeof Input>, "id" | "name"> {
  id: string;
  name: string;
  label: string;
  hint?: ReactNode;
  error?: string;
}

/** Etiqueta + campo + ayuda + error enlazados para lectores de pantalla. */
export function FormField({ id, name, label, hint, error, ...inputProps }: Props) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-heading text-sm font-bold">
        {label}
      </label>
      <Input id={id} name={name} aria-describedby={describedBy} aria-invalid={error ? true : undefined} {...inputProps} />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Aviso de error de un formulario (arriba del botón). */
export function FormError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="rounded-xl bg-destructive/15 px-4 py-3 text-sm text-destructive">
      {children}
    </p>
  );
}
