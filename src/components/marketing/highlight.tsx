import type { ReactNode } from "react";

/** Palabra clave resaltada con el color primario y un subrayado de trazo suave (CLAUDE.md §8.4). */
export function Highlight({ children }: { children: ReactNode }) {
  return (
    <span className="relative inline-block text-primary-text">
      {children}
      <svg
        aria-hidden="true"
        viewBox="0 0 200 12"
        preserveAspectRatio="none"
        className="absolute -bottom-[0.08em] left-0 h-[0.16em] w-full"
      >
        <path d="M2 8 C 50 2, 120 2, 198 7" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      </svg>
    </span>
  );
}
