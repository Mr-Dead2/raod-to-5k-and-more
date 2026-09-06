// Capacitor bridge. Every export no-ops on the web (guarded by
// Capacitor.isNativePlatform()) so a single codebase runs in the browser and
// in the Android app.
import { Capacitor } from "@capacitor/core";

export const isNative = () => Capacitor.isNativePlatform();

const DAILY_ID = 5001;
const LIVE_ID = 5002;          // rewritten in place while a run is tracked
const RUN_ID_BASE = 6100;
const LIVE_CHANNEL = "stride-live";
const ALERT_CHANNEL = "stride-alerts";

// Two alerts fired inside the same second used to derive the same id and so
// overwrote each other (a km split swallowing an interval cue). A counter is
// unique regardless of timing.
let alertSeq = 0;
const nextAlertId = () => RUN_ID_BASE + (alertSeq = (alertSeq + 1) % 10000);

const notif = async () => (await import("@capacitor/local-notifications")).LocalNotifications;

let channelsReady = false;
async function ensureChannels(LocalNotifications) {
  if (channelsReady) return;
  try {
    // Importance 2 = low: the run notice sits in the shade without buzzing on
    // every rewrite. Alerts get importance 4 so km splits actually land.
    await LocalNotifications.createChannel({
      id: LIVE_CHANNEL, name: "Run in progress", importance: 2, visibility: 1, vibration: false,
      description: "The ongoing notice showing distance, time and pace while you track a run.",
    });
    await LocalNotifications.createChannel({
      id: ALERT_CHANNEL, name: "Run alerts & reminders", importance: 4, visibility: 1, vibration: true,
      description: "Kilometre splits, run/walk switches, finished runs and the daily reminder.",
    });
    channelsReady = true;
  } catch { /* older Android or already created */ }
}

// What Android currently thinks, without prompting: "granted" | "denied" |
// "prompt". The web `Notification` API does not exist in the Android WebView,
// so this is the only honest source of truth in the native app — anything that
// reads `Notification.permission` there is reading "denied" forever.
export async function nativeCheckPermission() {
  if (!isNative()) return "denied";
  try {
    const LocalNotifications = await notif();
    await ensureChannels(LocalNotifications);
    const { display } = await LocalNotifications.checkPermissions();
    return display === "granted" ? "granted" : display === "denied" ? "denied" : "prompt";
  } catch { return "prompt"; }
}

// Prompts if Android has never asked. Only for explicit, user-initiated
// entry points — never on the notification hot path.
async function granted(LocalNotifications) {
  const perm = await LocalNotifications.requestPermissions();
  return perm.display === "granted";
}

// Silent check for the hot path: posting a km split must never raise a
// permission dialog over a run in progress.
async function alreadyGranted(LocalNotifications) {
  try {
    const perm = await LocalNotifications.checkPermissions();
    return perm.display === "granted";
  } catch { return false; }
}

// Ask Android for POST_NOTIFICATIONS (required from Android 13) and make sure
// the channels exist. Safe to call repeatedly — once the user has answered,
// Android resolves it without showing the dialog again.
export async function nativeEnsurePermission() {
  if (!isNative()) return false;
  try {
    const LocalNotifications = await notif();
    // Channels first: they must exist before the first notification is posted,
    // and creating them does not require permission.
    await ensureChannels(LocalNotifications);
    return await granted(LocalNotifications);
  } catch { return false; }
}

// Android 12+ hands out exact alarms only if the user allows them in system
// settings. Without one the daily reminder still fires, but Doze can hold it
// back by many minutes — so the app has to be able to say so and offer the fix.
// Returns "granted" | "denied" | "prompt" | "unsupported" (the last when the
// plugin cannot answer, e.g. on the web).
export async function nativeExactAlarmState() {
  if (!isNative()) return "unsupported";
  try {
    const LocalNotifications = await notif();
    const { exact_alarm: state } = await LocalNotifications.checkExactNotificationSetting();
    return state === "granted" ? "granted" : state === "denied" ? "denied" : "prompt";
  } catch { return "unsupported"; }
}

// Opens Android's "Alarms & reminders" screen for Stride, then reports back.
export async function nativeRequestExactAlarm() {
  if (!isNative()) return "unsupported";
  try {
    const LocalNotifications = await notif();
    const { exact_alarm: state } = await LocalNotifications.changeExactNotificationSetting();
    return state === "granted" ? "granted" : "denied";
  } catch { return "unsupported"; }
}

export async function nativeEnableReminder(time, message) {
  if (!isNative()) return false;
  const LocalNotifications = await notif();
  await ensureChannels(LocalNotifications);
  if (!(await granted(LocalNotifications))) return false;
  const [hour, minute] = String(time || "18:00").split(":").map(Number);
  await LocalNotifications.cancel({ notifications: [{ id: DAILY_ID }] });
  await LocalNotifications.schedule({
    notifications: [{
      id: DAILY_ID,
      title: "Stride · time to run",
      body: message || "Lace up — your session is waiting.",
      channelId: ALERT_CHANNEL,
      schedule: { on: { hour, minute }, allowWhileIdle: true, repeats: true },
    }],
  });
  return true;
}

