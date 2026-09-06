import React, { useState, useEffect, useCallback } from "react";
import { C, tint } from "../data.js";
import { haptic } from "../celebrate.js";
import {
  isNative, nativeExactAlarmState, nativeRequestExactAlarm, nativeNotificationReport,
  openNotificationSettings, openChannelSettings, openBatterySettings, openAppSettings,
} from "../native.js";
import {
  notificationsSupported, permissionState, loadReminder,
  ensureNotificationPermission, sendTestNotification,
} from "../notifications.js";

// Which build is actually running. Stamped by vite.config.js — the first thing
// to check when a shipped fix appears not to have landed, because an installed
// PWA or a side-loaded APK can easily still be running old code.
const BUILD_TIME = typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : "";

// Everything asynchronous in this panel goes through here.
//
// This is the tool of last resort: it is what someone opens when notifications
// are silently doing nothing, which is exactly the situation in which a native
// call may never settle. It used to await its whole report before rendering
// anything, so a single hanging call left the panel *invisible* — the one
// screen that could have explained the hang, erased by it. Nothing is awaited
// without a deadline, and the panel renders before any of it resolves.
const withTimeout = (promise, ms, fallback = null) =>
  Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((r) => setTimeout(() => r(fallback), ms)),
  ]);

// "good" = working, "warn" = works but with caveats, "bad" = this is the problem.
const DOT = { good: C.good, warn: C.warn, bad: C.warn, info: C.dim };

