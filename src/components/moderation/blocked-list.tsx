"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Avatar } from "@/components/room/avatar";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export interface BlockedPerson {
  id: string;
  name: string | null;
  avatarUrl: string | null;
}

/** Las personas que bloqueaste (solo tú las ves) y el botón para desbloquear. */
export function BlockedList({ initial }: { initial: BlockedPerson[] }) {
  const t = useTranslations("Moderation.blocked");
  const errors = useTranslations("Moderation.errors");
  const [supabase] = useState(() => createClient());
  const [people, setPeople] = useState(initial);
  const [error, setError] = useState(false);

  async function unblock(id: string) {
    setError(false);
    const { error: failure } = await supabase.from("blocks").delete().eq("blocked_id", id);
    if (failure) return setError(true);
    setPeople((list) => list.filter((person) => person.id !== id));
  }

  return (
    <section aria-labelledby="blocked-title" className="flex flex-col gap-3 rounded-3xl bg-background p-6 shadow-sm ring-1 ring-border">
      <h2 id="blocked-title" className="font-heading text-lg font-extrabold">
        {t("title")}
      </h2>
      {people.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t("help")}</p>
          <ul className="flex flex-col gap-2">
            {people.map((person) => (
              <li key={person.id} className="flex items-center gap-3">
                <Avatar userId={person.id} name={person.name ?? "?"} src={person.avatarUrl} />
                <span className="min-w-0 flex-1 truncate font-semibold">{person.name ?? t("unknown")}</span>
                <Button size="sm" variant="secondary" className="text-foreground" onClick={() => unblock(person.id)}>
                  {t("unblock")}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {errors("generic")}
        </p>
      ) : null}
    </section>
  );
}
