// Generates PWA PNG icons from an inline SVG (no design tools needed).
// Run with: npm run icons
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const BG = "#0c0d10";
const ACCENT = "#ccff33";

// content = the lime mark (ring + upward chevrons = "progress / go").
const mark = (cx, cy, s) => `
  <g transform="translate(${cx},${cy})">
    <circle r="${s}" fill="none" stroke="${ACCENT}" stroke-width="${s * 0.16}"
            stroke-linecap="round" stroke-dasharray="${s * 4.2} ${s * 1.7}"
            transform="rotate(120)"/>
    <path d="M ${-s * 0.45} ${s * 0.15} L 0 ${-s * 0.3} L ${s * 0.45} ${s * 0.15}"
          fill="none" stroke="${ACCENT}" stroke-width="${s * 0.16}"
          stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M ${-s * 0.45} ${s * 0.5} L 0 ${s * 0.05} L ${s * 0.45} ${s * 0.5}"
          fill="none" stroke="${ACCENT}" stroke-width="${s * 0.16}"
          stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;

// Standard icon: rounded-square background, mark at 56% of canvas.
const standard = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.22}" fill="${BG}"/>
  ${mark(size / 2, size / 2, size * 0.28)}
</svg>`;

// Maskable icon: full-bleed background, mark kept inside the safe zone (smaller).
const maskable = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  ${mark(size / 2, size / 2, size * 0.22)}
</svg>`;

const out = "public/icons";
await mkdir(out, { recursive: true });

const jobs = [
  ["icon-192.png", standard(192)],
  ["icon-512.png", standard(512)],
  ["maskable-512.png", maskable(512)],
];

for (const [name, svg] of jobs) {
  await sharp(Buffer.from(svg)).png().toFile(`${out}/${name}`);
  console.log("wrote", `${out}/${name}`);
}
