// The 4-week training plan. This is the single source of truth: edit a day here
// and the whole app (rows, "next up", stats, charts) updates from it.
//
// It's a properly periodised build, not "just run 5 km every day": each week
// mixes session types — intervals (run/walk or hard/easy), a tempo, easy
// recovery runs and one weekly long run — and weekly volume ramps up for three
// weeks (≈15→17→20 km) then tapers in week 4 into a goal 5K. The long run grows
// past 5 km in week 3 so race day feels comfortable. "run N min / walk N min"
// strings are parsed by the interval cues (RunTracker.parseInterval), so keep
// that exact wording on run/walk days.
//
// `DEFAULT_WEEKS` is the built-in plan. The *active* plan (`WEEKS`) can be
// replaced/extended at runtime by `applyPlan()` — e.g. the AI coach appending a
// "beyond 5K" block. Everything imports the live `WEEKS`/`FLAT`/`TOTAL` bindings,
// so swapping the plan + a re-render updates rows, stats, charts and history.
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

// Flatten a weeks array into a day list. `key` (w{week}d{index}) joins the plan
// to user progress, so any progress read/write must use that exact format.
const flatten = (weeks) => weeks.flatMap((w) => w.days.map((day, di) => ({ ...day, key: `w${w.n}d${di}`, week: w.n })));

// The active plan. `let` so applyPlan() can swap it; importers see live bindings.
export let WEEKS = DEFAULT_WEEKS;
export let FLAT = flatten(WEEKS);
export let TOTAL = FLAT.length;

// Swap the active plan (e.g. an AI-extended one). Pass a falsy/empty value to
// fall back to the built-in plan. Re-derives FLAT/TOTAL in place.
export function applyPlan(weeks) {
  WEEKS = Array.isArray(weeks) && weeks.length ? weeks : DEFAULT_WEEKS;
  FLAT = flatten(WEEKS);
  TOTAL = FLAT.length;
  return WEEKS;
}

// Color palette — use these tokens instead of hardcoding hex values.
export const C = {
  bg: "#0a0b0d", surface: "#131519", surface2: "#1b1e24", line: "#22262d",
  text: "#f4f5f2", dim: "#8e94a0", accent: "#c8f73c", run: "#c8f73c",
  easy: "#45dcc2", rest: "#5c6373", warn: "#ff6a3d",
};
export const typeColor = (t) => (t === "run" ? C.run : t === "easy" ? C.easy : C.rest);

// Selectable accent themes. Everything reads colors from `C` at render time,
// so switching is just mutating the palette and re-rendering.
export const ACCENTS = [
  { id: "lime", name: "Lime", accent: "#c8f73c" },
  { id: "sky", name: "Sky", accent: "#5cc8ff" },
  { id: "gold", name: "Gold", accent: "#ffd84d" },
  { id: "violet", name: "Violet", accent: "#c08bff" },
];
export function applyAccent(id) {
  const a = ACCENTS.find((x) => x.id === id) || ACCENTS[0];
  C.accent = a.accent;
  C.run = a.accent; // run sessions are highlighted in the accent colour
  return a.id;
}
