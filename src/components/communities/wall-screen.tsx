"use client";

import { CheckCircle2, HandHeart, Lock, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { ModerationMenu } from "@/components/moderation/moderation-menu";
import { Avatar } from "@/components/room/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { toCommunityError, type CommunityErrorKey } from "@/features/communities/schemas";
import type { WallAuthor, WallRequest, WallSupport } from "@/features/communities/wall";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const MAX = 500;
const TESTIMONY_MAX = 500;

/**
 * Muro de oración de la comunidad. Lee en el servidor y escribe con el navegador: quién puede ver cada
 * petición (toda la comunidad o solo el liderazgo), quién la edita y quién la borra lo decide RLS.
 */
export function WallScreen({
  communityId,
  meId,
  isLeader,
  initialRequests,
  initialSupport,
  authors,
}: {
  communityId: string;
  meId: string;
  isLeader: boolean;
  initialRequests: WallRequest[];
  initialSupport: WallSupport[];
  authors: Record<string, WallAuthor>;
}) {
  const t = useTranslations("Communities");
  const wall = useTranslations("Communities.wall");
  const format = useFormatter();
  const [supabase] = useState(() => createClient());

  const [requests, setRequests] = useState(initialRequests);
  const [support, setSupport] = useState(initialSupport);
  const [draft, setDraft] = useState("");
  const [visibility, setVisibility] = useState<"community" | "leaders">("community");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<CommunityErrorKey | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [testimonyFor, setTestimonyFor] = useState<string | null>(null);
  const [testimony, setTestimony] = useState("");
  // Quien bloqueas desaparece al instante; el liderazgo ve todo para poder moderar
  const [blocked, setBlocked] = useState<ReadonlySet<string>>(new Set());
  const shown = isLeader ? requests : requests.filter((request) => !blocked.has(request.author_id));

  const supportCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of support) counts.set(row.request_id, (counts.get(row.request_id) ?? 0) + 1);
    return counts;
  }, [support]);
  const mine = useMemo(() => new Set(support.filter((row) => row.user_id === meId).map((row) => row.request_id)), [support, meId]);

  async function post(event: React.FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setPosting(true);
    setError(null);
    const { data, error: failure } = await supabase
      .from("community_requests")
      .insert({ community_id: communityId, content, visibility })
      .select("id, author_id, content, visibility, is_answered, testimony, created_at")
      .single();
    setPosting(false);
    if (failure || !data) return setError(toCommunityError(failure));
    setRequests((list) => [data, ...list]);
    setDraft("");
  }

  async function toggleSupport(requestId: string) {
    setError(null);
    if (mine.has(requestId)) {
      const { error: failure } = await supabase.from("community_request_support").delete().eq("request_id", requestId).eq("user_id", meId);
      if (failure) return setError("generic");
      setSupport((rows) => rows.filter((row) => !(row.request_id === requestId && row.user_id === meId)));
    } else {
      const { error: failure } = await supabase.from("community_request_support").insert({ request_id: requestId } as never);
      if (failure) return setError(toCommunityError(failure));
      setSupport((rows) => [...rows, { request_id: requestId, user_id: meId }]);
    }
  }

  async function setAnswered(requestId: string, answered: boolean, note?: string) {
    setError(null);
    const { data, error: failure } = await supabase
      .from("community_requests")
      .update({ is_answered: answered, testimony: answered && note ? note : null })
      .eq("id", requestId)
      .select("id, author_id, content, visibility, is_answered, testimony, created_at")
      .single();
    if (failure || !data) return setError(toCommunityError(failure));
    setRequests((list) => list.map((r) => (r.id === requestId ? data : r)));
    setTestimonyFor(null);
    setTestimony("");
  }

  async function remove(requestId: string) {
    setDeleting(null);
    setError(null);
    const { data, error: failure } = await supabase.from("community_requests").delete().eq("id", requestId).select("id");
    if (failure) return setError("generic");
    if (data?.length) setRequests((list) => list.filter((r) => r.id !== requestId));
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-heading text-2xl font-extrabold">{wall("title")}</h2>
        <p className="mt-1 text-muted-foreground">{wall("subtitle")}</p>
      </div>

      <form onSubmit={post} className="flex flex-col gap-3 rounded-3xl bg-background p-5 shadow-sm ring-1 ring-border" noValidate>
        <label htmlFor="wall-draft" className="sr-only">
          {wall("label")}
        </label>
        <Textarea id="wall-draft" rows={3} maxLength={MAX} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={wall("placeholder")} />
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="wall-visibility" className="text-sm font-semibold">
            {wall("visibility.label")}
          </label>
          <select
            id="wall-visibility"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as "community" | "leaders")}
            className="min-h-11 rounded-full border border-border bg-surface px-4 text-sm"
          >
            <option value="community">{wall("visibility.community")}</option>
            <option value="leaders">{wall("visibility.leaders")}</option>
          </select>
          <Button type="submit" size="md" className="ml-auto" disabled={posting || draft.trim().length === 0} aria-busy={posting}>
            {posting ? wall("publishing") : wall("publish")}
          </Button>
        </div>
      </form>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      {shown.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-border p-6 text-muted-foreground">{wall("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((request) => {
            const author = authors[request.author_id];
            const isMine = request.author_id === meId;
            const praying = mine.has(request.id);
            const count = supportCount.get(request.id) ?? 0;
            return (
              <li key={request.id}>
                <article
                  className={cn("flex flex-col gap-3 rounded-3xl bg-background p-5 shadow-sm ring-1 ring-border", request.is_answered && "ring-answered/60")}
                >
                  <header className="flex items-center gap-3">
                    <Avatar userId={request.author_id} name={author?.display_name ?? "?"} src={author?.avatar_url} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {wall("by", { name: author?.display_name ?? wall("unknownAuthor") })}
                        {isMine ? <span className="ml-2 text-xs text-muted-foreground">{wall("own")}</span> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">{format.dateTime(new Date(request.created_at), { dateStyle: "medium", timeStyle: "short" })}</p>
                    </div>
                    {request.visibility === "leaders" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs font-semibold">
                        <Lock className="size-3" aria-hidden="true" />
                        {wall("leadersOnly")}
                      </span>
                    ) : null}
                  </header>

                  <p className="leading-relaxed whitespace-pre-line">{request.content}</p>

                  {request.is_answered ? (
                    <div className="rounded-2xl bg-answered/15 p-3 text-sm">
                      <p className="flex items-center gap-2 font-heading font-bold text-answered-foreground">
                        <CheckCircle2 className="size-4" aria-hidden="true" />
                        {wall("answered")}
                      </p>
                      {request.testimony ? <p className="mt-1 whitespace-pre-line">{request.testimony}</p> : null}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    {isMine ? null : (
                      <Button
                        size="sm"
                        variant={praying ? "primary" : "secondary"}
                        className={praying ? undefined : "text-foreground"}
                        aria-pressed={praying}
                        onClick={() => toggleSupport(request.id)}
                      >
                        <HandHeart className="size-4" aria-hidden="true" />
                        {praying ? wall("stopPraying") : wall("praying")}
                      </Button>
                    )}
                    <span className="text-xs text-muted-foreground">{wall("count", { count })}</span>
                  </div>

                  {isMine ? (
                    <div className="flex flex-col gap-2">
                      {testimonyFor === request.id ? (
                        <div className="flex flex-col gap-2">
                          <label htmlFor={`testimony-${request.id}`} className="text-sm font-semibold">
                            {wall("testimony")}
                          </label>
                          <Textarea id={`testimony-${request.id}`} rows={2} maxLength={TESTIMONY_MAX} value={testimony} onChange={(e) => setTestimony(e.target.value)} placeholder={wall("testimonyPlaceholder")} />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => setAnswered(request.id, true, testimony.trim())}>
                              {wall("saveTestimony")}
                            </Button>
                            <Button size="sm" variant="secondary" className="text-foreground" onClick={() => setTestimonyFor(null)}>
                              {wall("cancel")}
                            </Button>
                          </div>
                        </div>
                      ) : request.is_answered ? (
                        <Button size="sm" variant="secondary" className="self-start text-foreground" onClick={() => setAnswered(request.id, false)}>
                          {wall("reopen")}
                        </Button>
                      ) : (
                        <Button size="sm" variant="secondary" className="self-start text-foreground" onClick={() => setTestimonyFor(request.id)}>
                          {wall("markAnswered")}
                        </Button>
                      )}
                    </div>
                  ) : null}

                  {isMine || isLeader ? (
                    deleting === request.id ? (
                      <div role="group" aria-label={wall("confirmDelete")} className="flex flex-wrap items-center gap-2">
                        <span className="text-sm">{wall("confirmDelete")}</span>
                        <Button size="sm" variant="danger" onClick={() => remove(request.id)}>
                          {wall("confirmYes")}
                        </Button>
                        <Button size="sm" variant="secondary" className="text-foreground" onClick={() => setDeleting(null)}>
                          {wall("cancel")}
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="secondary" className="self-start text-foreground" onClick={() => setDeleting(request.id)}>
                        <Trash2 className="size-4" aria-hidden="true" />
                        {wall("delete")}
                      </Button>
                    )
                  ) : null}
                  {isMine ? null : (
                    <ModerationMenu
                      target={{ type: "community_request", id: request.id }}
                      author={{ id: request.author_id, name: author?.display_name ?? wall("unknownAuthor") }}
                      communityId={communityId}
                      onBlocked={(userId) => setBlocked((current) => new Set(current).add(userId))}
                    />
                  )}
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
