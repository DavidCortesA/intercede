"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { startCheckout } from "@/features/billing/api";
import type { BillingErrorKey, CheckoutInput } from "@/features/billing/schemas";

interface Props {
  /** Qué se compra. El precio nunca viaja desde aquí: lo calcula la base. */
  purchase: CheckoutInput;
  label: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}

/** Botón de compra: crea la orden en el servidor y lleva a la persona a la página de pago de Conekta. */
export function BuyButton({ purchase, label, variant = "primary", size = "sm", className }: Props) {
  const t = useTranslations("Billing");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BillingErrorKey | null>(null);

  async function buy() {
    setBusy(true);
    setError(null);
    const result = await startCheckout(purchase);
    if (result.ok) {
      window.location.assign(result.url);
      return; // se queda "ocupado" mientras el navegador cambia de página
    }
    setError(result.error);
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant={variant} size={size} className={className} onClick={() => void buy()} disabled={busy} aria-busy={busy}>
        {busy ? t("paying") : label}
      </Button>
      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t(`errors.${error}`)}
        </p>
      ) : null}
    </div>
  );
}
