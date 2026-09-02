// Web notification layer. No backend and no push server — three best-effort
// mechanisms cover the daily reminder (permission + service worker, Periodic
// Background Sync, and a foreground timer), and a fourth set of calls drives
// the live notifications shown while a run is being tracked.
//
// Settings live in IndexedDB, not localStorage, because the service worker has
// to read them while the app is closed.
import { idbGet, idbSet } from "./idb.js";
import { isNative, nativeLiveRun, nativeEndLiveRun, nativeRunNotification, nativeEnsurePermission } from "./native.js";

const KEY = "reminder";

export const DEFAULT_REMINDER = {
  enabled: false,
  time: "18:00",
  lastFired: "",
  message: "",
  restToday: false,
  skipRest: false,   // stay quiet on rest days
  runKm: true,       // buzz at every completed kilometre
  runInterval: true, // run/walk interval switches
  runFinish: true,   // run saved / finished
  runLive: true,     // ongoing "run in progress" notification
  milestone: true,   // achievements + goal milestones
};

// Rotating nudges so the daily reminder never reads like the same robot.
const NUDGES = [
  "Lace up — your session is waiting.",
  "Ten minutes in and you'll be glad you went.",
  "Consistency beats intensity. Go log today.",
  "Future you is already grateful. Head out.",
  "The first kilometre is the hardest. Start it.",
];
export const pickNudge = () => NUDGES[Math.floor(Math.random() * NUDGES.length)];

export async function loadReminder() { return { ...DEFAULT_REMINDER, ...((await idbGet(KEY)) || {}) }; }
export async function saveReminder(patch) {
  const next = { ...(await loadReminder()), ...patch };
  await idbSet(KEY, next);
  return next;
}

export function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
}
export function permission() { return notificationsSupported() ? Notification.permission : "denied"; }
export async function requestPermission() {
  if (!notificationsSupported()) return "denied";
  try { return await Notification.requestPermission(); } catch { return "denied"; }
}

// Nothing shows a notification until the user has granted permission, and the
// browser only asks when we ask. Call this before anything that intends to
// notify (starting a run, switching an alert on) rather than assuming an
// earlier prompt happened.
//
// A permission prompt the user simply ignores leaves its promise pending for as
// long as the tab lives, so this always settles: whatever is waiting reports
// the permission as it currently stands and moves on. Never let a caller block
// on this indefinitely — and never gate a core action (like starting a run) on
// the answer at all.
export async function ensureNotificationPermission({ timeoutMs = 15000 } = {}) {
  const ask = async () => {
    if (isNative()) return nativeEnsurePermission();
    if (!notificationsSupported()) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;   // only the user can undo this
    return (await requestPermission()) === "granted";
  };
  return Promise.race([
    ask().catch(() => false),
    new Promise((resolve) => setTimeout(() => resolve(permission() === "granted"), timeoutMs)),
  ]);
}

// navigator.serviceWorker.ready never rejects — if no worker ever takes
// control (private windows, a failed registration, plain http) it simply
// hangs, which would stall every notification call behind it. Time it out and
// fall back to a page-level notification.
async function swReady(ms = 2500) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
  } catch { return null; }
}

async function registerPeriodicSync() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!("periodicSync" in reg)) return;
    const status = await navigator.permissions.query({ name: "periodic-background-sync" });
    if (status.state === "granted") await reg.periodicSync.register("stride-reminder", { minInterval: 12 * 60 * 60 * 1000 });
  } catch { /* unsupported — the other two layers still work */ }
}

// Core web notification. `opts` passes through to showNotification, so callers
// can make a notice silent, sticky, or replace an earlier one via its tag.
export async function showNotice(title, body, opts = {}) {
  if (permission() !== "granted") return false;
  const options = {
    body,
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: "stride",
    renotify: true,
    vibrate: [80, 40, 80],
    data: { url: "./" },
    ...opts,
  };
  const reg = await swReady();
  if (reg) {
    try { await reg.showNotification(title, options); return true; } catch { /* fall through */ }
  }
  // Page-level fallback. The Notification constructor rejects the fields only a
  // service worker may use, so drop them rather than lose the notice entirely.
  try {
    const { actions, renotify, ...plain } = options;
    new Notification(title, plain);
    return true;
  } catch { return false; }
}

export const showReminderNow = (body, title = "Stride", tag = "stride-reminder") => showNotice(title, body, { tag });

export async function enableReminders(time, message) {
  if (!(await ensureNotificationPermission())) return false;
  await saveReminder({ enabled: true, time, message });
  await registerPeriodicSync();
  return true;
}
export async function disableReminders() { await saveReminder({ enabled: false }); }
export async function syncMessage(message, restToday = false) {
  const r = await loadReminder();
  if (r.message !== message || r.restToday !== restToday) await saveReminder({ message, restToday });
}

