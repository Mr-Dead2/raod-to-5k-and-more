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
// Design tokens. Everything reads `C` at render time, so mutating it in place
// (applyAccent) plus a re-render is enough to re-theme the whole app.
// ---------------------------------------------------------------------------
export const C = {
  bg: "#07080b",          // page ground
  bgSoft: "#0b0d11",      // inputs / recessed wells
  surface: "#121419",     // primary card
  surface2: "#181b22",    // nested card / chip
  surface3: "#20242d",    // hover / raised chip
  line: "#242833",        // hairline border
  line2: "#333949",       // stronger border
  text: "#f5f6f4",
  dim: "#8d93a1",
  dim2: "#636876",
  accent: "#c8f73c",      // primary accent (swapped by applyAccent)
  accent2: "#4be8a0",     // gradient partner for the accent
  run: "#c8f73c",
  easy: "#45dcc2",
  rest: "#5c6373",
  warn: "#ff6a3d",
  good: "#3ddc97",
  // derived, kept in sync by applyAccent()
  grad: "linear-gradient(135deg,#c8f73c 0%,#4be8a0 100%)",
  gradSoft: "linear-gradient(135deg,#c8f73c22 0%,#4be8a018 100%)",
  glow: "0 10px 34px -14px #c8f73c99",
};
export const typeColor = (t) => (t === "run" ? C.run : t === "easy" ? C.easy : C.rest);

// Accents ship in pairs so every gradient in the app stays on-brand.
export const ACCENTS = [
  { id: "lime",   name: "Lime",   accent: "#c8f73c", accent2: "#4be8a0" },
  { id: "sky",    name: "Sky",    accent: "#5cc8ff", accent2: "#8b7bff" },
  { id: "gold",   name: "Gold",   accent: "#ffd84d", accent2: "#ff8a3d" },
  { id: "violet", name: "Violet", accent: "#c08bff", accent2: "#ff7ad9" },
  { id: "ember",  name: "Ember",  accent: "#ff7a45", accent2: "#ffc24d" },
  { id: "mint",   name: "Mint",   accent: "#3ddc97", accent2: "#29c5f6" },
];

export function applyAccent(id) {
  const a = ACCENTS.find((x) => x.id === id) || ACCENTS[0];
  C.accent = a.accent;
  C.accent2 = a.accent2;
  C.run = a.accent;
  C.grad = `linear-gradient(135deg,${a.accent} 0%,${a.accent2} 100%)`;
  C.gradSoft = `linear-gradient(135deg,${a.accent}22 0%,${a.accent2}18 100%)`;
  C.glow = `0 10px 34px -14px ${a.accent}99`;
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
export const tint = (hex, alpha) => {
  const h = String(hex).replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};
