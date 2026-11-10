"use client";

import {
  AudioPresets,
  DisconnectReason,
  MediaDeviceFailure,
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
} from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAudioToken, type AudioApiError } from "./api";

export type AudioStatus = "idle" | "connecting" | "connected" | "reconnecting";
/** `talk`: entra con el micrófono; `listen`: solo escucha (nunca pide el micrófono). */
export type AudioMode = "talk" | "listen";

export type AudioErrorCode =
  | "mic_denied"
  | "mic_missing"
  | "mic_busy"
  | "mic_error"
  | "connect_failed"
  | "duplicate"
  | "removed"
  | "room_closed"
  | "not_a_member"
  | "unauthenticated"
  | "livekit_unavailable"
  | "server_misconfigured"
  | "network";

export interface Presence {
  speaking: boolean;
  micOn: boolean;
}

/** Intentos de reconexión con un token nuevo cuando LiveKit se da por vencido (espera en ms). */
const RECONNECT_DELAYS = [1000, 3000, 6000, 10000];

/** Errores del servidor que no se arreglan reintentando. */
const FATAL_API_ERRORS: Partial<Record<AudioApiError, AudioErrorCode>> = {
  removed: "removed",
  room_closed: "room_closed",
  not_a_member: "not_a_member",
  unauthenticated: "unauthenticated",
  server_misconfigured: "server_misconfigured",
  livekit_unavailable: "livekit_unavailable",
};

function micErrorFrom(error: unknown): AudioErrorCode {
  switch (MediaDeviceFailure.getFailure(error)) {
    case MediaDeviceFailure.PermissionDenied:
      return "mic_denied";
    case MediaDeviceFailure.NotFound:
      return "mic_missing";
    case MediaDeviceFailure.DeviceInUse:
      return "mic_busy";
    default:
      return "mic_error";
  }
}

function disconnectError(reason: DisconnectReason | undefined): AudioErrorCode | null {
  switch (reason) {
    case DisconnectReason.DUPLICATE_IDENTITY:
      return "duplicate";
    case DisconnectReason.PARTICIPANT_REMOVED:
      return "removed";
    case DisconnectReason.ROOM_DELETED:
    case DisconnectReason.ROOM_CLOSED:
      return "room_closed";
    default:
      return null;
  }
}

/**
 * Audio en vivo de una sala con LiveKit (el navegador se conecta directo; el servidor solo emite
 * el token). Cuida lo que importa en un celular:
 *  - el micrófono se pide solo cuando la persona decide hablar (nunca al cargar la página);
 *  - "solo escuchar" no publica nada ni pide permisos;
 *  - reconexión: LiveKit reintenta solo ante cortes breves y, si se rinde, se pide un token
 *    nuevo y se reconecta (un token vencido no debe dejar a nadie fuera de una sala abierta);
 *  - errores del micrófono con causas distintas (permiso, sin micrófono, en uso).
 */