export async function nativeUpdateReminder(time, message) {
  if (!isNative()) return;
  await nativeEnableReminder(time, message);
}

export async function nativeDisableReminder() {
  if (!isNative()) return;
  const LocalNotifications = await notif();
  await LocalNotifications.cancel({ notifications: [{ id: DAILY_ID }] });
}

// One-off alert (km split, interval switch, run finished, test).
export async function nativeRunNotification(title, body) {
  if (!isNative()) return false;
  try {
    const LocalNotifications = await notif();
    await ensureChannels(LocalNotifications);
    if (!(await alreadyGranted(LocalNotifications))) return false;
    // No `schedule`: the plugin then posts the notification straight away.
    // Scheduling even 150 ms out hands it to AlarmManager, which Android 12+
    // downgrades to an inexact alarm unless the app holds SCHEDULE_EXACT_ALARM
    // — so a km split could land minutes after the kilometre.
    await LocalNotifications.schedule({
      notifications: [{
        id: nextAlertId(),
        title, body,
        channelId: ALERT_CHANNEL,
      }],
    });
    return true;
  } catch { return false; }
}

// The sticky "run in progress" notice. Same id every time, so each call
// rewrites the existing notification rather than stacking a new one.
export async function nativeLiveRun(title, body) {
  if (!isNative()) return false;
  try {
    const LocalNotifications = await notif();
    await ensureChannels(LocalNotifications);
    if (!(await alreadyGranted(LocalNotifications))) return false;
    // Posted immediately (no `schedule`) — see nativeRunNotification. Same id
    // every time, so Android rewrites the existing notice in place.
    await LocalNotifications.schedule({
      notifications: [{
        id: LIVE_ID,
        title, body,
        channelId: LIVE_CHANNEL,
        ongoing: true,
        autoCancel: false,
      }],
    });
    return true;
  } catch { return false; }
}

export async function nativeEndLiveRun() {
  if (!isNative()) return;
  try {
    const LocalNotifications = await notif();
    await LocalNotifications.cancel({ notifications: [{ id: LIVE_ID }] });
  } catch { /* already gone */ }
}

// Ask for location up front. Bounded, because callers sit on the path to
// starting a run: an Android dialog the user simply ignores leaves this pending
// for as long as the app lives, and the run must begin regardless. The
// background-geolocation watcher asks again itself (requestPermissions: true),
// so nothing is lost by moving on.
export async function ensureLocationPermission({ timeoutMs = 12000 } = {}) {
  if (!isNative()) return;
  const ask = (async () => {
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      await Geolocation.requestPermissions();
    } catch { /* denied — the tracker surfaces the error */ }
  })();
  await Promise.race([ask, new Promise((r) => setTimeout(r, timeoutMs))]);
}

// One-time native bootstrap, run at launch. Creates the notification channels
// and asks for POST_NOTIFICATIONS — Android 13+ shows nothing until an app
// asks, and until this landed Stride only ever asked deep inside the settings
// screen, so a fresh install genuinely never requested notifications at all.
export async function nativeBootstrapNotifications() {
  if (!isNative()) return "denied";
  try {
    const LocalNotifications = await notif();
    await ensureChannels(LocalNotifications);
    const perm = await LocalNotifications.requestPermissions();
    return perm.display === "granted" ? "granted" : "denied";
  } catch { return "denied"; }
}

export async function nativeShareBackup(json, filename) {
  if (!isNative()) return false;
  try {
    const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
    const { Share } = await import("@capacitor/share");
    const { uri } = await Filesystem.writeFile({ path: filename, data: json, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: filename, files: [uri] });
    return true;
  } catch (e) {
    return /cancel/i.test(String(e?.message || e));
  }
}

// Fires whenever the native app comes back to the foreground. The main use is
// re-reading permissions: a user who grants notifications in Android's settings
// screen must not come back to a UI still insisting they are blocked.
// Returns a cleanup function (a no-op on the web).
export function onAppResume(cb) {
  if (!isNative()) return () => {};
  let remove = null, dead = false;
  (async () => {
    try {
      const { App } = await import("@capacitor/app");
      const handle = await App.addListener("appStateChange", ({ isActive }) => { if (isActive) cb(); });
      if (dead) handle.remove(); else remove = () => handle.remove();
    } catch { /* plugin unavailable */ }
  })();
  return () => { dead = true; remove?.(); };
}

export async function styleStatusBar() {
  if (!isNative()) return;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#07080b" });
  } catch { /* not supported */ }
}