export function startForegroundScheduler(getMessage) {
  const tick = async () => {
    const r = await loadReminder();
    if (!r.enabled || permission() !== "granted") return;
    if (r.skipRest && r.restToday) return;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (r.lastFired === today) return;
    const [h, m] = (r.time || "18:00").split(":").map(Number);
    if (now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m)) {
      const msg = getMessage();
      if (msg && (await showNotice("Stride · time to run", `${msg}\n${pickNudge()}`, { tag: "stride-reminder" }))) {
        await saveReminder({ lastFired: today });
      }
    }
  };
  tick();
  return setInterval(tick, 60 * 1000);
}

// --- in-run notifications ---------------------------------------------------
// One sticky "run in progress" notice that is rewritten in place (same tag /
// same native id) plus transient notices at each kilometre and at the finish.

const LIVE_TAG = "stride-live";
let liveAt = 0;              // throttle: rewriting too often spams some phones
let liveOn = false;

const pace = (sec) => (sec > 0 ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}` : null);
const clock = (sec) => {
  const s = Math.max(0, Math.round(sec)), h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60), r = s % 60, pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
};

// Called on every tracker update. Rewrites the ongoing notification at most
// once every `minGapMs`, or immediately when `force` (km split, pause, resume).
export async function updateLiveRun({ km = 0, elapsedSec = 0, paceSec = 0, paused = false, force = false }) {
  const r = await loadReminder();
  if (r.runLive === false) return false;
  const now = Date.now();
  if (!force && liveOn && now - liveAt < 15000) return false;
  liveAt = now;
  liveOn = true;
  const title = paused ? "Stride · run paused" : "Stride · run in progress";
  const p = pace(paceSec);
  const body = `${km.toFixed(2)} km · ${clock(elapsedSec)}${p ? ` · ${p}/km` : ""}`;
  if (isNative()) return nativeLiveRun(title, body);
  return showNotice(title, body, {
    tag: LIVE_TAG,
    renotify: false,
    silent: true,
    requireInteraction: true,
    vibrate: undefined,
    actions: [{ action: "open", title: "Open Stride" }],
  });
}

export async function endLiveRun() {
  if (!liveOn) return;
  liveOn = false;
  liveAt = 0;
  if (isNative()) { await nativeEndLiveRun(); return; }
  try {
    const reg = await swReady();
    if (reg) for (const n of await reg.getNotifications({ tag: LIVE_TAG })) n.close();
  } catch { /* nothing to clear */ }
}

async function transient(title, body, tag) {
  if (isNative()) return nativeRunNotification(title, body);
  return showNotice(title, body, { tag });
}

export async function notifyRunKm(km, splitSec) {
  const r = await loadReminder();
  if (r.runKm === false) return false;
  const p = pace(splitSec);
  return transient(`Stride · ${km} km done`, p ? `Last kilometre in ${p}. Keep the rhythm.` : "Keep the rhythm.", `stride-km-${km}`);
}
export async function notifyRunInterval(label) {
  const r = await loadReminder();
  if (r.runInterval === false) return false;
  return transient("Stride · interval", label, "stride-interval");
}
export async function notifyRunFinish(distance, time, paceLabel) {
  const r = await loadReminder();
  if (r.runFinish === false) return false;
  return transient("Stride · run complete", `${distance} km · ${time}${paceLabel ? ` · ${paceLabel}` : ""}`, "stride-finish");
}
export async function notifyMilestone(title, body) {
  const r = await loadReminder();
  if (r.milestone === false) return false;
  return transient(title, body, "stride-milestone");
}

// "Send me one now" button in settings, so the user can prove it works.
export async function sendTestNotification() {
  if (!(await ensureNotificationPermission())) return false;
  if (isNative()) return nativeRunNotification("Stride · test", "Notifications are working. This is what a nudge looks like.");
  return showNotice("Stride · test", "Notifications are working. This is what a nudge looks like.", { tag: "stride-test" });
}

// Called when a run starts: the alerts the user has switched on are useless if
// the browser was never asked. Callers must NOT await this — see
// ensureNotificationPermission — the run has to begin whatever the user does
// with the prompt.
export async function primeRunNotifications() {
  const r = await loadReminder();
  const wanted = r.runLive !== false || r.runKm !== false || r.runInterval !== false || r.runFinish !== false;
  if (!wanted) return false;
  return ensureNotificationPermission();
}

export function speak(text) {
  try {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95; u.volume = 1;
      window.speechSynthesis.speak(u);
      return true;
    }
  } catch { /* no voice available */ }
  return false;
}
