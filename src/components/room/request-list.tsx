"use client";

import { CheckCircle2, HandHeart, Trash2 } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { REQUEST_MAX_LENGTH } from "@/features/rooms/schemas";
import type { PrayerRequest, RoomMember } from "@/features/rooms/types";
import { cn } from "@/lib/utils";
import { Avatar } from "./avatar";

interface Props {
  requests: PrayerRequest[];
  members: RoomMember[];
  meId: string;
  isHost: boolean;
  onSetAnswered: (id: string, isAnswered: boolean, testimony: string | null) => Promise<boolean>;
  onRemove: (id: string) => Promise<boolean>;
}

export function RequestList({ requests, members, meId, isHost, onSetAnswered, onRemove }: Props) {
  const t = useTranslations("Room.requests");
  const names = new Map(members.map((m) => [m.user_id, m.display_name]));

  if (requests.length === 0) {
    return <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-muted-foreground">{t("empty")}</p>;
  }

  return (
    // aria-live: las peticiones nuevas se anuncian sin quitar el foco al lector de pantalla
    <ul aria-live="polite" className="flex flex-col gap-3">
      {requests.map((request) => (
        <RequestItem
          key={request.id}
          request={request}
          authorName={names.get(request.author_id) ?? t("unknownAuthor")}
          canEdit={request.author_id === meId}
          canDelete={request.author_id === meId || isHost}
          onSetAnswered={onSetAnswered}
          onRemove={onRemove}
        />
      ))}
    </ul>
  );
}

interface ItemProps {
  request: PrayerRequest;
  authorName: string;
  canEdit: boolean;
  canDelete: boolean;
  onSetAnswered: Props["onSetAnswered"];
  onRemove: Props["onRemove"];
}

function RequestItem({ request, authorName, canEdit, canDelete, onSetAnswered, onRemove }: ItemProps) {
  const t = useTranslations("Room.requests");
  const format = useFormatter();
  // "hace 2 min" se actualiza solo cada minuto
  const now = useNow({ updateInterval: 60_000 });
  const [editing, setEditing] = useState(false);
  const [testimony, setTestimony] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(isAnswered: boolean, text: string | null) {
    setBusy(true);
    const ok = await onSetAnswered(request.id, isAnswered, text);
    setBusy(false);
    if (ok) setEditing(false);
  }

  return (
    <li
      className={cn(
        "rounded-2xl border border-border bg-surface p-4",
        request.is_answered && "border-l-[3px] border-l-answered",
      )}
    >
      <div className="flex items-center gap-3">
        <Avatar userId={request.author_id} name={authorName} className="size-9 text-xs" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading text-sm font-bold">{t("by", { name: authorName })}</p>
          <time
            dateTime={request.created_at}
            suppressHydrationWarning
            className="text-xs text-muted-foreground"
          >
            {format.relativeTime(new Date(request.created_at), now)}
          </time>
        </div>
        {request.is_answered ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-answered-surface px-2.5 py-1 text-xs font-bold text-answered-foreground">
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
            {t("answered")}
          </span>
        ) : null}
      </div>

      <p className="mt-3 whitespace-pre-wrap break-words leading-relaxed">{request.content}</p>

      {request.is_answered && request.testimony ? (
        <p className="mt-3 rounded-xl bg-answered-surface p-3 text-sm leading-relaxed text-answered-foreground">
          <strong>{t("testimonyPrefix")}</strong> {request.testimony}
        </p>
      ) : null}

      {editing ? (
        <div className="mt-3 flex flex-col gap-2">
          <label htmlFor={`testimony-${request.id}`} className="text-sm font-semibold">
            {t("testimonyLabel")}
          </label>
          <Textarea
            id={`testimony-${request.id}`}
            rows={2}
            maxLength={REQUEST_MAX_LENGTH}
            value={testimony}
            onChange={(event) => setTestimony(event.target.value)}
            placeholder={t("testimonyPlaceholder")}
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => save(true, testimony.trim() || null)}>
              {t("save")}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(false)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canEdit ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => (request.is_answered ? save(false, null) : setEditing(true))}
            >
              <HandHeart className="size-4" aria-hidden="true" />
              {request.is_answered ? t("unmarkAnswered") : t("markAnswered")}
            </Button>
          ) : null}
          {canDelete ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              aria-label={t("delete")}
              onClick={async () => {
                setBusy(true);
                await onRemove(request.id);
                setBusy(false);
              }}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              <span className="sr-only">{t("delete")}</span>
            </Button>
          ) : null}
        </div>
      )}
    </li>
  );
}
