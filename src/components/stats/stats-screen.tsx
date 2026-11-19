import { Download } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { compare, summarize, type CommunityStats, type StatsTotals } from "@/features/stats/stats";
import { cn } from "@/lib/utils";

function Kpi({ label, value, hint, hidden }: { label: string; value: string; hint?: string; hidden?: boolean }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-background p-4 ring-1 ring-border">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={cn("font-heading text-3xl font-extrabold tabular-nums", hidden && "text-muted-foreground")}>{value}</dd>
      {hint ? <dd className="text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

function Delta({ now, before }: { now: number | null; before: number | null }) {
  const t = useTranslations("Stats");
  if (now === null || before === null) return <span className="text-muted-foreground">—</span>;
  const diff = Math.round((now - before) * 10) / 10;
  return (
    <span className={cn("tabular-nums", diff > 0 && "text-success", diff < 0 && "text-destructive")}>
      {diff > 0 ? "+" : ""}
      {diff}
      <span className="sr-only"> {t("compare.vsPrevious")}</span>
    </span>
  );
}

/**
 * Panel de estadísticas de la comunidad: solo agregados y NUNCA minutos por persona. Lo que involucra a menos de 5 personas
 * llega oculto desde la base y aquí se muestra como "oculto", sin pistas.
 */
export function StatsScreen({ stats, communityId }: { stats: CommunityStats; communityId: string }) {
  const t = useTranslations("Stats");
  const format = useFormatter();
  const totals = summarize(stats.weeks, stats.people_in_period);
  const comparison = stats.level === "history" ? compare(stats.weeks, stats.people_in_period) : null;
  const hiddenText = t("hidden");
  const num = (value: number | null) => (value === null ? hiddenText : format.number(value));
  const maxHours = Math.max(1, ...stats.weeks.map((week) => (week.person_minutes ?? 0) / 60));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-muted-foreground">{stats.level === "history" ? t("introHistory") : t("introRecent")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("privacy")}</p>
        </div>
        <a href={`/api/communities/${communityId}/stats`} download className={buttonVariants({ size: "sm", variant: "secondary" }) + " text-foreground"}>
          <Download className="size-4" aria-hidden="true" />
          {t("csv")}
        </a>
      </header>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi label={t("kpi.hours")} value={totals.personHours === null ? hiddenText : `${format.number(totals.personHours)} h`} hint={totals.personHours === null ? t("hiddenHint") : undefined} hidden={totals.personHours === null} />
        <Kpi label={t("kpi.rooms")} value={format.number(totals.rooms)} />
        <Kpi label={t("kpi.requestsNew")} value={format.number(totals.requestsNew)} />
        <Kpi label={t("kpi.requestsAnswered")} value={format.number(totals.requestsAnswered)} />
        <Kpi label={t("kpi.devotionals")} value={num(totals.devotionalsRead)} hint={totals.devotionalsRead === null ? t("hiddenHint") : undefined} hidden={totals.devotionalsRead === null} />
        <Kpi label={t("kpi.members")} value={format.number(totals.membersEnd)} hint={t("kpi.membersGrowth", { count: totals.membersEnd - totals.membersStart })} />
      </dl>

      {comparison ? (
        <section aria-labelledby="compare-title" className="flex flex-col gap-3">
          <h2 id="compare-title" className="font-heading text-lg font-bold">
            {t("compare.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("compare.body")}</p>
          <table className="w-full max-w-xl text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-semibold">
                  {t("compare.metric")}
                </th>
                <th scope="col" className="py-2 pr-3 font-semibold">
                  {t("compare.current")}
                </th>
                <th scope="col" className="py-2 pr-3 font-semibold">
                  {t("compare.previous")}
                </th>
                <th scope="col" className="py-2 font-semibold">
                  {t("compare.change")}
                </th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["kpi.hours", (x: StatsTotals) => x.personHours],
                  ["kpi.rooms", (x: StatsTotals) => x.rooms],
                  ["kpi.requestsNew", (x: StatsTotals) => x.requestsNew],
                  ["kpi.requestsAnswered", (x: StatsTotals) => x.requestsAnswered],
                  ["kpi.devotionals", (x: StatsTotals) => x.devotionalsRead],
                ] as const
              ).map(([key, pick]) => (
                <tr key={key} className="border-t border-border/60">
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    {t(key)}
                  </th>
                  <td className="py-2 pr-3 tabular-nums">{num(pick(comparison.current))}</td>
                  <td className="py-2 pr-3 tabular-nums">{num(pick(comparison.previous))}</td>
                  <td className="py-2">
                    <Delta now={pick(comparison.current)} before={pick(comparison.previous)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section aria-labelledby="weeks-title" className="flex flex-col gap-3">
        <h2 id="weeks-title" className="font-heading text-lg font-bold">
          {t("weeks.title")}
        </h2>
        <div className="overflow-x-auto rounded-2xl bg-background ring-1 ring-border">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">{t("weeks.caption")}</caption>
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t("weeks.week")}
                </th>
                <th scope="col" className="px-2 py-3 font-semibold">
                  {t("kpi.hours")}
                </th>
                <th scope="col" className="px-2 py-3 font-semibold">
                  {t("weeks.avg")}
                </th>
                <th scope="col" className="px-2 py-3 font-semibold">
                  {t("kpi.rooms")}
                </th>
                <th scope="col" className="px-2 py-3 font-semibold">
                  {t("weeks.requests")}
                </th>
                <th scope="col" className="px-2 py-3 font-semibold">
                  {t("kpi.devotionals")}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t("kpi.members")}
                </th>
              </tr>
            </thead>
            <tbody>
              {[...stats.weeks].reverse().map((week) => {
                const hours = week.person_minutes === null ? null : week.person_minutes / 60;
                return (
                  <tr key={week.week_start} className="border-t border-border/60">
                    <th scope="row" className="px-4 py-2 text-left font-normal">
                      {format.dateTime(new Date(`${week.week_start}T00:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" })}
                    </th>
                    <td className="px-2 py-2">
                      {hours === null ? (
                        <span className="text-muted-foreground">{week.had_attendance ? hiddenText : "0"}</span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <span className="tabular-nums">{format.number(Math.round(hours * 10) / 10)}</span>
                          <span aria-hidden="true" className="h-2 rounded-full bg-brand-gradient" style={{ width: `${Math.max(4, (hours / maxHours) * 80)}px` }} />
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 tabular-nums">{week.avg_participants === null ? (week.had_attendance ? hiddenText : "—") : format.number(week.avg_participants)}</td>
                    <td className="px-2 py-2 tabular-nums">{week.rooms}</td>
                    <td className="px-2 py-2 tabular-nums">
                      {week.requests_new} / {week.requests_answered}
                    </td>
                    <td className="px-2 py-2 tabular-nums">{week.devotionals_read === null ? (week.had_devotional_reads ? hiddenText : "0") : week.devotionals_read}</td>
                    <td className="px-4 py-2 tabular-nums">{week.members}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">{t("weeks.note")}</p>
      </section>
    </div>
  );
}