export function useLiveAudio(roomId: string) {
  const roomRef = useRef<Room | null>(null);
  const attachedRef = useRef(new Set<HTMLMediaElement>());
  const leavingRef = useRef(false);
  const wantMicRef = useRef(false);

  const [status, setStatus] = useState<AudioStatus>("idle");
  const [mode, setMode] = useState<AudioMode | null>(null);
  const [micEnabled, setMicEnabled] = useState(false);
  const [error, setError] = useState<AudioErrorCode | null>(null);
  const [presence, setPresence] = useState<ReadonlyMap<string, Presence>>(new Map());
  const [soundBlocked, setSoundBlocked] = useState(false);

  const refresh = useCallback((room: Room) => {
    const next = new Map<string, Presence>();
    for (const participant of [room.localParticipant, ...room.remoteParticipants.values()]) {
      next.set(participant.identity, { speaking: participant.isSpeaking, micOn: participant.isMicrophoneEnabled });
    }
    setPresence(next);
    setMicEnabled(room.localParticipant.isMicrophoneEnabled);
  }, []);

  const detachAll = useCallback(() => {
    for (const element of attachedRef.current) element.remove();
    attachedRef.current.clear();
  }, []);

  const reset = useCallback(
    (nextError: AudioErrorCode | null) => {
      detachAll();
      roomRef.current = null;
      wantMicRef.current = false;
      setStatus("idle");
      setMode(null);
      setMicEnabled(false);
      setPresence(new Map());
      setSoundBlocked(false);
      setError(nextError);
    },
    [detachAll],
  );

  const enableMic = useCallback(async (room: Room): Promise<boolean> => {
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
      wantMicRef.current = true;
      setMode("talk");
      setError(null);
      return true;
    } catch (failure) {
      wantMicRef.current = false;
      setMode("listen");
      setError(micErrorFrom(failure));
      return false;
    }
  }, []);

  /** Pide un token nuevo y reconecta la misma sala de audio (hasta 4 intentos). */
  const reconnect = useCallback(
    async (room: Room) => {
      setStatus("reconnecting");
      for (const delay of RECONNECT_DELAYS) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (leavingRef.current || roomRef.current !== room) return;

        const token = await fetchAudioToken(roomId);
        if (!token.ok) {
          const fatal = FATAL_API_ERRORS[token.error];
          if (fatal) return reset(fatal);
          continue; // red caída u otro fallo pasajero: se reintenta
        }
        try {
          await room.connect(token.data.serverUrl, token.data.token);
          await room.startAudio().catch(() => undefined);
          setStatus("connected");
          if (wantMicRef.current) await enableMic(room);
          refresh(room);
          return;
        } catch {
          // se reintenta con el siguiente intervalo
        }
      }
      reset("connect_failed");
    },
    [roomId, reset, enableMic, refresh],
  );

  const leave = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    leavingRef.current = true;
    await room.disconnect();
    room.removeAllListeners();
    reset(null);
  }, [reset]);

  const join = useCallback(
    async (nextMode: AudioMode) => {
      if (roomRef.current) return;
      leavingRef.current = false;
      setError(null);
      setStatus("connecting");
      setMode(nextMode);

      const token = await fetchAudioToken(roomId);
      if (!token.ok) return reset(FATAL_API_ERRORS[token.error] ?? (token.error === "network" ? "network" : "connect_failed"));

      const room = new Room({
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        // Voz: códec optimizado para habla y menor consumo de datos
        publishDefaults: { audioPreset: AudioPresets.speech, dtx: true },
      });
      roomRef.current = room;

      const onChange = () => refresh(room);
      for (const event of [
        RoomEvent.ParticipantConnected,
        RoomEvent.ParticipantDisconnected,
        RoomEvent.ActiveSpeakersChanged,
        RoomEvent.TrackMuted,
        RoomEvent.TrackUnmuted,
        RoomEvent.TrackPublished,
        RoomEvent.TrackUnpublished,
        RoomEvent.LocalTrackPublished,
        RoomEvent.LocalTrackUnpublished,
      ] as const) {
        room.on(event, onChange);
      }

      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio) return;
        const element = track.attach();
        element.style.display = "none";
        document.body.appendChild(element);
        attachedRef.current.add(element);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        for (const element of track.detach()) {
          element.remove();
          attachedRef.current.delete(element);
        }
      });
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => setSoundBlocked(!room.canPlaybackAudio));
      room.on(RoomEvent.Reconnecting, () => setStatus("reconnecting"));
      room.on(RoomEvent.Reconnected, () => {
        setStatus("connected");
        refresh(room);
      });
      room.on(RoomEvent.MediaDevicesError, (failure: Error) => setError(micErrorFrom(failure)));
      room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (leavingRef.current || roomRef.current !== room) return;
        detachAll();
        const fatal = disconnectError(reason);
        if (fatal) return reset(fatal);
        void reconnect(room);
      });

      try {
        await room.connect(token.data.serverUrl, token.data.token);
      } catch {
        room.removeAllListeners();
        return reset("connect_failed");
      }

      // El clic de "unirse" es el gesto que el navegador exige para reproducir audio
      await room.startAudio().catch(() => undefined);
      setSoundBlocked(!room.canPlaybackAudio);
      setStatus("connected");
      refresh(room);

      if (nextMode === "talk") await enableMic(room);
      refresh(room);
    },
    [roomId, reset, refresh, detachAll, reconnect, enableMic],
  );

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    if (room.localParticipant.isMicrophoneEnabled) {
      await room.localParticipant.setMicrophoneEnabled(false);
      wantMicRef.current = false;
    } else {
      await enableMic(room);
    }
    refresh(room);
  }, [enableMic, refresh]);

  const enableSound = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    await room.startAudio().catch(() => undefined);
    setSoundBlocked(!room.canPlaybackAudio);
  }, []);

  // Al salir de la pantalla de la sala se corta el audio
  useEffect(() => {
    const attached = attachedRef.current; // el Set es estable durante toda la vida del hook
    return () => {
      leavingRef.current = true;
      const room = roomRef.current;
      if (room) {
        void room.disconnect();
        room.removeAllListeners();
      }
      for (const element of attached) element.remove();
      attached.clear();
    };
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { status, mode, micEnabled, error, presence, soundBlocked, join, leave, toggleMic, enableSound, clearError };
}

export type LiveAudio = ReturnType<typeof useLiveAudio>;
