/**
 * Campana suave al terminar cada segmento (opcional, solo en este dispositivo). Los navegadores solo dejan sonar audio
 * después de un gesto de la persona: por eso el contexto de audio se crea al ACTIVAR la campana (un clic), nunca al cargar.
 */
export interface Bell {
  ring: () => void;
  close: () => void;
}

export function createBell(): Bell | null {
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  const context = new Context();
  void context.resume();

  return {
    ring() {
      const now = context.currentTime;
      // Un tono grave y su armónico con caída lenta: se oye como una campana pequeña, sin sobresaltar
      for (const [frequency, volume] of [
        [528, 0.18],
        [1056, 0.07],
      ] as const) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(volume, now + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(now);
        oscillator.stop(now + 2.3);
      }
    },
    close() {
      void context.close();
    },
  };
}