function Row({ state, label, value, note }) {
  return (
    <div style={{ display: "flex", gap: 10, padding: "9px 0", borderTop: `1px solid ${C.line}` }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%", marginTop: 6, flexShrink: 0,
        background: DOT[state] || C.dim,
        boxShadow: state === "bad" ? `0 0 8px ${tint(C.warn, .8)}` : "none",
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
          <span style={{ fontSize: 12, color: C.dim, fontWeight: 600 }}>{label}</span>
          <span style={{ marginLeft: "auto", fontSize: 12, color: C.text, fontWeight: 700, textAlign: "right", wordBreak: "break-word" }}>{value}</span>
        </div>
        {note && <div style={{ fontSize: 11, color: C.dim2, marginTop: 3, lineHeight: 1.45 }}>{note}</div>}
      </div>
    </div>
  );
}

function FixButton({ onClick, children }) {
  return (
    <button onClick={onClick} className="tap chip"
      style={{ width: "100%", marginTop: 8, borderRadius: 12, padding: "10px 0", fontSize: 12.5, fontWeight: 700, background: C.surface2, color: C.text, cursor: "pointer" }}>
      {children}
    </button>
  );
}

const IMPORTANCE = { 0: "blocked", 1: "min", 2: "low (silent)", 3: "default", 4: "high", 5: "urgent" };

export function NotifDiagnostics() {
  const native = isNative();
  // Seeded with what is known synchronously, so there is always a panel.
  // `undefined` means "still looking"; anything else is an answer, including a
  // failure. The difference matters: a row that reports a problem while it is
  // merely still loading is worse than one that says nothing yet.
  const [d, setD] = useState({
    native,
    standalone: typeof window !== "undefined" &&
      (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true),
    supported: notificationsSupported(),
    perm: undefined,
    exact: undefined,
    sw: undefined,
    swOk: false,
    background: undefined,
    reminder: undefined,
    report: undefined,
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // Probes run in parallel and each writes its own row as it lands. Chaining
  // them meant one slow answer held every row at "checking…" for the sum of
  // all the deadlines — on a phone where something really is stuck, that is
  // most of half a minute of a panel that looks broken itself.
  const collect = useCallback(() => {
    const set = (patch) => setD((prev) => ({ ...prev, ...patch }));

    withTimeout(permissionState(), 4000, "couldn't read").then((perm) => set({ perm }));
    withTimeout(native ? nativeExactAlarmState() : "n/a", 4000, "unknown").then((exact) => set({ exact }));
    withTimeout(native ? nativeNotificationReport() : null, 4000, null).then((report) => set({ report }));
    withTimeout(loadReminder(), 3000, null).then((reminder) => set({ reminder }));

    (async () => {
      if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
        set({ sw: "unsupported in this browser", swOk: false, background: "not available" });
        return;
      }
      const reg = await withTimeout(navigator.serviceWorker.ready, 2500);
      if (!reg) { set({ sw: "not controlling this page", swOk: false, background: "not available" }); return; }
      set({ sw: "active", swOk: true });
      let background = "not available";
      try {
        if ("periodicSync" in reg) {
          const st = await navigator.permissions.query({ name: "periodic-background-sync" });
          background = st.state === "granted" ? "allowed" : `not allowed (${st.state})`;
        } else background = "this browser has no background sync";
      } catch { background = "unknown"; }
      set({ background });
    })();
  }, [native]);

  useEffect(() => { collect(); }, [collect]);

  // The honest test: fire a notification, then ask the system whether one
  // actually exists. "The call didn't throw" is not the same as "it appeared".
  const runTest = async () => {
    haptic(10);
    setTesting(true);
    setTestResult(null);
    try {
      const granted = await withTimeout(ensureNotificationPermission(), 20000, false);
      if (!granted) {
        setTestResult({ ok: false, msg: "Permission is not granted, so nothing can be shown. Use the buttons above to turn Stride's notifications on." });
      } else {
        const sent = await withTimeout(sendTestNotification(), 8000, false);
        let seen = null;
        if (!native && "serviceWorker" in navigator) {
          const reg = await withTimeout(navigator.serviceWorker.ready, 2500);
          if (reg) seen = (await reg.getNotifications()).length;
        }
        setTestResult(sent
          ? { ok: true, msg: seen === 0
              ? "Sent, but your system reports no notification on screen — check that notifications are allowed for this app in your phone's settings."
              : "Sent. If you can't see it, notifications are being blocked at the phone level rather than by the app." }
          : { ok: false, msg: "The app could not post a notification at all. The rows above say which part of the phone is refusing." });
      }
    } catch (e) {
      setTestResult({ ok: false, msg: `Failed: ${e?.message || e}` });
    }
    setTesting(false);
    collect();
  };

  const act = (fn) => async () => { haptic(8); await fn(); setTimeout(collect, 400); };

  const where = d.native ? "Native Android app" : d.standalone ? "Installed app (PWA)" : "Browser tab";
  const permState = d.perm === undefined ? "info" : d.perm === "granted" ? "good" : d.perm === "denied" ? "bad" : "warn";
  const build = BUILD_TIME
    ? new Date(BUILD_TIME).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "unknown";

  const r = d.report;
  const alertsChannel = r?.channels?.find((c) => c.id === "stride-alerts");

  return (
    <div style={{ marginTop: 6 }}>
      <div className="lab" style={{ marginBottom: 2 }}>Troubleshooting</div>
      <div style={{ fontSize: 11, color: C.dim2, marginBottom: 4, lineHeight: 1.5 }}>
        If notifications aren't arriving, this says where they're getting stuck.
      </div>

      <Row state="info" label="Running as" value={where}
        note={!d.native && !d.standalone
          ? "In a plain browser tab reminders only fire while the tab is open. Add Stride to your home screen, or use the Android app, for anything reliable."
          : null} />

      <Row state="info" label="App build" value={build}
        note="If this is older than the fix you're expecting, the app is still running old code — uninstall it completely and install the new APK, rather than installing over the top." />

      {d.native && r?.device && <Row state="info" label="Phone" value={`${r.device} · Android SDK ${r.sdkInt}`} />}

      {!d.native && (
        <Row state={d.supported ? "good" : "bad"} label="Notification support"
          value={d.supported ? "available" : "missing"}
          note={d.supported ? null : "This browser can't show notifications at all. On iPhone, Stride must be added to the home screen first."} />
      )}

      <Row state={permState} label="Permission" value={d.perm ?? "checking…"}
        note={d.perm === "denied"
          ? d.native
            ? "Blocked by Android. The app cannot undo this — turn Stride's notifications on below, then come back."
            : "Blocked. The app cannot undo this — allow notifications for this site in your browser's site settings, then reopen Stride."
          : d.perm === "default"
            ? "Never asked or never answered. Use the test button below, or the button on the banner above."
            : null} />

      {/* Android has several independent switches, and the permission grant is
          only the first. Each of the rest gets its own row and its own way out,
          because "notifications are allowed" and "notifications appear" are
          not the same statement on a power-managed phone. */}
      {d.native && r && (
        <>
          <Row state={r.appNotificationsEnabled ? "good" : "bad"} label="Notifications for Stride"
            value={r.appNotificationsEnabled ? "on" : "off"}
            note={r.appNotificationsEnabled ? null : "Android's app-level switch is off, so nothing can appear no matter what the app does."} />

          <Row state={!alertsChannel?.exists ? "warn" : alertsChannel.blocked ? "bad" : "good"}
            label="Alerts channel"
            value={!alertsChannel?.exists ? "not created yet"
              : alertsChannel.blocked ? "blocked"
              : IMPORTANCE[alertsChannel.importance] || `importance ${alertsChannel.importance}`}
            note={!alertsChannel?.exists
              ? "Stride hasn't posted anything yet, so Android hasn't been given the channel. Run the test below."
              : alertsChannel.blocked
                ? "This specific category is silenced. The app-level switch being on does not override it."
                : null} />

          <Row state={r.batteryUnrestricted ? "good" : "warn"} label="Battery optimisation"
            value={r.batteryUnrestricted ? "unrestricted" : "restricted"}
            note={r.batteryUnrestricted ? null
              : "Android may delay or drop the daily reminder while the phone is idle. Set Stride to unrestricted for a reminder you can rely on."} />

          <Row state={r.exactAlarms ? "good" : "warn"} label="Exact alarms"
            value={r.exactAlarms ? "allowed" : "not allowed"}
            note={r.exactAlarms ? null
              : "The daily reminder still fires, but Android can hold it back by several minutes."} />
        </>
      )}

      {d.native && r === null && (
        <Row state="warn" label="Phone settings" value="couldn't read"
          note="Stride couldn't ask Android about its notification settings. If this build is older than the troubleshooting panel itself, reinstall the APK; use the button below to check the settings by hand." />
      )}

      {!d.native && (
        <Row state={d.sw === undefined ? "info" : d.swOk ? "good" : "warn"} label="Background worker" value={d.sw ?? "checking…"}
          note={d.swOk ? null : "Without it, notifications only work while the app is open."} />
      )}

      {!d.native && (
        <Row state={d.background === undefined ? "info" : d.background === "allowed" ? "good" : "warn"} label="Wake-ups when closed" value={d.background ?? "checking…"}
          note={d.background === "allowed" ? null
            : "The browser won't wake Stride while it's closed, so a daily reminder can only fire when the app is open. This is a browser limit, not a setting in the app — the Android app doesn't have it."} />
      )}

      <Row state={d.reminder?.enabled ? "good" : "info"} label="Daily reminder"
        value={d.reminder === undefined ? "checking…" : d.reminder?.enabled ? `on at ${d.reminder.time}` : "off"}
        note={d.reminder?.enabled && d.reminder.lastFired ? `Last fired ${d.reminder.lastFired}.` : null} />

      {d.native && (
        <>
          <FixButton onClick={act(openNotificationSettings)}>Open Stride's notification settings</FixButton>
          {alertsChannel?.blocked && (
            <FixButton onClick={act(() => openChannelSettings("stride-alerts"))}>Unblock the alerts channel</FixButton>
          )}
          {r && !r.batteryUnrestricted && (
            <FixButton onClick={act(openBatterySettings)}>Open battery optimisation</FixButton>
          )}
          {d.exact !== undefined && d.exact !== "unsupported" && d.exact !== "granted" && (
            <FixButton onClick={act(nativeRequestExactAlarm)}>Allow exact alarms</FixButton>
          )}
          <FixButton onClick={act(openAppSettings)}>Open app info</FixButton>
        </>
      )}

      <button onClick={runTest} disabled={testing} className="tap cta"
        style={{ width: "100%", marginTop: 12, borderRadius: 12, padding: "12px 0", fontSize: 13.5, fontWeight: 800, cursor: "pointer", opacity: testing ? 0.6 : 1 }}>
        {testing ? "Testing…" : "Test notifications now"}
      </button>

      {testResult && (
        <div className="rise" style={{
          marginTop: 10, borderRadius: 12, padding: "11px 13px", fontSize: 12, lineHeight: 1.5,
          color: C.text,
          background: tint(testResult.ok ? C.good : C.warn, .12),
          border: `1px solid ${tint(testResult.ok ? C.good : C.warn, .45)}`,
        }}>
          {testResult.msg}
        </div>
      )}
    </div>
  );
}
