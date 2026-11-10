import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { z } from "zod";

/** Duración del token de acceso (CLAUDE.md §3). LiveKit renueva el de quien sigue conectado. */
export const LIVEKIT_TOKEN_TTL = "2h";

const envSchema = z.object({
  LIVEKIT_URL: z.string().min(1),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
});

/**
 * Credenciales de LiveKit (solo servidor, nunca `NEXT_PUBLIC_`). El error nombra las variables
 * que faltan, jamás sus valores.
 */
export function getLiveKitEnv() {
  const parsed = envSchema.safeParse({
    LIVEKIT_URL: process.env.LIVEKIT_URL,
    LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
  });
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Configuración de LiveKit incompleta (${missing}). Revisa .env.local y .env.example.`);
  }
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = parsed.data;
  return {
    /** URL de señalización para el navegador (wss://…). */
    wsUrl: LIVEKIT_URL.replace(/^http/, "ws"),
    /** URL de la API de administración (https://…). */
    httpUrl: LIVEKIT_URL.replace(/^ws/, "http"),
    apiKey: LIVEKIT_API_KEY,
    apiSecret: LIVEKIT_API_SECRET,
  };
}

export function getRoomService() {
  const env = getLiveKitEnv();
  return new RoomServiceClient(env.httpUrl, env.apiKey, env.apiSecret);
}

interface TokenInput {
  /** Nombre de la sala en LiveKit = id de la sala en la base. */
  roomName: string;
  /** Identidad = id del usuario de Supabase. */
  identity: string;
  displayName: string;
  isHost: boolean;
}

/**
 * Token corto para entrar a UNA sala de audio. Los permisos son los mínimos de la Fase 4:
 * escuchar y publicar solo micrófono (sin cámara, pantalla ni datos).
 */
export async function createParticipantToken({ roomName, identity, displayName, isHost }: TokenInput) {
  const env = getLiveKitEnv();
  const token = new AccessToken(env.apiKey, env.apiSecret, {
    identity,
    name: displayName,
    ttl: LIVEKIT_TOKEN_TTL,
    metadata: JSON.stringify({ role: isHost ? "host" : "participant" }),
  });
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canSubscribe: true,
    canPublish: true,
    canPublishSources: [TrackSource.MICROPHONE],
    canPublishData: false,
  });
  return token.toJwt();
}
