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

// Heart-rate samples Health Connect holds for a window — whatever wrote them.
// For a Galaxy Watch that is Samsung Health, relaying what the watch measured:
// a Tizen watch cannot stream its pulse to an app live, but what it recorded
// arrives here once the watch has synced. Resolves to { count, avg, max }, or
// null when Health Connect could not be asked.
export async function readHeartRate(startMs, endMs) {
  if (!healthSupported()) return null;
  try {
    const r = await HealthConnect.readHeartRate({ startTime: String(Math.round(startMs)), endTime: String(Math.round(endMs)) });
    return { count: r.count || 0, avg: r.avg || 0, max: r.max || 0, sources: r.sources || [] };
  } catch { return null; }
}

// --- pure mapping ----------------------------------------------------------

const DAY_MS = 86400000;
const startOfDay = (iso) => { const d = new Date(iso + "T00:00:00"); d.setHours(0, 0, 0, 0); return d; };
const localISODate = (ms) => {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Steps per minute, only when the figure is one a person on foot can produce
// — a stray step total over a long session must not become a "cadence of 12".
export function cadenceOf(steps, minutes) {
  if (!(steps > 0) || !(minutes > 0)) return 0;
  const spm = Math.round(steps / minutes);
  return spm >= 60 && spm <= 240 ? spm : 0;
}

/**
 * A Health Connect workout in the shape `update()` stores. Distance and
 * duration are the only things a session is guaranteed to carry; everything
 * else is copied across only when the watch actually recorded it, so an
 * imported run never claims a zero it does not have.
 */
export function workoutToEntry(w) {
  const km = w.distanceM > 0 ? Number((w.distanceM / 1000).toFixed(2)) : 0;
  const min = Number(Math.max(0, (w.endTime - w.startTime) / 60000).toFixed(1));
  const cadence = cadenceOf(w.steps, (w.endTime - w.startTime) / 60000);
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
    // What the watch called it ("Running"), for when the plan day it lands on
    // was something else — a watch run on a rest day is still a run.
    hcLabel: exerciseName(w.exerciseType, w.title),
    ...(w.kcal > 0 ? { kcal: Math.round(w.kcal) } : {}),
    ...(w.hrAvg > 0 ? { hrAvg: Math.round(w.hrAvg) } : {}),
    ...(w.hrMax > 0 ? { hrMax: Math.round(w.hrMax) } : {}),
    ...(w.steps > 0 ? { steps: Math.round(w.steps) } : {}),
    ...(cadence ? { cadence } : {}),
  };
}

/**
 * When a run Stride tracked itself actually happened, as [start, end] in epoch
 * ms. Its `date` is stamped when the run is *saved* — the end, not the start —
 * so the window runs backwards from it by the run's own duration.
 */
export function trackedWindow(e) {
  const end = new Date(e && e.date).getTime();
  if (!e || isNaN(end)) return null;
  const durMs = e.durMs > 0 ? e.durMs : parseFloat(e.min) > 0 ? parseFloat(e.min) * 60000 : 0;
  return [end - durMs, end];
}

// Two recordings of the same outing: their windows overlap, give or take the
// few minutes between pressing start on the watch and on the phone.
const sameOuting = (a, b, slackMs = 5 * 60000) => a[0] < b[1] + slackMs && b[0] < a[1] + slackMs;

/**
 * What a watch recording can add to a run Stride tracked itself: heart rate,
 * steps and cadence, and only where the Stride run has none of its own — a
 * chest strap's reading is never replaced by a wrist's. Null when there is
 * nothing to add.
 */
export function mergePatch(entry, w) {
  const patch = {};
  if (!(entry.hrAvg > 0) && w.hrAvg > 0) {
    patch.hrAvg = Math.round(w.hrAvg);
    if (w.hrMax > 0) patch.hrMax = Math.round(w.hrMax);
    patch.hrSource = "watch";
  }
  if (!(entry.steps > 0) && w.steps > 0) {
    patch.steps = Math.round(w.steps);
    const minutes = entry.durMs > 0 ? entry.durMs / 60000 : (w.endTime - w.startTime) / 60000;
    const cadence = cadenceOf(w.steps, minutes);
    if (cadence && !(entry.cadence > 0)) patch.cadence = cadence;
  }
  if (!Object.keys(patch).length) return null;
  patch.hcId = w.id;
  return patch;
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
  // Runs Stride tracked itself, as time windows. A watch workout that overlaps
  // one is the same outing seen twice: its heart rate is merged into the
  // Stride run rather than the run being logged a second time.
  const tracked = Object.entries(log || {})
    .filter(([, e]) => e && e.tracked && e.date)
    .map(([key, e]) => ({ key, e, win: trackedWindow(e) }))
    .filter((t) => t.win);

  const taken = new Set();
  const ready = [], skipped = [], merge = [];

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
    const twin = tracked.find((t) => sameOuting(t.win, [w.startTime, w.endTime]));
    if (twin) {
      const patch = mergePatch(twin.e, w);
      if (patch) merge.push({ w, key: twin.key, label, when, kind, patch });
      else skipped.push({ w, label, when, reason: "Stride already tracked this run" });
      continue;
    }
    const key = chooseDayKey(w, { flat, log, startDate, taken });
    if (!key) { skipped.push({ w, label, when, reason: "no free day left in the plan" }); continue; }

    taken.add(key);
    ready.push({ w, key, label, when, kind, entry: workoutToEntry(w) });
  }

  return { ready, skipped, merge };
}

/**
 * Runs Stride tracked that could still pick up a heart rate from the watch:
 * recent, no heart rate of their own, not already looked up and given up on.
 * Samsung Health can take a while to hand what the watch measured to Health
 * Connect, so a run is retried on later launches until it is `giveUpMs` old.
 */
export function heartRateTargets(log, { now = Date.now(), maxAgeMs = 7 * DAY_MS } = {}) {
  return Object.entries(log || {})
    .filter(([, e]) => e && e.tracked && !(e.hrAvg > 0) && !e.hrChecked)
    .map(([key, e]) => ({ key, e, win: trackedWindow(e) }))
    .filter((t) => t.win && t.win[1] - t.win[0] >= 3 * 60000 && now - t.win[1] < maxAgeMs);
}

/**
 * The patch a heart-rate lookup earns a tracked run. A handful of readings
 * over half an hour is not an average worth printing, so it needs a few, and
 * roughly one every two minutes. When there is nothing and the run is old
 * enough that the watch must have synced, it is marked so it stops being asked.
 */
export function heartRatePatch(result, win, { now = Date.now(), giveUpMs = 36 * 3600000 } = {}) {
  const minutes = (win[1] - win[0]) / 60000;
  if (result && result.count >= Math.max(4, Math.floor(minutes / 2)) && result.avg > 0) {
    return { hrAvg: Math.round(result.avg), ...(result.max > 0 ? { hrMax: Math.round(result.max) } : {}), hrSource: "watch" };
  }
  if (result && now - win[1] > giveUpMs) return { hrChecked: true };
  return null;
}
