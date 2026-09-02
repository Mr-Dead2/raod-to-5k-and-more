import React, { useState, useEffect, useCallback } from "react";
import { C, tint } from "../data.js";
import { haptic } from "../celebrate.js";
import { isNative } from "../native.js";
import {
  notificationsSupported, permission, loadReminder,
  ensureNotificationPermission, sendTestNotification,
} from "../notifications.js";

// Which build is actually running. Stamped by vite.config.js — the first thing
// to check when a shipped fix appears not to have landed, because an installed
// PWA or a side-loaded APK can easily still be running old code.
const BUILD_TIME = typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : "";

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((r) => setTimeout(() => r(null), ms))]);

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

export function NotifDiagnostics() {
  const [d, setD] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const collect = useCallback(async () => {
    const native = isNative();
    const standalone = typeof window !== "undefined" &&
      (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true);
    const supported = notificationsSupported();
    const perm = native ? "n/a (native)" : permission();

    let sw = "unsupported in this browser";
    let swOk = false;
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      const reg = await withTimeout(navigator.serviceWorker.ready, 2500);
      if (reg) { sw = "active"; swOk = true; }
      else sw = "not controlling this page";
    }

    let background = "not available";
    if (swOk) {
      try {
        const reg = await navigator.serviceWorker.ready;
        if ("periodicSync" in reg) {
          const st = await navigator.permissions.query({ name: "periodic-background-sync" });
          background = st.state === "granted" ? "allowed" : `not allowed (${st.state})`;
        } else background = "this browser has no background sync";
      } catch { background = "unknown" }
    }

    const r = await loadReminder();
    return { native, standalone, supported, perm, sw, swOk, background, reminder: r };
  }, []);

  useEffect(() => { collect().then(setD); }, [collect]);

  // The honest test: fire a notification, then ask the browser whether one
  // actually exists. "The call didn't throw" is not the same as "it appeared".
  const runTest = async () => {
    haptic(10);
    setTesting(true);
    setTestResult(null);
    try {
      const granted = await ensureNotificationPermission();
      if (!granted && !isNative()) {
        setTestResult({ ok: false, msg: "Permission is not granted, so nothing can be shown." });
      } else {
        const sent = await sendTestNotification();
        let seen = null;
        if (!isNative() && "serviceWorker" in navigator) {
          const reg = await withTimeout(navigator.serviceWorker.ready, 2500);
          if (reg) seen = (await reg.getNotifications()).length;
        }
        setTestResult(sent
          ? { ok: true, msg: seen === 0
              ? "Sent, but your system reports no notification on screen — check that notifications are allowed for this app in your phone's settings."
              : "Sent. If you can't see it, notifications are being blocked at the phone level rather than by the app." }
          : { ok: false, msg: "The app could not post a notification at all." });
      }
    } catch (e) {
      setTestResult({ ok: false, msg: `Failed: ${e?.message || e}` });
    }
    setTesting(false);
    setD(await collect());
  };

  if (!d) return null;

  const where = d.native ? "Native Android app" : d.standalone ? "Installed app (PWA)" : "Browser tab";
  const permState = d.native ? "info" : d.perm === "granted" ? "good" : d.perm === "denied" ? "bad" : "warn";
  const build = BUILD_TIME
    ? new Date(BUILD_TIME).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "unknown";

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
        note="If this is older than the fix you're expecting, the app is still running old code — close it completely and reopen, or reinstall the APK." />

      {!d.native && (
        <Row state={d.supported ? "good" : "bad"} label="Notification support"
          value={d.supported ? "available" : "missing"}
          note={d.supported ? null : "This browser can't show notifications at all. On iPhone, Stride must be added to the home screen first."} />
      )}

      <Row state={permState} label="Permission" value={d.perm}
        note={d.perm === "denied"
          ? "Blocked. The app cannot undo this — allow notifications for this site in your browser's site settings, then reopen Stride."
          : d.perm === "default"
            ? "Never asked or never answered. Use the button below."
            : null} />

      {!d.native && (
        <Row state={d.swOk ? "good" : "warn"} label="Background worker" value={d.sw}
          note={d.swOk ? null : "Without it, notifications only work while the app is open."} />
      )}

      {!d.native && (
        <Row state={d.background === "allowed" ? "good" : "warn"} label="Wake-ups when closed" value={d.background}
          note={d.background === "allowed" ? null
            : "The browser won't wake Stride while it's closed, so a daily reminder can only fire when the app is open. This is a browser limit, not a setting in the app — the Android app doesn't have it."} />
      )}

      <Row state={d.reminder.enabled ? "good" : "info"} label="Daily reminder"
        value={d.reminder.enabled ? `on at ${d.reminder.time}` : "off"}
        note={d.reminder.enabled && d.reminder.lastFired ? `Last fired ${d.reminder.lastFired}.` : null} />

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
