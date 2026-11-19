import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { formatMxn, type Entitlements } from "@/features/billing/schemas";
import type { OrderRow } from "@/features/billing/queries";
import { cn } from "@/lib/utils";

type Limits = Omit<Entitlements, "plan">;

/** Límites de un plan o de los límites efectivos de una comunidad (plan + extras). */
export function LimitsList({ limits, className }: { limits: Limits; className?: string }) {
  const t = useTranslations("Billing.limits");
  const rows: [string, string][] = [
    [t("members"), String(limits.max_members)],
    [t("rooms"), String(limits.max_concurrent_rooms)],
    [t("minutes"), t("minutesValue", { hours: limits.max_room_minutes / 60 })],
    [t("participants"), String(limits.max_room_participants)],
    [t("hours"), limits.included_person_hours === null ? t("hoursNone") : t("hoursValue", { count: limits.included_person_hours })],
    [t("cameras"), `${limits.max_cameras} · ${limits.camera_quality}`],
  ];
  return (
    <dl className={cn("grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2", className)}>
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-2">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Estado real de una orden (viene de la base: solo el webhook verificado la marca como pagada). */
export function OrderNotice({ order }: { order: OrderRow }) {
  const t = useTranslations("Billing.order");
  const status = (["paid", "pending", "expired", "failed", "canceled", "refunded"] as const).find((s) => s === order.status) ?? "failed";
  const good = status === "paid";
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-start gap-3 rounded-2xl px-5 py-4 text-sm",
        good ? "bg-success/10 text-foreground ring-1 ring-success/40" : "bg-surface text-foreground ring-1 ring-border",
      )}
    >
      <p className="font-semibold">{t(status)}</p>
      {status === "pending" && order.checkout_url ? (
        <a href={order.checkout_url} className={buttonVariants({ size: "sm", variant: "secondary" })}>
          {t("continuePay")}
        </a>
      ) : null}
    </div>
  );
}

/** Pagos recientes, de más nuevo a más viejo. */
export function OrdersList({ orders, empty }: { orders: OrderRow[]; empty: string }) {
  const t = useTranslations("Billing");
  const format = useFormatter();
  if (orders.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-border/60 rounded-2xl bg-background ring-1 ring-border">
      {orders.map((order) => {
        const name =
          order.kind === "plan"
            ? `${t(`plans.${order.item_code as "plus" | "pro"}.name`)} · ${order.billing_period === "annual" ? t("period.annual") : t("period.monthly")}`
            : t(`products.${order.item_code as "vigilia"}.name`) + (order.quantity > 1 ? ` × ${order.quantity}` : "");
        return (
          <li key={order.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
            <span className="font-semibold">{name}</span>
            <span className="text-muted-foreground">{format.dateTime(new Date(order.created_at), { dateStyle: "medium" })}</span>
            <span className="tabular-nums">{formatMxn(order.amount_mxn)}</span>
            <span className="rounded-full bg-surface px-3 py-0.5 text-xs font-semibold">
              {t(`order.statusLabel.${order.status as "pending"}`)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Tarjeta de un producto con su precio; el botón de compra va como hijo. */
export function ProductCard({
  code,
  price,
  priceNote,
  children,
}: {
  code: "sala_larga" | "vigilia" | "vigilia_grande" | "extension" | "members_50" | "rooms_5" | "hours_100";
  price: number;
  priceNote?: string;
  children?: ReactNode;
}) {
  const t = useTranslations("Billing");
  return (
    <li className="flex flex-col gap-3 rounded-2xl bg-background p-5 ring-1 ring-border">
      <div>
        <h3 className="font-heading text-lg font-bold">{t(`products.${code}.name`)}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t(`products.${code}.desc`)}</p>
      </div>
      <p className="font-heading text-2xl font-extrabold tabular-nums">
        {formatMxn(price)}
        {priceNote ? <span className="ml-2 text-sm font-semibold text-muted-foreground">{priceNote}</span> : null}
      </p>
      {children}
    </li>
  );
}
