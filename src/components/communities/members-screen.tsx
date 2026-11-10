"use client";

import { Check, Copy, Link2, LogOut, UserMinus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";
import { Avatar } from "@/components/room/avatar";
import { Button } from "@/components/ui/button";
import { COMMUNITY_ROLES, toCommunityError, type CommunityErrorKey, type CommunityRole } from "@/features/communities/schemas";
import type { CommunityMember } from "@/features/communities/types";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Miembros, roles y enlace de invitación. Cada acción llama a una función de la base de datos que
 * decide quién puede hacerla (admin cambia roles y revoca; el liderazgo saca a miembros). Los botones
 * solo se muestran cuando la acción procede, pero la barrera real es la base.
 */
export function MembersScreen({
  communityId,
  meId,
  role,
  members,
  inviteToken,
}: {
  communityId: string;
  meId: string;
  role: CommunityRole;
  members: CommunityMember[];
  inviteToken: string | null;
}) {
  const t = useTranslations("Communities");
  const locale = useLocale();
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const isAdmin = role === "admin";
  const isLeader = role === "admin" || role === "leader";

  const [token, setToken] = useState(inviteToken);
  const [notice, setNotice] = useState<"copied" | "revoked" | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CommunityErrorKey | null>(null);

  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const inviteUrl = token && origin ? new URL(`/${locale}/c/${token}`, origin).href : "";

  async function run(action: () => PromiseLike<{ error: { message: string; code?: string } | null }>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: failure } = await action();
    setBusy(false);
    if (failure) {
      setError(toCommunityError(failure));
      return false;
    }
    return true;
  }

  async function changeRole(userId: string, next: CommunityRole) {
    if (await run(() => supabase.rpc("set_member_role", { p_community_id: communityId, p_user_id: userId, p_role: next }))) router.refresh();
  }

  async function remove(userId: string) {
    setRemoving(null);
    if (await run(() => supabase.rpc("remove_community_member", { p_community_id: communityId, p_user_id: userId }))) router.refresh();
  }

  async function leave() {
    if (await run(() => supabase.rpc("leave_community", { p_community_id: communityId }))) {
      router.push("/comunidades");
      router.refresh();
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setNotice("copied");
    } catch {
      setError("generic");
    }
  }

  async function revoke() {
    setBusy(true);
    setError(null);
    const { data, error: failure } = await supabase.rpc("regenerate_community_invite", { p_community_id: communityId });
    setBusy(false);
    if (failure || !data) return setError(toCommunityError(failure));
    setToken(data);
    setNotice("revoked");
  }

  const canRemove = (member: CommunityMember) =>
    member.user_id !== meId && ((isAdmin && member.role !== "admin") || (isLeader && member.role === "member"));

  return (
    <div className="flex flex-col gap-6">
      {isLeader && token ? (
        <section aria-labelledby="invite-title" className="flex flex-col gap-2 rounded-3xl bg-background p-5 shadow-sm ring-1 ring-border">
          <h2 id="invite-title" className="flex items-center gap-2 font-heading text-lg font-extrabold">
            <Link2 className="size-5 text-primary-text" aria-hidden="true" />
            {t("members.invite.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("members.invite.help")}</p>
          <p className="rounded-xl bg-surface p-3 text-xs break-all text-muted-foreground" data-testid="community-invite-url">
            {inviteUrl}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" className="text-foreground" onClick={copyLink} disabled={busy}>
              {notice === "copied" ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
              {t("members.invite.copy")}
            </Button>
            {isAdmin ? (
              <Button size="sm" variant="secondary" className="text-foreground" onClick={revoke} disabled={busy}>
                {t("members.invite.revoke")}
              </Button>
            ) : null}
          </div>
          {notice ? (
            <p role="status" className="text-xs font-semibold text-success">
              {t(`members.invite.${notice}`)}
            </p>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      <section aria-labelledby="members-title" className="flex flex-col gap-3">
        <h2 id="members-title" className="font-heading text-lg font-extrabold">
          {t("members.title")} <span className="text-sm font-semibold text-muted-foreground">({members.length})</span>
        </h2>
        <ul className="flex flex-col gap-2">
          {members.map((member) => (
            <li key={member.user_id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-background p-3 shadow-sm ring-1 ring-border">
              <Avatar userId={member.user_id} name={member.display_name} src={member.avatar_url} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-heading font-bold">
                  {member.display_name} {member.user_id === meId ? <span className="text-xs font-semibold text-muted-foreground">{t("members.you")}</span> : null}
                </p>
                {isAdmin ? (
                  <>
                    <label htmlFor={`role-${member.user_id}`} className="sr-only">
                      {t("members.roleLabel", { name: member.display_name })}
                    </label>
                    <select
                      id={`role-${member.user_id}`}
                      value={member.role}
                      disabled={busy}
                      onChange={(event) => changeRole(member.user_id, event.target.value as CommunityRole)}
                      className="mt-1 min-h-9 rounded-full border border-border bg-surface px-3 text-xs font-semibold"
                    >
                      {COMMUNITY_ROLES.map((key) => (
                        <option key={key} value={key}>
                          {t(`roles.${key}`)}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">{t(`roles.${member.role as CommunityRole}`)}</p>
                )}
              </div>
              {canRemove(member) ? (
                removing === member.user_id ? (
                  <div role="group" aria-label={t("members.confirmRemove", { name: member.display_name })} className="flex flex-wrap items-center gap-2">
                    <span className="text-sm">{t("members.confirmRemove", { name: member.display_name })}</span>
                    <Button size="sm" variant="danger" disabled={busy} onClick={() => remove(member.user_id)}>
                      {t("members.confirm")}
                    </Button>
                    <Button size="sm" variant="secondary" className="text-foreground" onClick={() => setRemoving(null)}>
                      {t("members.cancel")}
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="secondary" className="text-foreground" disabled={busy} onClick={() => setRemoving(member.user_id)}>
                    <UserMinus className="size-4" aria-hidden="true" />
                    {t("members.remove")}
                  </Button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        {leaving ? (
          <div role="group" aria-label={t("members.confirmLeave")} className="flex flex-col gap-3 rounded-2xl bg-background p-4 ring-1 ring-border">
            <p className="text-sm">{t("members.confirmLeave")}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="danger" disabled={busy} onClick={leave}>
                {t("members.confirmLeaveYes")}
              </Button>
              <Button size="sm" variant="secondary" className="text-foreground" onClick={() => setLeaving(false)}>
                {t("members.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" size="md" className="self-start text-foreground" onClick={() => setLeaving(true)}>
            <LogOut className="size-4" aria-hidden="true" />
            {t("members.leave")}
          </Button>
        )}
      </section>
    </div>
  );
}
