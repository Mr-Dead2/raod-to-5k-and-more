// Native (Capacitor) bridge. On the web these all no-op so the same code runs
// in the browser PWA and the installed Android app. The headline win: when
// running natively, reminders are scheduled with the OS LocalNotifications
// plugin, so they fire reliably even when the app is fully closed.
import { Capacitor } from "@capacitor/core";

export const isNative = () => Capacitor.isNativePlatform();

const DAILY_ID = 5001;

export async function nativeEnableReminder(time, message) {
  if (!isNative()) return false;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  const perm = await LocalNotifications.requestPermissions();
  if (perm.display !== "granted") return false;
  const [hour, minute] = String(time || "18:00").split(":").map(Number);
  await LocalNotifications.cancel({ notifications: [{ id: DAILY_ID }] });
  await LocalNotifications.schedule({
    notifications: [{
      id: DAILY_ID,
      title: "Road to 5K",
      body: message || "Time to lace up — you've got a session today.",
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
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  await LocalNotifications.cancel({ notifications: [{ id: DAILY_ID }] });
}

// Ask for location up front on native so the in-WebView GPS tracker can run.
export async function ensureLocationPermission() {
  if (!isNative()) return;
  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    await Geolocation.requestPermissions();
  } catch { /* user can still grant it when the tracker prompts */ }
}

// Match the dark status bar to the app.
export async function styleStatusBar() {
  if (!isNative()) return;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#0c0d10" });
  } catch { /* ignore */ }
}
