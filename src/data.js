// The 4-week training plan. This is the single source of truth: edit a day here
// and the whole app (rows, "next up", stats, charts) updates from it.
export const WEEKS = [
  { n: 1, label: "Foundation", days: [
    { d: "MON", type: "run", title: "4 km", detail: "Run 6 min / walk 1 min", km: 4 },
    { d: "TUE", type: "easy", title: "Easy 2–3 km", detail: "Slow jog or 30 min walk", km: 2.5 },
    { d: "WED", type: "run", title: "4.5 km", detail: "Run 6 / walk 1", km: 4.5 },
    { d: "THU", type: "easy", title: "Easy 2–3 km", detail: "Slow jog or walk", km: 2.5 },
    { d: "FRI", type: "run", title: "5 km", detail: "Run 6 / walk 1 — first 5 km!", km: 5 },
    { d: "SAT", type: "rest", title: "Walk or rest", detail: "30 min walk, or full rest", km: 0 },
    { d: "SUN", type: "run", title: "4 km", detail: "Easy continuous", km: 4 },
  ]},
  { n: 2, label: "Extend", days: [
    { d: "MON", type: "run", title: "5 km", detail: "Run 8 / walk 1", km: 5 },
    { d: "TUE", type: "easy", title: "Easy 3 km", detail: "Slow jog", km: 3 },
    { d: "WED", type: "run", title: "4 km", detail: "Continuous, no walking", km: 4 },
    { d: "THU", type: "easy", title: "Easy 2–3 km", detail: "Jog or walk", km: 2.5 },
    { d: "FRI", type: "run", title: "5 km", detail: "Run 10 / walk 1", km: 5 },
    { d: "SAT", type: "rest", title: "Walk or rest", detail: "Keep it light", km: 0 },
    { d: "SUN", type: "run", title: "5 km", detail: "Only 1–2 walk breaks", km: 5 },
  ]},
  { n: 3, label: "Hit 5 km", days: [
    { d: "MON", type: "run", title: "5 km", detail: "Attempt continuous", km: 5 },
    { d: "TUE", type: "easy", title: "Easy 3 km", detail: "Slow jog", km: 3 },
    { d: "WED", type: "run", title: "4 km", detail: "Continuous, relaxed", km: 4 },
    { d: "THU", type: "rest", title: "Walk or rest", detail: "Recover", km: 0 },
    { d: "FRI", type: "run", title: "5 km", detail: "Continuous 🎉", km: 5 },
    { d: "SAT", type: "easy", title: "Easy walk", detail: "Loose legs", km: 2 },
    { d: "SUN", type: "run", title: "5 km", detail: "Continuous, comfortable", km: 5 },
  ]},
  { n: 4, label: "Lock it in", days: [
    { d: "MON", type: "run", title: "5 km", detail: "Easy continuous", km: 5 },
    { d: "TUE", type: "easy", title: "Easy 3 km", detail: "Jog", km: 3 },
    { d: "WED", type: "run", title: "5 km", detail: "Steady", km: 5 },
    { d: "THU", type: "rest", title: "Walk or rest", detail: "Recover", km: 0 },
    { d: "FRI", type: "run", title: "5 km", detail: "Easy", km: 5 },
    { d: "SAT", type: "rest", title: "Rest", detail: "Full rest", km: 0 },
    { d: "SUN", type: "rest", title: "Rest", detail: "Arrive fresh!", km: 0 },
  ]},
];

// Flattened day list. `key` (w{week}d{index}) joins the static plan to user progress.
export const FLAT = WEEKS.flatMap((w) => w.days.map((day, di) => ({ ...day, key: `w${w.n}d${di}`, week: w.n })));
export const TOTAL = FLAT.length;

// Color palette — use these tokens instead of hardcoding hex values.
export const C = {
  bg: "#0b0c0f", surface: "#15171c", surface2: "#1c1f26", line: "#272b34",
  text: "#f2f3ef", dim: "#9298a4", accent: "#c8f73c", run: "#c8f73c",
  easy: "#45dcc2", rest: "#5c6373", warn: "#ff6a3d",
};
export const typeColor = (t) => (t === "run" ? C.run : t === "easy" ? C.easy : C.rest);
