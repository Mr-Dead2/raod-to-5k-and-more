// Importing runs recorded somewhere else, through Android's Health Connect.
//
// The case this exists for: a watch that Stride cannot run on. A Galaxy Watch 3
// is a Tizen device — no APK will ever be installed on it — but the runs it
// records reach the phone through Samsung Health, and Samsung Health syncs
// exercise sessions into Health Connect. From there they are just data, and
// Stride can pull them into its own history alongside GPS-tracked runs.
//
// The native side (android/health-connect) is a thin read-only bridge. Every
// decision — what counts as a run, which plan day a workout belongs to, what
// has already been imported — lives here, where it is plain JavaScript and can
// be reasoned about and tested without a device.
import { registerPlugin, Capacitor } from "@capacitor/core";

const HealthConnect = registerPlugin("HealthConnect");

export const healthSupported = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

// Health Connect exercise type ids (androidx.health.connect ExerciseSessionRecord).
// Only the foot-borne ones belong in a running log; a cycle ride logged as
// "12 km" would quietly wreck every pace figure and race prediction.
export const EXERCISE_TYPES = {
  56: { name: "Running", run: true },
  57: { name: "Treadmill run", run: true },
  79: { name: "Walking", run: true },
  37: { name: "Hiking", run: true },
  8:  { name: "Boot camp", run: false },
  13: { name: "Cycling", run: false },
  14: { name: "Stationary bike", run: false },
};

export const isRunLike = (type) => EXERCISE_TYPES[type]?.run === true;
export const exerciseName = (type, title) => title || EXERCISE_TYPES[type]?.name || "Workout";

// --- native calls ----------------------------------------------------------
// Each resolves rather than throwing, so the UI never has to wrap them: a
// missing provider and a refused permission are ordinary states, not errors.

export async function healthAvailability() {
  if (!healthSupported()) return "NotSupported";
  try {
    const { availability } = await HealthConnect.checkAvailability();
    return availability;
  } catch { return "NotSupported"; }
}

export async function healthPermissionGranted() {
  if (!healthSupported()) return false;
  try {
    const { granted } = await HealthConnect.checkHealthPermissions();
    return !!granted;
  } catch { return false; }
}

export async function requestHealthPermission() {
  if (!healthSupported()) return false;
  try {
    const { granted } = await HealthConnect.requestHealthPermissions();
    return !!granted;
  } catch { return false; }
}

export async function openHealthConnect() {
  if (!healthSupported()) return;
  try { await HealthConnect.openSettings(); } catch { /* nothing to open */ }
}

// Raw workouts in the last `days` days, newest first.
export async function readWorkouts(days = 30) {
  if (!healthSupported()) return [];
  const endTime = Date.now();
  const startTime = endTime - days * 86400000;
  try {
    // Strings, not numbers: an epoch millisecond's Java type on the other side
    // depends on how org.json parses it, and Capacitor's getLong/getDouble each
    // accept only one of those types. See the note in HealthConnectPlugin.kt.
    const { workouts } = await HealthConnect.readWorkouts({
      startTime: String(startTime), endTime: String(endTime),
    });
    return (workouts || []).slice().sort((a, b) => b.startTime - a.startTime);
  } catch { return []; }
}

// --- pure mapping ----------------------------------------------------------

const DAY_MS = 86400000;
const startOfDay = (iso) => { const d = new Date(iso + "T00:00:00"); d.setHours(0, 0, 0, 0); return d; };
const localISODate = (ms) => {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * A Health Connect workout in the shape `update()` stores. Distance and
 * duration are the only things a session is guaranteed to carry; everything
 * else is copied across only when the watch actually recorded it, so an
 * imported run never claims a zero it does not have.
 */
export function workoutToEntry(w) {
  const km = w.distanceM > 0 ? Number((w.distanceM / 1000).toFixed(2)) : 0;
  const min = Number(Math.max(0, (w.endTime - w.startTime) / 60000).toFixed(1));
  return {
    done: true,
    km,
    min,
    date: new Date(w.startTime).toISOString(),
    imported: true,
    hcId: w.id,
    hcSource: w.source || null,
    ...(w.kcal > 0 ? { kcal: Math.round(w.kcal) } : {}),
    ...(w.hrAvg > 0 ? { hrAvg: Math.round(w.hrAvg) } : {}),
    ...(w.hrMax > 0 ? { hrMax: Math.round(w.hrMax) } : {}),
    ...(w.steps > 0 ? { steps: Math.round(w.steps) } : {}),
  };
}

/**
 * Which plan day a workout should land on.
 *
 * With a start date set, a run belongs on the day it actually happened — that
 * is the whole point of the calendar mapping. Only when that day is taken (or
 * there is no start date) does it fall through to the first unfinished day, so
 * importing a backlog fills the plan in order instead of piling every run onto
 * the same key.
 *
 * `taken` is the set of keys already claimed, including ones claimed earlier in
 * the same import run. Returns null when the plan has no room left.
 */
export function chooseDayKey(w, { flat, log, startDate, taken = new Set() }) {
  const free = (key) => key && !taken.has(key) && !(log[key] && log[key].done);

  if (startDate) {
    const idx = Math.round((startOfDay(localISODate(w.startTime)) - startOfDay(startDate)) / DAY_MS);
    if (idx >= 0 && idx < flat.length && free(flat[idx].key)) return flat[idx].key;
  }
  const next = flat.find((f) => free(f.key));
  return next ? next.key : null;
}

/**
 * Split the workouts into what is worth importing and what is not, with a
 * reason for everything skipped — a silent "imported 0 of 12" is the kind of
 * result that sends someone hunting for a bug that is not there.
 *
 * Skips: anything that is not a run/walk/hike, anything already imported (the
 * Health Connect record id is kept on the entry), anything Stride recorded
 * itself (a GPS run and its Samsung Health copy are the same run twice), and
 * anything too short to be a session.
 */
export function planImport(workouts, { flat, log, startDate, minMinutes = 3 }) {
  const importedIds = new Set(
    Object.values(log || {}).map((e) => e && e.hcId).filter(Boolean)
  );
  // Runs Stride tracked itself, by the minute they started — a workout that
  // begins within a few minutes of one is the same outing seen twice.
  const trackedStarts = Object.values(log || {})
    .filter((e) => e && e.tracked && e.date)
    .map((e) => new Date(e.date).getTime())
    .filter((t) => !isNaN(t));

  const taken = new Set();
  const ready = [], skipped = [];

  for (const w of workouts) {
    const label = exerciseName(w.exerciseType, w.title);
    const when = new Date(w.startTime);
    const minutes = (w.endTime - w.startTime) / 60000;

    if (!isRunLike(w.exerciseType)) { skipped.push({ w, label, when, reason: "not a run or walk" }); continue; }
    if (importedIds.has(w.id)) { skipped.push({ w, label, when, reason: "already imported" }); continue; }
    if (minutes < minMinutes) { skipped.push({ w, label, when, reason: "too short" }); continue; }
    if (trackedStarts.some((t) => Math.abs(t - w.startTime) < 15 * 60000)) {
      skipped.push({ w, label, when, reason: "Stride already tracked this run" });
      continue;
    }
    const key = chooseDayKey(w, { flat, log, startDate, taken });
    if (!key) { skipped.push({ w, label, when, reason: "no free day left in the plan" }); continue; }

    taken.add(key);
    ready.push({ w, key, label, when, entry: workoutToEntry(w) });
  }

  return { ready, skipped };
}
