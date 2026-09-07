import React, { useState, useEffect, useRef, useMemo } from "react";
import { ShareSheet } from "./components/ShareSheet.jsx";
import { copyText } from "./share.js";
import { U, UNITS, setUnit, fmtDist, fmtDistNum, fmtPace as fmtPaceU, fmtPaceUnit, fmtElev, splitLabel, toDisplay, fromDisplay } from "./units.js";
import { RouteReplay } from "./components/RouteReplay.jsx";
import { RouteMaker } from "./components/RouteMaker.jsx";
import { WEEKS, FLAT, TOTAL, DEFAULT_WEEKS, C, typeColor, ACCENTS, applyAccent, applyPlan, tint } from "./data.js";
import { extendPlan, planSplit, adaptedPlan } from "./plan.js";
import { loadLog, saveLog, loadSettings, saveSettings } from "./storage.js";
import { WeeklyBars, CumulativeArea, StreakGrid, PaceTrend } from "./components/Charts.jsx";
import { LiveMap } from "./components/LiveMap.jsx";
import { BottomNav } from "./components/BottomNav.jsx";
import { RunTracker } from "./components/RunTracker.jsx";
import { NotifDiagnostics } from "./components/NotifDiagnostics.jsx";
import { WeatherStrip, useWeather } from "./components/Weather.jsx";
import { backupState, backupLabel, countSessions, autoDue, backupFilename } from "./backup.js";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { ACHIEVEMENTS, unlockedIds } from "./achievements.js";
import { buildSummary, streamCoach, generatePlanBlock, adaptPlanBlock, coachRun, validateKey, ANALYSE_PROMPT, quickAsks, MODELS, DEFAULT_MODEL, DEFAULT_GOAL } from "./coach.js";
import { haptic, confetti } from "./celebrate.js";
import {
  notificationsSupported, permissionState, loadReminder, saveReminder,
  enableReminders, disableReminders, showReminderNow, syncMessage,
  startForegroundScheduler, notifyMilestone,
  ensureNotificationPermission,
} from "./notifications.js";
import {
  RACES, raceById, bestReference, predictAll, readiness, daysUntil,
  fmtDuration, CONFIDENCE_LABEL, DEFAULT_GOAL_RACE,
} from "./goals.js";
import {
  healthSupported, healthAvailability, healthPermissionGranted,
  requestHealthPermission, openHealthConnect, readWorkouts, planImport,
} from "./health.js";
import {
  isNative, nativeEnableReminder, nativeDisableReminder, nativeUpdateReminder,
  ensureLocationPermission, styleStatusBar, nativeShareBackup, nativeWriteBackup,
  nativeBootstrapNotifications, onAppResume,
} from "./native.js";

// Tiny inline icon set (stroke follows text color) — keeps UI chrome free of
// emoji without pulling in an icon library.
const ICON_PATHS = {
  play: <path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none" />,
  download: <><path d="M12 3v12" /><path d="m6 11 6 6 6-6" /><path d="M4 21h16" /></>,
  upload: <><path d="M12 21V9" /><path d="m6 13 6-6 6 6" /><path d="M4 3h16" /></>,
  share: <><circle cx="6" cy="12" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><path d="m8.7 10.7 6.6-3.4M8.7 13.3l6.6 3.4" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /></>,
  map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z" /><path d="M9 3v15M15 6v15" /></>,
  bell: <><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
  flag: <><path d="M4 22V4M4 4h13l-2.5 4L17 12H4" /></>,
};
const Icon = ({ name, size = 16, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, ...style }} aria-hidden="true">
    {ICON_PATHS[name]}
  </svg>
);

// Brand mark: speed lines running into a forward chevron.
const Mark = () => (
  <span style={{
    width: 32, height: 32, borderRadius: 11, background: C.grad, flexShrink: 0,
    display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: C.glow,
  }}>
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={C.bg} strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8h6" /><path d="M2 13h4" /><path d="M5 18h4" /><path d="m12 5 7 7-7 7" />
    </svg>
  </span>
);

