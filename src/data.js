// Training data + design tokens. The app can extend the plan beyond 5K with the AI coach.
export const DEFAULT_WEEKS = [
  { n: 1, label: "Build the base", days: [
    { d: "MON", type: "run", title: "3 km intervals", detail: "Run 5 min / walk 1 min × 4 — ease in", km: 3 },
    { d: "TUE", type: "easy", title: "Easy 2.5 km", detail: "Conversational jog or brisk walk", km: 2.5 },
    { d: "WED", type: "rest", title: "Walk or rest", detail: "20–30 min walk, or full rest", km: 0 },
    { d: "THU", type: "run", title: "3.5 km steady", detail: "Run 6 min / walk 1 min — smooth rhythm", km: 3.5 },
    { d: "FRI", type: "easy", title: "Easy 2.5 km", detail: "Loose legs, nothing hard", km: 2.5 },
    { d: "SAT", type: "run", title: "4 km long run", detail: "Run 6 min / walk 1 min — longest this week", km: 4 },
    { d: "SUN", type: "run", title: "4 km easy", detail: "Easy continuous jog — relaxed pace", km: 4 },
  ]},
  { n: 2, label: "Stretch the run", days: [
    { d: "MON", type: "run", title: "4 km intervals", detail: "Run 8 min / walk 1 min — longer run blocks", km: 4 },
    { d: "TUE", type: "easy", title: "Easy 3 km", detail: "Relaxed, steady breathing", km: 3 },
    { d: "WED", type: "rest", title: "Walk or rest", detail: "Gentle movement or full rest", km: 0 },
    { d: "THU", type: "run", title: "3 km tempo", detail: "10 min easy, 10 comfortably hard, 5 easy", km: 3 },
    { d: "FRI", type: "easy", title: "Easy 2.5 km", detail: "Keep it light", km: 2.5 },
    { d: "SAT", type: "run", title: "5 km long run", detail: "Run 10 min / walk 1 min — your first 5K", km: 5 },
    { d: "SUN", type: "rest", title: "Rest", detail: "Recover well", km: 0 },
  ]},
  { n: 3, label: "Run it continuous", days: [
    { d: "MON", type: "run", title: "5 km steady", detail: "Continuous if you can — one walk break max", km: 5 },
    { d: "TUE", type: "easy", title: "Easy 3 km", detail: "Easy aerobic jog", km: 3 },
    { d: "WED", type: "run", title: "4 km intervals", detail: "Run 4 min hard / 2 min easy × 4 — build speed", km: 4 },
    { d: "THU", type: "rest", title: "Walk or rest", detail: "Recover for the long run", km: 0 },
    { d: "FRI", type: "easy", title: "Easy 2.5 km", detail: "Shake out the legs", km: 2.5 },
    { d: "SAT", type: "run", title: "6 km long run", detail: "Continuous easy pace — go past 5K", km: 6 },
    { d: "SUN", type: "rest", title: "Rest", detail: "Big week done — rest up", km: 0 },
  ]},
  { n: 4, label: "Lock in your 5K", days: [
    { d: "MON", type: "run", title: "4 km easy", detail: "Relaxed on fresh legs", km: 4 },
    { d: "TUE", type: "easy", title: "Easy 2.5 km", detail: "Short and light", km: 2.5 },
    { d: "WED", type: "run", title: "3 km tempo", detail: "5 easy, 15 steady-strong, 5 easy — sharpen up", km: 3 },
    { d: "THU", type: "rest", title: "Walk or rest", detail: "Rest before your goal run", km: 0 },
    { d: "FRI", type: "rest", title: "Rest", detail: "Stay loose, hydrate, eat well", km: 0 },
    { d: "SAT", type: "run", title: "5 km goal run", detail: "Continuous 5K — this is the one 🎉", km: 5 },
    { d: "SUN", type: "easy", title: "Easy 3 km", detail: "Victory shakeout — you're a 5K runner", km: 3 },
  ]},
];
const flatten = (weeks) => weeks.flatMap((w) => w.days.map((day, di) => ({ ...day, key: `w${w.n}d${di}`, week: w.n })));
export let WEEKS = DEFAULT_WEEKS;
export let FLAT = flatten(WEEKS);
export let TOTAL = FLAT.length;
export function applyPlan(weeks) { WEEKS = Array.isArray(weeks) && weeks.length ? weeks : DEFAULT_WEEKS; FLAT = flatten(WEEKS); TOTAL = FLAT.length; return WEEKS; }
// ---------------------------------------------------------------------------
// Design tokens — Apple's dark appearance. Everything reads `C` at render time,
// so mutating it in place (applyAccent) plus a re-render re-themes the app.
//
// Every value is an opaque hex on purpose: tint() only understands hex, and a
// token handed to it as rgba() would silently turn into NaN. Translucent fills
// live as CSS custom properties in app.css (--fill…, --sep) and the glass
// materials in src/styles.js.
// ---------------------------------------------------------------------------
export const C = {
  bg: "#000000",          // systemBackground — true black, as in Fitness
  bgSoft: "#0e0e10",      // a well sunk into the black ground
  surface: "#1c1c1e",     // secondarySystemGroupedBackground — cells and cards
  surface2: "#2c2c2e",    // tertiary — controls nested inside a cell
  surface3: "#3a3a3c",    // systemGray4 — raised / pressed
  line: "#38383a",        // opaqueSeparator
  line2: "#48484a",       // systemGray3 — stronger stroke
  text: "#ffffff",        // label
  dim: "#8e8e93",         // systemGray — secondary label
  dim2: "#6e6e73",        // tertiary label, kept legible on #1c1c1e
  accent: "#c8f73c",      // primary accent (swapped by applyAccent)
  accent2: "#8ee03a",     // deeper tone of the same hue, for ring-style gradients
  run: "#c8f73c",
  easy: "#40cbe0",        // systemTeal
  rest: "#636366",        // systemGray2
  warn: "#ff453a",        // systemRed — errors, destructive, the End button
  good: "#30d158",        // systemGreen
  // Apple's system colours, used the way Fitness uses them: one colour per
  // kind of metric, the same everywhere it appears.
  yellow: "#ffd60a",      // time
  pink: "#ff375f",        // energy
  cyan: "#64d2ff",        // pace
  purple: "#bf5af2",      // cadence
  orange: "#ff9f0a",      // warnings that aren't errors
  blue: "#0a84ff",        // links
  gray: "#636366",        // systemGray2 — neutral badges, a switch that is on but inert
  onAccent: "#000000",    // text and glyphs drawn on an accent (or any bright) fill
  // derived, kept in sync by applyAccent()
  grad: "linear-gradient(135deg,#c8f73c 0%,#8ee03a 100%)",
  gradSoft: "linear-gradient(135deg,rgba(200,247,60,.16) 0%,rgba(142,224,58,.08) 100%)",
  glow: "0 10px 28px -14px rgba(200,247,60,.55)",
};
export const typeColor = (t) => (t === "run" ? C.run : t === "easy" ? C.easy : C.rest);

