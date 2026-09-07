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

// Health Connect exercise type ids (androidx.health.connect ExerciseSessionRecord),
// each tagged with what it is rather than a single "importable" flag.
//
// The distinction earns its keep because Samsung Health records walking *by
// itself*: a stroll to the shops becomes an exercise session with no input from
// the user. Importing those as runs buries real training under noise and — worse
// — a long amble becomes the "longest run" that race readiness is measured
// against. So walks are a separate kind, off by default, and never counted as
// running even when the user does want them logged.
//
// Anything not listed is not foot-borne and is never imported: a cycle ride
// logged as "24 km" would wreck every pace figure and race prediction.
export const EXERCISE_TYPES = {
  56: { name: "Running", kind: "run" },
  57: { name: "Treadmill run", kind: "run" },
  79: { name: "Walking", kind: "walk" },
  37: { name: "Hiking", kind: "walk" },
  8:  { name: "Boot camp", kind: null },
  13: { name: "Cycling", kind: null },
  14: { name: "Stationary bike", kind: null },
};

export const exerciseKind = (type) => EXERCISE_TYPES[type]?.kind || null;
export const isRunLike = (type) => exerciseKind(type) === "run";
export const isWalkLike = (type) => exerciseKind(type) === "walk";
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
    // "run" or "walk". Stats that only make sense for running — pace, longest
    // run, race predictions — read this and leave walks out.
    activity: exerciseKind(w.exerciseType) || "run",
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
export function planImport(workouts, { flat, log, startDate, minMinutes = 3, minKm = 0.3, includeWalks = false }) {
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

    const kind = exerciseKind(w.exerciseType);
    if (!kind) { skipped.push({ w, label, when, reason: "not a run or walk" }); continue; }
    if (kind === "walk" && !includeWalks) {
      skipped.push({ w, label, when, reason: "walk — your watch logs these on its own" });
      continue;
    }
    if (importedIds.has(w.id)) { skipped.push({ w, label, when, reason: "already imported" }); continue; }
    if (minutes < minMinutes) { skipped.push({ w, label, when, reason: "too short" }); continue; }
    // A session with no distance worth the name is a detection artefact, not
    // training — and it would land on a plan day as a completed session.
    const km = (w.distanceM || 0) / 1000;
    if (km > 0 && km < minKm) { skipped.push({ w, label, when, reason: "too short" }); continue; }
    if (trackedStarts.some((t) => Math.abs(t - w.startTime) < 15 * 60000)) {
      skipped.push({ w, label, when, reason: "Stride already tracked this run" });
      continue;
    }
    const key = chooseDayKey(w, { flat, log, startDate, taken });
    if (!key) { skipped.push({ w, label, when, reason: "no free day left in the plan" }); continue; }

    taken.add(key);
    ready.push({ w, key, label, when, kind, entry: workoutToEntry(w) });
  }

  return { ready, skipped };
}
