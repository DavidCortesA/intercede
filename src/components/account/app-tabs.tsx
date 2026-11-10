"use client";

import { BookHeart, History, Mic, UserRound, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const TABS: { key: "pray" | "journal" | "rooms" | "profile"; href: string; icon: LucideIcon; accountOnly: boolean }[] = [
  { key: "pray", href: "/orar", icon: Mic, accountOnly: false },
  { key: "journal", href: "/diario", icon: BookHeart, accountOnly: true },
  { key: "rooms", href: "/salas", icon: History, accountOnly: true },
  { key: "profile", href: "/perfil", icon: UserRound, accountOnly: false },
];

/**
 * Navegación progresiva (CLAUDE.md §8.4): quien ora como invitado solo ve Orar y Perfil; Diario y
 * Salas aparecen al crear una cuenta.
 */
export function AppTabs({ isGuest }: { isGuest: boolean }) {
  const t = useTranslations("Tabs");
  const pathname = usePathname();
  const tabs = TABS.filter((tab) => !(isGuest && tab.accountOnly));

  return (
    <nav
      aria-label={t("label")}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-2xl justify-around px-2">
        {tabs.map(({ key, href, icon: Icon }) => {
          const active = pathname === href;
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-w-16 flex-col items-center gap-1 px-3 py-2.5 text-[11px] font-semibold transition-colors",
                  active ? "text-primary-text" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
