// Generates the source images for the native app icon + splash screen, then
// (separately) `npx @capacitor/assets generate` slices them into every density.
// Run via: npm run android:assets
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const BG = "#0c0d10";
const ACCENT = "#ccff33";

const mark = (cx, cy, s) => `
  <g transform="translate(${cx},${cy})">
    <circle r="${s}" fill="none" stroke="${ACCENT}" stroke-width="${s * 0.16}"
            stroke-linecap="round" stroke-dasharray="${s * 4.2} ${s * 1.7}" transform="rotate(120)"/>
    <path d="M ${-s * 0.45} ${s * 0.15} L 0 ${-s * 0.3} L ${s * 0.45} ${s * 0.15}"
          fill="none" stroke="${ACCENT}" stroke-width="${s * 0.16}" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M ${-s * 0.45} ${s * 0.5} L 0 ${s * 0.05} L ${s * 0.45} ${s * 0.5}"
          fill="none" stroke="${ACCENT}" stroke-width="${s * 0.16}" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;

const icon = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>${mark(size / 2, size / 2, size * 0.26)}</svg>`;

const splash = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>${mark(size / 2, size / 2, size * 0.12)}</svg>`;

await mkdir("assets", { recursive: true });
const jobs = [
  ["assets/icon.png", icon(1024)],
  ["assets/icon-foreground.png", `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${mark(512, 512, 1024 * 0.2)}</svg>`],
  ["assets/icon-background.png", `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="${BG}"/></svg>`],
  ["assets/splash.png", splash(2732)],
  ["assets/splash-dark.png", splash(2732)],
];
for (const [name, svg] of jobs) {
  await sharp(Buffer.from(svg)).png().toFile(name);
  console.log("wrote", name);
}
