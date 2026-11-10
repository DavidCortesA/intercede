/**
 * Paisaje decorativo: montaña al atardecer con silueta de cruz (CLAUDE.md §8.4).
 * Es ilustración propia en SVG (no es el logo), pensada para el pie del héroe.
 */
export function MountainScene({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 1440 420"
      preserveAspectRatio="xMidYMax slice"
      className={className}
    >
      <defs>
        <radialGradient id="sun" cx="50%" cy="100%" r="60%">
          <stop offset="0" stopColor="#F5A640" stopOpacity="0.85" />
          <stop offset="0.35" stopColor="#F5A640" stopOpacity="0.18" />
          <stop offset="1" stopColor="#F5A640" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="720" cy="430" rx="620" ry="330" fill="url(#sun)" />
      <path
        d="M0 420V300l140-90 120 80 150-130 130 110 120-70 180 90 130-120 140 110 140-90 130 120v110z"
        fill="#161a6b"
        opacity="0.85"
      />
      <path d="M0 420V355l200-115 100 60 170-130 130 90 120-165 140 160 120-80 130 100 140-90 190 130v100z" fill="#0A1240" />
      {/* Cruz sobre la cima central (cima en x=720, y=95) */}
      <g transform="translate(708 53)" fill="#F5A640">
        <rect x="9" y="0" width="6" height="44" rx="1.5" />
        <rect x="0" y="12" width="24" height="6" rx="1.5" />
      </g>
    </svg>
  );
}
