"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import {
  COMMUNITY_KINDS,
  communityFormSchema,
  parseInviteToken,
  toCommunityError,
  type CommunityErrorKey,
  type CommunityKind,
} from "@/features/communities/schemas";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";

/** Crear una comunidad o unirse con un enlace/código. Las reglas viven en la base (create_community, join_community). */
export function CommunityForms() {
  const t = useTranslations("Communities");
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [name, setName] = useState("");
  const [kind, setKind] = useState<CommunityKind>("church");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<CommunityErrorKey | null>(null);

  const [invite, setInvite] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<CommunityErrorKey | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const parsed = communityFormSchema.safeParse({ name, kind, description });
    if (!parsed.success) return setCreateError(toCommunityError({ message: parsed.error.issues[0]?.message }));

    setCreating(true);
    setCreateError(null);
    const { data, error } = await supabase.rpc("create_community", {
      p_name: parsed.data.name,
      p_kind: parsed.data.kind,
      p_description: parsed.data.description,
    });
    setCreating(false);
    if (error || !data) return setCreateError(toCommunityError(error));
    router.push(`/comunidades/${data}`);
    router.refresh(); // el diseño (pestañas) se vuelve a leer: aparece Comunidades
  }

  async function join(event: React.FormEvent) {
    event.preventDefault();
    const token = parseInviteToken(invite);
    if (!token) return setJoinError("community_not_found");

    setJoining(true);
    setJoinError(null);
    const { data, error } = await supabase.rpc("join_community", { p_token: token });
    setJoining(false);
    if (error || !data) return setJoinError(toCommunityError(error));
    router.push(`/comunidades/${data}`);
    router.refresh(); // el diseño (pestañas) se vuelve a leer: aparece Comunidades
  }

  return (
    <>
      <form onSubmit={create} className="flex flex-col gap-4 rounded-3xl bg-background p-5 shadow-sm ring-1 ring-border" noValidate>
        <h2 className="font-heading text-lg font-extrabold">{t("create.title")}</h2>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="community-name" className="text-sm font-semibold">
            {t("create.name")}
          </label>
          <Input id="community-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t("create.namePlaceholder")} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="community-kind" className="text-sm font-semibold">
            {t("create.kind")}
          </label>
          <select
            id="community-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as CommunityKind)}
            className="min-h-12 rounded-2xl border border-border bg-surface px-4 text-base"
          >
            {COMMUNITY_KINDS.map((key) => (
              <option key={key} value={key}>
                {t(`kinds.${key}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="community-description" className="text-sm font-semibold">
            {t("create.description")}
          </label>
          <Textarea id="community-description" rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {createError ? (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {t(`errors.${createError}`)}
          </p>
        ) : null}
        <Button type="submit" size="md" className="self-start" disabled={creating} aria-busy={creating}>
          {creating ? t("create.submitting") : t("create.submit")}
        </Button>
      </form>

      <form onSubmit={join} className="flex flex-col gap-4 rounded-3xl bg-background p-5 shadow-sm ring-1 ring-border" noValidate>
        <h2 className="font-heading text-lg font-extrabold">{t("join.title")}</h2>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="community-invite" className="text-sm font-semibold">
            {t("join.label")}
          </label>
          <Input id="community-invite" value={invite} onChange={(e) => setInvite(e.target.value)} placeholder={t("join.placeholder")} autoComplete="off" required />
        </div>
        {joinError ? (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {t(`errors.${joinError}`)}
          </p>
        ) : null}
        <Button type="submit" size="md" variant="secondary" className="self-start text-foreground" disabled={joining} aria-busy={joining}>
          {joining ? t("join.submitting") : t("join.submit")}
        </Button>
      </form>
    </>
  );
}
