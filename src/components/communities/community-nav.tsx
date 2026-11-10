"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { key: "wall", path: "" },
  { key: "rooms", path: "/salas" },
  { key: "events", path: "/eventos" },
  { key: "devotional", path: "/devocional" },
  { key: "members", path: "/miembros" },
] as const;

/** Secciones de una comunidad. `Ajustes` solo aparece para la administración. */
export function CommunityNav({ communityId, isAdmin, isLeader = isAdmin }: { communityId: string; isAdmin: boolean; isLeader?: boolean }) {
  const t = useTranslations("Communities.nav");
  const pathname = usePathname();
  const base = `/comunidades/${communityId}`;
  const items: { key: "wall" | "rooms" | "events" | "devotional" | "members" | "reports" | "settings"; path: string }[] = [
    ...SECTIONS,
    ...(isLeader ? [{ key: "reports" as const, path: "/reportes" }] : []),
    ...(isAdmin ? [{ key: "settings" as const, path: "/ajustes" }] : []),
  ];

  return (
    <nav aria-label={t("label")} className="-mx-5 overflow-x-auto px-5">
      <ul className="flex w-max gap-2 pb-1">
        {items.map(({ key, path }) => {
          const href = `${base}${path}`;
          const active = pathname === href;
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold transition-colors",
                  active ? "bg-brand-gradient text-white" : "bg-background ring-1 ring-border hover:ring-ring",
                )}
              >
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
