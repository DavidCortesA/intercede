"use server";

import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { signInAsGuest } from "@/features/auth/actions";
import { displayNameSchema } from "@/features/auth/schemas";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { toRoomError, type RoomErrorCode } from "./errors";
import { extractRoomCode } from "./schemas";

export interface RoomActionState {
  error?: RoomErrorCode;
  /** Se devuelve para no borrar lo que la persona escribió si hubo un error. */
  displayName?: string;
}

function guestError(error: "invalid_name" | "rate_limited" | "guests_disabled" | "unexpected"): RoomErrorCode {
  return error === "unexpected" ? "generic" : error;
}

/** Crear sala sin cuenta: entra como invitado con un nombre, crea la sala y lleva a ella. */
export async function createRoomAction(_prev: RoomActionState, formData: FormData): Promise<RoomActionState> {
  const locale = String(formData.get("locale") ?? "");
  const rawName = String(formData.get("displayName") ?? "");
  if (!hasLocale(routing.locales, locale)) return { error: "generic", displayName: rawName };

  const name = displayNameSchema.safeParse(rawName);
  if (!name.success) return { error: "invalid_name", displayName: rawName };

  const guest = await signInAsGuest({ displayName: name.data });
  if (!guest.ok) return { error: guestError(guest.error), displayName: rawName };

  const t = await getTranslations({ locale, namespace: "Room" });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_room", {
    p_name: t("defaultName", { name: name.data }).slice(0, 60),
    p_display_name: name.data,
  });
  const created = data?.[0];
  if (error || !created) return { error: toRoomError(error), displayName: rawName };

  redirect({ href: `/r/${created.room_code}`, locale });
  return {};
}

/** Unirse a una sala con un nombre (sin cuenta). Si todo sale bien, recarga la sala ya dentro. */
export async function joinRoomAction(_prev: RoomActionState, formData: FormData): Promise<RoomActionState> {
  const locale = String(formData.get("locale") ?? "");
  const rawName = String(formData.get("displayName") ?? "");
  const code = extractRoomCode(String(formData.get("code") ?? ""));
  if (!hasLocale(routing.locales, locale)) return { error: "generic", displayName: rawName };
  if (!code) return { error: "room_not_found", displayName: rawName };

  const name = displayNameSchema.safeParse(rawName);
  if (!name.success) return { error: "invalid_name", displayName: rawName };

  const guest = await signInAsGuest({ displayName: name.data });
  if (!guest.ok) return { error: guestError(guest.error), displayName: rawName };

  const supabase = await createClient();
  const { error } = await supabase.rpc("join_room", { p_code: code, p_display_name: name.data });
  if (error) return { error: toRoomError(error), displayName: rawName };

  redirect({ href: `/r/${code}`, locale });
  return {};
}
