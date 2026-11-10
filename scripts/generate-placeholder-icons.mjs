/**
 * Genera íconos PWA PLACEHOLDER (sin logo) en public/icons/.
 * Es un marcador temporal: un recuadro con el degradado de marca y una barra vertical.
 * NO es el logo ni lo aproxima. Se elimina cuando lleguen los archivos oficiales en
 * public/brand/ (CLAUDE.md §8.1) y los íconos se generen desde la variante (a) o (b).
 *
 * Uso: node scripts/generate-placeholder-icons.mjs
 */
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const outDir = fileURLToPath(new URL("../public/icons/", import.meta.url));

const gradient = `
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5B2EE6"/>
      <stop offset="1" stop-color="#2563FF"/>
    </linearGradient>
  </defs>`;

/** `safe`: fracción del lienzo que ocupa el contenido (maskable exige ≤ 0.8). */
function svg(size, { rounded, safe }) {
  const radius = rounded ? Math.round(size * 0.22) : 0;
  const barW = size * safe * 0.16;
  const barH = size * safe * 0.62;
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      ${gradient}
      <rect width="${size}" height="${size}" rx="${radius}" fill="url(#g)"/>
      <rect x="${(size - barW) / 2}" y="${(size - barH) / 2}" width="${barW}" height="${barH}" rx="${barW / 2}" fill="#FFFFFF"/>
    </svg>`);
}

const targets = [
  { file: "icon-192.png", size: 192, rounded: true, safe: 0.9 },
  { file: "icon-512.png", size: 512, rounded: true, safe: 0.9 },
  { file: "icon-maskable-512.png", size: 512, rounded: false, safe: 0.7 },
  { file: "apple-touch-icon.png", size: 180, rounded: false, safe: 0.8 },
];

await mkdir(outDir, { recursive: true });
for (const { file, size, rounded, safe } of targets) {
  await sharp(svg(size, { rounded, safe })).png().toFile(`${outDir}${file}`);
  console.log(`✓ public/icons/${file}`);
}
