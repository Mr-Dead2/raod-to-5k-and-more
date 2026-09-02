// Race goals beyond the starter plan.
//
// Once the 5K is in the bag the app needs a new target, so this module holds
// the race catalogue, the maths that turns a known performance into a
// predicted finish time at another distance, and a readiness read-out.
//
// Prediction uses Riegel's endurance formula, T2 = T1 * (D2/D1)^1.06, which is
// the standard rule of thumb for equivalent race times. It is optimistic for
// big extrapolations (a 5K does not honestly predict a marathon), so
// `confidence()` grades how far the guess is being stretched and the UI says so.

export const RACES = [
  { id: "1k",   name: "1K",            short: "1K",   chip: "1K",       km: 1 },
  { id: "5k",   name: "5K",            short: "5K",   chip: "5K",       km: 5 },
  { id: "10k",  name: "10K",           short: "10K",  chip: "10K",      km: 10 },
  { id: "half", name: "Half marathon", short: "HALF", chip: "Half",     km: 21.0975 },
  { id: "full", name: "Marathon",      short: "FULL", chip: "Marathon", km: 42.195 },
];

export const RIEGEL_EXP = 1.06;

export const raceById = (id) => RACES.find((r) => r.id === id) || null;

// Equivalent finish time at targetKm, given a time over baseKm.
export function riegel(baseSec, baseKm, targetKm) {
  if (!(baseSec > 0) || !(baseKm > 0) || !(targetKm > 0)) return 0;
  return baseSec * Math.pow(targetKm / baseKm, RIEGEL_EXP);
}

// How much to trust a prediction: extrapolating a long way is a guess.
export function confidence(baseKm, targetKm) {
  if (!(baseKm > 0) || !(targetKm > 0)) return "none";
  const ratio = targetKm / baseKm;
  if (ratio <= 1.6 && ratio >= 0.5) return "high";
  if (ratio <= 3) return "fair";
  return "rough";
}

export const CONFIDENCE_LABEL = { high: "solid estimate", fair: "fair estimate", rough: "rough guess", none: "" };

// Pick the best reference performance from logged runs: the longest run wins
// ties because a longer effort extrapolates more honestly than a short fast one.
// `runs` are { km, sec } pairs. Returns { km, sec, paceSec } or null.
export function bestReference(runs) {
  let best = null;
  for (const r of runs || []) {
    const km = parseFloat(r.km), sec = parseFloat(r.sec);
    if (!(km > 0.8) || !(sec > 60)) continue;
    // Score by Riegel-equivalent 5K time; the fastest equivalent is the best
    // shape signal, and among equals the longer run is the safer base.
    const eq = riegel(sec, km, 5);
    if (!best || eq < best.eq - 1 || (Math.abs(eq - best.eq) <= 1 && km > best.km)) {
      best = { km, sec, eq, paceSec: sec / km };
    }
  }
  if (!best) return null;
  return { km: best.km, sec: best.sec, paceSec: best.paceSec };
}

// Predicted finish for every race in the catalogue.
export function predictAll(ref) {
  if (!ref) return [];
  return RACES.map((race) => ({
    race,
    sec: riegel(ref.sec, ref.km, race.km),
    confidence: confidence(ref.km, race.km),
  }));
}

// Readiness for a target distance: your longest run as a share of the race,
// capped at 100. Runners are generally race-ready once they can cover ~80% of
// the distance in training (the full distance for anything up to 10K).
export function readiness(longestKm, targetKm) {
  if (!(targetKm > 0)) return 0;
  const need = targetKm <= 10 ? targetKm : targetKm * 0.8;
  return Math.max(0, Math.min(100, Math.round(((longestKm || 0) / need) * 100)));
}

export function daysUntil(iso) {
  if (!iso) return null;
  const target = new Date(iso + "T00:00:00");
  if (isNaN(target)) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000);
}

// h:mm:ss for anything an hour or longer, else m:ss.
export function fmtDuration(sec) {
  if (!(sec > 0)) return "—";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

export const DEFAULT_GOAL_RACE = "10k";
