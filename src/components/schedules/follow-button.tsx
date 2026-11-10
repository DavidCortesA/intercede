"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";

/** Botón "Seguir esta sala" de la pantalla de invitación. La base valida el token y que sea una cuenta. */
export function FollowButton({ token }: { token: string }) {
  const t = useTranslations("Invite");
  const [supabase] = useState(() => createClient());
  const [state, setState] = useState<"idle" | "busy" | "done" | "failed">("idle");

  async function follow() {
    setState("busy");
    const { error } = await supabase.rpc("subscribe_to_schedule", { p_token: token });
    setState(error ? "failed" : "done");
  }

  if (state === "done") {
    return (
      <div className="flex flex-col items-start gap-4">
        <p role="status" className="font-semibold text-success">
          {t("done")}
        </p>
        <Link href="/programadas" className={buttonVariants({ size: "md" })}>
          {t("seeAll")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <Button size="lg" onClick={follow} disabled={state === "busy"} aria-busy={state === "busy"}>
        {state === "busy" ? t("following") : t("follow")}
      </Button>
      {state === "failed" ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t("errors.generic")}
        </p>
      ) : null}
    </div>
  );
}
