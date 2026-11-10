import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SectionHeading({
  eyebrow,
  title,
  className,
}: {
  eyebrow: string;
  title: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("reveal max-w-3xl", className)}>
      <p className="text-xs font-bold uppercase tracking-[0.28em] text-primary-text">{eyebrow}</p>
      <h2 className="mt-4 font-heading text-[clamp(2rem,4.5vw,3.5rem)] font-extrabold leading-[1.05] text-balance">
        {title}
      </h2>
    </div>
  );
}

/** Contenedor centrado con los márgenes laterales de la landing. */
export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-6xl px-5 sm:px-8", className)}>{children}</div>;
}
