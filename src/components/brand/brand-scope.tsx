import type { CSSProperties, ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * Aplica la marca de una comunidad (CLAUDE.md §16 B6) a lo que envuelve: el color de acento reemplaza al degradado de los
 * botones y pastillas (texto blanco; el contraste AA ya lo garantizó la base al guardarlo) y, en pantallas claras, al color
 * de los enlaces. Sin marca no hace nada. Solo un color: el logo y el nombre se muestran con `BrandBadge`.
 */
export function BrandScope({ accent, mode, className, children }: { accent: string | null; mode: "light" | "dark"; className?: string; children: ReactNode }) {
  if (!accent) return <div className={className}>{children}</div>;
  return (
    <div data-brand={mode} style={{ "--brand-accent": accent } as CSSProperties} className={className}>
      {children}
    </div>
  );
}

/** "Con tecnología de INTERCEDE": SIEMPRE visible donde hay marca de una comunidad. */
export function PoweredBy({ label, className }: { label: string; className?: string }) {
  return (
    <p className={cn("text-center text-xs text-muted-foreground", className)}>
      <Link href="/" className="underline-offset-4 hover:underline">
        {label}
      </Link>
    </p>
  );
}
