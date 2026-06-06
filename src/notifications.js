// Reminder notifications for the PWA.
//
// Honest note on the web platform: a website cannot wake itself to fire an
// alarm at an exact time the way a native Android app can. Without a backend
// push server we use the best tools available:
//   1. Notification permission + the service worker to actually show notices.
//   2. Periodic Background Sync (Chrome on Android, installed PWA): the SW wakes
//      ~twice a day, reads the reminder from IndexedDB, and fires if it's due.
//   3. A foreground timer, so if the app is open at reminder time you still get
//      nudged immediately.
// Settings live in IndexedDB (see idb.js) so the SW can read them while closed.
import { idbGet, idbSet } from "./idb.js";

const KEY = "reminder";
const DEFAULT = { enabled: false, time: "18:00", lastFired: "", message: "" };

export async function loadReminder() {
  return (await idbGet(KEY)) || DEFAULT;
}

export async function saveReminder(patch) {
  const cur = (await idbGet(KEY)) || DEFAULT;
  const next = { ...cur, ...patch };
  await idbSet(KEY, next);
  return next;
}

export function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
}

export function permission() {
  return notificationsSupported() ? Notification.permission : "denied";
}

export async function requestPermission() {
  if (!notificationsSupported()) return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

async function registerPeriodicSync() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if ("periodicSync" in reg) {
      const status = await navigator.permissions.query({ name: "periodic-background-sync" });
      if (status.state === "granted") {
        await reg.periodicSync.register("run5k-reminder", { minInterval: 12 * 60 * 60 * 1000 });
      }
    }
  } catch {
    /* not supported — foreground timer still works */
  }
}

export async function showReminderNow(body) {
  if (permission() !== "granted") return;
  const options = {
    body,
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: "run5k-reminder",
    vibrate: [80, 40, 80],
    data: { url: "./" },
  };
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification("Road to 5K", options);
  } catch {
    try { new Notification("Road to 5K", options); } catch { /* ignore */ }
  }
}

export async function enableReminders(time, message) {
  const perm = permission() === "granted" ? "granted" : await requestPermission();
  if (perm !== "granted") return false;
  await saveReminder({ enabled: true, time, message });
  await registerPeriodicSync();
  return true;
}

export async function disableReminders() {
  await saveReminder({ enabled: false });
}

// Keep the stored message fresh so the background SW knows what to say.
export async function syncMessage(message) {
  const r = await loadReminder();
  if (r.enabled && r.message !== message) await saveReminder({ message });
}

// Foreground scheduler: while the app is open, fire once when the clock passes
// the reminder time (guarded by lastFired so it only triggers once per day).
export function startForegroundScheduler(getMessage) {
  const tick = async () => {
    const r = await loadReminder();
    if (!r.enabled || permission() !== "granted") return;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (r.lastFired === today) return;
    const [h, m] = (r.time || "18:00").split(":").map(Number);
    if (now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m)) {
      const msg = getMessage();
      if (msg) {
        await showReminderNow(msg);
        await saveReminder({ lastFired: today });
      }
    }
  };
  tick();
  const timer = setInterval(tick, 60 * 1000);
  return () => clearInterval(timer);
}
