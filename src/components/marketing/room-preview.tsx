import { Heart, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";

const GUESTS = [
  { initials: "LU", gradient: "from-brand-blue to-brand-cyan" },
  { initials: "SO", gradient: "from-brand-gold to-[#E9704B]" },
  { initials: "JO", gradient: "from-[#0ea5a4] to-brand-blue" },
  { initials: "+5", gradient: "from-[#7c3aed] to-[#db2777]" },
];

/**
 * Ilustración decorativa de una sala de oración (inspirada en la pantalla 3 de
 * docs/design/pantallas.html). No es interactiva ni usa datos reales.
 */
export async function RoomPreview() {
  const t = await getTranslations("Hero");

  return (
    <div
      aria-hidden="true"
      className="dark w-full max-w-sm rounded-[2rem] border border-border bg-brand-navy-800/85 p-5 text-foreground shadow-2xl shadow-black/40 backdrop-blur"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="font-heading text-base font-bold">{t("previewRoom")}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-2 rounded-full bg-[#16c47f] shadow-[0_0_0_3px_rgba(22,196,127,0.2)]" />
            {t("previewLive")} · 08:42
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-border bg-brand-navy-900 px-3 py-1.5 text-xs font-semibold">
          <Users className="size-3.5" />8
        </span>
      </div>

      <div className="mt-6 flex flex-col items-center">
        <div className="relative grid size-28 place-items-center">
          <span className="absolute inset-0 animate-[ring-pulse_2.4s_infinite] rounded-full border-2 border-brand-violet-400/70" />
          <span className="absolute inset-0 animate-[ring-pulse_2.4s_1.2s_infinite] rounded-full border-2 border-brand-violet-400/70" />
          <span className="grid size-20 place-items-center rounded-full bg-gradient-to-br from-brand-violet to-[#8B5CF6] font-heading text-2xl font-bold text-white ring-4 ring-brand-navy-900 outline-2 outline-brand-violet">
            MA
          </span>
        </div>
        <p className="mt-3 font-heading text-base font-bold">María</p>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-brand-cyan">
          <span className="flex h-3 items-end gap-0.5">
            {[0.4, 1, 0.65].map((h, i) => (
              <i
                key={i}
                className="w-[3px] origin-bottom animate-[eq_1s_infinite_ease-in-out] rounded-sm bg-brand-cyan"
                style={{ height: `${h * 12}px`, animationDelay: `${i * 0.2}s` }}
              />
            ))}
          </span>
          {t("previewSpeaking")}
        </p>
      </div>

      <div className="mt-5 flex justify-center gap-2">
        {GUESTS.map((g) => (
          <span
            key={g.initials}
            className={`grid size-10 place-items-center rounded-full bg-gradient-to-br ${g.gradient} font-heading text-xs font-bold text-white`}
          >
            {g.initials}
          </span>
        ))}
      </div>

      <div className="mt-5 rounded-2xl border border-border border-l-[3px] border-l-brand-gold bg-brand-navy-900/70 p-3.5 text-[13px] leading-snug">
        “{t("previewRequest")}”
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Heart className="size-3 text-brand-gold" />
          {t("previewPraying")}
        </p>
      </div>
    </div>
  );
}
