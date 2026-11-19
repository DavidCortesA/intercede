"use client";

import { Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { BuyButton } from "@/components/billing/buy-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { roomClock } from "@/features/billing/limits";
import { formatMxn } from "@/features/billing/schemas";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Room } from "@/features/rooms/types";

type PassCode = "sala_larga" | "vigilia" | "vigilia_grande" | "extension";
interface Option {
  code: PassCode;
  price: number;
}
interface MyPass {
  id: string;
  product_code: string;
}

const CODES: readonly PassCode[] = ["extension", "sala_larga", "vigilia", "vigilia_grande"];

/** Hora actual que se refresca sola (cada 15 s basta para avisos de minutos). */
function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Aviso del límite de tiempo de la sala (CLAUDE.md §14.8): a 10 y a 2 minutos del final, y durante la gracia de 5
 * minutos. Nunca se corta una oración sin aviso. El anfitrión puede ampliar la sala con un pase; el cambio llega a
 * todos por Realtime (la fila de la sala se actualiza). El cierre real lo hace el servidor.
 */
export function RoomLimit({ room, isHost, isAnonymous }: { room: Room; isHost: boolean; isAnonymous: boolean }) {
  const t = useTranslations("Room.limit");
  const billing = useTranslations("Billing");
  const now = useNow();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Option[]>([]);
  const [passes, setPasses] = useState<MyPass[]>([]);
  const [loading, setLoading] = useState(false);
  const [usingPass, setUsingPass] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const clock = roomClock(new Date(room.ends_at).getTime(), now);

  // Al abrir el diálogo se leen los pases y precios (como la persona: RLS)
  useEffect(() => {
    if (!open || isAnonymous) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const supabase = createClient();
      const [{ data: products }, { data: mine }, entitlements] = await Promise.all([
        supabase.from("products").select("code, price_mxn, org_price_mxn").eq("kind", "pass"),
        supabase.from("passes").select("id, product_code, community_id").eq("status", "available"),
        room.community_id ? supabase.rpc("get_entitlements", { p_community_id: room.community_id }) : Promise.resolve({ data: null }),
      ]);
      if (cancelled) return;
      const plan = (entitlements.data as { plan?: string } | null)?.plan;
      const paidOrg = plan === "plus" || plan === "pro";
      setOptions(
        CODES.flatMap((code) => {
          const row = products?.find((p) => p.code === code);
          return row ? [{ code, price: paidOrg && row.org_price_mxn ? row.org_price_mxn : row.price_mxn }] : [];
        }),
      );
      setPasses(
        (mine ?? [])
          .filter((p) => p.community_id === null || p.community_id === room.community_id)
          .map((p) => ({ id: p.id, product_code: p.product_code })),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isAnonymous, room.community_id]);

  function show() {
    setOpen(true);
    setError(false);
    dialogRef.current?.showModal();
  }

  async function applyPass(passId: string) {
    setUsingPass(passId);
    setError(false);
    const { error: rpcError } = await createClient().rpc("apply_pass", { p_pass_id: passId, p_room_id: room.id });
    setUsingPass(null);
    if (rpcError) {
      setError(true);
      return;
    }
    dialogRef.current?.close();
  }

  if (clock.phase === "ok" && !open) return null;

  const message =
    clock.phase === "warning"
      ? t("warning", { minutes: clock.minutesLeft })
      : clock.phase === "urgent"
        ? t("urgent", { minutes: clock.minutesLeft })
        : clock.phase === "grace"
          ? t("grace", { minutes: clock.graceMinutesLeft })
          : null;

  return (
    <>
      {message ? (
        <div role="status" className="flex flex-wrap items-center gap-3 border-b border-brand-gold/40 bg-brand-gold/10 px-4 py-2.5 text-sm">
          <Clock className="size-4 shrink-0 text-brand-gold" aria-hidden="true" />
          <p className="min-w-0 flex-1">{message}</p>
          {isHost ? (
            <Button size="sm" onClick={show}>
              {t("extend")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <dialog
        ref={dialogRef}
        aria-labelledby="extend-room-title"
        onClose={() => setOpen(false)}
        className="dark m-auto w-[min(94vw,30rem)] rounded-3xl border border-border bg-brand-navy-800 p-0 text-foreground backdrop:bg-black/70"
      >
        <div className="flex max-h-[85dvh] flex-col gap-5 overflow-y-auto p-6">
          <div>
            <h2 id="extend-room-title" className="font-heading text-xl font-extrabold">
              {t("extendTitle")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("extendBody")}</p>
          </div>

          {isAnonymous ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-muted-foreground">{t("guestNote")}</p>
              <Link href="/registro" className={buttonVariants({ size: "sm" })}>
                {t("createAccount")}
              </Link>
            </div>
          ) : loading ? (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          ) : (
            <>
              <section aria-labelledby="my-passes" className="flex flex-col gap-2">
                <h3 id="my-passes" className="text-sm font-bold">
                  {t("yourPasses")}
                </h3>
                {passes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("noPasses")}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {passes.map((pass) => (
                      <li key={pass.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface px-4 py-2">
                        <span className="font-semibold">{billing(`products.${pass.product_code as PassCode}.name`)}</span>
                        <Button size="sm" onClick={() => void applyPass(pass.id)} disabled={usingPass !== null}>
                          {usingPass === pass.id ? t("using") : t("use")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section aria-labelledby="buy-passes" className="flex flex-col gap-3">
                <h3 id="buy-passes" className="text-sm font-bold">
                  {t("buyTitle")}
                </h3>
                <ul className="flex flex-col gap-3">
                  {options.map((option) => (
                    <li key={option.code} className="flex flex-col gap-2 rounded-xl bg-surface p-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-heading font-bold">{billing(`products.${option.code}.name`)}</span>
                        <span className="tabular-nums">{formatMxn(option.price)}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{billing(`products.${option.code}.desc`)}</p>
                      <BuyButton
                        purchase={{ kind: "pass", code: option.code, roomId: room.id, communityId: room.community_id ?? undefined }}
                        label={billing("pay")}
                        variant="secondary"
                      />
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">{billing("payMethods")}</p>
              </section>
            </>
          )}

          {error ? (
            <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {t("errors.generic")}
            </p>
          ) : null}

          <Button variant="secondary" size="md" onClick={() => dialogRef.current?.close()}>
            {t("close")}
          </Button>
        </div>
      </dialog>
    </>
  );
}
