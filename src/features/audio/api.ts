/** Llamadas del navegador a los endpoints de audio (`/api/livekit/*`). */

export type AudioApiError =
  | "invalid_request"
  | "forbidden_origin"
  | "unauthenticated"
  | "not_a_member"
  | "removed"
  | "room_closed"
  | "not_host"
  | "participant_not_connected"
  | "livekit_unavailable"
  | "server_misconfigured"
  | "member_not_found"
  | "cannot_remove_self"
  | "unexpected"
  | "network";

type Result<T> = { ok: true; data: T } | { ok: false; error: AudioApiError };

async function post<T>(path: string, body: unknown): Promise<Result<T>> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const json = (await response.json().catch(() => ({}))) as { error?: AudioApiError } & Record<string, unknown>;
    if (!response.ok) return { ok: false, error: json.error ?? "unexpected" };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, error: "network" };
  }
}

export interface TokenResponse {
  token: string;
  serverUrl: string;
  identity: string;
}

export const fetchAudioToken = (roomId: string) => post<TokenResponse>("/api/livekit/token", { roomId });

export type HostCommand =
  | { action: "mute_all"; roomId: string }
  | { action: "mute"; roomId: string; identity: string }
  | { action: "remove"; roomId: string; identity: string }
  | { action: "close"; roomId: string };

export const sendHostCommand = (command: HostCommand) => post<Record<string, unknown>>("/api/livekit/host", command);
