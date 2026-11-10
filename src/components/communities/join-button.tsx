"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toCommunityError, type CommunityErrorKey } from "@/features/communities/schemas";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";

/** Botón "Unirme a la comunidad" de la pantalla de invitación. La base valida el enlace y que sea una cuenta. */
export function JoinCommunityButton({ token }: { token: string }) {
  const t = useTranslations("CommunityInvite");
  const errors = useTranslations("Communities.errors");
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CommunityErrorKey | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    const { data, error: failure } = await supabase.rpc("join_community", { p_token: token });
    if (failure || !data) {
      setBusy(false);
      return setError(toCommunityError(failure));
    }
    router.push(`/comunidades/${data}`);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <Button size="lg" onClick={join} disabled={busy} aria-busy={busy}>
        {busy ? t("joining") : t("join")}
      </Button>
      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errors(error)}
        </p>
      ) : null}
    </div>
  );
}
