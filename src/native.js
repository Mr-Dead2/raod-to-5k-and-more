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

const notif = async () => (await import("@capacitor/local-notifications")).LocalNotifications;

async function ensureChannels(LocalNotifications) {
  try {
    // Importance 2 = low: the run notice sits in the shade without buzzing on
    // every rewrite. Alerts get importance 4 so km splits actually land.
    await LocalNotifications.createChannel({
      id: LIVE_CHANNEL, name: "Run in progress", importance: 2, visibility: 1, vibration: false,
    });
    await LocalNotifications.createChannel({
      id: ALERT_CHANNEL, name: "Run alerts & reminders", importance: 4, visibility: 1, vibration: true,
    });
  } catch { /* older Android or already created */ }
}

async function granted(LocalNotifications) {
  const perm = await LocalNotifications.requestPermissions();
  return perm.display === "granted";
}

export async function nativeEnableReminder(time, message) {
  if (!isNative()) return false;
  const LocalNotifications = await notif();
  if (!(await granted(LocalNotifications))) return false;
  await ensureChannels(LocalNotifications);
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
    if (!(await granted(LocalNotifications))) return false;
    await ensureChannels(LocalNotifications);
    await LocalNotifications.schedule({
      notifications: [{
        id: RUN_ID_BASE + (Math.floor(Date.now() / 1000) % 100000),
        title, body,
        channelId: ALERT_CHANNEL,
        schedule: { at: new Date(Date.now() + 150) },
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
    if (!(await granted(LocalNotifications))) return false;
    await ensureChannels(LocalNotifications);
    await LocalNotifications.schedule({
      notifications: [{
        id: LIVE_ID,
        title, body,
        channelId: LIVE_CHANNEL,
        ongoing: true,
        autoCancel: false,
        schedule: { at: new Date(Date.now() + 100) },
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

export async function ensureLocationPermission() {
  if (!isNative()) return;
  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    await Geolocation.requestPermissions();
  } catch { /* denied — the tracker surfaces the error */ }
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

export async function styleStatusBar() {
  if (!isNative()) return;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#07080b" });
  } catch { /* not supported */ }
}