// Accents ship in pairs: the colour and a deeper tone of the same hue, so a
// gradient reads like an Activity ring rather than a rainbow.
export const ACCENTS = [
  { id: "lime",   name: "Lime",   accent: "#c8f73c", accent2: "#8ee03a" },
  { id: "sky",    name: "Sky",    accent: "#64d2ff", accent2: "#0a84ff" },
  { id: "gold",   name: "Gold",   accent: "#ffd60a", accent2: "#ff9f0a" },
  { id: "violet", name: "Violet", accent: "#bf5af2", accent2: "#5e5ce6" },
  { id: "ember",  name: "Ember",  accent: "#ff7a45", accent2: "#ff453a" },
  { id: "mint",   name: "Mint",   accent: "#63e6e2", accent2: "#30d158" },
];

export function applyAccent(id) {
  const a = ACCENTS.find((x) => x.id === id) || ACCENTS[0];
  C.accent = a.accent;
  C.accent2 = a.accent2;
  C.run = a.accent;
  C.grad = `linear-gradient(135deg,${a.accent} 0%,${a.accent2} 100%)`;
  C.gradSoft = `linear-gradient(135deg,${tint(a.accent, 0.16)} 0%,${tint(a.accent2, 0.08)} 100%)`;
  C.glow = `0 10px 28px -14px ${tint(a.accent, 0.55)}`;
  if (typeof document !== "undefined") {
    const r = document.documentElement.style;
    r.setProperty("--app-accent", a.accent);
    r.setProperty("--app-accent-2", a.accent2);
    r.setProperty("--app-grad", C.grad);
    r.setProperty("--app-glow", C.glow);
  }
  return a.id;
}

// Translucent tint of any token colour, e.g. tint(C.accent, 0.14).
export function tint(hex, alpha) {
  const h = String(hex).replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const hue = (hex) => {
  const n = parseInt(String(hex).replace("#", ""), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const hueGap = (a, b) => { const d = Math.abs(hue(a) - hue(b)); return Math.min(d, 360 - d); };

// Three ring colours in the spirit of Move / Exercise / Stand: the accent,
// then the first two system colours that stay clearly apart from it (and from
// each other), whichever accent the user picked.
export function ringColors() {
  const out = [C.accent];
  for (const c of [C.cyan, C.pink, C.yellow, C.purple, C.good]) {
    if (out.every((o) => hueGap(o, c) > 42)) out.push(c);
    if (out.length === 3) break;
  }
  return out;
}
