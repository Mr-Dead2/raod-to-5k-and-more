// ---------------------------------------------------------------------------
// Distance units.
//
// **Kilometres are the canonical unit and nothing here changes that.** Every
// stored value — a log entry's `km`, a plan day's `km`, splits, GPS distance,
// race distances — stays metric on disk and in every calculation. This module
// only converts at the edges, where a number is shown to someone or typed in
// by them. That keeps one unit in the maths, keeps backups portable between a
// metric and an imperial phone, and means switching units can never rewrite
// the user's history.
//
// The setting lives at `unit` in `run5k:settings`. `main.jsx` applies the
// persisted choice before first render, and (like the accent) everything reads
// the live `U` object at render time, so flipping it plus a re-render is
// enough to re-label the whole app.
// ---------------------------------------------------------------------------

export const KM_PER_MILE = 1.609344;

export const UNITS = [
  { id: "km", name: "Kilometres", short: "km", paceLabel: "min / km" },
  { id: "mi", name: "Miles", short: "mi", paceLabel: "min / mile" },
];

// Mutated in place by setUnit(), like the `C` palette. Read at render time.
export const U = { id: "km", short: "km", paceLabel: "min / km" };

export const isMiles = () => U.id === "mi";

export function setUnit(id) {
  const u = UNITS.find((x) => x.id === id) || UNITS[0];
  U.id = u.id;
  U.short = u.short;
  U.paceLabel = u.paceLabel;
  return U.id;
}

// --- conversion -------------------------------------------------------------

/** Canonical km → the number to display. */
export const toDisplay = (km) => {
  const n = parseFloat(km);
  if (!isFinite(n)) return 0;
  return isMiles() ? n / KM_PER_MILE : n;
};

/** A number the user typed → canonical km. */
export const fromDisplay = (v) => {
  const n = parseFloat(v);
  if (!isFinite(n)) return 0;
  return isMiles() ? n * KM_PER_MILE : n;
};

/** Seconds per km → seconds per displayed unit. */
export const paceToDisplay = (secPerKm) => {
  const n = parseFloat(secPerKm);
  if (!isFinite(n) || n <= 0) return 0;
  return isMiles() ? n * KM_PER_MILE : n;
};

/** Metres per second → the speed number to display (km/h or mph). */
export const speedToDisplay = (ms) => {
  const n = parseFloat(ms);
  if (!isFinite(n) || n <= 0) return 0;
  return isMiles() ? n * 2.2369362920544 : n * 3.6;
};

// --- formatting -------------------------------------------------------------

/** "5.20" — the distance number alone, for when the unit is labelled separately. */
export const fmtDistNum = (km, digits = 2) => toDisplay(km).toFixed(digits);

/** "5.20 km" / "3.23 mi" */
export const fmtDist = (km, digits = 2) => `${fmtDistNum(km, digits)} ${U.short}`;

/** m:ss for the displayed unit, or null when there is no pace to show. */
export const fmtPace = (secPerKm) => {
  const s = paceToDisplay(secPerKm);
  if (!(s > 0) || !isFinite(s)) return null;
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
};

/** "5:12 /km" — pace with its unit, or a dash when unknown. */
export const fmtPaceUnit = (secPerKm) => {
  const p = fmtPace(secPerKm);
  return p ? `${p} /${U.short}` : "—";
};

export const speedLabel = () => (isMiles() ? "mph" : "km/h");

/** Elevation stays metric unless the user is on miles, where feet are expected. */
export const fmtElev = (metres) => {
  const n = parseFloat(metres);
  if (!isFinite(n) || n === 0) return `0 ${isMiles() ? "ft" : "m"}`;
  return isMiles() ? `${Math.round(n * 3.280839895)} ft` : `${Math.round(n)} m`;
};

/** Body weight: kilograms, or pounds for someone on miles. */
export const fmtWeight = (kg) => (isMiles() ? `${Math.round(kg * 2.2046226218)} lb` : `${Math.round(kg)} kg`);
export const weightStep = () => (isMiles() ? 0.45359237 : 1); // 1 lb vs 1 kg

/**
 * What a split is called — always per KILOMETRE, whatever the display unit.
 *
 * The tracker records a split each time the run crosses a whole kilometre, and
 * that is what is stored. Mile splits cannot be derived from km splits without
 * interpolating between them, which would be inventing times the runner never
 * ran. Rather than fabricate, the label says "km" explicitly even on miles, so
 * a mile-using runner is never misled about what the number means.
 */
export const splitLabel = (i) => `${i + 1} km`;
