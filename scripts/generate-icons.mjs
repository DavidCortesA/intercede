/**
 * Genera los íconos PWA y favicons en public/icons/ a partir del símbolo oficial
 * (public/brand/logo-mark-white.svg) sobre el degradado de marca violeta → azul
 * (variante "a" del CLAUDE.md §8.1). No modifica el logo: solo lo coloca sobre el fondo.
 *
 * Uso: node scripts/generate-icons.mjs
 */
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const outDir = fileURLToPath(new URL("../public/icons/", import.meta.url));
const markSvg = await readFile(new URL("../public/brand/logo-mark-white.svg", import.meta.url));

function background(size, rounded) {
  const radius = rounded ? Math.round(size * 0.22) : 0;
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#5B2EE6"/>
          <stop offset="1" stop-color="#2563FF"/>
        </linearGradient>
      </defs>
      <rect width="${size}" height="${size}" rx="${radius}" fill="url(#g)"/>
    </svg>`);
}

/** `markRatio`: ancho del símbolo respecto al lienzo (maskable exige que quepa en la zona segura del 80 %). */
async function render({ file, size, rounded, markRatio }) {
  const mark = await sharp(markSvg, { density: 300 })
    .resize({ width: Math.round(size * markRatio) })
    .png()
    .toBuffer();

  await sharp(background(size, rounded))
    .composite([{ input: mark, gravity: "center" }])
    .png()
    .toFile(`${outDir}${file}`);
  console.log(`✓ public/icons/${file}`);
}

const targets = [
  { file: "icon-32.png", size: 32, rounded: true, markRatio: 0.8 },
  { file: "icon-48.png", size: 48, rounded: true, markRatio: 0.8 },
  { file: "icon-192.png", size: 192, rounded: true, markRatio: 0.66 },
  { file: "icon-512.png", size: 512, rounded: true, markRatio: 0.66 },
  // Maskable: fondo a sangre y símbolo dentro de la zona segura
  { file: "icon-maskable-512.png", size: 512, rounded: false, markRatio: 0.56 },
  // iOS aplica sus propias esquinas redondeadas
  { file: "apple-touch-icon.png", size: 180, rounded: false, markRatio: 0.62 },
];

await mkdir(outDir, { recursive: true });
for (const target of targets) await render(target);