const DAY = 86400000;
const paceSec = (min, km) => {
  const m = parseFloat(min), k = parseFloat(km);
  if (!m || !k) return 0;
  return (m * 60) / k;
};
// Pace is stored per kilometre and displayed in whatever unit the runner chose.
const fmtPace = (s) => fmtPaceU(s);
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`);

// 1–5 effort scale logged per session (user content, like the badge emoji).
const FEELS = ["😖", "😕", "🙂", "😄", "🤩"];

const startOfDay = (iso) => { const d = new Date(iso + "T00:00:00"); d.setHours(0, 0, 0, 0); return d; };
const todayIndexOf = (iso) => {
  if (!iso) return -1;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((now - startOfDay(iso)) / DAY);
};
const dateForDay = (iso, i) => { const d = startOfDay(iso); d.setDate(d.getDate() + i); return d; };

// Smoothly animate a number toward its target for that satisfying count-up feel.
function useCountUp(target, ms = 650) {
  const [v, setV] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    const from = prev.current, to = target, start = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      setV(from + (to - from) * e);
      if (t < 1) raf = requestAnimationFrame(tick); else prev.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

// A distance field in the runner's chosen unit that stores canonical km.
//
// It keeps a local draft while focused so half-typed values ("5.", "0.") are
// not round-tripped through a conversion and rewritten under the caret; the
// draft is dropped on blur and the stored km takes over again.
function DistanceInput({ km, placeholderKm, onChangeKm, ...rest }) {
  const [draft, setDraft] = useState(null);
  const shown = draft != null
    ? draft
    : km === "" || km == null ? "" : String(Number(toDisplay(km).toFixed(2)));
  return (
    <input
      className="inp" type="number" inputMode="decimal"
      placeholder={String(Number(toDisplay(placeholderKm || 0).toFixed(2)))}
      value={shown}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        onChangeKm(v === "" ? "" : fromDisplay(v));
      }}
      onBlur={() => setDraft(null)}
      {...rest}
    />
  );
}

// ---------------------------------------------------------------------------
// Layout primitives.
//
// These MUST live at module scope. Defined inside App() they were a new
// component type on every render, so React unmounted and remounted their whole
// subtree each time state changed — which destroyed the focused element. The
// visible symptom was that every text field in the app (the coach's question
// box, the API key, a session's distance) accepted exactly one character
// before the input was torn out from under the caret.
// ---------------------------------------------------------------------------
const Card = ({ children, style, className = "", innerRef }) => (
  <div ref={innerRef} className={`card ${className}`.trim()} style={{ borderRadius: 20, padding: 18, ...style }}>{children}</div>
);
const Label = ({ children, right }) => (
  <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
    <span className="lab">{children}</span>
    {right != null && <span style={{ marginLeft: "auto" }}>{right}</span>}
  </div>
);
const Bar = ({ pct }) => (
  <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>
);
// Every tab opens with the same shape: a big title, a line of context, and
// an optional action on the right. That repetition is most of what makes a
// set of screens read as one app.
const Screen = ({ title, sub, action }) => (
  <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 16 }}>
    <div style={{ minWidth: 0 }}>
      <h2 className="disp" style={{ fontSize: 27, fontWeight: 700, margin: 0, letterSpacing: -0.7, lineHeight: 1.05 }}>{title}</h2>
      {sub && <div style={{ fontSize: 12.5, color: C.dim, marginTop: 5, fontWeight: 500 }}>{sub}</div>}
    </div>
    {action && <div style={{ marginLeft: "auto", flexShrink: 0 }}>{action}</div>}
  </div>
);
// Segmented control. The pill is one element that translates, so switching
// sub-screens is a movement rather than two things repainting.
const Segmented = ({ items, value, onChange }) => {
  const i = Math.max(0, items.findIndex((x) => x.id === value));
  return (
    <div className="seg" style={{ marginBottom: 16 }}>
      <i style={{ width: `calc((100% - 8px) / ${items.length})`, transform: `translateX(${i * 100}%)` }} />
      {items.map((x) => (
        <button key={x.id} className={value === x.id ? "on" : ""}
          onClick={() => { onChange(x.id); haptic(5); }}>{x.label}</button>
      ))}
    </div>
  );
};
// A compact figure tile: one number, one label, optional footnote.
const Tile = ({ label, value, unit, sub, hero, color, delay = 0 }) => (
  <div className="card stagger" style={{ animationDelay: `${delay}s`, flex: 1, minWidth: 0, borderRadius: 18, padding: "14px 14px 13px", overflow: "hidden" }}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
      <span className={`num${hero ? " gtext" : ""}`} style={{ fontSize: 28, fontWeight: 700, color: hero ? undefined : color || C.text, lineHeight: 1 }}>{value}</span>
      {unit && <span className="num" style={{ fontSize: 12, fontWeight: 700, color: C.dim }}>{unit}</span>}
    </div>
    <div style={{ fontSize: 9.5, letterSpacing: 1.4, color: C.dim, marginTop: 9, fontWeight: 800, textTransform: "uppercase" }}>{label}</div>
    {sub && <div style={{ fontSize: 10.5, color: C.dim2, marginTop: 3 }}>{sub}</div>}
  </div>
);

export default function App() {
  const [log, setLog] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(null);
  const [tab, setTab] = useState("plan"); // plan | stats | history
  const [tipsOpen, setTipsOpen] = useState(false);
  const notifCardRef = useRef(null);
  const [startDate, setStartDate] = useState("");
  const [toast, setToast] = useState(null);
  const [trackerOpen, setTrackerOpen] = useState(false);
  const [accent, setAccent] = useState("lime");
  const [unit, setUnitState] = useState("km");
  const [histFilter, setHistFilter] = useState("all"); // all | run | gps
  const [openWeeks, setOpenWeeks] = useState({}); // completed weeks expanded by tap
  const [replayRun, setReplayRun] = useState(null); // run object being replayed
  const [routeMakerOpen, setRouteMakerOpen] = useState(false);
  const [shareSpec, setShareSpec] = useState(null); // card handed to the share sheet
  const [statsView, setStatsView] = useState("overview"); // overview | goal | charts | awards | settings
  const [scrolled, setScrolled] = useState(false);
  const wx = useWeather({ enabled: tab === "plan" });
  const [backupInfo, setBackupInfo] = useState({ lastBackupAt: null, sessionsAtLastBackup: 0 });
  const [selectedCustomRoute, setSelectedCustomRoute] = useState(null);

  // reminders + per-type notification switches
  const [remOn, setRemOn] = useState(false);
  const [remTime, setRemTime] = useState("18:00");
  const [perm, setPerm] = useState("default");
  const [notif, setNotif] = useState({ runLive: true, runKm: true, runInterval: true, runFinish: true, milestone: true, skipRest: false });

  // race goal beyond the starter plan
  const [goalRace, setGoalRace] = useState(DEFAULT_GOAL_RACE);
  const [goalDate, setGoalDate] = useState("");

  // AI coach (Groq)
  const [coachKey, setCoachKey] = useState("");
  const [coachGoal, setCoachGoal] = useState(DEFAULT_GOAL);
  const [coachModel, setCoachModel] = useState(DEFAULT_MODEL);
  const [coachChat, setCoachChat] = useState([]); // [{ role: "user"|"assistant", content }]
  const [coachInput, setCoachInput] = useState("");
  const [coachBusy, setCoachBusy] = useState(false);
  const [coachErr, setCoachErr] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [coachStream, setCoachStream] = useState("");   // reply text as it arrives
  const [keyCheck, setKeyCheck] = useState(null);       // { ok, error } after a key test
  const [keyBusy, setKeyBusy] = useState(false);
  const coachAbort = useRef(null);                      // aborts the in-flight reply
  const coachAcc = useRef("");                          // text streamed so far
  const chatEndRef = useRef(null);
  const chatBoxRef = useRef(null);
  // AI-generated plan: a version counter to re-derive plan memos, plus a pending
  // proposal the user previews before applying.
  const [planVersion, setPlanVersion] = useState(0);
  const [proposedPlan, setProposedPlan] = useState(null); // { weeks, fromIdx, mode }
  const [planBusy, setPlanBusy] = useState(false);
  const isCustomPlan = WEEKS !== DEFAULT_WEEKS;
  // per-run "coach this run" feedback (transient, keyed by session key)
  const [runFeedback, setRunFeedback] = useState({}); // { [key]: text }
  const [runFeedbackBusy, setRunFeedbackBusy] = useState(null); // key currently loading

  // install prompt
  const [installEvt, setInstallEvt] = useState(null);

  // Health Connect import (runs recorded on a watch, via Samsung Health etc.)
  const [hc, setHc] = useState({ availability: "NotSupported", granted: false });
  const [hcScan, setHcScan] = useState(null);   // { ready, skipped } after a look
  // Off by default: Samsung Health records walking on its own, so importing
  // walks means importing every trip to the shops as a training session.
  const [importWalks, setImportWalks] = useState(false);
  const [hcBusy, setHcBusy] = useState(false);

  // stopwatch
  const [swMs, setSwMs] = useState(0);
  const [swRun, setSwRun] = useState(false);
  const swRef = useRef(null);

  useEffect(() => {
    setLog(loadLog());
    const s = loadSettings();
    setStartDate(s.startDate || "");
    setAccent(applyAccent(s.accent));
    setUnitState(setUnit(s.unit));
    setBackupInfo({ lastBackupAt: s.lastBackupAt || null, sessionsAtLastBackup: s.sessionsAtLastBackup || 0 });
    setCoachKey(s.groqKey || "");
    setCoachGoal(s.goal || DEFAULT_GOAL);
    setCoachModel(s.coachModel || DEFAULT_MODEL);
    setGoalRace(s.goalRace || DEFAULT_GOAL_RACE);
    setGoalDate(s.goalDate || "");
    setImportWalks(!!s.importWalks);
    if (Array.isArray(s.coachChat)) setCoachChat(s.coachChat);
    else if (s.coachLast?.text) setCoachChat([{ role: "assistant", content: s.coachLast.text }]); // migrate old single reply
    setLoaded(true);
    (async () => {
      const r = await loadReminder();
      setRemOn(!!r.enabled);
      setRemTime(r.time || "18:00");
      setNotif({ runLive: r.runLive !== false, runKm: r.runKm !== false, runInterval: r.runInterval !== false, runFinish: r.runFinish !== false, milestone: r.milestone !== false, skipRest: !!r.skipRest });
    })();
    // native app setup (no-ops on the web)
    styleStatusBar();
    (async () => {
      // Android grants nothing unless something asks, and until now nothing in
      // the launch path ever did — a fresh APK install could run for weeks
      // without a single permission dialog. Ask once, on the first launch only,
      // so we don't burn Android's limited prompt budget on every start.
      if (isNative() && !loadSettings().askedNotifPerm) {
        saveSettings({ ...loadSettings(), askedNotifPerm: true });
        await nativeBootstrapNotifications();
      }
      setPerm(await permissionState());
      // Location is requested up front too, but never blocks the UI.
      ensureLocationPermission();
    })();
  }, []);

  useEffect(() => {
    const h = (e) => { e.preventDefault(); setInstallEvt(e); };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  // Weekly automatic backup, native only. On the web a silent download would
  // be a surprise; natively a file quietly appearing in Documents/Stride is
  // exactly the safety net localStorage does not provide. Best-effort: a
  // failure is never surfaced, because the manual export is still there.
  useEffect(() => {
    if (!loaded || !isNative()) return;
    const s = loadSettings();
    if (!autoDue({ lastAutoAt: s.lastAutoBackupAt, log })) return;
    let cancelled = false;
    (async () => {
      const path = await nativeWriteBackup(backupPayload(), backupFilename());
      if (cancelled || !path) return;
      markBackedUp({ lastAutoBackupAt: new Date().toISOString() });
    })();
    return () => { cancelled = true; };
    // Runs on load and whenever the log changes; autoDue() rate-limits it to
    // once a week, so this is not a write per tick.
  }, [loaded, log]);

  // The app bar is transparent over the top of the page and gains its glass
  // background once anything has scrolled under it — the cue that tells you a
  // bar is chrome and not just the first row of content.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Moving between tabs should feel like opening a screen, not scrolling a
  // very long page: start each one at the top.
  useEffect(() => { window.scrollTo({ top: 0, behavior: "auto" }); }, [tab, statsView]);

  // Follow the reply as it streams — inside the conversation box only. Scrolling
  // the page instead moved the composer (and its Stop button) down the screen
  // on every token, so the control you were reaching for slid out from under
  // your thumb.
  useEffect(() => {
    if (tab !== "coach") return;
    const box = chatBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [coachStream, coachChat, coachBusy, tab]);

  // Coming back from Android's notification settings should be reflected here
  // straight away, rather than leaving a "blocked" banner over a permission the
  // user has just granted.
  // Health Connect state can change entirely outside the app — the provider
  // gets installed, access is granted or revoked in its own settings screen —
  // so it is re-read on launch and on every return to the foreground.
  const refreshHealth = async () => {
    if (!healthSupported()) return { availability: "NotSupported", granted: false };
    const availability = await healthAvailability();
    const granted = availability === "Available" ? await healthPermissionGranted() : false;
    const next = { availability, granted };
    setHc(next);
    return next;
  };
  useEffect(() => { refreshHealth(); }, []);

  useEffect(() => onAppResume(() => {
    permissionState().then(setPerm);
    refreshHealth();
  }), []);

  useEffect(() => {
    if (swRun) {
      const start = Date.now() - swMs;
      swRef.current = setInterval(() => setSwMs(Date.now() - start), 200);
    } else if (swRef.current) clearInterval(swRef.current);
    return () => swRef.current && clearInterval(swRef.current);
  }, [swRun]);

  const persist = (next) => { setLog(next); saveLog(next); };

  const update = (key, patch) => {
    const cur = log[key] || {};
    const wasDone = !!cur.done;
    const next = { ...cur, ...patch };
    if (patch.done && !cur.done && !next.date) next.date = new Date().toISOString();
    const merged = { ...log, [key]: next };
    persist(merged);

    // celebrate newly completed sessions
    if (patch.done && !wasDone) {
      const total = FLAT.filter((f) => merged[f.key] && merged[f.key].done).length;
      const wk = Number(key.match(/^w(\d+)d/)[1]);
      const days = WEEKS.find((w) => w.n === wk).days;
      const weekDone = days.every((_, i) => merged[`w${wk}d${i}`] && merged[`w${wk}d${i}`].done);
      if (total >= TOTAL) { haptic([20, 40, 60]); confetti({ count: 170, spread: 1.5 }); }
      else if (weekDone) { haptic([15, 30, 15]); confetti({ count: 120, spread: 1.2 }); }
      else { haptic(15); confetti({ count: 70 }); }
    } else if (patch.done === false) {
      haptic(8);
    }
  };

  const reset = () => { persist({}); setOpen(null); haptic(10); };

  const saveStart = (d) => { setStartDate(d); saveSettings({ ...loadSettings(), startDate: d }); haptic(8); };

  const saveGoalRace = (id) => { setGoalRace(id); saveSettings({ ...loadSettings(), goalRace: id }); haptic(8); };
  const saveGoalDate = (d) => { setGoalDate(d); saveSettings({ ...loadSettings(), goalDate: d }); haptic(6); };

  // Per-type notification switches live in IndexedDB with the reminder, so the
  // service worker sees the same settings while the app is closed.
  const toggleNotif = async (key) => {
    const next = { ...notif, [key]: !notif[key] };
    setNotif(next);
    haptic(6);
    await saveReminder({ [key]: next[key] });
    // Switching an alert on is worthless if the browser was never asked.
    if (next[key] && key !== "skipRest") {
      await ensureNotificationPermission();
      setPerm(await permissionState());
    }
  };

  // Explicit "allow notifications" action for the settings banner.
  const askNotificationPermission = async () => {
    haptic(8);
    const ok = await ensureNotificationPermission();
    setPerm(await permissionState());
    setToast(ok
      ? { icon: "🔔", title: "Notifications are on", label: "NOTIFICATIONS" }
      : {
          icon: "⚠️",
          title: isNative()
            ? "Blocked — turn Stride's notifications on in Android settings"
            : "Blocked — allow them in your browser settings",
          label: "NOTIFICATIONS",
        });
  };

  // --- Health Connect import -----------------------------------------------
  // Read-only: Stride pulls workouts in and never writes back, so the worst a
  // mistake here can do is add a row the user can undo by unticking the day.

  const connectHealth = async () => {
    haptic(8);
    setHcBusy(true);
    const granted = await requestHealthPermission();
    const next = await refreshHealth();
    setHcBusy(false);
    if (!granted && !next.granted) {
      setToast({ icon: "⚠️", title: "Health Connect didn't grant access", label: "IMPORT" });
    }
  };

  const scanHealth = async () => {
    haptic(8);
    setHcBusy(true);
    setHcScan(null);
    const workouts = await readWorkouts(30);
    setHcScan(planImport(workouts, { flat: FLAT, log, startDate, includeWalks: importWalks }));
    setHcBusy(false);
  };

  // Applies the whole batch in one write. update() persists per call and would
  // otherwise merge each run onto a stale `log`, so only the last would survive.
  const applyHealthImport = () => {
    if (!hcScan || hcScan.ready.length === 0) return;
    const merged = { ...log };
    for (const r of hcScan.ready) merged[r.key] = { ...(merged[r.key] || {}), ...r.entry };
    persist(merged);
    haptic([12, 30, 12]);
    confetti({ count: 70 });
    const n = hcScan.ready.length;
    const walks = hcScan.ready.filter((r) => r.kind === "walk").length;
    const noun = walks === 0 ? "run" : walks === n ? "walk" : "session";
    setToast({ icon: "⌚", title: `Imported ${n} ${noun}${n === 1 ? "" : "s"}`, label: "HEALTH CONNECT" });
    setHcScan(null);
    setTab("history");
  };

  // The notification centre is three levels down (Stats, then a collapsed
  // "Settings & tools", then a scroll), which is precisely where nobody looks
  // when notifications are the thing that is broken. This is the shortcut.
  const goToNotifications = () => {
    haptic(8);
    setTab("stats");
    setStatsView("settings");
    // After the section has expanded and painted.
    setTimeout(() => notifCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
  };

  const toggleImportWalks = () => {
    const next = !importWalks;
    setImportWalks(next);
    saveSettings({ ...loadSettings(), importWalks: next });
    haptic(6);
    // Re-sort what is already on screen rather than making them scan again.
    setHcScan((prev) => prev && planImport(prev.ready.concat(prev.skipped).map((x) => x.w),
      { flat: FLAT, log, startDate, includeWalks: next }));
  };

  // Switching units only changes labels and the numbers on screen: every stored
  // value stays in kilometres, so nothing in the log is rewritten.
  const setUnitPref = (id) => {
    setUnitState(setUnit(id));
    saveSettings({ ...loadSettings(), unit: id });
    haptic(8);
  };

  const setAccentTheme = (id) => {
    setAccent(applyAccent(id)); // mutates C; the state change re-renders everything with it
    saveSettings({ ...loadSettings(), accent: id });
    haptic(8);
  };

  // AI coach settings persist to the same on-device settings store
  const saveCoachKey = (v) => { setCoachKey(v); saveSettings({ ...loadSettings(), groqKey: v }); };
  const saveCoachGoal = (v) => { setCoachGoal(v); saveSettings({ ...loadSettings(), goal: v }); };
  const saveCoachModel = (v) => { setCoachModel(v); saveSettings({ ...loadSettings(), coachModel: v }); };

  const persistChat = (chat) => {
    const trimmed = chat.slice(-20); // cap stored history
    setCoachChat(trimmed);
    saveSettings({ ...loadSettings(), coachChat: trimmed });
  };

  // Everything the coach needs about the plan itself: today's session and what
  // is coming. Without it the most obvious question anyone asks a coach — what
  // should I do today? — gets answered by guesswork.
  const coachPlanContext = () => {
    const at = (i) => (i >= 0 && i < TOTAL ? FLAT[i] : null);
    // distance in the runner's unit, matching `units` in the summary
    const brief = (f) => f && ({ week: f.week, day: f.d, type: f.type, title: f.title, detail: f.detail, distance: Number(fmtDistNum(f.km, 1)), done: !!(log[f.key] && log[f.key].done) });
    const startIdx = todayKey ? todayIdx : FLAT.findIndex((f) => !(log[f.key] && log[f.key].done));
    return {
      today: todayKey ? brief(at(todayIdx)) : null,
      upcoming: startIdx >= 0
        ? Array.from({ length: 7 }, (_, i) => brief(at(startIdx + i))).filter(Boolean)
        : null,
    };
  };

  const coachSummary = () => buildSummary({
    stats, weekly, history, goal: coachGoal, race: coachRaceGoal, plan: coachPlanContext(),
  });

  // Send a message through the coach. `content` is what the model receives;
  // `display` (optional) is the friendlier text shown in the user bubble.
  //
  // The reply streams in. Waiting in silence for a long answer makes a fast
  // model feel slow, and a reply the runner stops halfway is still a reply —
  // whatever arrived is kept rather than thrown away.
  const sendToCoach = async (content, display) => {
    if (coachBusy) return;
    if (!coachKey.trim()) { setCoachErr("Add your free Groq API key below first."); setShowKey(true); return; }
    haptic(8);
    setCoachErr("");
    const base = [...coachChat, { role: "user", content, display: display || content }];
    setCoachChat(base);
    setCoachBusy(true);
    setCoachStream("");
    coachAcc.current = "";
    const ctrl = new AbortController();
    coachAbort.current = ctrl;
    try {
      const messages = base.map((m) => ({ role: m.role, content: m.content })); // strip display before sending
      const text = await streamCoach({
        apiKey: coachKey.trim(),
        model: coachModel.trim() || DEFAULT_MODEL,
        summary: coachSummary(),
        messages,
        signal: ctrl.signal,
        onToken: (t) => { coachAcc.current += t; setCoachStream(coachAcc.current); },
      });
      persistChat([...base, { role: "assistant", content: text }]);
      haptic([10, 20, 10]);
    } catch (e) {
      const stopped = e?.name === "AbortError";
      if (stopped && coachAcc.current.trim()) {
        persistChat([...base, { role: "assistant", content: coachAcc.current.trim(), stopped: true }]);
      } else {
        if (!stopped) setCoachErr(e.message || "Couldn't reach the coach.");
        setCoachChat(coachChat); // roll the optimistic user bubble back
      }
      haptic(8);
    } finally {
      setCoachBusy(false);
      setCoachStream("");
      coachAcc.current = "";
      coachAbort.current = null;
    }
  };
  const stopCoach = () => { coachAbort.current?.abort(); haptic(8); };
  const analyseCoach = () => sendToCoach(ANALYSE_PROMPT, "Analyse my training");
  const askCoachInput = () => { const q = coachInput.trim(); if (!q) return; setCoachInput(""); sendToCoach(q); };
  const clearCoachChat = () => { persistChat([]); setCoachErr(""); haptic(6); };

  // Retry the last question: drop the failed exchange and ask it again.
  const retryCoach = () => {
    const lastUser = [...coachChat].reverse().find((m) => m.role === "user");
    if (!lastUser || coachBusy) return;
    const upto = coachChat.slice(0, coachChat.lastIndexOf(lastUser));
    setCoachChat(upto);
    setTimeout(() => sendToCoach(lastUser.content, lastUser.display), 0);
  };

  const testCoachKey = async () => {
    haptic(8);
    setKeyBusy(true);
    setKeyCheck(null);
    setKeyCheck(await validateKey({ apiKey: coachKey, model: coachModel.trim() || DEFAULT_MODEL }));
    setKeyBusy(false);
  };

  // Swap the active training plan, persist it, and re-derive plan-based memos.
  const setActivePlan = (weeks) => {
    applyPlan(weeks);
    saveSettings({ ...loadSettings(), customPlan: weeks && weeks !== DEFAULT_WEEKS ? weeks : null });
    setPlanVersion((v) => v + 1);
  };

  // Ask the AI for a new block (appended to the current plan) and preview it.
  const generatePlan = async () => {
    if (planBusy) return;
    if (!coachKey.trim()) { setCoachErr("Add your free Groq API key below first."); setShowKey(true); return; }
    haptic(8);
    setCoachErr(""); setPlanBusy(true); setProposedPlan(null);
    try {
      const summary = coachSummary();
      const raw = await generatePlanBlock({ apiKey: coachKey.trim(), model: coachModel.trim() || DEFAULT_MODEL, summary });
      const extended = extendPlan(WEEKS, raw);
      if (!extended) throw new Error("The plan came back empty — try again.");
      setProposedPlan({ weeks: extended, fromIdx: WEEKS.length, mode: "append" });
      haptic([10, 20, 10]);
    } catch (e) {
      setCoachErr(e.message || "Couldn't build a plan.");
      haptic(8);
    } finally {
      setPlanBusy(false);
    }
  };

  // Re-tune the not-yet-started weeks from results + too easy/hard feedback.
  const adaptPlan = async () => {
    if (planBusy) return;
    if (!coachKey.trim()) { setCoachErr("Add your free Groq API key below first."); setShowKey(true); return; }
    const { future } = planSplit(WEEKS, log);
    if (!future.length) { setCoachErr("No upcoming sessions to adjust — finish or build a new block."); return; }
    haptic(8);
    setCoachErr(""); setPlanBusy(true); setProposedPlan(null);
    try {
      const summary = coachSummary();
      const raw = await adaptPlanBlock({ apiKey: coachKey.trim(), model: coachModel.trim() || DEFAULT_MODEL, summary, weeks: future });
      const res = adaptedPlan(WEEKS, log, raw);
      if (!res) throw new Error("Couldn't adjust the plan — try again.");
      setProposedPlan({ ...res, mode: "adapt" });
      haptic([10, 20, 10]);
    } catch (e) {
      setCoachErr(e.message || "Couldn't adjust the plan.");
      haptic(8);
    } finally {
      setPlanBusy(false);
    }
  };

  const applyProposedPlan = () => {
    if (!proposedPlan) return;
    setActivePlan(proposedPlan.weeks);
    const adapt = proposedPlan.mode === "adapt";
    setProposedPlan(null);
    haptic([12, 30, 12]); confetti({ count: 90 });
    setToast(adapt
      ? { icon: "🎯", title: "Upcoming sessions re-tuned", label: "PLAN UPDATED" }
      : { icon: "🚀", title: "New training block added", label: "PLAN UPDATED" });
    setTab("plan");
  };
  const resetPlan = () => { setActivePlan(null); setProposedPlan(null); haptic(8); setToast({ icon: "↩️", title: "Back to the default plan", label: "PLAN RESET" }); };

  // On-demand AI feedback for a single logged run.
  const coachThisRun = async (item) => {
    if (runFeedbackBusy) return;
    if (!coachKey.trim()) { setTab("coach"); setCoachErr("Add your free Groq API key in the AI coach tab first."); setShowKey(true); return; }
    haptic(8); setRunFeedbackBusy(item.key);
    try {
      const e = item.e || {};
      const km = parseFloat(e.km) || 0, min = parseFloat(e.min) || 0;
      const run = {
        session: `${item.title} — ${item.detail}`,
        km: Number(km.toFixed(2)), min: min ? Number(min.toFixed(1)) : null,
        pace: min && km ? fmtPace((min * 60) / km) : null,
        splits: e.splits ? e.splits.map((s) => fmtPace(s)) : null,
        feel: e.feel || null, stitch: !!e.stitch, gps: !!e.tracked,
        elevGainM: e.elev || null, runKm: e.runKm ?? null, walkKm: e.walkKm ?? null,
        cadenceSpm: e.cadence || null,
        date: e.date ? e.date.slice(0, 10) : null,
      };
      const summary = coachSummary();
      const text = await coachRun({ apiKey: coachKey.trim(), model: coachModel.trim() || DEFAULT_MODEL, summary, run });
      setRunFeedback((m) => ({ ...m, [item.key]: text }));
      haptic([10, 20, 10]);
    } catch (e) {
      setRunFeedback((m) => ({ ...m, [item.key]: `⚠️ ${e.message || "Couldn't reach the coach."}` }));
      haptic(8);
    } finally {
      setRunFeedbackBusy(null);
    }
  };

  const importRef = useRef(null);

  // The backup payload, built once and reused by the manual export and the
  // automatic native write.
  const backupPayload = () => {
    // keep the secret Groq key out of backup files (export can open a share sheet)
    const { groqKey, ...safeSettings } = loadSettings();
    return JSON.stringify(
      { app: "stride", version: 2, exportedAt: new Date().toISOString(), log, settings: { ...safeSettings, startDate } },
      null, 2,
    );
  };

  // Remember not just *when* the log was written out but *how much* was in it,
  // so the nag can be about unprotected work rather than the calendar.
  const markBackedUp = (extra = {}) => {
    const at = new Date().toISOString();
    saveSettings({ ...loadSettings(), lastBackupAt: at, sessionsAtLastBackup: countSessions(log), ...extra });
    setBackupInfo({ lastBackupAt: at, sessionsAtLastBackup: countSessions(log) });
  };

  const exportData = async () => {
    haptic(8);
    const json = backupPayload();
    const filename = backupFilename();
    // native: Blob downloads don't work in the WebView — share the file instead
    if (isNative()) {
      const ok = await nativeShareBackup(json, filename);
      if (ok) markBackedUp();
      setToast(ok ? { icon: "💾", title: "Backup ready to share", label: "BACKUP" }
                  : { icon: "⚠️", title: "Couldn't export backup", label: "BACKUP" });
      return;
    }
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    markBackedUp();
    setToast({ icon: "💾", title: "Backup downloaded", label: "BACKUP" });
  };
  // Accepts current (v2) and old (v1) backups, plus a raw log object copied
  // straight out of localStorage — so runs survive any app version change.
  const parseBackup = (data) => {
    if (!data || typeof data !== "object") return null;
    if (data.log && typeof data.log === "object") return { log: data.log, settings: data.settings || {} };
    if (Object.keys(data).some((k) => /^w\d+d\d+$/.test(k))) return { log: data, settings: {} };
    return null;
  };
  const importData = async (file) => {
    if (!file) return;
    try {
      const backup = parseBackup(JSON.parse(await file.text()));
      if (backup) {
        // merge rather than replace, so importing an old backup never wipes
        // sessions logged since it was taken; the backup wins per session
        const merged = { ...log };
        let restored = 0;
        for (const [k, e] of Object.entries(backup.log)) {
          if (!e || typeof e !== "object") continue;
          merged[k] = { ...merged[k], ...e };
          restored++;
        }
        persist(merged);
        if (backup.settings.startDate) saveStart(backup.settings.startDate);
        if (backup.settings.accent) setAccentTheme(backup.settings.accent);
        if (backup.settings.unit) setUnitPref(backup.settings.unit);
        if (backup.settings.customPlan) setActivePlan(backup.settings.customPlan);
        if (backup.settings.goalRace) saveGoalRace(backup.settings.goalRace);
        if (backup.settings.goalDate) saveGoalDate(backup.settings.goalDate);
        haptic([10, 30, 10]);
        setToast({ icon: "✅", title: `Backup restored — ${restored} session${restored === 1 ? "" : "s"}`, label: "BACKUP" });
      } else setToast({ icon: "⚠️", title: "Not a valid backup file", label: "BACKUP" });
    } catch { setToast({ icon: "⚠️", title: "Couldn't read that file", label: "BACKUP" }); }
  };
  // --- sharing --------------------------------------------------------------
  // Every shareable thing is described as a card `spec` and handed to the
  // sheet, which owns the format/style picking, the preview and the export.
  // The spec object goes into state so its identity is stable — the sheet
  // re-renders the preview whenever the spec changes, and a fresh object on
  // every App render would put it in a loop.
  const openShare = (spec) => { haptic(10); setShareSpec(spec); };

  const runShareSpec = (item) => ({
    kind: "run",
    data: {
      title: item.title || null,
      km: item.e.km, min: item.e.min, durMs: item.e.durMs,
      route: item.e.route, splits: item.e.splits,
      elev: item.e.elev, kcal: item.e.kcal,
      runKm: item.e.runKm, walkKm: item.e.walkKm,
      hrAvg: item.e.hrAvg, cadence: item.e.cadence,
      note: item.e.note, date: item.e.date,
    },
  });

  const progressShareSpec = () => ({
    kind: "progress",
    data: {
      headline: goal ? `Road to my ${goal.name}` : `${WEEKS.length}-week training block`,
      pct, done: stats.done, total: TOTAL,
      km: stats.kmLogged, runs: stats.runsLogged, streak: stats.best,
      pace: fmtPace(stats.avgPaceSec),
      longest: stats.maxKm,
      time: stats.minTotal ? fmtMin(stats.minTotal) : null,
      weekly: weekly.map((w) => ({ week: w.label, value: w.value, target: w.target })),
      date: Date.now(),
    },
  });

  const achievementShareSpec = (a) => ({
    kind: "achievement",
    data: { icon: a.icon, title: a.title, desc: a.desc, count: unlocked.size, of: ACHIEVEMENTS.length, date: Date.now() },
  });

  const goalShareSpec = () => ({
    kind: "goal",
    data: {
      raceName: goal ? goal.name : "Next race",
      time: goalPrediction ? fmtDuration(goalPrediction.sec) : "—",
      sub: goalPrediction && raceRef
        ? `predicted from ${fmtDist(raceRef.km, 1)} in ${fmtDuration(raceRef.sec)}`
        : "log a timed run for a prediction",
      distance: goal ? fmtDist(goal.km, goal.km % 1 ? 1 : 0) : "—",
      days: goalDate && goalDays != null && goalDays >= 0 ? goalDays : null,
      readiness: goalReady,
      note: goalReady >= 100
        ? "Longest run already covers the distance."
        : goal ? `Longest run so far ${fmtDist(stats.maxKm || 0, 1)}.` : "",
      date: Date.now(),
    },
  });

  // An imported walk is a session, but it is not a run. Pace, longest run and
  // race predictions must ignore it: Samsung Health logs walks by itself, and a
  // long amble counted as a run would set the "longest run" that race readiness
  // is measured against, and drag every pace figure with it.
  const isRun = (e) => e && e.activity !== "walk";

  const stats = useMemo(() => {
    let kmLogged = 0, done = 0, stitches = 0, runsLogged = 0, maxKm = 0, bestPaceSec = 0, stitchlessRuns = 0;
    let timeSum = 0, paceKmSum = 0, minTotal = 0, earlyRuns = 0, lateRuns = 0;
    let bestSplitSec = 0, bestElevM = 0, totalKcal = 0;
    FLAT.forEach((f) => {
      const e = log[f.key];
      if (!e) return;
      if (e.done) done++;
      const running = isRun(e);
      const k = parseFloat(e.km);
      if (!isNaN(k)) {
        kmLogged += k;
        if (k > 0 && running) { runsLogged++; maxKm = Math.max(maxKm, k); if (!e.stitch) stitchlessRuns++; }
      }
      if (e.stitch) stitches++;
      const ps = running ? paceSec(e.min, e.km) : 0;
      if (ps && (bestPaceSec === 0 || ps < bestPaceSec)) bestPaceSec = ps;
      const mm = parseFloat(e.min);
      if (mm > 0) minTotal += mm;
      if (mm > 0 && k > 0 && running) { timeSum += mm * 60; paceKmSum += k; }
      if (e.done && e.date) {
        const h = new Date(e.date).getHours();
        if (h < 8) earlyRuns++; else if (h >= 21) lateRuns++;
      }
      // per-run PRs from GPS-tracked runs
      if (e.splits && e.splits.length > 0) {
        const fastest = Math.min(...e.splits);
        if (bestSplitSec === 0 || fastest < bestSplitSec) bestSplitSec = fastest;
      }
      if (e.elev > 0) bestElevM = Math.max(bestElevM, e.elev);
      if (e.kcal > 0) totalKcal += e.kcal;
    });
    let best = 0, cur = 0;
    FLAT.forEach((f) => { if (log[f.key] && log[f.key].done) { cur++; best = Math.max(best, cur); } else cur = 0; });
    // streak the user is on right now: consecutive done days ending at the last done day
    let lastDone = -1;
    FLAT.forEach((f, i) => { if (log[f.key] && log[f.key].done) lastDone = i; });
    let curStreak = 0;
    for (let i = lastDone; i >= 0 && log[FLAT[i].key] && log[FLAT[i].key].done; i--) curStreak++;
    const fullWeeks = WEEKS.filter((w) => w.days.every((_, i) => log[`w${w.n}d${i}`] && log[`w${w.n}d${i}`].done)).length;
    const avgPaceSec = paceKmSum > 0 ? timeSum / paceKmSum : 0;
    return { kmLogged, done, total: TOTAL, stitches, runsLogged, best, curStreak, maxKm, bestPaceSec, stitchlessRuns, fullWeeks, avgPaceSec, minTotal, earlyRuns, lateRuns, bestSplitSec, bestElevM, totalKcal };
  }, [log, planVersion]);

  const weekly = useMemo(() => WEEKS.map((w) => {
    let value = 0, target = 0;
    w.days.forEach((day, di) => {
      target += day.km || 0;
      const e = log[`w${w.n}d${di}`];
      const k = e && parseFloat(e.km);
      if (k && !isNaN(k)) value += k;
    });
    return { label: w.n, value, target };
  }), [log, planVersion]);

  const todayIdx = todayIndexOf(startDate);

  const cells = useMemo(() => FLAT.map((f, i) => ({
    done: !!(log[f.key] && log[f.key].done),
    type: f.type,
    isToday: i === todayIdx,
    isPast: startDate && i < todayIdx,
    label: startDate ? dateForDay(startDate, i).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : f.d,
  })), [log, startDate, todayIdx, planVersion]);

  const history = useMemo(() => {
    const items = FLAT.map((f) => ({ ...f, e: log[f.key] || {} }))
      .filter((f) => f.e.done || parseFloat(f.e.km) > 0);
    items.sort((a, b) => (b.e.date || "").localeCompare(a.e.date || ""));
    return items;
  }, [log, planVersion]);

  const paceTrend = useMemo(() => history
    .filter((h) => isRun(h.e) && paceSec(h.e.min, h.e.km) > 0)
    .slice().sort((a, b) => (a.e.date || "").localeCompare(b.e.date || ""))
    .map((h) => ({ sec: paceSec(h.e.min, h.e.km) })), [history]);

  const cumulative = useMemo(() => {
    const runs = history.filter((h) => parseFloat(h.e.km) > 0).slice()
      .sort((a, b) => (a.e.date || "").localeCompare(b.e.date || ""));
    let total = 0;
    return runs.map((r) => { total += parseFloat(r.e.km); return { total }; });
  }, [history]);

  const unlocked = useMemo(() => unlockedIds(stats), [stats]);

  // Is there unprotected work? Recomputed from the log, not the calendar.
  const backup = useMemo(
    () => backupState({ log, lastBackupAt: backupInfo.lastBackupAt, sessionsAtLastBackup: backupInfo.sessionsAtLastBackup }),
    [log, backupInfo],
  );

  // achievement unlock toast
  const prevUnlocked = useRef(null);
  useEffect(() => {
    if (!loaded) return;
    if (prevUnlocked.current === null) { prevUnlocked.current = unlocked; return; }
    const fresh = ACHIEVEMENTS.find((a) => unlocked.has(a.id) && !prevUnlocked.current.has(a.id));
    if (fresh) {
      setToast(fresh);
      haptic([10, 30, 10]);
      notifyMilestone(`Stride · ${fresh.icon} ${fresh.title}`, fresh.desc).catch?.(() => {});
    }
    prevUnlocked.current = unlocked;
  }, [unlocked, loaded]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3400); return () => clearTimeout(t); }, [toast]);

  const pct = Math.round((stats.done / TOTAL) * 100);
  const pctShown = Math.round(useCountUp(pct));
  const kmShown = useCountUp(stats.kmLogged);
  const nextUp = FLAT.find((f) => !(log[f.key] && log[f.key].done));

  // which session a tracked run defaults to saving into
  const todayKey = startDate && todayIdx >= 0 && todayIdx < TOTAL ? FLAT[todayIdx].key : null;
  const trackDefaultKey = todayKey || (nextUp ? nextUp.key : FLAT[0].key);

  // Plan-tab hero card: today's session when a start date maps one, else the next unfinished day
  const heroIdx = todayKey ? todayIdx : -1;
  const hero = heroIdx >= 0 ? FLAT[heroIdx] : nextUp;
  const heroEntry = hero ? log[hero.key] || {} : {};
  const saveTrackedRun = (r) => {
    update(r.dayKey, {
      done: true, km: r.km, min: r.min, tracked: true, route: r.route, splits: r.splits, durMs: r.durMs,
      elev: r.elev, kcal: r.kcal, runKm: r.runKm, walkKm: r.walkKm, hrAvg: r.hrAvg, hrMax: r.hrMax,
      cadence: r.cadence, steps: r.steps,
    });
    setTrackerOpen(false);
    setTab("history");
  };

  // Race goal: the best logged run becomes the reference performance that every
  // equivalent finish time is extrapolated from.
  const raceRef = useMemo(() => bestReference(history.filter((h) => isRun(h.e)).map((h) => ({
    km: parseFloat(h.e.km),
    sec: h.e.durMs > 0 ? h.e.durMs / 1000 : parseFloat(h.e.min) * 60,
  }))), [history]);
  const predictions = useMemo(() => predictAll(raceRef), [raceRef]);
  const goal = raceById(goalRace);
  const goalDays = daysUntil(goalDate);
  const goalReady = goal ? readiness(stats.maxKm, goal.km) : 0;
  const goalPrediction = predictions.find((p) => p.race.id === goalRace) || null;
  // Compact form of the race goal handed to the AI coach.
  const coachRaceGoal = goal ? {
    race: goal.name,
    distanceKm: goal.km,
    raceDate: goalDate || null,
    daysAway: goalDays,
    predictedTime: goalPrediction ? fmtDuration(goalPrediction.sec) : null,
    predictionConfidence: goalPrediction ? goalPrediction.confidence : null,
    distanceReadinessPct: goalReady,
  } : null;

  // Rest days can silence the daily nudge; the flag rides along to the service
  // worker so it stays quiet too.
  const restToday = todayKey ? FLAT[todayIdx].type === "rest" : false;

  const msg = nextUp ? `Today: Week ${nextUp.week} · ${nextUp.d} · ${nextUp.title} — ${nextUp.detail}` : "You finished the plan — go enjoy a victory run! 🎖️";
  const msgRef = useRef(msg);
  msgRef.current = msg;
  useEffect(() => {
    if (!remOn) return;
    syncMessage(msg, restToday);
    if (isNative()) nativeUpdateReminder(remTime, msg);
  }, [msg, remOn, restToday, remTime]);

  useEffect(() => {
    const id = startForegroundScheduler(() => msgRef.current);
    return () => clearInterval(id);
  }, []);

  const toggleReminder = async () => {
    haptic(10);
    if (remOn) {
      await disableReminders();
      if (isNative()) await nativeDisableReminder();
      setRemOn(false);
    } else {
      const ok = isNative()
        ? await nativeEnableReminder(remTime, msgRef.current)
        : await enableReminders(remTime, msgRef.current);
      if (ok) await saveReminder({ enabled: true, time: remTime, message: msgRef.current });
      setRemOn(ok); setPerm(await permissionState());
      if (ok && !isNative()) showReminderNow(`Reminders on — I'll nudge you around ${remTime} ✅`);
    }
  };
  const changeTime = async (t) => {
    setRemTime(t);
    if (remOn) { await saveReminder({ time: t }); if (isNative()) await nativeUpdateReminder(t, msgRef.current); }
  };
  const doInstall = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; setInstallEvt(null); };

  const fmt = (ms) => { const s = Math.floor(ms / 1000), m = Math.floor(s / 60); return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };

  const R = 17, CIRC = 2 * Math.PI * R; // app-bar progress ring

  // header schedule eyebrow / countdown
  let eyebrow = `${WEEKS.length}-WEEK BLOCK`, countdown = null;
  if (startDate) {
    if (todayIdx < 0) eyebrow = `STARTS IN ${-todayIdx} DAY${-todayIdx === 1 ? "" : "S"}`;
    else if (todayIdx >= TOTAL) eyebrow = "BLOCK COMPLETE 🎖️";
    else {
      eyebrow = `DAY ${todayIdx + 1} OF ${TOTAL}`;
      const toGoal = TOTAL - 1 - todayIdx;
      countdown = toGoal > 0 ? `${toGoal} days to the last session` : "Final session is today! 🏁";
    }
  }

  // `hero` renders the number in the accent gradient — reserved for the one
  // figure per row that matters most.
  const ShareBtn = ({ spec, label: lbl = "Share", style }) => (
    <button onClick={() => openShare(spec)} className="chip tap"
      style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.surface2, color: C.text, ...style }}>
      <Icon name="share" size={13} /> {lbl}
    </button>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Manrope', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        button { font-family: inherit; }
        html, body { background:${C.bg}; }
        body { overscroll-behavior-y: none; }
        input { font-family: 'Manrope', sans-serif; }
        .disp { font-family: 'Space Grotesk', sans-serif; letter-spacing: -0.015em; }
        .num  { font-family: 'Space Grotesk', sans-serif; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
        .tap { cursor: pointer; }
        .tap:active { transform: scale(.975); }
        .row, .card, .chip { transition: background .18s ease, border-color .18s ease, transform .12s ease, box-shadow .22s ease; }

        /* --- ambient aurora: soft accent light behind the whole page --- */
        .aurora { position:fixed; inset:0; z-index:0; pointer-events:none; overflow:hidden; }
        .aurora i { position:absolute; display:block; border-radius:50%; filter:blur(72px); }
        .aurora .a1 { width:min(70vw,520px); height:min(70vw,520px); top:-16vh; left:-16vw;  background:${C.accent};  opacity:.17; animation:drift1 26s ease-in-out infinite alternate; }
        .aurora .a2 { width:min(60vw,440px); height:min(60vw,440px); top:4vh;   right:-18vw; background:${C.accent2}; opacity:.13; animation:drift2 31s ease-in-out infinite alternate; }
        .aurora .a3 { width:min(80vw,600px); height:min(80vw,600px); bottom:-24vh; left:10vw; background:${C.accent2}; opacity:.07; animation:drift1 37s ease-in-out infinite alternate-reverse; }
        @keyframes drift1 { from { transform:translate3d(0,0,0) scale(1) } to { transform:translate3d(6vw,5vh,0) scale(1.14) } }
        @keyframes drift2 { from { transform:translate3d(0,0,0) scale(1.08) } to { transform:translate3d(-7vw,7vh,0) scale(.94) } }

        /* --- app bar: chrome, not content. Transparent at rest, glass once
              anything scrolls beneath it. --- */
        .appbar {
          position:sticky; top:0; z-index:60; margin:0 -16px 14px; padding:0 16px;
          padding-top:max(10px, env(safe-area-inset-top));
          transition:background .25s ease, border-color .25s ease, box-shadow .25s ease;
          border-bottom:1px solid transparent;
        }
        .appbar.stuck {
          background:rgba(8,9,13,.93);
          backdrop-filter:blur(20px) saturate(150%);
          -webkit-backdrop-filter:blur(20px) saturate(150%);
          border-bottom-color:${C.line};
          box-shadow:0 12px 26px -22px rgba(0,0,0,1);
        }

        /* --- surfaces: lit from the top-left, hairline highlight on the rim --- */
        .card {
          position:relative;
          background:linear-gradient(158deg, ${tint(C.text, 0.045)} 0%, ${C.surface} 34%, ${C.bgSoft} 100%);
          border:1px solid ${C.line};
          box-shadow:0 20px 44px -32px rgba(0,0,0,.95), inset 0 1px 0 ${tint(C.text, 0.05)};
        }
        .card.glow { border-color:${tint(C.accent, .45)}; box-shadow:${C.glow}, inset 0 1px 0 ${tint(C.accent, .16)}; }
        .card.accented { background:linear-gradient(150deg, ${tint(C.accent, .16)} 0%, ${tint(C.accent2, .07)} 46%, ${C.bgSoft} 100%); border-color:${tint(C.accent, .3)}; }
        .card.flat { box-shadow:none; background:${tint(C.text, .035)}; }

        /* --- primary action: the accent gradient, glowing --- */
        .cta { border:none !important; background:${C.grad} !important; color:${C.bg} !important; box-shadow:${C.glow}; }
        .cta:disabled { box-shadow:none; }

        /* gradient numerals for hero figures */
        .gtext { background:${C.grad}; -webkit-background-clip:text; background-clip:text; color:transparent; }

        .inp { background:${C.bgSoft}; border:1px solid ${C.line}; color:${C.text}; border-radius:12px; padding:11px 13px; width:100%; font-size:15px; font-weight:600; outline:none; transition:border-color .15s ease, box-shadow .15s ease; }
        .inp:focus { border-color:${C.accent}; box-shadow:0 0 0 3px ${tint(C.accent, .16)}; }

        .chip { cursor:pointer; border-radius:999px; padding:8px 14px; font-size:12.5px; font-weight:600; border:1px solid ${C.line}; background:${C.surface2}; color:${C.dim}; }
        .chip:active { transform:scale(.97); }
        .chip.on { background:${C.grad}; color:${C.bg}; border-color:transparent; font-weight:800; box-shadow:${C.glow}; }

        .lab { font-size:10px; letter-spacing:2px; font-weight:800; color:${C.dim}; text-transform:uppercase; }

        /* --- segmented control: one track, a pill that slides between slots.
              This is what breaks a long screen into real sub-screens. --- */
        .seg { position:relative; display:flex; padding:4px; border-radius:15px;
               background:${C.bgSoft}; border:1px solid ${C.line}; overflow:hidden; }
        .seg > i { position:absolute; top:4px; bottom:4px; left:4px; border-radius:11px;
                   background:linear-gradient(150deg,${tint(C.accent, .22)},${tint(C.accent2, .1)});
                   border:1px solid ${tint(C.accent, .4)};
                   transition:transform .3s cubic-bezier(.3,1.2,.5,1); }
        .seg > button { position:relative; z-index:1; flex:1; background:none; border:none; cursor:pointer;
                        padding:9px 0; font-size:11.5px; font-weight:700; color:${C.dim};
                        transition:color .2s ease; white-space:nowrap; }
        .seg > button.on { color:${C.accent}; font-weight:800; }

        /* horizontal scrollers keep their own scrollbar out of the design */
        .hscroll { display:flex; gap:7px; overflow-x:auto; scrollbar-width:none; -ms-overflow-style:none; }
        .hscroll::-webkit-scrollbar { display:none; }

        /* thin gradient progress bar, used for weeks, goals and readiness */
        .bar { height:6px; border-radius:999px; background:${C.bgSoft}; overflow:hidden; border:1px solid ${C.line}; }
        .bar > i { display:block; height:100%; border-radius:999px; background:${C.grad}; transition:width .55s cubic-bezier(.2,.8,.2,1); }

        .sw { width:46px; height:27px; min-height:27px; flex-shrink:0; border-radius:999px; border:none; cursor:pointer; position:relative; transition:background .2s; }
        .sw b { position:absolute; top:3px; left:3px; width:21px; height:21px; border-radius:50%; background:#fff; transition:left .2s; }

        /* the round tick on every plan row */
        .tick { width:27px; height:27px; min-height:27px; flex-shrink:0; border-radius:50%; cursor:pointer;
                display:flex; align-items:center; justify-content:center;
                font-size:14px; font-weight:900; padding:0;
                transition:background .18s ease, border-color .18s ease, transform .12s ease; }

        /* Leaflet chrome matched to the dark theme */
        .leaflet-container { background:${C.bg}; font-family:'Manrope', system-ui, sans-serif; }
        .leaflet-control-attribution { background:rgba(7,8,11,.72) !important; color:#5f6673 !important; font-size:9px !important; }
        .leaflet-control-attribution a { color:#828a98 !important; }

        @keyframes rise { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:none } }
        @keyframes pop { 0%{ transform:scale(.6) } 60%{ transform:scale(1.18) } 100%{ transform:scale(1) } }
        @keyframes toastIn { from{ opacity:0; transform:translate(-50%,-16px) } to{ opacity:1; transform:translate(-50%,0) } }
        @keyframes cellIn { from{ opacity:0; transform:scale(.5) } to{ opacity:1; transform:none } }
        @keyframes slideUp { from{ opacity:0; transform:translateY(14px) } to{ opacity:1; transform:none } }
        @keyframes spin { to { transform:rotate(360deg) } }
        @keyframes blink { 0%,45% { opacity:1 } 55%,100% { opacity:.15 } }
        .caret { animation:blink .9s steps(1,end) infinite; }
        @keyframes pulseRing { 0%,100% { opacity:.45 } 50% { opacity:.9 } }
        .rise { animation:rise .3s ease both; }
        .pop { animation:pop .32s ease; }
        .stagger { opacity:0; animation:slideUp .45s ease forwards; }
        .spin { animation:spin 1s linear infinite; }

        @media (prefers-reduced-motion: reduce) {
          .stagger, .spin, .aurora i, .caret { animation:none !important; }
          .stagger { opacity:1; }
        }
      `}</style>

      {/* Achievement toast */}
      {toast && (
        <div style={{ position: "fixed", top: "calc(14px + env(safe-area-inset-top))", left: "50%", transform: "translateX(-50%)", zIndex: 9998, animation: "toastIn .3s ease both", width: "calc(100% - 32px)", maxWidth: 380 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 12, borderRadius: 16, padding: "13px 15px",
            background: `linear-gradient(150deg,${tint(C.accent, .2)},${C.surface2} 60%)`,
            border: `1px solid ${tint(C.accent, .5)}`,
            boxShadow: `${C.glow}, 0 12px 30px -14px rgba(0,0,0,.8)`,
            backdropFilter: "blur(10px)",
          }}>
            <span style={{ fontSize: 23 }}>{toast.icon}</span>
            <div>
              <div style={{ fontSize: 10, letterSpacing: 1.5, color: C.accent, fontWeight: 800 }}>{toast.label || "ACHIEVEMENT UNLOCKED"}</div>
              <div className="disp" style={{ fontSize: 15, fontWeight: 700 }}>{toast.title}</div>
            </div>
          </div>
        </div>
      )}

      {/* Ambient accent light behind everything */}
      <div className="aurora" aria-hidden="true"><i className="a1" /><i className="a2" /><i className="a3" /></div>

      <div style={{ position: "relative", zIndex: 1, maxWidth: 620, margin: "0 auto", padding: "0 16px calc(118px + env(safe-area-inset-bottom))" }}>
        {/* App bar — compact chrome that stays put while the screen scrolls.
            The big scrolling masthead it replaces looked like the first card
            of a web page; this looks like an app. */}
        <div className={`appbar${scrolled ? " stuck" : ""}`}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "6px 0 12px" }}>
            <Mark />
            <div style={{ minWidth: 0 }}>
              <div className="disp" style={{ fontSize: 18.5, fontWeight: 700, lineHeight: 1, letterSpacing: -0.4 }}>Stride</div>
              <div style={{ fontSize: 9, letterSpacing: 1.8, color: C.dim, fontWeight: 800, marginTop: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{eyebrow}</div>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 9 }}>
              <button onClick={() => openShare(progressShareSpec())} className="card tap" aria-label="Share my progress"
                style={{ width: 38, height: 38, borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center", color: C.text, cursor: "pointer", padding: 0 }}>
                <Icon name="share" size={16} />
              </button>
              <button onClick={() => { setTab("stats"); setStatsView("overview"); haptic(6); }} className="tap"
                aria-label={`${pctShown}% of the plan complete`}
                style={{ position: "relative", width: 42, height: 42, background: "none", border: "none", padding: 0, cursor: "pointer", flexShrink: 0 }}>
                <svg width="42" height="42" viewBox="0 0 42 42" style={{ transform: "rotate(-90deg)", display: "block" }}>
                  <defs>
                    <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor={C.accent} />
                      <stop offset="100%" stopColor={C.accent2} />
                    </linearGradient>
                  </defs>
                  <circle cx="21" cy="21" r={R} fill="none" stroke={C.surface2} strokeWidth="4.5" />
                  <circle cx="21" cy="21" r={R} fill="none" stroke="url(#ringGrad)" strokeWidth="4.5" strokeLinecap="round"
                    strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - pctShown / 100)}
                    style={{ transition: "stroke-dashoffset .45s cubic-bezier(.2,.8,.2,1)", filter: `drop-shadow(0 0 5px ${tint(C.accent, .55)})` }} />
                </svg>
                <span className="num" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: C.text }}>{pctShown}</span>
              </button>
            </div>
          </div>
        </div>

        {installEvt && (
          <button onClick={doInstall} className="chip" style={{ width: "100%", padding: "11px 14px", marginBottom: 14, background: C.accent, color: C.bg, border: "none", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <Icon name="download" size={15} /> Install Stride on your phone
          </button>
        )}

      {tab === "stats" && (
          <div className="rise">
            <Screen
              title="Your numbers"
              sub={stats.runsLogged ? `${stats.runsLogged} run${stats.runsLogged === 1 ? "" : "s"} logged · ${fmtDist(stats.kmLogged, 1)} covered` : "Log a session and this fills up"}
              action={<ShareBtn spec={progressShareSpec()} />} />

            <Segmented
              items={[
                { id: "overview", label: "Overview" },
                { id: "goal", label: "Goal" },
                { id: "charts", label: "Charts" },
                { id: "awards", label: "Awards" },
                { id: "settings", label: "Setup" },
              ]}
              value={statsView} onChange={setStatsView} />

            {statsView === "overview" && (<div className="rise">
              {/* Headline card: the one number that matters, and the two
                  actions people actually came here for. */}
              <div className="card accented" style={{ borderRadius: 24, padding: "20px 20px 18px", marginBottom: 10, overflow: "hidden" }}>
                <div className="lab">Total distance</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 7, margin: "8px 0 14px" }}>
                  <span className="num gtext" style={{ fontSize: 52, fontWeight: 700, lineHeight: 1 }}>{fmtDistNum(kmShown, 1)}</span>
                  <span className="num" style={{ fontSize: 18, fontWeight: 700, color: C.dim }}>{U.short}</span>
                </div>
                <Bar pct={pct} />
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9, fontSize: 11.5, color: C.dim, fontWeight: 600 }}>
                  <span>{stats.done} of {TOTAL} sessions</span>
                  <span className="num" style={{ marginLeft: "auto", color: C.accent, fontWeight: 800 }}>{pct}%</span>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                  <button onClick={() => { haptic(12); setTrackerOpen(true); }} className="tap cta disp"
                    style={{ flex: 1.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 15, padding: "14px 0", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
                    <Icon name="play" size={16} /> Track run
                  </button>
                  <button onClick={() => { haptic(10); setRouteMakerOpen(true); }} className="card tap disp"
                    style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 15, padding: "14px 0", fontSize: 14, fontWeight: 700, cursor: "pointer", color: C.text }}>
                    <Icon name="map" size={15} /> Routes
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <Tile label="Streak" value={stats.curStreak} unit="d" sub={`best ${stats.best}`} hero delay={0} />
                <Tile label="Runs done" value={stats.runsLogged} delay={0.05} />
                <Tile label="On feet" value={stats.minTotal ? fmtMin(stats.minTotal) : "—"} delay={0.1} />
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <Tile label="Avg pace" value={fmtPace(stats.avgPaceSec) || "—"} sub={stats.avgPaceSec ? U.paceLabel : ""} delay={0.15} />
                <Tile label="Longest" value={stats.maxKm ? fmtDistNum(stats.maxKm, 1) : "—"} unit={stats.maxKm ? U.short : ""} delay={0.2} />
                <Tile label="Stitches" value={stats.stitches} color={stats.stitches ? C.warn : C.easy} sub="should drop!" delay={0.25} />
              </div>

{/* Personal bests */}
            <Card style={{ marginBottom: 12 }}>
              <Label>Personal records</Label>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <PB label="BEST PACE" value={fmtPace(stats.bestPaceSec) || "—"} unit={`/${U.short}`} color={C.accent} />
                <PB label="LONGEST RUN" value={stats.maxKm ? fmtDist(stats.maxKm, 1) : "—"} />
                <PB label="BIG WEEK" value={fmtDist(Math.max(0, ...weekly.map((w) => w.value)), 1)} />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <PB label="FASTEST KM" value={fmtPace(stats.bestSplitSec) || "—"} unit={stats.bestSplitSec ? `/${U.short}` : ""} color={C.accent} />
                <PB label="BEST CLIMB" value={stats.bestElevM ? `+${fmtElev(stats.bestElevM)}` : "—"} />
                <PB label="TOTAL KCAL" value={stats.totalKcal ? Math.round(stats.totalKcal).toLocaleString() : "—"} />
              </div>
            </Card>
            </div>)}

            {statsView === "goal" && (<div className="rise">
{/* Race goal — the target that replaces "get to 5K" once it's done */}
            <Card className="accented" style={{ marginBottom: 12 }}>
              <Label right={goalDays != null && (
                <span className="num" style={{ fontSize: 11, fontWeight: 800, color: goalDays < 0 ? C.dim : C.accent }}>
                  {goalDays > 0 ? `${goalDays} DAY${goalDays === 1 ? "" : "S"} TO GO` : goalDays === 0 ? "RACE DAY 🏁" : "DONE"}
                </span>
              )}>My next goal</Label>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                {RACES.filter((r) => r.km >= 5).map((r) => (
                  <button key={r.id} onClick={() => saveGoalRace(r.id)} className={`chip tap${goalRace === r.id ? " on" : ""}`} style={{ flex: 1 }}>{r.chip}</button>
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "flex-end", gap: 14, marginBottom: 12 }}>
                <div>
                  <div className="lab" style={{ marginBottom: 3 }}>Target time</div>
                  <div className="num gtext" style={{ fontSize: 34, fontWeight: 700, lineHeight: 1 }}>
                    {goalPrediction ? fmtDuration(goalPrediction.sec) : "—"}
                  </div>
                </div>
                <div style={{ flex: 1, textAlign: "right", fontSize: 11, color: C.dim, lineHeight: 1.5 }}>
                  {goalPrediction && raceRef
                    ? <>predicted from your {fmtDist(raceRef.km, 1)} in {fmtDuration(raceRef.sec)}<br /><span style={{ color: C.dim2 }}>{CONFIDENCE_LABEL[goalPrediction.confidence]}</span></>
                    : "Log a timed run and a predicted finish appears here."}
                </div>
              </div>

              <div style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 5 }}>
                  <span style={{ fontSize: 11, color: C.dim, fontWeight: 600 }}>Distance readiness</span>
                  <span className="num" style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800, color: goalReady >= 100 ? C.good : C.text }}>{goalReady}%</span>
                </div>
                <Bar pct={goalReady} />
                <div style={{ fontSize: 10.5, color: C.dim2, marginTop: 6 }}>
                  {goal ? (goalReady >= 100
                    ? `Your longest run already covers the distance. You're ready.`
                    : `Longest run so far ${fmtDist(stats.maxKm || 0, 1)}. The ${goal.name} is ${fmtDist(goal.km, 1)}.`) : ""}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>Race day</span>
                <input className="inp" type="date" value={goalDate} onChange={(e) => saveGoalDate(e.target.value)} style={{ width: "auto" }} />
                {goalDate && <button onClick={() => saveGoalDate("")} className="chip tap" style={{ fontSize: 11, padding: "6px 11px" }}>Clear</button>}
              </div>
            </Card>
{/* Equivalent finish times across every distance */}
            <Card style={{ marginBottom: 12 }}>
              <Label right={raceRef && <span style={{ fontSize: 10, color: C.dim2, fontWeight: 600 }}>from {fmtDist(raceRef.km, 1)}</span>}>
                Race predictions
              </Label>
              {predictions.length === 0 ? (
                <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.55 }}>
                  Log a run with both distance and time — or track one with GPS — and every equivalent race time shows up here.
                </div>
              ) : (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6 }}>
                    {predictions.map((p) => {
                      const isGoal = p.race.id === goalRace;
                      return (
                        <button key={p.race.id} onClick={() => saveGoalRace(p.race.id)} className="tap"
                          style={{
                            textAlign: "center", padding: "12px 3px 10px", borderRadius: 13, cursor: "pointer",
                            background: isGoal ? tint(C.accent, .13) : C.surface2,
                            border: `1px solid ${isGoal ? tint(C.accent, .5) : C.line}`,
                          }}>
                          <div style={{ fontSize: 8.5, letterSpacing: 1, color: isGoal ? C.accent : C.dim, fontWeight: 800 }}>{p.race.short}</div>
                          <div className="num" style={{ fontSize: 13.5, fontWeight: 700, color: C.text, marginTop: 5 }}>{fmtDuration(p.sec)}</div>
                          <div style={{ fontSize: 8, color: C.dim2, marginTop: 3, fontWeight: 600 }}>
                            {p.confidence === "high" ? "solid" : p.confidence === "fair" ? "fair" : "rough"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 10.5, color: C.dim2, marginTop: 10, lineHeight: 1.5 }}>
                    Riegel equivalents from your best logged effort. The further the jump from that distance, the rougher the guess.
                  </div>
                </>
              )}
            </Card>
              <button onClick={() => openShare(goalShareSpec())} className="card tap"
                style={{ width: "100%", borderRadius: 16, padding: "14px 0", marginBottom: 12, color: C.text, fontSize: 13.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer" }}>
                <Icon name="share" size={15} /> Share my race goal
              </button>
            </div>)}

            {statsView === "charts" && (<div className="rise">
{/* Schedule / today */}
            <Card style={{ marginBottom: 12 }}>
              <Label>Plan schedule</Label>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>I started on</span>
                <input className="inp" type="date" value={startDate} onChange={(e) => saveStart(e.target.value)} style={{ width: "auto" }} />
              </div>
              {startDate && (
                <div style={{ marginTop: 14 }}>
                  <StreakGrid cells={cells} />
                </div>
              )}
              {!startDate && <div style={{ fontSize: 11, color: C.dim, marginTop: 8 }}>Set this to light up today's session and a day-by-day calendar.</div>}
            </Card>
{/* Charts */}
            <Card style={{ marginBottom: 12 }}>
              <Label>Km per week · logged vs plan</Label>
              <WeeklyBars data={weekly} />
            </Card>
            <Card style={{ marginBottom: 12 }}>
              <Label>Pace trend · up means faster</Label>
              <PaceTrend points={paceTrend} />
            </Card>
            <Card style={{ marginBottom: 12 }}>
              <Label>Cumulative distance</Label>
              <CumulativeArea points={cumulative} />
            </Card>
            </div>)}

            {statsView === "awards" && (<div className="rise">
              <Card style={{ marginBottom: 12 }}>
                <Label right={<span className="num" style={{ fontSize: 11.5, color: C.accent, fontWeight: 800 }}>{unlocked.size}/{ACHIEVEMENTS.length}</span>}>Achievements</Label>
                <div style={{ marginBottom: 15 }}><Bar pct={(unlocked.size / ACHIEVEMENTS.length) * 100} /></div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  {ACHIEVEMENTS.map((a) => {
                    const got = unlocked.has(a.id);
                    return (
                      <button key={a.id} disabled={!got} onClick={() => openShare(achievementShareSpec(a))}
                        className={got ? "tap" : ""} title={`${a.title} — ${a.desc}`}
                        style={{
                          textAlign: "center", padding: "14px 6px 11px", borderRadius: 16, cursor: got ? "pointer" : "default",
                          background: got ? `linear-gradient(150deg,${tint(C.accent, .15)},${tint(C.accent2, .05)})` : tint(C.text, .025),
                          border: `1px solid ${got ? tint(C.accent, .32) : C.line}`,
                          opacity: got ? 1 : 0.42,
                        }}>
                        <div style={{ fontSize: 26, filter: got ? "none" : "grayscale(1)" }}>{a.icon}</div>
                        <div style={{ fontSize: 9.5, fontWeight: 700, color: got ? C.text : C.dim, marginTop: 6, lineHeight: 1.25 }}>{a.title}</div>
                        <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: 1, marginTop: 5, color: got ? C.accent : "transparent" }}>SHARE</div>
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: 11, color: C.dim2, marginTop: 13, lineHeight: 1.5 }}>
                  Tap a badge you've earned to turn it into a share card.
                </div>
              </Card>
            </div>)}

            {statsView === "settings" && (<div className="rise">
{/* Appearance */}
            <Card style={{ marginBottom: 12 }}>
              <Label>Appearance</Label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                {ACCENTS.map((a) => {
                  const active = accent === a.id;
                  return (
                    <button key={a.id} onClick={() => setAccentTheme(a.id)} className="tap"
                      style={{
                        cursor: "pointer", borderRadius: 14, padding: "12px 4px",
                        background: active ? `linear-gradient(150deg,${a.accent}26,${a.accent2}12)` : C.surface2,
                        border: `1px solid ${active ? a.accent : C.line}`,
                      }}>
                      <span style={{
                        display: "block", width: 22, height: 22, borderRadius: "50%", margin: "0 auto 7px",
                        background: `linear-gradient(135deg,${a.accent},${a.accent2})`,
                        boxShadow: active ? `0 0 12px -2px ${a.accent}` : "none",
                      }} />
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: active ? C.text : C.dim }}>{a.name}</span>
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: C.dim2, marginTop: 10 }}>
                Every gradient, chart and highlight in the app follows this pair of colours.
              </div>

              <div style={{ height: 1, background: C.line, margin: "16px -18px" }} />

              <Label>Distance unit</Label>
              <div style={{ display: "flex", gap: 8 }}>
                {UNITS.map((u) => (
                  <button key={u.id} onClick={() => setUnitPref(u.id)} className={`chip tap${unit === u.id ? " on" : ""}`}
                    style={{ flex: 1, textAlign: "center" }}>{u.name}</button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: C.dim2, marginTop: 10, lineHeight: 1.5 }}>
                Only what you see changes — every run is stored in kilometres, so switching back and
                forth never alters a single logged distance. Splits stay per kilometre because that is
                how they were recorded.
              </div>
            </Card>
{/* Notifications */}
            <Card style={{ marginBottom: 12 }} innerRef={notifCardRef}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div className="lab" style={{ marginBottom: 0 }}>Daily reminder</div>
                  <div style={{ fontSize: 13, color: C.text, marginTop: 4, fontWeight: 600 }}>Get nudged to do your session</div>
                </div>
                <button onClick={toggleReminder} className="sw" style={{ background: remOn ? C.accent : C.line }} aria-label="Toggle reminders">
                  <b style={{ left: remOn ? 22 : 3 }} />
                </button>
              </div>
              {remOn && (
                <div className="rise" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                  <span style={{ fontSize: 12, color: C.dim, fontWeight: 600 }}>Remind me at</span>
                  <input className="inp" type="time" value={remTime} onChange={(e) => changeTime(e.target.value)} style={{ width: "auto" }} />
                </div>
              )}

              <div style={{ height: 1, background: C.line, margin: "14px -18px" }} />

              {/* Until permission is granted every switch below is inert, so say
                  so loudly rather than showing a row of confident green toggles. */}
              {(isNative() || notificationsSupported()) && perm !== "granted" && (
                <div style={{
                  borderRadius: 14, padding: "13px 14px", marginBottom: 14,
                  background: `linear-gradient(150deg,${tint(C.warn, .16)},${C.surface2} 70%)`,
                  border: `1px solid ${tint(C.warn, .45)}`,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                    {perm === "denied" ? "Notifications are blocked" : "Notifications aren't switched on yet"}
                  </div>
                  <div style={{ fontSize: 11.5, color: C.dim, marginTop: 4, lineHeight: 1.5 }}>
                    {isNative()
                      ? perm === "denied"
                        ? "Android is blocking Stride. Open Settings › Apps › Stride › Notifications and allow them, then come back — the app cannot undo this itself."
                        : "Android hasn't been asked yet. The switches below do nothing until it says yes."
                      : perm === "denied"
                        ? "Your browser is blocking them for this site. Open the padlock or site settings next to the address bar and allow notifications, then come back."
                        : "The switches below do nothing until your browser gives Stride permission."}
                  </div>
                  {perm !== "denied" && (
                    <button onClick={askNotificationPermission} className="tap cta"
                      style={{ marginTop: 11, width: "100%", borderRadius: 12, padding: "11px 0", fontSize: 13.5, fontWeight: 800, cursor: "pointer" }}>
                      Allow notifications
                    </button>
                  )}
                </div>
              )}

              <div className="lab" style={{ marginBottom: 4 }}>What Stride tells you</div>
              <div style={{ fontSize: 11, color: C.dim2, marginBottom: 10, lineHeight: 1.5 }}>
                Alerts land on your lock screen, so they reach you with the phone pocketed mid-run.
              </div>
              {[
                ["runLive", "Run in progress", "A live notice with distance, time and pace while you track"],
                ["runKm", "Kilometre splits", "A buzz and your split time at every full kilometre"],
                ["runInterval", "Run / walk switches", "Tells you when to run and when to walk"],
                ["runFinish", "Run finished", "A summary the moment you stop the clock"],
                ["milestone", "Achievements", "When you unlock a badge"],
                ["skipRest", "Stay quiet on rest days", "Skip the daily nudge when the plan says rest"],
              ].map(([key, title, desc]) => {
                // A switch that is on but can't fire is shown muted, not accent.
                const live = notif[key] && (key === "skipRest" || perm === "granted");
                return (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{title}</div>
                      <div style={{ fontSize: 11, color: C.dim2, marginTop: 2, lineHeight: 1.4 }}>{desc}</div>
                    </div>
                    <button onClick={() => toggleNotif(key)} className="sw"
                      style={{ background: live ? C.accent : notif[key] ? C.line2 : C.line, flexShrink: 0 }} aria-label={`Toggle ${title}`}>
                      <b style={{ left: notif[key] ? 22 : 3 }} />
                    </button>
                  </div>
                );
              })}

              <div style={{ height: 1, background: C.line, margin: "14px -18px" }} />
              <NotifDiagnostics />
            </Card>
{/* Import runs recorded elsewhere (a watch, another app) */}
            {healthSupported() && (
              <Card style={{ marginBottom: 12 }}>
                <Label>Import from your watch</Label>
                {hc.availability !== "Available" ? (
                  <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.6 }}>
                    {hc.availability === "NotInstalled"
                      ? "Health Connect isn't set up on this phone yet. Install or update it from the Play Store, sync Samsung Health to it, then come back."
                      : "This phone doesn't support Health Connect, so runs recorded on a watch can't be pulled in automatically."}
                  </div>
                ) : !hc.granted ? (
                  <>
                    <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.6, marginBottom: 11 }}>
                      Runs your watch records reach the phone through its own app (Samsung Health, for
                      example). Give Stride read access and they can be pulled into your history —
                      Stride only ever reads, it never writes anything back.
                    </div>
                    <button onClick={connectHealth} disabled={hcBusy} className="tap cta"
                      style={{ width: "100%", borderRadius: 12, padding: "12px 0", fontSize: 13.5, fontWeight: 800, cursor: "pointer", opacity: hcBusy ? 0.6 : 1 }}>
                      {hcBusy ? "Waiting for Health Connect…" : "Allow Stride to read workouts"}
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.6, marginBottom: 11 }}>
                      Connected. Look for runs recorded in the last 30 days. Rides and gym sessions
                      are never imported, walks only if you switch them on below, and anything Stride
                      already tracked is left alone.
                    </div>
                    <button onClick={scanHealth} disabled={hcBusy} className="tap cta"
                      style={{ width: "100%", borderRadius: 12, padding: "12px 0", fontSize: 13.5, fontWeight: 800, cursor: "pointer", opacity: hcBusy ? 0.6 : 1 }}>
                      {hcBusy ? "Looking…" : "Look for new runs"}
                    </button>

                    {/* Samsung Health logs walking with no input from the user,
                        so this stays off unless it is asked for. Even when on,
                        walks never count towards pace or longest run. */}
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0 2px" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Also import walks</div>
                        <div style={{ fontSize: 11, color: C.dim2, marginTop: 2, lineHeight: 1.45 }}>
                          Your watch records walks by itself, so this is off. Walks that do come in are
                          logged as walks — never counted towards pace, longest run or race predictions.
                        </div>
                      </div>
                      <button onClick={toggleImportWalks} className="sw"
                        style={{ background: importWalks ? C.accent : C.line, flexShrink: 0 }} aria-label="Toggle walk import">
                        <b style={{ left: importWalks ? 22 : 3 }} />
                      </button>
                    </div>

                    {hcScan && hcScan.ready.length === 0 && (
                      <div className="rise" style={{ fontSize: 12, color: C.dim, marginTop: 12, lineHeight: 1.6 }}>
                        Nothing new to import.
                        {hcScan.skipped.length > 0
                          ? ` ${hcScan.skipped.length} workout${hcScan.skipped.length === 1 ? " was" : "s were"} skipped — see below.`
                          : " Health Connect has no workouts from the last 30 days; check that your watch's app is syncing into it."}
                      </div>
                    )}

                    {hcScan && hcScan.ready.length > 0 && (
                      <div className="rise" style={{ marginTop: 12 }}>
                        <Label>Ready to import</Label>
                        {hcScan.ready.map((r) => (
                          <div key={r.w.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "7px 0", borderTop: `1px solid ${C.line}` }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{r.label}</div>
                              <div style={{ fontSize: 11, color: C.dim2, marginTop: 2 }}>
                                {r.kind === "walk" ? "Walk · " : ""}
                                {r.when.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} → {r.key}
                              </div>
                            </div>
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              <div className="num" style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
                                {r.entry.km > 0 ? fmtDist(r.entry.km, 2) : `${r.entry.min} min`}
                              </div>
                              {r.entry.km > 0 && <div style={{ fontSize: 10.5, color: C.dim }}>{r.entry.min} min</div>}
                            </div>
                          </div>
                        ))}
                        {/* "5 runs" would be a lie when three of them are walks. */}
                        <button onClick={applyHealthImport} className="tap cta"
                          style={{ width: "100%", marginTop: 12, borderRadius: 12, padding: "12px 0", fontSize: 13.5, fontWeight: 800, cursor: "pointer" }}>
                          {(() => {
                            const n = hcScan.ready.length;
                            const walks = hcScan.ready.filter((r) => r.kind === "walk").length;
                            const noun = walks === 0 ? "run" : walks === n ? "walk" : "session";
                            return `Import ${n} ${noun}${n === 1 ? "" : "s"}`;
                          })()}
                        </button>
                      </div>
                    )}

                    {/* Saying why something was skipped costs three lines and
                        saves the user hunting for a bug that isn't there. */}
                    {hcScan && hcScan.skipped.length > 0 && (
                      <div className="rise" style={{ marginTop: 12 }}>
                        <Label>Skipped</Label>
                        {hcScan.skipped.slice(0, 8).map((sk, i) => (
                          <div key={sk.w.id || i} style={{ display: "flex", gap: 8, fontSize: 11, color: C.dim2, padding: "4px 0", lineHeight: 1.5 }}>
                            <span style={{ flex: 1, minWidth: 0 }}>
                              {sk.label} · {sk.when.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                            </span>
                            <span style={{ flexShrink: 0 }}>{sk.reason}</span>
                          </div>
                        ))}
                        {hcScan.skipped.length > 8 && (
                          <div style={{ fontSize: 11, color: C.dim2, paddingTop: 4 }}>…and {hcScan.skipped.length - 8} more.</div>
                        )}
                      </div>
                    )}

                    <button onClick={() => { haptic(6); openHealthConnect(); }} className="chip tap"
                      style={{ width: "100%", marginTop: 12, background: C.surface2, color: C.text, padding: "10px 0", fontSize: 12 }}>
                      Open Health Connect
                    </button>
                  </>
                )}
              </Card>
            )}
{/* Data & backup */}
            <Card style={{ marginBottom: 12 }}>
              <Label right={
                <span style={{ fontSize: 11, fontWeight: 700, color: backup.stale ? C.warn : C.good }}>
                  {backupLabel({ lastBackupAt: backupInfo.lastBackupAt })}
                </span>
              }>Data &amp; backup</Label>

              {backup.stale && (
                <div style={{
                  display: "flex", gap: 9, alignItems: "flex-start", marginBottom: 12, padding: "10px 12px",
                  borderRadius: 12, background: tint(C.warn, .1), border: `1px solid ${tint(C.warn, .32)}`,
                }}>
                  <span style={{ fontSize: 13, flexShrink: 0 }} aria-hidden="true">⚠️</span>
                  <span style={{ fontSize: 11.5, color: C.text, lineHeight: 1.5 }}>
                    {backup.reason} Everything lives on this phone only — export a copy somewhere safe.
                  </span>
                </div>
              )}

              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={exportData} className="chip tap" style={{ flex: 1, background: C.surface2, color: C.text, padding: "11px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}><Icon name="download" size={14} /> Export</button>
                <button onClick={() => importRef.current?.click()} className="chip tap" style={{ flex: 1, background: C.surface2, color: C.text, padding: "11px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}><Icon name="upload" size={14} /> Import</button>
                <button onClick={() => openShare(progressShareSpec())} className="chip tap" style={{ flex: 1, background: C.surface2, color: C.text, padding: "11px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}><Icon name="share" size={14} /> Share card</button>
              </div>
              <input ref={importRef} type="file" accept="application/json,.json" style={{ display: "none" }}
                onChange={(e) => { importData(e.target.files[0]); e.target.value = ""; }} />
              <div style={{ fontSize: 11, color: C.dim, marginTop: 8, lineHeight: 1.5 }}>
                {isNative()
                  ? "Export opens the share sheet — send the backup file to Drive, email or your new phone, then Import it there."
                  : "Export saves your runs to a file; Import restores them (e.g. on a new phone or a new version of the app)."}
                {" "}Importing merges with what's already here, so nothing gets wiped. Your data lives only on this device.
                {isNative() ? " Stride also writes a dated copy to Documents/Stride once a week, so there is always something to fall back on." : ""}
              </div>
            </Card>
{/* Stopwatch — treadmill / no-GPS fallback */}
            <Card style={{ textAlign: "center", padding: 18 }}>
              <Label>Treadmill stopwatch · no GPS</Label>
              <div className={`num${swRun ? " gtext" : ""}`} style={{ fontSize: 54, fontWeight: 700, margin: "8px 0 14px", color: swRun ? undefined : C.text }}>{fmt(swMs)}</div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                <button onClick={() => { setSwRun((r) => !r); haptic(10); }} className={swRun ? "chip tap" : "chip tap on"}
                  style={swRun ? { background: C.warn, color: C.bg, border: "none", padding: "11px 26px", fontSize: 14, fontWeight: 800 } : { padding: "11px 26px", fontSize: 14 }}>
                  {swRun ? "Pause" : swMs ? "Resume" : "Start"}
                </button>
                <button onClick={() => { setSwRun(false); setSwMs(0); haptic(8); }} className="chip" style={{ padding: "11px 22px", fontSize: 14 }}>Reset</button>
              </div>
            </Card>
            </div>)}
          </div>
        )}

        {tab === "coach" && (() => {
          const asks = quickAsks({
            stats,
            race: goal ? goal.name : null,
            raceDays: goalDate ? goalDays : null,
            todaySession: todayKey && todayIdx >= 0 && todayIdx < TOTAL ? FLAT[todayIdx] : null,
          });
          const hasChat = coachChat.length > 0 || coachBusy;
          return (
          <div className="rise">
            <Screen
              title="AI coach"
              sub={coachKey ? "Reads your real numbers · powered by Groq" : "Add a free Groq key to unlock it"}
              action={coachChat.length > 0
                ? <button onClick={clearCoachChat} disabled={coachBusy} className="chip tap" style={{ opacity: coachBusy ? 0.5 : 1 }}>Clear</button>
                : null} />

            {!coachKey && (
              <Card className="glow" style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13.5, color: C.text, lineHeight: 1.6, marginBottom: 12 }}>
                  Your coach reads every run you've logged and answers from those numbers. Paste a
                  free Groq API key to switch it on — it's stored on this device and never leaves it
                  except to reach Groq.
                </div>
                <label className="lab">Groq API key</label>
                <input className="inp" type={showKey ? "text" : "password"} value={coachKey}
                  onChange={(e) => { saveCoachKey(e.target.value); setKeyCheck(null); }} placeholder="gsk_…"
                  autoComplete="off" autoCorrect="off" spellCheck={false} style={{ marginTop: 7 }} />
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: C.dim, cursor: "pointer" }}>
                    <input type="checkbox" checked={showKey} onChange={(e) => setShowKey(e.target.checked)} /> Show key
                  </label>
                  <button onClick={testCoachKey} disabled={keyBusy || !coachKey.trim()} className="chip tap"
                    style={{ marginLeft: "auto", opacity: keyBusy || !coachKey.trim() ? 0.5 : 1 }}>
                    {keyBusy ? "Checking…" : "Check key"}
                  </button>
                </div>
                {keyCheck && (
                  <div className="rise" style={{ marginTop: 10, fontSize: 12, lineHeight: 1.55, fontWeight: 600, color: keyCheck.ok ? C.good : C.warn }}>
                    {keyCheck.ok ? "✓ Key works — ask your coach anything." : keyCheck.error}
                  </div>
                )}
                <div style={{ fontSize: 11.5, color: C.dim2, marginTop: 11, lineHeight: 1.5 }}>
                  Get one free at <span style={{ color: C.text, fontWeight: 700 }}>console.groq.com/keys</span>.
                </div>
              </Card>
            )}

            {/* Conversation */}
            <Card style={{ marginBottom: 12, padding: hasChat ? "16px 15px 15px" : 18 }}>
              {!hasChat ? (
                <div style={{ textAlign: "center", padding: "14px 6px 4px" }}>
                  <div style={{ fontSize: 30 }}>🧠</div>
                  <div className="disp" style={{ fontSize: 17, fontWeight: 700, marginTop: 9 }}>
                    {stats.runsLogged ? "Ask about your training" : "Log a run and I'll have something to say"}
                  </div>
                  <div style={{ fontSize: 12.5, color: C.dim, marginTop: 6, lineHeight: 1.55, maxWidth: 330, margin: "6px auto 0" }}>
                    {stats.runsLogged
                      ? `I can see your ${stats.runsLogged} logged run${stats.runsLogged === 1 ? "" : "s"}, your paces, your plan and what's coming up.`
                      : "Tick off a session or track a run with GPS, then come back for a read on it."}
                  </div>
                  <button onClick={analyseCoach} disabled={coachBusy} className="tap cta disp"
                    style={{ marginTop: 16, borderRadius: 14, padding: "13px 22px", fontSize: 14.5, fontWeight: 700, cursor: "pointer", opacity: coachBusy ? 0.6 : 1 }}>
                    Analyse my training
                  </button>
                </div>
              ) : (
                <div ref={chatBoxRef} style={{
                  display: "flex", flexDirection: "column", gap: 10,
                  maxHeight: "52vh", overflowY: "auto", overscrollBehavior: "contain",
                  margin: "0 -3px", padding: "0 3px",
                }}>
                  {coachChat.map((m, i) => (
                    <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "93%" }}>
                      {m.role === "assistant" && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                          <span style={{ width: 17, height: 17, borderRadius: 6, background: C.grad, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9 }}>🧠</span>
                          <span className="lab" style={{ fontSize: 9 }}>Coach</span>
                        </div>
                      )}
                      <div style={{
                        background: m.role === "user" ? C.grad : tint(C.text, .05),
                        color: m.role === "user" ? C.bg : C.text,
                        border: m.role === "user" ? "none" : `1px solid ${C.line}`,
                        borderRadius: m.role === "user" ? "16px 16px 5px 16px" : "5px 16px 16px 16px",
                        padding: "11px 14px", fontSize: 13.5, lineHeight: 1.6,
                        whiteSpace: "pre-wrap", fontWeight: m.role === "user" ? 600 : 400,
                      }}>{m.display || m.content}</div>
                      {m.role === "assistant" && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                          {m.stopped && <span style={{ fontSize: 10, color: C.dim2, fontWeight: 700 }}>stopped early</span>}
                          {i === coachChat.length - 1 && !coachBusy && (
                            <>
                              <button onClick={async () => { haptic(6); const r = await copyText(m.content); setToast({ icon: r === "copied" ? "📋" : "⚠️", title: r === "copied" ? "Answer copied" : "Couldn't copy", label: "COACH" }); }}
                                className="chip tap" style={{ fontSize: 10.5, padding: "5px 11px" }}>Copy</button>
                              <button onClick={retryCoach} className="chip tap" style={{ fontSize: 10.5, padding: "5px 11px" }}>Ask again</button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* the reply as it arrives */}
                  {coachBusy && (
                    <div style={{ alignSelf: "flex-start", maxWidth: "93%" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                        <span style={{ width: 17, height: 17, borderRadius: 6, background: C.grad, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9 }}>🧠</span>
                        <span className="lab" style={{ fontSize: 9 }}>Coach</span>
                      </div>
                      <div style={{
                        background: tint(C.text, .05), border: `1px solid ${C.line}`,
                        borderRadius: "5px 16px 16px 16px", padding: "11px 14px",
                        fontSize: 13.5, lineHeight: 1.6, whiteSpace: "pre-wrap", color: C.text,
                      }}>
                        {coachStream || <span style={{ color: C.dim }}>thinking</span>}
                        <span className="caret" style={{ display: "inline-block", width: 7, height: 14, marginLeft: 2, verticalAlign: "-2px", background: C.accent, borderRadius: 2 }} />
                      </div>
                      {/* No Stop button here on purpose: attached to the growing
                          bubble it slides down the screen as the reply arrives,
                          so it moves out from under the thumb reaching for it.
                          The composer's Send turns into Stop instead — same
                          action, fixed position. */}
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}

              {coachErr && (
                <div className="rise" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, padding: "10px 12px", borderRadius: 12, background: tint(C.warn, .1), border: `1px solid ${tint(C.warn, .4)}` }}>
                  <span style={{ flex: 1, fontSize: 12, color: C.text, lineHeight: 1.5 }}>{coachErr}</span>
                  {coachChat.length > 0 && (
                    <button onClick={() => { setCoachErr(""); retryCoach(); }} className="chip tap" style={{ fontSize: 11, padding: "6px 11px", flexShrink: 0 }}>Retry</button>
                  )}
                </div>
              )}

              {/* Composer */}
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14 }}>
                <input className="inp" value={coachInput} onChange={(e) => setCoachInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") askCoachInput(); }}
                  placeholder="Ask your coach anything…" disabled={coachBusy} />
                <button onClick={coachBusy ? stopCoach : askCoachInput} disabled={!coachBusy && !coachInput.trim()}
                  className={coachBusy ? "chip tap" : "tap cta"}
                  style={{ borderRadius: 12, padding: "11px 16px", fontSize: 14, fontWeight: 700, flexShrink: 0, opacity: !coachBusy && !coachInput.trim() ? 0.5 : 1 }}>
                  {coachBusy ? "Stop" : "Send"}
                </button>
              </div>

              {/* Contextual one-tap asks — built from this runner's situation */}
              <div className="hscroll" style={{ marginTop: 10 }}>
                {asks.map((q) => (
                  <button key={q.label} onClick={() => sendToCoach(q.text, q.label)} disabled={coachBusy}
                    className="chip tap" style={{ flexShrink: 0, background: C.surface2, color: C.text, opacity: coachBusy ? 0.5 : 1 }}>
                    {q.label}
                  </button>
                ))}
                {coachChat.length > 0 && (
                  <button onClick={analyseCoach} disabled={coachBusy} className="chip tap"
                    style={{ flexShrink: 0, opacity: coachBusy ? 0.5 : 1 }}>Re-analyse</button>
                )}
              </div>
            </Card>

            {/* Plan tools */}
            <Card style={{ marginBottom: 12 }}>
              <Label>Your training plan</Label>
              <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.55, marginBottom: 12 }}>
                Build a fresh block when you've smashed your goal, or re-tune the sessions you
                haven't started yet from the too easy / too hard feedback you leave on completed
                days. Nothing you've logged is lost either way.
              </div>

              {proposedPlan && (() => {
                const newWeeks = proposedPlan.weeks.slice(proposedPlan.fromIdx);
                const verb = proposedPlan.mode === "adapt" ? "adjusted" : "new";
                return (
                  <div className="rise" style={{ background: C.bgSoft, border: `1px solid ${tint(C.accent, .45)}`, borderRadius: 14, padding: 13, marginBottom: 11 }}>
                    <div className="lab" style={{ color: C.accent, marginBottom: 9 }}>Proposed — {newWeeks.length} {verb} week{newWeeks.length === 1 ? "" : "s"}</div>
                    {newWeeks.map((w) => {
                      const km = w.days.reduce((sum, d) => sum + (d.km || 0), 0);
                      return (
                        <div key={w.n} style={{ marginBottom: 9 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>
                            Week {w.n} · {w.label} <span className="num" style={{ color: C.dim, fontWeight: 600 }}>· {fmtDist(km, 1)}</span>
                          </div>
                          <div style={{ fontSize: 11, color: C.dim2, lineHeight: 1.55, marginTop: 2 }}>
                            {w.days.map((d) => `${d.d} ${d.km ? d.title : "rest"}`).join(" · ")}
                          </div>
                        </div>
                      );
                    })}
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button onClick={applyProposedPlan} className="tap cta" style={{ flex: 1, borderRadius: 12, padding: "11px 0", fontSize: 13.5, fontWeight: 800 }}>
                        {proposedPlan.mode === "adapt" ? "Update my plan" : "Add to my plan"}
                      </button>
                      <button onClick={() => setProposedPlan(null)} className="chip tap">Discard</button>
                    </div>
                  </div>
                );
              })()}

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button onClick={generatePlan} disabled={planBusy || coachBusy} className="chip tap" style={{ flex: 1, opacity: planBusy || coachBusy ? 0.5 : 1 }}>
                  {planBusy ? "Working…" : proposedPlan && proposedPlan.mode !== "adapt" ? "Regenerate block" : "Build my next block"}
                </button>
                <button onClick={adaptPlan} disabled={planBusy || coachBusy} className="chip tap" style={{ flex: 1, opacity: planBusy || coachBusy ? 0.5 : 1 }}>
                  Adjust upcoming
                </button>
                {isCustomPlan && (
                  <button onClick={resetPlan} disabled={planBusy} className="chip tap" style={{ opacity: planBusy ? 0.5 : 1 }}>Reset plan</button>
                )}
              </div>
            </Card>

            {/* Coach setup */}
            <Card style={{ marginBottom: 12 }}>
              <Label>Coach setup</Label>

              <label className="lab">What I'm training for</label>
              <input className="inp" value={coachGoal} onChange={(e) => saveCoachGoal(e.target.value)}
                placeholder={DEFAULT_GOAL} style={{ marginTop: 7, marginBottom: 16 }} />

              <label className="lab">Model</label>
              <div style={{ display: "grid", gap: 7, marginTop: 8 }}>
                {MODELS.map((m) => {
                  const active = (coachModel.trim() || DEFAULT_MODEL) === m.id;
                  return (
                    <button key={m.id} onClick={() => { saveCoachModel(m.id); setKeyCheck(null); haptic(5); }} className="tap"
                      style={{
                        display: "flex", alignItems: "center", gap: 10, textAlign: "left", cursor: "pointer",
                        borderRadius: 13, padding: "11px 13px",
                        background: active ? tint(C.accent, .12) : C.bgSoft,
                        border: `1px solid ${active ? tint(C.accent, .45) : C.line}`,
                      }}>
                      <span style={{
                        width: 15, height: 15, borderRadius: "50%", flexShrink: 0,
                        border: `2px solid ${active ? C.accent : C.line2}`,
                        background: active ? C.accent : "transparent",
                      }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: C.text }}>{m.name}</span>
                        <span style={{ display: "block", fontSize: 11, color: C.dim2, marginTop: 2 }}>{m.note}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <details style={{ marginTop: 11 }}>
                <summary className="lab" style={{ cursor: "pointer" }}>Use another model</summary>
                <input className="inp" value={coachModel} onChange={(e) => { saveCoachModel(e.target.value); setKeyCheck(null); }}
                  placeholder={DEFAULT_MODEL} autoComplete="off" spellCheck={false} style={{ marginTop: 9 }} />
                <div style={{ fontSize: 11, color: C.dim2, marginTop: 8, lineHeight: 1.5 }}>
                  Any model id Groq serves. Their free line-up changes, so the list above will go stale.
                </div>
              </details>

              {coachKey && (
                <details style={{ marginTop: 16 }}>
                  <summary className="lab" style={{ cursor: "pointer" }}>Groq API key</summary>
                  <input className="inp" type={showKey ? "text" : "password"} value={coachKey}
                    onChange={(e) => { saveCoachKey(e.target.value); setKeyCheck(null); }} placeholder="gsk_…"
                    autoComplete="off" autoCorrect="off" spellCheck={false} style={{ marginTop: 9 }} />
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: C.dim, cursor: "pointer" }}>
                      <input type="checkbox" checked={showKey} onChange={(e) => setShowKey(e.target.checked)} /> Show key
                    </label>
                    <button onClick={testCoachKey} disabled={keyBusy} className="chip tap" style={{ marginLeft: "auto", opacity: keyBusy ? 0.5 : 1 }}>
                      {keyBusy ? "Checking…" : "Check key"}
                    </button>
                  </div>
                  {keyCheck && (
                    <div className="rise" style={{ marginTop: 10, fontSize: 12, lineHeight: 1.55, fontWeight: 600, color: keyCheck.ok ? C.good : C.warn }}>
                      {keyCheck.ok ? "✓ Key works." : keyCheck.error}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: C.dim2, marginTop: 11, lineHeight: 1.5 }}>
                    Stored only on this device and sent straight to Groq — no server in between. It is
                    stripped from backup files, so exporting never leaks it.
                  </div>
                </details>
              )}
            </Card>
          </div>
          );
        })()}

        {tab === "history" && (() => {
          // "Runs" has to mean runs: a walk the watch logged by itself has a
          // distance, so filtering on distance alone let it back in.
          const anyWalks = history.some((h) => h.e.activity === "walk");
          const shown = history.filter((h) =>
            histFilter === "gps" ? h.e.tracked
              : histFilter === "run" ? isRun(h.e) && parseFloat(h.e.km) > 0
                : histFilter === "walk" ? h.e.activity === "walk"
                  : true);
          const shownKm = shown.reduce((s, h) => s + (parseFloat(h.e.km) || 0), 0);
          const shownMin = shown.reduce((s, h) => s + (parseFloat(h.e.min) || 0), 0);
          return (
          <div className="rise">
            <Screen
              title="History"
              sub={history.length ? `${shown.length} session${shown.length === 1 ? "" : "s"} · ${fmtDist(shownKm, 1)}${shownMin ? ` · ${fmtMin(shownMin)}` : ""}` : "Every session you tick off lands here"}
              action={history.length > 0 ? <ShareBtn spec={progressShareSpec()} /> : null} />

            {history.length > 0 && (
              <div className="hscroll" style={{ marginBottom: 14 }}>
                {[["all", "All"], ["run", "Runs"], ...(anyWalks ? [["walk", "Walks"]] : []), ["gps", "GPS tracked"]].map(([id, lbl]) => (
                  <button key={id} onClick={() => { setHistFilter(id); haptic(5); }} className={`chip tap${histFilter === id ? " on" : ""}`}>
                    {lbl}
                  </button>
                ))}
              </div>
            )}

            {history.length === 0 ? (
              <Card style={{ textAlign: "center", padding: "34px 20px" }}>
                <div style={{ fontSize: 34 }}>🏃</div>
                <div className="disp" style={{ fontSize: 18, fontWeight: 700, marginTop: 10 }}>No runs logged yet</div>
                <div style={{ fontSize: 13, color: C.dim, marginTop: 6, lineHeight: 1.55 }}>Track a run with GPS, or tick off a day on the Plan tab, and it'll show up here.</div>
                <button onClick={() => { haptic(12); setTrackerOpen(true); }} className="tap cta disp"
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 16, borderRadius: 14, padding: "13px 22px", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}>
                  <Icon name="play" size={15} /> Track your first run
                </button>
              </Card>
            ) : shown.length === 0 ? (
              <Card style={{ textAlign: "center", padding: 24 }}>
                <div style={{ fontSize: 13, color: C.dim }}>Nothing matches this filter yet.</div>
              </Card>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {shown.map((h, idx) => {
                  const p = fmtPace(paceSec(h.e.min, h.e.km));
                  const km = parseFloat(h.e.km) || 0;
                  const date = h.e.date ? new Date(h.e.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "—";
                  const hasRoute = h.e.route && h.e.route.length > 1;
                  const extras = [];
                  if (h.e.elev > 0) extras.push(`▲ ${fmtElev(h.e.elev)}`);
                  if (h.e.kcal > 0) extras.push(`${h.e.kcal} kcal`);
                  if (h.e.runKm > 0) extras.push(`Run ${fmtDist(h.e.runKm, 2)}`);
                  if (h.e.walkKm > 0) extras.push(`Walk ${fmtDist(h.e.walkKm, 2)}`);
                  if (h.e.hrAvg > 0) extras.push(`♥ ${h.e.hrAvg} avg · ${h.e.hrMax} max`);
                  if (h.e.cadence > 0) extras.push(`${h.e.cadence} spm`);
                  return (
                    <Card key={h.key} style={{ padding: 0, overflow: "hidden", borderRadius: 20, animation: "rise .3s ease both", animationDelay: `${Math.min(idx * 0.03, 0.3)}s` }}>
                      {hasRoute && (
                        <div style={{ position: "relative" }}>
                          <LiveMap points={h.e.route} height={158} interactive={false} />
                          <button onClick={() => { haptic(8); setReplayRun({ route: h.e.route, km: h.e.km, durMs: h.e.durMs }); }}
                            className="chip tap" style={{ position: "absolute", bottom: 9, right: 9, zIndex: 500, background: "rgba(8,9,13,.86)", color: C.accent, border: `1px solid ${tint(C.accent, .45)}`, padding: "6px 12px", fontSize: 11, fontWeight: 700, backdropFilter: "blur(8px)" }}>
                            ▶ Replay
                          </button>
                          <span style={{ position: "absolute", top: 9, left: 9, zIndex: 500, fontSize: 8.5, fontWeight: 900, letterSpacing: 1, color: C.bg, background: C.grad, padding: "4px 9px", borderRadius: 999 }}>GPS</span>
                        </div>
                      )}

                      <div style={{ padding: "13px 15px 14px" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="disp" style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.25 }}>
                              {h.title}{h.e.feel ? ` ${FEELS[h.e.feel - 1]}` : ""}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                              <span style={{ fontSize: 11, color: C.dim }}>{date} · Week {h.week} · {h.d}</span>
                              {/* A walk is a session, but it is not a run, and the
                                  card has to say so — otherwise a 12 km amble the
                                  watch logged on its own reads as training. */}
                              {h.e.activity === "walk" && (
                                <span style={{ fontSize: 8.5, fontWeight: 900, letterSpacing: 1, color: C.easy, background: tint(C.easy, .14), border: `1px solid ${tint(C.easy, .4)}`, padding: "3px 8px", borderRadius: 999 }}>WALK</span>
                              )}
                              {h.e.imported && !h.e.tracked && (
                                <span style={{ fontSize: 8.5, fontWeight: 900, letterSpacing: 1, color: C.dim2, background: tint(C.text, .05), border: `1px solid ${C.line}`, padding: "3px 8px", borderRadius: 999 }}>IMPORTED</span>
                              )}
                            </div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            {km > 0 && <div className="num gtext" style={{ fontSize: 21, fontWeight: 700, lineHeight: 1 }}>{fmtDistNum(km, 2)}<span style={{ fontSize: 11 }}> {U.short}</span></div>}
                            <div className="num" style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
                              {h.e.min ? `${h.e.min} min` : ""}{p ? ` · ${p}/${U.short}` : ""}
                            </div>
                            {h.e.stitch && <div style={{ fontSize: 9, color: C.warn, fontWeight: 800, letterSpacing: 1, marginTop: 3 }}>STITCH</div>}
                          </div>
                        </div>

                        {h.e.note && (
                          <div style={{ fontSize: 12.5, color: C.dim, marginTop: 9, fontStyle: "italic", lineHeight: 1.5 }}>"{h.e.note}"</div>
                        )}

                        {extras.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 11 }}>
                            {extras.map((x, i) => (
                              <span key={i} className="chip" style={{ background: tint(C.text, .05), color: C.dim, fontSize: 11, padding: "6px 11px" }}>{x}</span>
                            ))}
                          </div>
                        )}

                        {h.e.splits && h.e.splits.length > 0 && (
                          <div className="hscroll" style={{ marginTop: 8 }}>
                            {h.e.splits.map((s, i) => (
                              <span key={i} className="chip" style={{ background: tint(C.text, .05), color: C.text, fontSize: 11, padding: "6px 11px", flexShrink: 0 }}>{splitLabel(i)} · {fmtPaceUnit(s)}</span>
                            ))}
                          </div>
                        )}

                        {km > 0 && (
                          <div style={{ display: "flex", gap: 8, marginTop: 13 }}>
                            <button onClick={() => openShare(runShareSpec(h))} className="chip tap"
                              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "11px 0", fontSize: 12.5, fontWeight: 700, background: tint(C.accent, .12), color: C.accent, borderColor: tint(C.accent, .38) }}>
                              <Icon name="share" size={14} /> Share card
                            </button>
                            <button onClick={() => coachThisRun(h)} disabled={runFeedbackBusy === h.key} className="chip tap"
                              style={{ flex: 1, padding: "11px 0", fontSize: 12.5, fontWeight: 700, opacity: runFeedbackBusy === h.key ? 0.6 : 1 }}>
                              {runFeedbackBusy === h.key ? "Reading…" : runFeedback[h.key] ? "Ask again" : `🧠 Coach this ${h.e.activity === "walk" ? "walk" : "run"}`}
                            </button>
                          </div>
                        )}

                        {runFeedback[h.key] && (
                          <div className="rise" style={{ background: C.bgSoft, border: `1px solid ${C.line}`, borderRadius: 13, padding: 12, marginTop: 10, fontSize: 12.5, lineHeight: 1.6, color: C.text, whiteSpace: "pre-wrap" }}>
                            {runFeedback[h.key]}
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
          );
        })()}

        {tab === "plan" && (
          <div className="rise">
            <Screen
              title={heroIdx >= 0 ? "Today" : hero ? "Next up" : "Block complete"}
              sub={countdown || (hero ? `Week ${hero.week} of ${WEEKS.length} · ${WEEKS.find((w) => w.n === hero.week)?.label}` : "Every session ticked off")}
              action={history.length > 0 ? <ShareBtn spec={progressShareSpec()} /> : null} />

            {/* Notifications being off is not a settings-screen detail — it is
                the reason the reminders and run alerts the user switched on are
                never arriving, so it is said here, where they actually look. */}
            {(isNative() || notificationsSupported()) && perm !== "granted" && (
              <button onClick={goToNotifications} className="tap"
                style={{
                  width: "100%", padding: "12px 14px", marginBottom: 12, borderRadius: 16, cursor: "pointer",
                  background: tint(C.warn, .12), color: C.text, border: `1px solid ${tint(C.warn, .42)}`,
                  display: "flex", alignItems: "center", gap: 11, textAlign: "left",
                }}>
                <span style={{ color: C.warn, display: "flex" }}><Icon name="bell" size={16} /></span>
                <span style={{ flex: 1, fontSize: 12.5, lineHeight: 1.4, fontWeight: 600 }}>
                  Notifications are off — reminders and run alerts can't reach you.
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: C.warn, flexShrink: 0 }}>Fix →</span>
              </button>
            )}

            {/* Unprotected work is worth a word here, not buried in settings:
                localStorage is one cleared cache away from empty. */}
            {backup.stale && (
              <button onClick={() => { haptic(8); setTab("stats"); setStatsView("settings"); }} className="tap"
                style={{
                  width: "100%", padding: "12px 14px", marginBottom: 12, borderRadius: 16, cursor: "pointer",
                  background: tint(C.accent, .1), color: C.text, border: `1px solid ${tint(C.accent, .38)}`,
                  display: "flex", alignItems: "center", gap: 11, textAlign: "left",
                }}>
                <span style={{ color: C.accent, display: "flex" }}><Icon name="download" size={16} /></span>
                <span style={{ flex: 1, fontSize: 12.5, lineHeight: 1.4, fontWeight: 600 }}>{backup.reason}</span>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: C.accent, flexShrink: 0 }}>Back up →</span>
              </button>
            )}

            {/* Conditions first: what to wear and whether to wait are decided
                before the session is even read. */}
            <WeatherStrip weather={wx.weather} onRefresh={wx.refresh} />

            {/* Today / next-up hero — the screen's centre of gravity */}
            {hero ? (
              <div className="card accented" style={{ borderRadius: 24, padding: "18px 20px 20px", marginBottom: 14, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{
                    fontSize: 9.5, letterSpacing: 1.6, fontWeight: 800, color: C.bg,
                    background: C.grad, borderRadius: 999, padding: "4px 11px",
                  }}>
                    {heroIdx >= 0 ? "TODAY" : "NEXT UP"}
                  </span>
                  <span style={{
                    fontSize: 9, letterSpacing: 1.4, fontWeight: 800, color: typeColor(hero.type),
                    background: tint(typeColor(hero.type), .13), border: `1px solid ${tint(typeColor(hero.type), .35)}`,
                    borderRadius: 999, padding: "3px 9px",
                  }}>{hero.type.toUpperCase()}</span>
                  <span style={{ fontSize: 10.5, color: C.dim, fontWeight: 700, letterSpacing: 0.6 }}>W{hero.week} · {hero.d}</span>
                  {heroIdx >= 0 && (
                    <span style={{ marginLeft: "auto", fontSize: 11, color: C.dim, fontWeight: 600 }}>
                      {dateForDay(startDate, heroIdx).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  )}
                </div>

                <div className="disp" style={{ fontSize: 29, fontWeight: 700, margin: "12px 0 4px", lineHeight: 1.12, textDecoration: heroEntry.done ? "line-through" : "none", color: heroEntry.done ? C.dim : C.text }}>
                  {hero.title}
                </div>
                <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.55 }}>{hero.detail}</div>

                {hero.km > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 15, paddingTop: 14, borderTop: `1px solid ${tint(C.text, .07)}` }}>
                    <div>
                      <div className="num gtext" style={{ fontSize: 27, fontWeight: 700, lineHeight: 1 }}>{fmtDistNum(hero.km, hero.km % 1 ? 1 : 0)}</div>
                      <div className="lab" style={{ marginTop: 5 }}>{U.short} target</div>
                    </div>
                    {heroIdx >= 0 && (
                      <div>
                        <div className="num" style={{ fontSize: 27, fontWeight: 700, lineHeight: 1, color: C.text }}>{heroIdx + 1}</div>
                        <div className="lab" style={{ marginTop: 5 }}>of {TOTAL} days</div>
                      </div>
                    )}
                    {heroEntry.km > 0 && (
                      <div style={{ marginLeft: "auto", textAlign: "right" }}>
                        <div className="num" style={{ fontSize: 20, fontWeight: 700, color: C.good }}>{fmtDist(parseFloat(heroEntry.km), 2)}</div>
                        <div className="lab" style={{ marginTop: 5 }}>logged</div>
                      </div>
                    )}
                  </div>
                )}

                {/* On a rest day the session *is* not running, so offering
                    "Start GPS run" as the primary action would be telling the
                    user to ignore their own plan. Tick it off instead. */}
                <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                  {hero.type === "rest" ? (
                    <>
                      <button onClick={() => update(hero.key, { done: !heroEntry.done })} className="tap cta disp"
                        style={{ flex: 1.4, borderRadius: 15, padding: "14px 0", fontSize: 15, fontWeight: 700, cursor: "pointer", opacity: heroEntry.done ? 0.75 : 1 }}>
                        {heroEntry.done ? "Rest day done ✓" : "Mark rest day done"}
                      </button>
                      <button onClick={() => { haptic(12); setTrackerOpen(true); }} className="chip tap"
                        style={{ flex: 1, padding: "14px 0", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                        <Icon name="play" size={14} /> Run anyway
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { haptic(12); setTrackerOpen(true); }} className="tap cta disp"
                        style={{ flex: 1.4, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 15, padding: "14px 0", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
                        <Icon name="play" size={15} /> Start GPS run
                      </button>
                      <button onClick={() => update(hero.key, { done: !heroEntry.done })} className="chip tap"
                        style={{ flex: 1, padding: "14px 0", fontSize: 13, fontWeight: 700, background: heroEntry.done ? tint(C.accent, .16) : C.bgSoft, color: heroEntry.done ? C.accent : C.dim, borderColor: heroEntry.done ? tint(C.accent, .4) : C.line }}>
                        {heroEntry.done ? "Done ✓" : "Mark done"}
                      </button>
                    </>
                  )}
                </div>

                {heroEntry.done && nextUp && nextUp.key !== hero.key && (
                  <div style={{ fontSize: 11.5, color: C.dim, marginTop: 13 }}>
                    Next up: Week {nextUp.week} · {nextUp.d} · {nextUp.title}
                  </div>
                )}
              </div>
            ) : (
              <div className="card glow" style={{ borderRadius: 22, padding: 20, marginBottom: 14, textAlign: "center" }}>
                <div style={{ fontSize: 34 }}>🎖️</div>
                <div className="disp" style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>Mission complete</div>
                <div style={{ fontSize: 13, color: C.dim, marginTop: 6, lineHeight: 1.55 }}>You finished every session. Keep the momentum — let your coach build what's next.</div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 16 }}>
                  <button onClick={() => { haptic(12); setTab("coach"); generatePlan(); }} disabled={planBusy} className="tap cta disp"
                    style={{ display: "inline-flex", alignItems: "center", gap: 7, borderRadius: 14, padding: "13px 20px", fontSize: 14.5, fontWeight: 700, cursor: "pointer", opacity: planBusy ? 0.6 : 1 }}>
                    🚀 {planBusy ? "Building…" : "Build my next block"}
                  </button>
                  <button onClick={() => { haptic(12); setTrackerOpen(true); }} className="chip tap disp"
                    style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "13px 18px", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}>
                    <Icon name="play" size={15} /> Victory run
                  </button>
                </div>
              </div>
            )}

            {/* Goal countdown strip — the target that comes after this block */}
            {goalDate && goalDays != null && goalDays >= 0 && goal && (
              <div className="card tap" onClick={() => { setTab("stats"); setStatsView("goal"); haptic(6); }}
                style={{ display: "flex", alignItems: "center", gap: 12, borderRadius: 18, padding: "13px 15px", marginBottom: 10 }}>
                <span style={{ color: C.accent, display: "flex" }}><Icon name="flag" size={18} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="lab" style={{ marginBottom: 3 }}>{goal.name}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                    {goalDays === 0 ? "Race day is today" : `${goalDays} day${goalDays === 1 ? "" : "s"} to race day`}
                    {goalPrediction ? ` · on track for ${fmtDuration(goalPrediction.sec)}` : ""}
                  </div>
                </div>
                <span className="num" style={{ fontSize: 13, fontWeight: 800, color: goalReady >= 100 ? C.good : C.dim }}>{goalReady}%</span>
              </div>
            )}

            {/* Secondary actions — one row, so the hero keeps its single CTA */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {[
                { icon: "map", label: "Plan a route", onClick: () => { haptic(10); setRouteMakerOpen(true); } },
                { icon: "target", label: "Ask the coach", onClick: () => { haptic(8); setTab("coach"); } },
                { icon: "calendar", label: startDate ? "Schedule" : "Set start date", onClick: () => { haptic(8); setTab("stats"); setStatsView("charts"); } },
              ].map((a) => (
                <button key={a.label} onClick={a.onClick} className="card tap"
                  style={{ flex: 1, borderRadius: 16, padding: "13px 4px 11px", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, cursor: "pointer", color: C.text }}>
                  <span style={{ color: C.accent, display: "flex" }}><Icon name={a.icon} size={17} /></span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, textAlign: "center", lineHeight: 1.2 }}>{a.label}</span>
                </button>
              ))}
            </div>

            {WEEKS.map((w) => {
              const wDone = w.days.filter((_, i) => log[`w${w.n}d${i}`] && log[`w${w.n}d${i}`].done).length;
              const weekDone = wDone === w.days.length;
              const collapsed = weekDone && !openWeeks[w.n];
              const weekKm = w.days.reduce((sum, d) => sum + (d.km || 0), 0);
              return (
                <div key={w.n} className="stagger" style={{ marginBottom: 18, animationDelay: `${Math.min((w.n - 1) * 0.05, 0.3)}s` }}>
                  <div className={weekDone ? "tap" : ""}
                    onClick={() => { if (weekDone) { setOpenWeeks((o) => ({ ...o, [w.n]: !o[w.n] })); haptic(5); } }}
                    style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9, padding: "0 2px" }}>
                    <span className="disp" style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: 1.4, color: weekDone ? C.accent : C.text }}>WEEK {w.n}</span>
                    <span style={{ fontSize: 11, color: C.dim, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.label}</span>
                    <span className="num" style={{ marginLeft: "auto", fontSize: 10.5, color: C.dim2, fontWeight: 700, flexShrink: 0 }}>{fmtDist(weekKm, 0)}</span>
                    <span className="num" style={{ fontSize: 11, color: weekDone ? C.accent : C.dim, fontWeight: 800, flexShrink: 0 }}>
                      {weekDone ? `✓ ${collapsed ? "▸" : "▾"}` : `${wDone}/${w.days.length}`}
                    </span>
                  </div>
                  <div style={{ marginBottom: 10 }}><Bar pct={(wDone / w.days.length) * 100} /></div>
                  {!collapsed && <div style={{ display: "grid", gap: 7 }}>
                    {w.days.map((day, di) => {
                      const key = `w${w.n}d${di}`;
                      const e = log[key] || {};
                      const isOpen = open === key;
                      const flatIdx = (w.n - 1) * 7 + di;
                      const isToday = flatIdx === todayIdx;
                      const col = typeColor(day.type);
                      return (
                        <div key={di}>
                          <div className="row tap card" onClick={() => { setOpen(isOpen ? null : key); haptic(5); }}
                            style={{
                              display: "flex", alignItems: "center", gap: 11, padding: "11px 13px",
                              borderColor: isToday ? tint(C.accent, .55) : e.done ? tint(col, .4) : C.line,
                              borderRadius: isOpen ? "16px 16px 0 0" : 16,
                              boxShadow: isToday ? C.glow : undefined,
                            }}>
                            <button onClick={(ev) => { ev.stopPropagation(); update(key, { done: !e.done }); }}
                              className={`tick${e.done ? " pop" : ""}`}
                              aria-label={e.done ? `Mark ${day.title} not done` : `Mark ${day.title} done`}
                              style={{ border: `2px solid ${e.done ? col : C.line2}`, background: e.done ? col : "transparent", color: C.bg }}>
                              {e.done ? "✓" : ""}
                            </button>
                            <div style={{ width: 27, flexShrink: 0 }}>
                              <div style={{ fontSize: 10.5, fontWeight: 800, color: isToday ? C.accent : C.dim, letterSpacing: 0.4 }}>{day.d}</div>
                              <div style={{ width: 14, height: 2.5, borderRadius: 2, background: col, marginTop: 4, opacity: e.done ? 1 : .5 }} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="disp" style={{ fontSize: 15.5, fontWeight: 700, textDecoration: e.done ? "line-through" : "none", color: e.done ? C.dim : C.text, lineHeight: 1.25 }}>{day.title}</div>
                              <div style={{ fontSize: 11, color: C.dim2, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{day.detail}</div>
                            </div>
                            {isToday
                              ? <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: 1, color: C.bg, background: C.grad, padding: "4px 8px", borderRadius: 999, flexShrink: 0 }}>TODAY</span>
                              : day.km > 0
                                ? <span className="num" style={{ fontSize: 12, fontWeight: 700, color: e.done ? col : C.dim2, flexShrink: 0 }}>{fmtDistNum(day.km, day.km % 1 ? 1 : 0)}<span style={{ fontSize: 9, color: C.dim2 }}>{U.short}</span></span>
                                : <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: C.rest, flexShrink: 0 }}>REST</span>}
                          </div>

                          {isOpen && (
                            <div className="rise" style={{ background: C.bgSoft, border: `1px solid ${C.line}`, borderTop: "none", borderRadius: "0 0 14px 14px", padding: 14 }}>
                              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                                <div style={{ flex: 1 }}>
                                  <label style={{ fontSize: 10, color: C.dim, fontWeight: 700, letterSpacing: 1 }}>DISTANCE ({U.short})</label>
                                  <DistanceInput km={e.km ?? ""} placeholderKm={day.km || 0} onChangeKm={(v) => update(key, { km: v })} />
                                </div>
                                <div style={{ flex: 1 }}>
                                  <label style={{ fontSize: 10, color: C.dim, fontWeight: 700, letterSpacing: 1 }}>TIME (min)</label>
                                  <input className="inp" type="number" inputMode="numeric" placeholder="—" value={e.min ?? ""} onChange={(ev) => update(key, { min: ev.target.value })} />
                                </div>
                              </div>
                              {fmtPace(paceSec(e.min, e.km)) && (
                                <div style={{ fontSize: 11, color: C.accent, fontWeight: 700, marginBottom: 10 }}>Pace: {fmtPaceUnit(paceSec(e.min, e.km))}</div>
                              )}
                              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                                <span style={{ fontSize: 12, color: C.dim, fontWeight: 600 }}>Side stitch hit?</span>
                                <button onClick={() => update(key, { stitch: !e.stitch })} className="chip"
                                  style={{ background: e.stitch ? C.warn : C.bg, color: e.stitch ? C.bg : C.dim, border: e.stitch ? "none" : `1px solid ${C.line}` }}>
                                  {e.stitch ? "Yes" : "No"}
                                </button>
                              </div>
                              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                                <span style={{ fontSize: 12, color: C.dim, fontWeight: 600 }}>Effort felt</span>
                                <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
                                  {FEELS.map((f, i) => {
                                    const sel = e.feel === i + 1;
                                    return (
                                      <button key={i} onClick={() => update(key, { feel: sel ? null : i + 1 })}
                                        style={{ width: 34, height: 34, borderRadius: 10, border: `1px solid ${sel ? C.accent : C.line}`, background: sel ? C.surface : "transparent", fontSize: 16, cursor: "pointer", opacity: !e.feel || sel ? 1 : 0.45, padding: 0 }}>
                                        {f}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                                <span style={{ fontSize: 12, color: C.dim, fontWeight: 600 }}>Session was</span>
                                <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                                  {[["easy", "Too easy"], ["ok", "Just right"], ["hard", "Too hard"]].map(([v, lbl]) => {
                                    const sel = e.cal === v;
                                    const col = v === "hard" ? C.warn : v === "easy" ? C.easy : C.accent;
                                    return (
                                      <button key={v} onClick={() => update(key, { cal: sel ? null : v })} className="chip"
                                        style={{ background: sel ? col : C.bg, color: sel ? C.bg : C.dim, border: sel ? "none" : `1px solid ${C.line}`, fontSize: 11 }}>
                                        {lbl}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <input className="inp" placeholder="How did it feel? (note)" value={e.note ?? ""} onChange={(ev) => update(key, { note: ev.target.value })} />
                              {e.cal && <div style={{ fontSize: 11, color: C.dim, marginTop: 8 }}>The coach uses this — tap “Adjust upcoming” in the AI coach card to re-tune your next sessions.</div>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>}
                </div>
              );
            })}

            <button onClick={() => { setTipsOpen((o) => !o); haptic(6); }} className="card tap"
              style={{ width: "100%", textAlign: "left", padding: "13px 15px", marginBottom: 10, borderRadius: 16, color: C.text, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 9, cursor: "pointer" }}>
              <span style={{ color: C.accent, display: "flex" }}><Icon name="target" size={16} /></span>
              Beat the side stitch
              <span style={{ marginLeft: "auto", color: C.dim, fontWeight: 700 }}>{tipsOpen ? "▾" : "▸"}</span>
            </button>
            {tipsOpen && (
              <div className="rise card" style={{ borderRadius: 16, padding: "14px 16px", marginBottom: 12, fontSize: 13, lineHeight: 1.6, color: C.dim }}>
                <p style={{ margin: "0 0 7px" }}><b style={{ color: C.text }}>Belly breathing.</b> Deep into your stomach, not shallow into the chest — your #1 weapon.</p>
                <p style={{ margin: "0 0 7px" }}><b style={{ color: C.text }}>Exhale on the opposite foot</b> to the stitch side.</p>
                <p style={{ margin: "0 0 7px" }}><b style={{ color: C.text }}>No food 2–3h before.</b> Don't chug water right before either.</p>
                <p style={{ margin: 0 }}><b style={{ color: C.text }}>Slow down</b> to a pace where you could still talk.</p>
              </div>
            )}

            <div className="card" style={{ borderRadius: 16, padding: "13px 15px", fontSize: 12, lineHeight: 1.55, color: C.dim, marginBottom: 14 }}>
              <b style={{ color: C.text }}>Listen to your body.</b> Muscle soreness = normal. Sharp joint or shin pain = stop and rest 1–2 days. Don't arrive injured.
            </div>
            <button onClick={reset} className="chip tap" style={{ fontSize: 11 }}>Reset all progress</button>
          </div>
        )}

        {!loaded && <div style={{ fontSize: 11, color: C.dim, marginTop: 12 }}>loading…</div>}
      </div>

      <BottomNav tab={tab} onChange={(t) => { setTab(t); setOpen(null); haptic(6); }} />

      {trackerOpen && (
        <ErrorBoundary fallback={(err) => (
          <div style={{
            position: "fixed", inset: 0, zIndex: 9999, background: C.bg, color: C.text,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 14, padding: 24, textAlign: "center",
            paddingTop: "max(24px, env(safe-area-inset-top))",
          }}>
            <div style={{ fontSize: 38 }}>🛰️</div>
            <div className="disp" style={{ fontSize: 20, fontWeight: 700 }}>Run tracker hit a snag</div>
            <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.6, maxWidth: 320 }}>
              Couldn't start the GPS tracker. Nothing was lost — head back and try again.
            </div>
            <pre style={{ maxWidth: 340, width: "100%", overflow: "auto", textAlign: "left", fontSize: 11, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, color: C.warn, whiteSpace: "pre-wrap", margin: 0 }}>{err?.message || String(err)}</pre>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setTrackerOpen(false)} className="chip" style={{ padding: "13px 24px", fontSize: 15 }}>Back</button>
              <button onClick={() => window.location.reload()} className="chip cta" style={{ padding: "13px 24px", fontSize: 15, fontWeight: 800, borderRadius: 999 }}>Reload</button>
            </div>
          </div>
        )}>
          <RunTracker
            days={FLAT}
            defaultKey={trackDefaultKey}
            targetRoute={selectedCustomRoute}
            onSave={saveTrackedRun}
            onShare={(run) => openShare({ kind: "run", data: run })}
            onClose={() => setTrackerOpen(false)}
          />
        </ErrorBoundary>
      )}

      {routeMakerOpen && (
        <RouteMaker
          onClose={() => setRouteMakerOpen(false)}
          onSelectRoute={(route) => {
            setSelectedCustomRoute(route);
            setTrackerOpen(true);
          }}
        />
      )}

      {replayRun && (
        <RouteReplay run={replayRun} onClose={() => setReplayRun(null)} />
      )}

      {shareSpec && (
        <ShareSheet spec={shareSpec} onClose={() => setShareSpec(null)} onToast={setToast} />
      )}
    </div>
  );
}

function PB({ label, value, unit, color }) {
  return (
    <div style={{
      flex: 1, textAlign: "center", borderRadius: 14, padding: "13px 8px",
      background: color ? `linear-gradient(160deg,${tint(color, .14)},${C.surface2} 70%)` : C.surface2,
      border: `1px solid ${color ? tint(color, .32) : C.line}`,
    }}>
      <div className="num" style={{ fontSize: 16.5, fontWeight: 700, color: color || C.text }}>{value}<span style={{ fontSize: 10, color: C.dim, fontWeight: 700 }}>{unit ? " " + unit : ""}</span></div>
      <div style={{ fontSize: 9, letterSpacing: 1, color: C.dim, marginTop: 5, fontWeight: 700, textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}
