// Validation + normalization for training plans, especially AI-generated ones.
// The model's JSON is never trusted directly: coerce every field into the shape
// the app relies on (7 days/week, valid type/day/km, sane strings) so a wonky
// reply can't corrupt the plan, the progress keys, or the charts.
import { DEFAULT_WEEKS } from "./data.js";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const TYPES = ["run", "easy", "rest"];

const clampKm = (v) => {
  const n = Number(v);
  if (!isFinite(n) || n < 0) return 0;
  return Math.min(60, Math.round(n * 10) / 10);
};

function normalizeDay(raw, di, km) {
  const d = DAYS.includes((raw?.d || "").toUpperCase()) ? raw.d.toUpperCase() : DAYS[di];
  let type = TYPES.includes((raw?.type || "").toLowerCase()) ? raw.type.toLowerCase() : null;
  if (!type) type = km > 0 ? "run" : "rest"; // infer from distance when missing/invalid
  const title = (typeof raw?.title === "string" && raw.title.trim()) || (km > 0 ? `${km} km` : "Rest");
  const detail = (typeof raw?.detail === "string" && raw.detail.trim()) || (km > 0 ? "Steady effort" : "Recovery day");
  return { d, type, title: title.slice(0, 60), detail: detail.slice(0, 120), km: type === "rest" ? clampKm(raw?.km) : clampKm(raw?.km) };
}

function normalizeWeek(raw, n) {
  const daysRaw = Array.isArray(raw?.days) ? raw.days.slice(0, 7) : [];
  while (daysRaw.length < 7) daysRaw.push({ d: DAYS[daysRaw.length], type: "rest", km: 0 }); // pad short weeks with rest
  const days = daysRaw.map((dy, di) => normalizeDay(dy, di, clampKm(dy?.km)));
  const label = (typeof raw?.label === "string" && raw.label.trim()) || `Week ${n}`;
  return { n, label: label.slice(0, 40), days };
}

// Normalize a raw weeks array into valid week objects, numbered sequentially
// from `startN`. Caps the block length so a runaway reply can't bloat the plan.
export function normalizeWeeks(rawWeeks, startN = 1, maxWeeks = 8) {
  if (!Array.isArray(rawWeeks)) return [];
  return rawWeeks.slice(0, maxWeeks).map((w, i) => normalizeWeek(w, startN + i));
}

// Pull a weeks array out of whatever shape the model returned.
export function weeksFromModelJson(obj) {
  if (Array.isArray(obj)) return obj;
  if (Array.isArray(obj?.weeks)) return obj.weeks;
  if (Array.isArray(obj?.plan)) return obj.plan;
  return [];
}

export const maxWeekN = (weeks) => weeks.reduce((m, w) => Math.max(m, w.n || 0), 0);

// Append a normalized block to the current plan, continuing the week numbering.
export function extendPlan(currentWeeks, rawBlock) {
  const base = Array.isArray(currentWeeks) && currentWeeks.length ? currentWeeks : DEFAULT_WEEKS;
  const block = normalizeWeeks(weeksFromModelJson(rawBlock), maxWeekN(base) + 1);
  if (!block.length) return null;
  return [...base, ...block];
}
