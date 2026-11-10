import type { ReactNode } from "react";
import { Wordmark } from "@/components/marketing/wordmark";
import { Link } from "@/i18n/navigation";

/** Pantalla centrada y oscura para entrar a una sala o explicar por qué no se puede (sin distracciones). */
export function RoomShell({ children }: { children: ReactNode }) {
  return (
    <main
      id="contenido"
      className="dark flex min-h-dvh flex-col items-center justify-center gap-8 bg-brand-dusk px-6 py-10 text-center text-foreground"
    >
      <Link href="/" className="rounded-lg">
        <Wordmark className="h-8" />
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
