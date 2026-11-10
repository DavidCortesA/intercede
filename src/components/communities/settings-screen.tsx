"use client";

import { Camera, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { CommunityLogo } from "@/components/communities/community-logo";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import {
  COMMUNITY_KINDS,
  communityFormSchema,
  toCommunityError,
  type CommunityErrorKey,
  type CommunityKind,
} from "@/features/communities/schemas";
import type { Community } from "@/features/communities/types";
import { useRouter } from "@/i18n/navigation";
import { MAX_IMAGE_INPUT_BYTES, toSquareWebp } from "@/lib/image";
import { createClient } from "@/lib/supabase/client";

const BUCKET = "community-logos";

/** Ajustes de la comunidad (solo administración): datos, logo y eliminar. RLS y Storage deciden quién puede. */
export function SettingsScreen({ community }: { community: Community }) {
  const t = useTranslations("Communities.settings");
  const errors = useTranslations("Communities.errors");
  const kinds = useTranslations("Communities.kinds");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [supabase] = useState(() => createClient());

  const [name, setName] = useState(community.name);
  const [kind, setKind] = useState<CommunityKind>(community.kind as CommunityKind);
  const [description, setDescription] = useState(community.description ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<CommunityErrorKey | null>(null);

  const [logo, setLogo] = useState(community.logo_url);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<"invalid" | "failed" | null>(null);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const parsed = communityFormSchema.safeParse({ name, kind, description });
    if (!parsed.success) return setError(toCommunityError({ message: parsed.error.issues[0]?.message }));

    setSaving(true);
    setError(null);
    setSaved(false);
    const { data, error: failure } = await supabase
      .from("communities")
      .update({ name: parsed.data.name, kind: parsed.data.kind, description: parsed.data.description || null })
      .eq("id", community.id)
      .select("id");
    setSaving(false);
    // RLS: si la persona ya no es admin, la actualización no toca ninguna fila
    if (failure || !data?.length) return setError(toCommunityError(failure ?? { message: "not_admin" }));
    setSaved(true);
    router.refresh();
  }

  async function cleanFolder(keep?: string) {
    const { data } = await supabase.storage.from(BUCKET).list(community.id);
    const old = (data ?? []).map((file) => `${community.id}/${file.name}`).filter((path) => path !== keep);
    if (old.length > 0) await supabase.storage.from(BUCKET).remove(old);
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > MAX_IMAGE_INPUT_BYTES) return setLogoError("invalid");

    setLogoBusy(true);
    setLogoError(null);
    try {
      const blob = await toSquareWebp(file);
      const path = `${community.id}/logo-${Date.now()}.webp`;
      const upload = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/webp" });
      if (upload.error) throw upload.error;
      const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      const update = await supabase.from("communities").update({ logo_url: url }).eq("id", community.id);
      if (update.error) throw update.error;
      setLogo(url);
      await cleanFolder(path);
      router.refresh();
    } catch {
      setLogoError("failed");
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    setLogoBusy(true);
    setLogoError(null);
    const update = await supabase.from("communities").update({ logo_url: null }).eq("id", community.id);
    if (update.error) setLogoError("failed");
    else {
      setLogo(null);
      await cleanFolder();
      router.refresh();
    }
    setLogoBusy(false);
  }

  async function deleteCommunity() {
    setDeleting(true);
    setError(null);
    const { data, error: failure } = await supabase.from("communities").delete().eq("id", community.id).select("id");
    if (failure || !data?.length) {
      setDeleting(false);
      return setError(toCommunityError(failure ?? { message: "not_admin" }));
    }
    await cleanFolder();
    router.push("/comunidades");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="logo-title" className="flex items-center gap-5 rounded-3xl bg-background p-5 shadow-sm ring-1 ring-border">
        <CommunityLogo id={community.id} name={community.name} src={logo} className="size-20 text-2xl" />
        <div className="flex flex-col gap-2">
          <h2 id="logo-title" className="font-heading text-sm font-bold">
            {t("logo.title")}
          </h2>
          <div className="flex flex-wrap gap-2">
            <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={onFile} aria-label={t("logo.change")} tabIndex={-1} />
            <Button size="sm" variant="secondary" className="text-foreground" onClick={() => inputRef.current?.click()} disabled={logoBusy} aria-busy={logoBusy}>
              <Camera className="size-4" aria-hidden="true" />
              {logoBusy ? t("logo.uploading") : t("logo.change")}
            </Button>
            {logo ? (
              <Button size="sm" variant="secondary" className="text-foreground" onClick={removeLogo} disabled={logoBusy}>
                <Trash2 className="size-4" aria-hidden="true" />
                {t("logo.remove")}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{t("logo.help")}</p>
          {logoError ? (
            <p role="alert" className="text-sm text-destructive">
              {t(`logo.${logoError}`)}
            </p>
          ) : null}
        </div>
      </section>

      <form onSubmit={save} className="flex flex-col gap-4 rounded-3xl bg-background p-5 shadow-sm ring-1 ring-border" noValidate>
        <h2 className="font-heading text-lg font-extrabold">{t("info")}</h2>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="settings-name" className="text-sm font-semibold">
            {t("name")}
          </label>
          <Input id="settings-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="settings-kind" className="text-sm font-semibold">
            {t("kind")}
          </label>
          <select
            id="settings-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as CommunityKind)}
            className="min-h-12 rounded-2xl border border-border bg-surface px-4 text-base"
          >
            {COMMUNITY_KINDS.map((key) => (
              <option key={key} value={key}>
                {kinds(key)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="settings-description" className="text-sm font-semibold">
            {t("description")}
          </label>
          <Textarea id="settings-description" rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {error ? (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {errors(error)}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="md" disabled={saving} aria-busy={saving}>
            {saving ? t("saving") : t("save")}
          </Button>
          {saved ? (
            <p role="status" className="text-sm font-semibold text-success">
              {t("saved")}
            </p>
          ) : null}
        </div>
      </form>

      <section aria-labelledby="danger-title" className="flex flex-col gap-3 rounded-3xl bg-background p-5 shadow-sm ring-1 ring-destructive/40">
        <h2 id="danger-title" className="font-heading text-lg font-extrabold">
          {t("danger.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("danger.body")}</p>
        {confirmingDelete ? (
          <div role="group" aria-label={t("danger.title")} className="flex flex-wrap gap-2">
            <Button size="sm" variant="danger" onClick={deleteCommunity} disabled={deleting} aria-busy={deleting}>
              {t("danger.confirm")}
            </Button>
            <Button size="sm" variant="secondary" className="text-foreground" onClick={() => setConfirmingDelete(false)}>
              {t("danger.cancel")}
            </Button>
          </div>
        ) : (
          <Button size="md" variant="secondary" className="self-start text-destructive" onClick={() => setConfirmingDelete(true)}>
            <Trash2 className="size-4" aria-hidden="true" />
            {t("danger.delete")}
          </Button>
        )}
      </section>
    </div>
  );
}

