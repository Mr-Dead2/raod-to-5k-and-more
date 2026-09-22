import React, { useState, useEffect, useRef, useMemo } from "react";
import { ShareSheet } from "./components/ShareSheet.jsx";
import { copyText, fmtClock } from "./share.js";
import { RouteReplay } from "./components/RouteReplay.jsx";
import { RouteMaker } from "./components/RouteMaker.jsx";
import { WEEKS, FLAT, TOTAL, DEFAULT_WEEKS, C, typeColor, ACCENTS, applyAccent, applyPlan, tint, ringColors } from "./data.js";
import {
  Icon, IconBadge, Card, Label, Bar, Group, Cell, Screen, NavBar, useNavCollapse, Segmented, Switch,
  GlassButton, Tile, Metric, MetricGrid, Rings, Island,
} from "./components/ui.jsx";
import { appCss } from "./styles.js";
import { extendPlan, planSplit, adaptedPlan } from "./plan.js";
import { loadLog, saveLog, loadSettings, saveSettings } from "./storage.js";
import { WeeklyBars, CumulativeArea, StreakGrid, PaceTrend } from "./components/Charts.jsx";
import { LiveMap } from "./components/LiveMap.jsx";
import { BottomNav } from "./components/BottomNav.jsx";
import { RunTracker } from "./components/RunTracker.jsx";
import { NotifDiagnostics } from "./components/NotifDiagnostics.jsx";
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
  readHeartRate, heartRateTargets, heartRatePatch,
} from "./health.js";
import {
  isNative, nativeEnableReminder, nativeDisableReminder, nativeUpdateReminder,
  ensureLocationPermission, styleStatusBar, nativeShareBackup,
  nativeBootstrapNotifications, onAppResume,
} from "./native.js";

const DAY = 86400000;
const paceSec = (min, km) => {
  const m = parseFloat(min), k = parseFloat(km);
  if (!m || !k) return 0;
  return (m * 60) / k;
};
const fmtPace = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : null);
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
  const [histFilter, setHistFilter] = useState("all"); // all | run | gps
  const [openWeeks, setOpenWeeks] = useState({}); // completed weeks expanded by tap
  const [replayRun, setReplayRun] = useState(null); // run object being replayed
  const [routeMakerOpen, setRouteMakerOpen] = useState(false);
  const [shareSpec, setShareSpec] = useState(null); // card handed to the share sheet
  const [statsView, setStatsView] = useState("overview"); // overview | goal | charts | awards | settings
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
  const [hcScan, setHcScan] = useState(null);   // { ready, skipped, merge } after a look
  // Watch workouts the user waved away on the Plan tab: they stay importable
  // from Setup, but stop asking on every launch.
  const [hcDismissed, setHcDismissed] = useState(() => new Set(loadSettings().hcDismissed || []));
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

  // The navigation bar is invisible over the large title and turns to glass,
  // with the title centred in it, once the large title has scrolled beneath
  // it — driven by a CSS variable, so scrolling never re-renders the app.
  useNavCollapse();

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

  // The watch, kept in step without anyone pressing a button. A Galaxy Watch 3
  // can't run Stride and can't stream its pulse, but what it records reaches
  // Health Connect through Samsung Health — so on every launch and every return
  // to the app, Stride looks there for (a) runs recorded on the watch, offered
  // on the Plan tab, and (b) the heart rate the watch measured during runs
  // Stride tracked with the phone's GPS, which is added straight to those runs.
  // These callbacks outlive the render that registered them, so they read the
  // current log and settings through a ref, never through a stale closure.
  const latest = useRef({});
  latest.current = { log, startDate, importWalks };
  const lastWatchSync = useRef(0);
  const syncWatch = async ({ force = false } = {}) => {
    if (!healthSupported()) return null;
    const now = Date.now();
    if (!force && now - lastWatchSync.current < 60000) return null;
    lastWatchSync.current = now;
    const state = await refreshHealth();
    if (!state.granted) return null;

    const workouts = await readWorkouts(30);
    const cur = latest.current;
    const scan = planImport(workouts, { flat: FLAT, log: cur.log, startDate: cur.startDate, includeWalks: cur.importWalks });
    // New runs wait for a tap on the Plan tab. A watch recording of a run Stride
    // tracked itself doesn't: it only fills what the Stride run is missing
    // (heart rate, steps, cadence), so it is applied straight away.
    setHcScan({ ...scan, merge: [] });

    const patches = scan.merge.map((m) => [m.key, m.patch]);
    const merged = new Set(patches.map(([key]) => key));
    for (const t of heartRateTargets(latest.current.log).filter((x) => !merged.has(x.key)).slice(0, 12)) {
      const r = await readHeartRate(t.win[0] - 60000, t.win[1] + 60000);
      const patch = heartRatePatch(r, t.win);
      if (patch) patches.push([t.key, patch]);
    }
    if (patches.length) {
      // Merged onto the newest log, not the one this sync started from: the
      // reads above take time, and the user may have logged something meanwhile.
      setLog((prev) => {
        const next = { ...prev };
        for (const [key, patch] of patches) next[key] = { ...(prev[key] || {}), ...patch };
        saveLog(next);
        return next;
      });
      const n = patches.filter(([, p]) => p.hrAvg).length;
      if (n) setToast({ icon: "❤️", title: `Heart rate from your watch added to ${n} run${n === 1 ? "" : "s"}`, label: "YOUR WATCH" });
    }
    return scan;
  };
  useEffect(() => { if (loaded) syncWatch({ force: true }); else refreshHealth(); }, [loaded]);

  useEffect(() => onAppResume(() => {
    permissionState().then(setPerm);
    syncWatch();
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
  // Erasing every session is irreversible, so it takes a second tap within a
  // few seconds — the same arm-then-confirm the route planner uses for delete.
  const [resetArmed, setResetArmed] = useState(false);
  const resetTimer = useRef(0);
  useEffect(() => () => clearTimeout(resetTimer.current), []);
  const armReset = () => {
    clearTimeout(resetTimer.current);
    if (!resetArmed) {
      haptic(8);
      setResetArmed(true);
      resetTimer.current = setTimeout(() => setResetArmed(false), 3500);
      return;
    }
    setResetArmed(false);
    reset();
  };

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
    if (next.granted) await syncWatch({ force: true });
    setHcBusy(false);
    if (!granted && !next.granted) {
      setToast({ icon: "⚠️", title: "Health Connect didn't grant access", label: "IMPORT" });
    }
  };

  const scanHealth = async () => {
    haptic(8);
    setHcBusy(true);
    setHcScan(null);
    await syncWatch({ force: true });
    setHcBusy(false);
  };

  // Applies the whole batch in one write — new runs and the heart rate merged
  // into runs Stride tracked. update() persists per call and would otherwise
  // merge each onto a stale `log`, so only the last would survive.
  const applyHealthImport = (scan = hcScan) => {
    if (!scan) return;
    const ready = scan.ready || [], merges = scan.merge || [];
    if (!ready.length && !merges.length) return;
    const merged = { ...log };
    for (const r of ready) merged[r.key] = { ...(merged[r.key] || {}), ...r.entry };
    for (const m of merges) merged[m.key] = { ...(merged[m.key] || {}), ...m.patch };
    persist(merged);
    haptic([12, 30, 12]);
    if (ready.length) confetti({ count: 70 });
    const n = ready.length;
    const walks = ready.filter((r) => r.kind === "walk").length;
    const noun = walks === 0 ? "run" : walks === n ? "walk" : "session";
    setToast({
      icon: "⌚",
      title: n
        ? `Imported ${n} ${noun}${n === 1 ? "" : "s"}${merges.length ? ` · heart rate for ${merges.length} more` : ""}`
        : `Heart rate added to ${merges.length} run${merges.length === 1 ? "" : "s"}`,
      label: "YOUR WATCH",
    });
    setHcScan(null);
    setTab("history");
  };

  // "Not now" on the Plan tab's watch card: remember these workouts so the card
  // stops asking about them. They can still be imported from Setup.
  const dismissWatchItems = (items) => {
    haptic(6);
    const next = new Set(hcDismissed);
    for (const it of items) if (it.w && it.w.id) next.add(it.w.id);
    setHcDismissed(next);
    saveSettings({ ...loadSettings(), hcDismissed: [...next].slice(-200) });
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
    setHcScan((prev) => prev && planImport(prev.ready.concat(prev.skipped, prev.merge || []).map((x) => x.w),
      { flat: FLAT, log, startDate, includeWalks: next }));
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
    const brief = (f) => f && ({ week: f.week, day: f.d, type: f.type, title: f.title, detail: f.detail, km: f.km, done: !!(log[f.key] && log[f.key].done) });
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
  const exportData = async () => {
    haptic(8);
    // keep the secret Groq key out of backup files (export can open a share sheet)
    const { groqKey, ...safeSettings } = loadSettings();
    const payload = { app: "stride", version: 2, exportedAt: new Date().toISOString(), log, settings: { ...safeSettings, startDate } };
    const json = JSON.stringify(payload, null, 2);
    const filename = `stride-backup-${new Date().toISOString().slice(0, 10)}.json`;
    // native: Blob downloads don't work in the WebView — share the file instead
    if (isNative()) {
      const ok = await nativeShareBackup(json, filename);
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
        ? `predicted from ${raceRef.km.toFixed(1)} km in ${fmtDuration(raceRef.sec)}`
        : "log a timed run for a prediction",
      distance: goal ? `${goal.km.toFixed(goal.km % 1 ? 1 : 0)} km` : "—",
      days: goalDate && goalDays != null && goalDays >= 0 ? goalDays : null,
      readiness: goalReady,
      note: goalReady >= 100
        ? "Longest run already covers the distance."
        : goal ? `Longest run so far ${stats.maxKm || 0} km.` : "",
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

  // Where today sits in the block, for the Plan screen's subtitle.
  let schedule = `${WEEKS.length}-week block`, countdown = null;
  if (startDate) {
    if (todayIdx < 0) schedule = `Starts in ${-todayIdx} day${-todayIdx === 1 ? "" : "s"}`;
    else if (todayIdx >= TOTAL) schedule = "Block complete";
    else {
      schedule = `Day ${todayIdx + 1} of ${TOTAL}`;
      const toGoal = TOTAL - 1 - todayIdx;
      countdown = toGoal > 0 ? `${toGoal} day${toGoal === 1 ? "" : "s"} left` : "Final session today";
    }
  }
  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  const screenTitle = {
    plan: heroIdx >= 0 ? "Today" : hero ? "Next up" : "Block complete",
    stats: "Your numbers",
    coach: "Coach",
    history: "History",
  }[tab];

  // The controls that belong to the whole app — share, and the plan ring that
  // opens the overview — sit beside every large title, and move into the bar
  // once it has collapsed, the way an iOS profile button does.
  const appControls = (size) => (
    <>
      <GlassButton icon="share" label="Share my progress" size={size} onClick={() => openShare(progressShareSpec())} />
      <button onClick={() => { setTab("stats"); setStatsView("overview"); haptic(6); }}
        aria-label={`${pctShown}% of the plan complete`} className="ring-btn"
        style={{ width: size + 4, height: size + 4, minHeight: size + 4 }}>
        <Rings size={size + 4} stroke={size > 34 ? 4.5 : 3.8} rings={[{ pct, color: C.accent, color2: C.accent2 }]} />
        <span className="num" style={{ fontSize: size > 34 ? 12 : 10.5 }}>{pctShown}</span>
      </button>
    </>
  );

  // The Activity-style rings on the overview: the plan, this week, race day.
  const curWeekN = todayKey ? FLAT[todayIdx].week : nextUp ? nextUp.week : WEEKS[WEEKS.length - 1].n;
  const curWeek = weekly.find((w) => w.label === curWeekN) || { value: 0, target: 0 };
  const [ring1, ring2, ring3] = ringColors();
  const activity = [
    { label: "Sessions", value: stats.done, goal: `/${TOTAL}`, unit: "", pct: (stats.done / TOTAL) * 100, color: ring1, color2: C.accent2 },
    { label: `Week ${curWeekN}`, value: curWeek.value.toFixed(1), goal: `/${curWeek.target.toFixed(curWeek.target % 1 ? 1 : 0)}`, unit: "km", pct: curWeek.target ? (curWeek.value / curWeek.target) * 100 : 0, color: ring2 },
    { label: goal ? `${goal.name} ready` : "Race ready", value: goalReady, goal: "", unit: "%", pct: goalReady, color: ring3 },
  ];

  const bigWeek = Math.max(0, ...weekly.map((w) => w.value));

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text }}>
      <style>{appCss()}</style>

      <Island toast={toast} />
      <NavBar title={screenTitle} trailing={appControls(32)} />

      <div className="page">
        {/* A still wash of the accent behind the large title — colour that
            bleeds in from the top, as in Music or Fitness. It scrolls away
            with the page; nothing on this ground moves by itself. */}
        <div className="ambient" aria-hidden="true" />

        {installEvt && (
          <Group>
            <Cell icon="download" iconColor={C.blue} title="Install Stride" sub="Add it to your home screen — it works offline" chevron onClick={doInstall} />
          </Group>
        )}

        {tab === "stats" && (
          <div className="rise">
            <Screen eyebrow={todayLabel} title="Your numbers"
              sub={stats.runsLogged ? `${stats.runsLogged} run${stats.runsLogged === 1 ? "" : "s"} logged · ${stats.kmLogged.toFixed(1)} km covered` : "Log a session and this fills up"}
              trailing={appControls(36)} />

            <Segmented
              items={[
                { id: "overview", label: "Overview" },
                { id: "goal", label: "Goal" },
                { id: "charts", label: "Charts" },
                { id: "awards", label: "Awards" },
                { id: "settings", label: "Setup" },
              ]}
              value={statsView} onChange={setStatsView} style={{ marginBottom: 18 }} />

            {statsView === "overview" && (<div className="rise">
              {/* The headline card: total distance, the three rings, and the
                  two things people came here to do. */}
              <div className="card accented" style={{ padding: "18px 18px 16px", marginBottom: 12, overflow: "hidden" }}>
                <div className="t-foot" style={{ color: C.dim, fontWeight: 600 }}>Total distance</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4, margin: "3px 0 16px" }}>
                  <span className="num gtext" style={{ fontSize: 58, fontWeight: 700, lineHeight: 1 }}>{kmShown.toFixed(1)}</span>
                  <span className="num" style={{ fontSize: 22, fontWeight: 700, color: C.accent }}>KM</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 16, paddingTop: 14, borderTop: "0.5px solid var(--sep)" }}>
                  <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 10 }}>
                    {activity.map((a) => (
                      <div key={a.label} style={{ minWidth: 0 }}>
                        <div className="t-foot" style={{ color: C.text, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.label}</div>
                        <div className="num" style={{ fontSize: 21, fontWeight: 700, color: a.color, lineHeight: 1.12 }}>
                          {a.value}<span style={{ fontSize: 14 }}>{a.goal}</span>
                          {a.unit && <span style={{ fontSize: 12, marginLeft: 1, textTransform: "uppercase" }}>{a.unit}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                  <Rings size={136} stroke={16} gap={3} label={activity.map((a) => `${a.label} ${Math.round(a.pct)}%`).join(", ")}
                    rings={activity.map((a) => ({ pct: a.pct, color: a.color, color2: a.color2 }))} />
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                  <button onClick={() => { haptic(12); setTrackerOpen(true); }} className="cta tap"
                    style={{ flex: 1.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 999, padding: "14px 0", fontSize: 17 }}>
                    <Icon name="play" size={17} /> Track run
                  </button>
                  <button onClick={() => { haptic(10); setRouteMakerOpen(true); }} className="btn" style={{ flex: 1, padding: "14px 0", fontSize: 17 }}>
                    <Icon name="map" size={18} /> Routes
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                <Tile label="Streak" icon="flame" color={C.orange} value={stats.curStreak} unit="d" sub={`best ${stats.best}`} delay={0} />
                <Tile label="Runs" icon="run" color={C.accent} value={stats.runsLogged} delay={0.04} />
                <Tile label="On feet" icon="clock" color={C.yellow} value={stats.minTotal ? fmtMin(stats.minTotal) : "—"} delay={0.08} />
              </div>
              <div style={{ display: "flex", gap: 10, marginBottom: 26 }}>
                <Tile label="Avg pace" icon="gauge" color={C.cyan} value={fmtPace(stats.avgPaceSec) || "—"} sub={stats.avgPaceSec ? "per km" : ""} delay={0.12} />
                <Tile label="Longest" icon="route" color={C.easy} value={stats.maxKm ? stats.maxKm : "—"} unit={stats.maxKm ? "km" : ""} delay={0.16} />
                <Tile label="Stitches" icon="bolt" color={stats.stitches ? C.warn : C.good} value={stats.stitches} sub="should drop" delay={0.2} />
              </div>

              <Group header="Personal records">
                <Cell icon="gauge" iconColor={C.cyan} title="Best pace" value={<PBValue v={fmtPace(stats.bestPaceSec)} unit="/km" />} />
                <Cell icon="bolt" iconColor={C.yellow} title="Fastest kilometre" value={<PBValue v={fmtPace(stats.bestSplitSec)} unit="/km" />} />
                <Cell icon="route" iconColor={C.good} title="Longest run" value={<PBValue v={stats.maxKm ? stats.maxKm : null} unit="km" />} />
                <Cell icon="calendar" iconColor={C.orange} title="Biggest week" value={<PBValue v={bigWeek ? bigWeek.toFixed(1) : null} unit="km" />} />
                <Cell icon="mountain" iconColor={C.easy} title="Biggest climb" value={<PBValue v={stats.bestElevM ? `+${stats.bestElevM}` : null} unit="m" />} />
                <Cell icon="flame" iconColor={C.pink} title="Energy burned" value={<PBValue v={stats.totalKcal ? Math.round(stats.totalKcal).toLocaleString() : null} unit="kcal" />} />
              </Group>
            </div>)}

            {statsView === "goal" && (<div className="rise">
              {/* Race goal — the target that replaces "get to 5K" once it's done */}
              <div className="card accented" style={{ padding: 18, marginBottom: 12 }}>
                <Label right={goalDays != null && (
                  <span className="t-foot" style={{ fontWeight: 600, color: goalDays < 0 ? C.dim : C.accent }}>
                    {goalDays > 0 ? `${goalDays} day${goalDays === 1 ? "" : "s"} to go` : goalDays === 0 ? "Race day 🏁" : "Done"}
                  </span>
                )}>My next goal</Label>

                <Segmented
                  items={RACES.filter((r) => r.km >= 5).map((r) => ({ id: r.id, label: r.chip }))}
                  value={goalRace} onChange={saveGoalRace} style={{ marginBottom: 18 }} />

                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="t-foot" style={{ color: C.dim, fontWeight: 600 }}>Predicted finish</div>
                    <div className="num gtext" style={{ fontSize: 44, fontWeight: 700, lineHeight: 1.05, marginTop: 2 }}>
                      {goalPrediction ? fmtDuration(goalPrediction.sec) : "—"}
                    </div>
                    <div className="t-foot" style={{ color: C.dim, marginTop: 6 }}>
                      {goalPrediction && raceRef
                        ? <>from your {raceRef.km.toFixed(1)} km in {fmtDuration(raceRef.sec)} · <span style={{ color: C.dim2 }}>{CONFIDENCE_LABEL[goalPrediction.confidence]}</span></>
                        : "Log a timed run and a predicted finish appears here."}
                    </div>
                  </div>
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    <Rings size={84} stroke={10} rings={[{ pct: goalReady, color: goalReady >= 100 ? C.good : C.accent, color2: goalReady >= 100 ? C.good : C.accent2 }]} label={`Distance readiness ${goalReady}%`} />
                    <span style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                      <span className="num" style={{ fontSize: 19, fontWeight: 700, lineHeight: 1 }}>{goalReady}<span style={{ fontSize: 11 }}>%</span></span>
                      <span className="t-cap2" style={{ color: C.dim, marginTop: 2 }}>ready</span>
                    </span>
                  </div>
                </div>

                <div className="t-foot" style={{ color: C.dim, marginTop: 14, paddingTop: 12, borderTop: "0.5px solid var(--sep)" }}>
                  {goal ? (goalReady >= 100
                    ? "Your longest run already covers the distance. You're ready."
                    : `Longest run so far ${stats.maxKm || 0} km. The ${goal.name} is ${goal.km.toFixed(goal.km % 1 ? 1 : 0)} km.`) : ""}
                </div>
              </div>

              <Group footer={goalDate
                ? <button onClick={() => saveGoalDate("")} className="link" style={{ fontSize: 13, minHeight: 0 }}>Clear race day</button>
                : "Set a date and the Plan tab counts down to it."}>
                <Cell icon="flag" iconColor={C.orange} title="Race day"
                  trailing={<input className="inp" type="date" value={goalDate} onChange={(e) => saveGoalDate(e.target.value)} aria-label="Race day" />} />
              </Group>

              {/* Equivalent finish times across every distance */}
              <Group header="Race predictions" right={raceRef ? <span style={{ textTransform: "none" }}>from {raceRef.km.toFixed(1)} km</span> : null}
                footer={predictions.length ? "Riegel equivalents from your best logged effort. The further the jump from that distance, the rougher the guess. Tap one to make it your goal." : null}>
                {predictions.length === 0 ? (
                  <div className="cell"><span className="cell-sub" style={{ fontSize: 15 }}>
                    Log a run with both distance and time — or track one with GPS — and every equivalent race time shows up here.
                  </span></div>
                ) : predictions.map((p) => {
                  const isGoal = p.race.id === goalRace;
                  return (
                    <Cell key={p.race.id} onClick={() => saveGoalRace(p.race.id)}
                      title={p.race.name}
                      sub={p.confidence === "high" ? "Solid estimate" : p.confidence === "fair" ? "Fair estimate" : "Rough estimate"}
                      value={<span className="num" style={{ color: isGoal ? C.accent : C.text, fontWeight: 600 }}>{fmtDuration(p.sec)}</span>}
                      trailing={<span style={{ width: 20, display: "flex", justifyContent: "flex-end", color: C.accent }}>{isGoal && <Icon name="check" size={18} weight={2.6} />}</span>} />
                  );
                })}
              </Group>

              <button onClick={() => openShare(goalShareSpec())} className="btn" style={{ width: "100%", padding: "14px 0", fontSize: 17, marginBottom: 12 }}>
                <Icon name="share" size={18} /> Share my race goal
              </button>
            </div>)}

            {statsView === "charts" && (<div className="rise">
              {/* Schedule / today */}
              <Card style={{ marginBottom: 12 }}>
                <Label right={
                  <input className="inp" type="date" value={startDate} onChange={(e) => saveStart(e.target.value)} aria-label="Plan start date" />
                }>I started on</Label>
                {startDate
                  ? <div style={{ marginTop: 4 }}><StreakGrid cells={cells} /></div>
                  : <div className="t-foot" style={{ color: C.dim }}>Set this to light up today's session and a day-by-day calendar.</div>}
              </Card>
              <Card style={{ marginBottom: 12 }}>
                <Label right={<span className="t-foot" style={{ color: C.dim }}>logged vs plan</span>}>Distance per week</Label>
                <WeeklyBars data={weekly} />
              </Card>
              <Card style={{ marginBottom: 12 }}>
                <Label right={<span className="t-foot" style={{ color: C.dim }}>up means faster</span>}>Pace trend</Label>
                <PaceTrend points={paceTrend} />
              </Card>
              <Card style={{ marginBottom: 12 }}>
                <Label>Cumulative distance</Label>
                <CumulativeArea points={cumulative} />
              </Card>
            </div>)}

            {statsView === "awards" && (<div className="rise">
              <Card style={{ marginBottom: 12 }}>
                <Label right={<span className="t-sub" style={{ color: C.dim }}><span className="num" style={{ color: C.accent, fontWeight: 700 }}>{unlocked.size}</span> of {ACHIEVEMENTS.length}</span>}>Awards</Label>
                <div style={{ marginBottom: 20 }}><Bar pct={(unlocked.size / ACHIEVEMENTS.length) * 100} /></div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", rowGap: 20, columnGap: 8 }}>
                  {ACHIEVEMENTS.map((a, i) => {
                    const got = unlocked.has(a.id);
                    return (
                      <button key={a.id} disabled={!got} onClick={() => openShare(achievementShareSpec(a))}
                        className="medal-btn stagger" title={`${a.title} — ${a.desc}`} style={{ animationDelay: `${Math.min(i * 0.03, 0.3)}s` }}
                        aria-label={got ? `${a.title} — share it` : `${a.title} — locked: ${a.desc}`}>
                        <span className={`medal${got ? " got" : ""}`}><span>{a.icon}</span></span>
                        <span className="t-foot" style={{ fontWeight: 600, color: got ? C.text : C.dim2, marginTop: 8, lineHeight: 1.25 }}>{a.title}</span>
                        <span className="t-cap2" style={{ color: C.dim2, marginTop: 2, lineHeight: 1.3 }}>{got ? "Tap to share" : a.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </Card>
            </div>)}

            {statsView === "settings" && (<div className="rise">
              <Group header="Appearance" footer="Every ring, chart and highlight in the app follows this colour.">
                <div style={{ display: "flex", justifyContent: "space-between", padding: "16px 18px" }}>
                  {ACCENTS.map((a) => {
                    const active = accent === a.id;
                    return (
                      <button key={a.id} onClick={() => setAccentTheme(a.id)} aria-label={`${a.name} accent`} aria-pressed={active}
                        style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, background: "none", border: "none", padding: 0, cursor: "pointer", minHeight: 0 }}>
                        <span style={{
                          width: 38, height: 38, borderRadius: "50%", background: `linear-gradient(135deg,${a.accent},${a.accent2})`,
                          boxShadow: active ? `0 0 0 3px ${C.surface}, 0 0 0 5px ${a.accent}` : "inset 0 1px 0 rgba(255,255,255,.3)",
                          transition: "box-shadow .25s ease", display: "flex", alignItems: "center", justifyContent: "center", color: C.onAccent,
                        }}>{active && <Icon name="check" size={18} weight={2.8} />}</span>
                        <span className="t-cap" style={{ color: active ? C.text : C.dim, fontWeight: active ? 600 : 500 }}>{a.name}</span>
                      </button>
                    );
                  })}
                </div>
              </Group>

              {/* Until permission is granted every switch below is inert, so say
                  so loudly rather than showing a row of confident switches. */}
              <Group header="Notifications" innerRef={notifCardRef}>
                {(isNative() || notificationsSupported()) && perm !== "granted" && (
                  <div className="cell" style={{ alignItems: "flex-start", background: `linear-gradient(180deg, ${tint(C.orange, 0.12)}, transparent)` }}>
                    <IconBadge name="bell" color={C.orange} />
                    <span className="cell-main">
                      <span className="cell-title" style={{ fontWeight: 600 }}>
                        {perm === "denied" ? "Notifications are blocked" : "Notifications aren't switched on yet"}
                      </span>
                      <span className="cell-sub" style={{ fontSize: 15 }}>
                        {isNative()
                          ? perm === "denied"
                            ? "Android is blocking Stride. Open Settings › Apps › Stride › Notifications and allow them, then come back — the app cannot undo this itself."
                            : "Android hasn't been asked yet. The switches below do nothing until it says yes."
                          : perm === "denied"
                            ? "Your browser is blocking them for this site. Open the padlock or site settings next to the address bar and allow notifications, then come back."
                            : "The switches below do nothing until your browser gives Stride permission."}
                      </span>
                      {perm !== "denied" && (
                        <button onClick={askNotificationPermission} className="cta tap"
                          style={{ marginTop: 12, alignSelf: "flex-start", borderRadius: 999, padding: "10px 20px", fontSize: 15 }}>
                          Allow notifications
                        </button>
                      )}
                    </span>
                  </div>
                )}
                <Cell icon="alarm" iconColor={C.warn} title="Daily reminder" sub="A nudge to do your session"
                  trailing={<Switch on={remOn} onClick={toggleReminder} label="Daily reminder" />} />
                {remOn && (
                  <Cell title="Remind me at" style={{ "--inset": "60px", paddingLeft: 60 }}
                    trailing={<input className="inp" type="time" value={remTime} onChange={(e) => changeTime(e.target.value)} aria-label="Reminder time" />} />
                )}
              </Group>

              <Group header="What Stride tells you" footer="Alerts land on your lock screen, so they reach you with the phone pocketed mid-run.">
                {[
                  ["runLive", "Run in progress", "Live distance, time and pace while you track", "run", C.accent],
                  ["runKm", "Kilometre splits", "A buzz and your split at every kilometre", "flag", C.cyan],
                  ["runInterval", "Run / walk switches", "When to run and when to walk", "repeat", C.purple],
                  ["runFinish", "Run finished", "A summary the moment you stop", "check", C.good],
                  ["milestone", "Awards", "When you unlock a badge", "medal", C.yellow],
                  ["skipRest", "Quiet on rest days", "Skip the daily nudge when the plan says rest", "moon", C.blue],
                ].map(([key, title, desc, icon, color]) => {
                  // A switch that is on but can't fire is shown muted, not accent.
                  const live = notif[key] && (key === "skipRest" || perm === "granted");
                  return (
                    <Cell key={key} icon={icon} iconColor={color} title={title} sub={desc}
                      trailing={<Switch on={notif[key]} muted={notif[key] && !live} onClick={() => toggleNotif(key)} label={title} />} />
                  );
                })}
              </Group>

              <Card style={{ marginBottom: 26 }}>
                <NotifDiagnostics />
              </Card>

              {/* Import runs recorded elsewhere (a watch, another app) */}
              {healthSupported() && (
                <Group header="Your watch"
                  footer={<>
                    <b style={{ color: C.text, fontWeight: 600 }}>With a Galaxy Watch 3</b> (or any watch whose app syncs to
                    Health Connect): start runs on the watch from Samsung Health → Exercise → Running. In Samsung Health
                    on the phone, open Settings → Health Connect and let it share exercise, heart rate, steps and
                    distance. New runs then appear on the Plan tab by themselves. If you also track the run with
                    Stride's GPS, the watch's heart rate is added to that run instead of logging it twice — and even
                    without a watch workout, the heart rate your watch measured during a Stride run is added once it
                    syncs (set the watch to measure heart rate continuously for the best result).
                  </>}>
                  {hc.availability !== "Available" ? (
                    <div className="cell"><span className="cell-sub" style={{ fontSize: 15 }}>
                      {hc.availability === "NotInstalled"
                        ? "Health Connect isn't set up on this phone yet. Install or update it from the Play Store, sync Samsung Health to it, then come back."
                        : "This phone doesn't support Health Connect, so runs recorded on a watch can't be pulled in automatically."}
                    </span></div>
                  ) : !hc.granted ? (
                    <div className="cell" style={{ flexDirection: "column", alignItems: "stretch", gap: 12 }}>
                      <span className="cell-sub" style={{ fontSize: 15 }}>
                        Runs your watch records reach the phone through its own app (Samsung Health, for
                        example). Give Stride read access and they can be pulled into your history, with the
                        heart rate your watch measured — Stride only ever reads, it never writes anything back.
                      </span>
                      <button onClick={connectHealth} disabled={hcBusy} className="cta tap"
                        style={{ borderRadius: 999, padding: "13px 0", fontSize: 17, opacity: hcBusy ? 0.6 : 1 }}>
                        {hcBusy ? "Waiting for Health Connect…" : "Allow Stride to read workouts"}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="cell" style={{ flexDirection: "column", alignItems: "stretch", gap: 12 }}>
                        <span className="cell-sub" style={{ fontSize: 15 }}>
                          Connected. Stride checks for new watch runs whenever you open it and offers them on
                          the Plan tab. Rides and gym sessions are never imported, walks only if you switch
                          them on below.
                        </span>
                        <button onClick={scanHealth} disabled={hcBusy} className="cta tap"
                          style={{ borderRadius: 999, padding: "13px 0", fontSize: 17, opacity: hcBusy ? 0.6 : 1 }}>
                          {hcBusy ? "Looking…" : "Check now"}
                        </button>
                      </div>

                      {/* Samsung Health logs walking with no input from the user,
                          so this stays off unless it is asked for. Even when on,
                          walks never count towards pace or longest run. */}
                      <Cell icon="run" iconColor={C.easy} title="Also import walks"
                        sub="Your watch records walks by itself, so this is off. Walks that do come in are logged as walks — never counted towards pace, longest run or race predictions."
                        trailing={<Switch on={importWalks} onClick={toggleImportWalks} label="Also import walks" />} />

                      {hcScan && hcScan.ready.length === 0 && !(hcScan.merge || []).length && (
                        <div className="cell rise"><span className="cell-sub" style={{ fontSize: 15 }}>
                          Nothing new from your watch.
                          {hcScan.skipped.length > 0
                            ? ` ${hcScan.skipped.length} workout${hcScan.skipped.length === 1 ? " was" : "s were"} skipped — see below.`
                            : " Health Connect has no workouts from the last 30 days; check that Samsung Health is syncing into it."}
                        </span></div>
                      )}

                      {hcScan && hcScan.ready.map((r) => (
                        <Cell key={r.w.id} icon="watch" iconColor={C.good} title={r.label}
                          sub={`${r.kind === "walk" ? "Walk · " : ""}${r.when.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}${r.entry.hrAvg ? ` · ♥ ${r.entry.hrAvg} bpm` : ""}`}
                          value={
                            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                              <span className="num" style={{ color: C.text, fontWeight: 600 }}>{r.entry.km > 0 ? `${r.entry.km} km` : `${r.entry.min} min`}</span>
                              {r.entry.km > 0 && <span className="t-foot" style={{ color: C.dim }}>{r.entry.min} min</span>}
                            </span>
                          } />
                      ))}

                      {/* The same outing recorded twice — by Stride's GPS and by the
                          watch — becomes one run with the watch's readings in it. */}
                      {hcScan && (hcScan.merge || []).map((m) => (
                        <Cell key={m.w.id} icon="heart" iconColor={C.warn} title="Heart rate for a run you tracked"
                          sub={`${m.label} · ${m.when.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`}
                          value={m.patch.hrAvg ? <span className="num" style={{ color: C.text, fontWeight: 600 }}>{m.patch.hrAvg} bpm</span> : <span className="t-foot">steps</span>} />
                      ))}

                      {/* "5 runs" would be a lie when three of them are walks. */}
                      {hcScan && (hcScan.ready.length > 0 || (hcScan.merge || []).length > 0) && (
                        <div className="cell">
                          <button onClick={() => applyHealthImport()} className="cta tap" style={{ flex: 1, borderRadius: 999, padding: "13px 0", fontSize: 17 }}>
                            {(() => {
                              const n = hcScan.ready.length, mm = (hcScan.merge || []).length;
                              const walks = hcScan.ready.filter((r) => r.kind === "walk").length;
                              const noun = walks === 0 ? "run" : walks === n ? "walk" : "session";
                              if (!n) return `Add heart rate to ${mm} run${mm === 1 ? "" : "s"}`;
                              return `Import ${n} ${noun}${n === 1 ? "" : "s"}${mm ? ` + heart rate for ${mm}` : ""}`;
                            })()}
                          </button>
                        </div>
                      )}

                      {/* Saying why something was skipped costs three lines and
                          saves the user hunting for a bug that isn't there. */}
                      {hcScan && hcScan.skipped.length > 0 && (
                        <div className="cell rise" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
                          <span className="lab" style={{ marginBottom: 4 }}>Skipped</span>
                          {hcScan.skipped.slice(0, 8).map((sk, i) => (
                            <span key={sk.w.id || i} className="t-foot" style={{ display: "flex", gap: 8, color: C.dim }}>
                              <span style={{ flex: 1, minWidth: 0 }}>{sk.label} · {sk.when.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                              <span style={{ flexShrink: 0 }}>{sk.reason}</span>
                            </span>
                          ))}
                          {hcScan.skipped.length > 8 && (
                            <span className="t-foot" style={{ color: C.dim2 }}>…and {hcScan.skipped.length - 8} more.</span>
                          )}
                        </div>
                      )}

                      <Cell icon="external" iconColor={C.good} title="Open Health Connect" chevron onClick={() => { haptic(6); openHealthConnect(); }} />
                    </>
                  )}
                </Group>
              )}

              <Group header="Data & backup"
                footer={<>{isNative()
                  ? "Export opens the share sheet — send the backup file to Drive, email or your new phone, then Import it there."
                  : "Export saves your runs to a file; Import restores them (on a new phone, or a new version of the app)."}
                  {" "}Importing merges with what's already here, so nothing gets wiped. Your data lives only on this device.</>}>
                <Cell icon="download" iconColor={C.blue} title="Export backup" chevron onClick={exportData} />
                <Cell icon="upload" iconColor={C.blue} title="Import backup" chevron onClick={() => importRef.current?.click()} />
                <Cell icon="share" iconColor={C.good} title="Share progress card" chevron onClick={() => openShare(progressShareSpec())} />
              </Group>
              <input ref={importRef} type="file" accept="application/json,.json" style={{ display: "none" }}
                onChange={(e) => { importData(e.target.files[0]); e.target.value = ""; }} />

              {/* Stopwatch — treadmill / no-GPS fallback */}
              <Group header="Treadmill stopwatch" footer="For runs without GPS — log the time on the session afterwards.">
                <div style={{ padding: "20px 16px 18px", textAlign: "center" }}>
                  <div className="num" style={{ fontSize: 64, fontWeight: 300, letterSpacing: "-.02em", lineHeight: 1, color: swRun ? C.text : C.text }}>{fmt(swMs)}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, padding: "0 6px" }}>
                    <button onClick={() => { setSwRun(false); setSwMs(0); haptic(8); }} className="round-btn" disabled={!swMs && !swRun}
                      style={{ background: "var(--fill3)", color: C.text }}>Reset</button>
                    <button onClick={() => { setSwRun((r) => !r); haptic(10); }} className="round-btn"
                      style={swRun ? { background: tint(C.warn, 0.22), color: C.warn } : { background: tint(C.good, 0.22), color: C.good }}>
                      {swRun ? "Stop" : swMs ? "Resume" : "Start"}
                    </button>
                  </div>
                </div>
              </Group>
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
          const avatar = (
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
              <span style={{ width: 22, height: 22, borderRadius: "50%", background: C.grad, color: C.onAccent, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name="sparkles" size={13} />
              </span>
              <span className="t-cap" style={{ color: C.dim, fontWeight: 600 }}>Coach</span>
            </div>
          );
          return (
          <div className="rise">
            <Screen eyebrow={todayLabel} title="Coach"
              sub={coachKey ? "Reads your real numbers · powered by Groq" : "Add a free Groq key to switch it on"}
              trailing={appControls(36)} />

            {!coachKey && (
              <Card className="glow" style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <IconBadge name="sparkles" color={C.purple} size={36} />
                  <span className="t-headline">Switch on your coach</span>
                </div>
                <div className="t-sub" style={{ color: C.dim, marginBottom: 14 }}>
                  Your coach reads every run you've logged and answers from those numbers. Paste a
                  free Groq API key to switch it on — it's stored on this device and never leaves it
                  except to reach Groq.
                </div>
                <label className="lab" htmlFor="groq-key-setup">Groq API key</label>
                <input id="groq-key-setup" className="inp" type={showKey ? "text" : "password"} value={coachKey}
                  onChange={(e) => { saveCoachKey(e.target.value); setKeyCheck(null); }} placeholder="gsk_…"
                  autoComplete="off" autoCorrect="off" spellCheck={false} style={{ marginTop: 7 }} />
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                  <button onClick={() => setShowKey((v) => !v)} className="link" style={{ minHeight: 0 }} aria-pressed={showKey}>{showKey ? "Hide key" : "Show key"}</button>
                  <button onClick={testCoachKey} disabled={keyBusy || !coachKey.trim()} className="btn"
                    style={{ marginLeft: "auto", padding: "8px 16px" }}>
                    {keyBusy ? "Checking…" : "Check key"}
                  </button>
                </div>
                {keyCheck && (
                  <div className="rise t-foot" style={{ marginTop: 10, fontWeight: 600, color: keyCheck.ok ? C.good : C.warn }}>
                    {keyCheck.ok ? "✓ Key works — ask your coach anything." : keyCheck.error}
                  </div>
                )}
                <div className="t-foot" style={{ color: C.dim, marginTop: 11 }}>
                  Get one free at <span style={{ color: C.text, fontWeight: 600 }}>console.groq.com/keys</span>.
                </div>
              </Card>
            )}

            {/* Conversation */}
            <Card style={{ marginBottom: 12, padding: hasChat ? "14px 14px 14px" : 18 }}>
              {hasChat && (
                <div style={{ display: "flex", alignItems: "center", marginBottom: 12, padding: "0 2px" }}>
                  <span className="t-headline">Conversation</span>
                  {coachChat.length > 0 && (
                    <button onClick={clearCoachChat} disabled={coachBusy} className="link" style={{ marginLeft: "auto", minHeight: 0, opacity: coachBusy ? 0.4 : 1 }}>Clear</button>
                  )}
                </div>
              )}
              {!hasChat ? (
                <div style={{ textAlign: "center", padding: "10px 6px 4px" }}>
                  <span style={{ width: 58, height: 58, borderRadius: "50%", background: C.grad, color: C.onAccent, display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: C.glow }}>
                    <Icon name="sparkles" size={28} />
                  </span>
                  <div className="t-title3" style={{ marginTop: 12 }}>
                    {stats.runsLogged ? "Ask about your training" : "Log a run and I'll have something to say"}
                  </div>
                  <div className="t-sub" style={{ color: C.dim, maxWidth: 330, margin: "6px auto 0" }}>
                    {stats.runsLogged
                      ? `I can see your ${stats.runsLogged} logged run${stats.runsLogged === 1 ? "" : "s"}, your paces, your plan and what's coming up.`
                      : "Tick off a session or track a run with GPS, then come back for a read on it."}
                  </div>
                  <button onClick={analyseCoach} disabled={coachBusy} className="cta tap"
                    style={{ marginTop: 18, borderRadius: 999, padding: "13px 24px", fontSize: 17, opacity: coachBusy ? 0.6 : 1 }}>
                    Analyse my training
                  </button>
                </div>
              ) : (
                <div ref={chatBoxRef} style={{
                  display: "flex", flexDirection: "column", gap: 12,
                  maxHeight: "52vh", overflowY: "auto", overscrollBehavior: "contain",
                  margin: "0 -2px", padding: "0 2px",
                }}>
                  {coachChat.map((m, i) => (
                    <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%" }}>
                      {m.role === "assistant" && avatar}
                      <div className={`bubble ${m.role === "user" ? "me" : "them"}`}>{m.display || m.content}</div>
                      {m.role === "assistant" && (
                        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 7, paddingLeft: 4 }}>
                          {m.stopped && <span className="t-cap" style={{ color: C.dim2, fontWeight: 600 }}>Stopped early</span>}
                          {i === coachChat.length - 1 && !coachBusy && (
                            <>
                              <button onClick={async () => { haptic(6); const r = await copyText(m.content); setToast({ icon: r === "copied" ? "📋" : "⚠️", title: r === "copied" ? "Answer copied" : "Couldn't copy", label: "COACH" }); }}
                                className="link" style={{ fontSize: 13, minHeight: 0, display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="copy" size={14} /> Copy</button>
                              <button onClick={retryCoach} className="link" style={{ fontSize: 13, minHeight: 0, display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="refresh" size={14} /> Ask again</button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* the reply as it arrives */}
                  {coachBusy && (
                    <div style={{ alignSelf: "flex-start", maxWidth: "88%" }}>
                      {avatar}
                      <div className="bubble them">
                        {coachStream || <span style={{ color: C.dim }}>Thinking</span>}
                        <span className="caret" style={{ display: "inline-block", width: 7, height: 15, marginLeft: 2, verticalAlign: "-2px", background: C.accent, borderRadius: 2 }} />
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
                <div className="rise" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, padding: "11px 12px 11px 14px", borderRadius: 16, background: tint(C.warn, 0.12) }}>
                  <span className="t-foot" style={{ flex: 1, color: C.text }}>{coachErr}</span>
                  {coachChat.length > 0 && (
                    <button onClick={() => { setCoachErr(""); retryCoach(); }} className="btn" style={{ padding: "7px 14px", fontSize: 14, flexShrink: 0 }}>Retry</button>
                  )}
                </div>
              )}

              {/* Composer — the Messages field: a capsule with its send button
                  inside it. Send turns into Stop while a reply streams. */}
              <div className="composer" style={{ marginTop: 14 }}>
                <input value={coachInput} onChange={(e) => setCoachInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") askCoachInput(); }}
                  placeholder="Ask your coach anything…" disabled={coachBusy} aria-label="Message your coach" />
                <button onClick={coachBusy ? stopCoach : askCoachInput} disabled={!coachBusy && !coachInput.trim()}
                  aria-label={coachBusy ? "Stop the reply" : "Send"} className={coachBusy ? "send stop" : "send"}>
                  <Icon name={coachBusy ? "stop" : "arrowUp"} size={coachBusy ? 13 : 17} weight={2.6} />
                </button>
              </div>

              {/* Contextual one-tap asks — built from this runner's situation */}
              <div className="hscroll" style={{ marginTop: 10 }}>
                {asks.map((q) => (
                  <button key={q.label} onClick={() => sendToCoach(q.text, q.label)} disabled={coachBusy}
                    className="chip" style={{ flexShrink: 0 }}>
                    {q.label}
                  </button>
                ))}
                {coachChat.length > 0 && (
                  <button onClick={analyseCoach} disabled={coachBusy} className="chip" style={{ flexShrink: 0, color: C.accent }}>Re-analyse</button>
                )}
              </div>
            </Card>

            {/* Plan tools */}
            <Card style={{ marginBottom: 12 }}>
              <Label>Your training plan</Label>
              <div className="t-sub" style={{ color: C.dim, marginBottom: 14 }}>
                Build a fresh block when you've smashed your goal, or re-tune the sessions you
                haven't started yet from the too easy / too hard feedback you leave on completed
                days. Nothing you've logged is lost either way.
              </div>

              {proposedPlan && (() => {
                const newWeeks = proposedPlan.weeks.slice(proposedPlan.fromIdx);
                const verb = proposedPlan.mode === "adapt" ? "adjusted" : "new";
                return (
                  <div className="rise well" style={{ padding: "14px 14px 12px", marginBottom: 12, boxShadow: `inset 0 0 0 1px ${tint(C.accent, 0.4)}` }}>
                    <div className="t-foot" style={{ color: C.accent, fontWeight: 700, marginBottom: 10 }}>Proposed — {newWeeks.length} {verb} week{newWeeks.length === 1 ? "" : "s"}</div>
                    {newWeeks.map((w) => {
                      const km = w.days.reduce((sum, d) => sum + (d.km || 0), 0);
                      return (
                        <div key={w.n} style={{ marginBottom: 10 }}>
                          <div className="t-sub" style={{ fontWeight: 600 }}>
                            Week {w.n} · {w.label} <span className="num" style={{ color: C.dim, fontWeight: 500 }}>· {km.toFixed(1)} km</span>
                          </div>
                          <div className="t-foot" style={{ color: C.dim, marginTop: 2 }}>
                            {w.days.map((d) => `${d.d} ${d.km ? d.title : "rest"}`).join(" · ")}
                          </div>
                        </div>
                      );
                    })}
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button onClick={applyProposedPlan} className="cta tap" style={{ flex: 1, borderRadius: 999, padding: "12px 0", fontSize: 16 }}>
                        {proposedPlan.mode === "adapt" ? "Update my plan" : "Add to my plan"}
                      </button>
                      <button onClick={() => setProposedPlan(null)} className="btn">Discard</button>
                    </div>
                  </div>
                );
              })()}

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button onClick={generatePlan} disabled={planBusy || coachBusy} className="btn tinted" style={{ flex: 1, whiteSpace: "nowrap" }}>
                  {planBusy ? "Working…" : proposedPlan && proposedPlan.mode !== "adapt" ? "Regenerate block" : "Build my next block"}
                </button>
                <button onClick={adaptPlan} disabled={planBusy || coachBusy} className="btn" style={{ flex: 1, whiteSpace: "nowrap" }}>
                  Adjust upcoming
                </button>
                {isCustomPlan && (
                  <button onClick={resetPlan} disabled={planBusy} className="btn danger" style={{ flex: "1 1 100%" }}>Reset to the default plan</button>
                )}
              </div>
            </Card>

            {/* Coach setup */}
            <Group header="Coach setup">
              <div className="cell" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                <label className="t-foot" htmlFor="coach-goal" style={{ color: C.dim, fontWeight: 600 }}>What I'm training for</label>
                <input id="coach-goal" className="inp" value={coachGoal} onChange={(e) => saveCoachGoal(e.target.value)} placeholder={DEFAULT_GOAL} />
              </div>
            </Group>
            <Group header="Model" footer="Any model id Groq serves works. Their free line-up changes, so this list will go stale — use another model below if it does.">
              {MODELS.map((m) => {
                const active = (coachModel.trim() || DEFAULT_MODEL) === m.id;
                return (
                  <Cell key={m.id} icon="cpu" iconColor={active ? C.purple : C.gray} title={m.name} sub={m.note}
                    onClick={() => { saveCoachModel(m.id); setKeyCheck(null); haptic(5); }}
                    trailing={<span style={{ width: 20, display: "flex", justifyContent: "flex-end", color: C.accent }}>{active && <Icon name="check" size={18} weight={2.6} />}</span>} />
                );
              })}
              <details className="cell-details">
                <summary className="cell tappable" style={{ "--inset": "60px" }}>
                  <IconBadge name="text" color={C.gray} />
                  <span className="cell-main"><span className="cell-title">Use another model</span></span>
                  <span className="cell-chev"><Icon name="chevron" size={15} weight={2.4} /></span>
                </summary>
                <div style={{ padding: "0 16px 14px 60px" }}>
                  <input className="inp" value={coachModel} onChange={(e) => { saveCoachModel(e.target.value); setKeyCheck(null); }}
                    placeholder={DEFAULT_MODEL} autoComplete="off" spellCheck={false} aria-label="Model id" />
                </div>
              </details>
            </Group>

            {coachKey && (
              <Group header="Groq API key" footer="Stored only on this device and sent straight to Groq — no server in between. It is stripped from backup files, so exporting never leaks it.">
                <div className="cell" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
                  <input className="inp" type={showKey ? "text" : "password"} value={coachKey}
                    onChange={(e) => { saveCoachKey(e.target.value); setKeyCheck(null); }} placeholder="gsk_…"
                    autoComplete="off" autoCorrect="off" spellCheck={false} aria-label="Groq API key" />
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <button onClick={() => setShowKey((v) => !v)} className="link" style={{ minHeight: 0 }} aria-pressed={showKey}>{showKey ? "Hide key" : "Show key"}</button>
                    <button onClick={testCoachKey} disabled={keyBusy} className="btn" style={{ marginLeft: "auto", padding: "8px 16px" }}>
                      {keyBusy ? "Checking…" : "Check key"}
                    </button>
                  </div>
                  {keyCheck && (
                    <div className="rise t-foot" style={{ fontWeight: 600, color: keyCheck.ok ? C.good : C.warn }}>
                      {keyCheck.ok ? "✓ Key works." : keyCheck.error}
                    </div>
                  )}
                </div>
              </Group>
            )}
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
            <Screen eyebrow={todayLabel} title="History"
              sub={history.length ? `${shown.length} session${shown.length === 1 ? "" : "s"} · ${shownKm.toFixed(1)} km${shownMin ? ` · ${fmtMin(shownMin)}` : ""}` : "Every session you tick off lands here"}
              trailing={appControls(36)} />

            {history.length > 0 && (
              <Segmented
                items={[{ id: "all", label: "All" }, { id: "run", label: "Runs" }, ...(anyWalks ? [{ id: "walk", label: "Walks" }] : []), { id: "gps", label: "GPS" }]}
                value={histFilter} onChange={setHistFilter} style={{ marginBottom: 16 }} />
            )}

            {history.length === 0 ? (
              <Card style={{ textAlign: "center", padding: "34px 20px" }}>
                <span style={{ width: 64, height: 64, borderRadius: "50%", background: tint(C.accent, 0.14), color: C.accent, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name="run" size={32} weight={2.1} />
                </span>
                <div className="t-title3" style={{ marginTop: 14 }}>No runs logged yet</div>
                <div className="t-sub" style={{ color: C.dim, marginTop: 6 }}>Track a run with GPS, or tick off a day on the Plan tab, and it'll show up here.</div>
                <button onClick={() => { haptic(12); setTrackerOpen(true); }} className="cta tap"
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 18, borderRadius: 999, padding: "13px 24px", fontSize: 17 }}>
                  <Icon name="play" size={16} /> Track your first run
                </button>
              </Card>
            ) : shown.length === 0 ? (
              <Card style={{ textAlign: "center", padding: 24 }}>
                <div className="t-sub" style={{ color: C.dim }}>Nothing matches this filter yet.</div>
              </Card>
            ) : (
              <div style={{ display: "grid", gap: 14 }}>
                {shown.map((h, idx) => {
                  const pSec = paceSec(h.e.min, h.e.km);
                  const km = parseFloat(h.e.km) || 0;
                  const walk = h.e.activity === "walk";
                  const date = h.e.date ? new Date(h.e.date).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) : "—";
                  const hasRoute = h.e.route && h.e.route.length > 1;
                  const dur = h.e.durMs > 0 ? fmtClock(h.e.durMs) : parseFloat(h.e.min) > 0 ? fmtClock(parseFloat(h.e.min) * 60000) : null;
                  const metrics = [
                    dur && { label: "Time", value: dur, color: C.yellow },
                    pSec > 0 && { label: "Avg pace", value: fmtPace(pSec), unit: "/km", color: C.cyan },
                    h.e.kcal > 0 && { label: "Energy", value: h.e.kcal, unit: "kcal", color: C.pink },
                    h.e.elev > 0 && { label: "Elevation", value: `+${h.e.elev}`, unit: "m", color: C.good },
                    h.e.hrAvg > 0 && { label: "Avg heart rate", value: h.e.hrAvg, unit: "bpm", color: C.warn },
                    h.e.hrMax > 0 && { label: "Max heart rate", value: h.e.hrMax, unit: "bpm", color: C.warn },
                    h.e.cadence > 0 && { label: "Cadence", value: h.e.cadence, unit: "spm", color: C.purple },
                    h.e.runKm > 0 && { label: "Running", value: h.e.runKm, unit: "km", color: C.accent },
                    h.e.walkKm > 0 && { label: "Walking", value: h.e.walkKm, unit: "km", color: C.easy },
                  ].filter(Boolean);
                  return (
                    <div key={h.key} className="card" style={{ padding: 0, overflow: "hidden", animation: "rise .34s cubic-bezier(.2,.8,.2,1) both", animationDelay: `${Math.min(idx * 0.04, 0.3)}s` }}>
                      {hasRoute && (
                        <div style={{ position: "relative" }}>
                          <LiveMap points={h.e.route} height={172} interactive={false} radius={0} />
                          <button onClick={() => { haptic(8); setReplayRun({ route: h.e.route, km: h.e.km, durMs: h.e.durMs }); }}
                            className="glass" style={{ position: "absolute", bottom: 10, right: 10, zIndex: 500, borderRadius: 999, padding: "7px 14px", minHeight: 0, color: C.text, fontSize: 14, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                            <Icon name="play" size={13} /> Replay
                          </button>
                        </div>
                      )}

                      <div style={{ padding: "14px 16px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <span style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: tint(walk ? C.easy : C.accent, 0.16), color: walk ? C.easy : C.accent }}>
                            <Icon name="run" size={22} weight={2.1} />
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {/* A watch run that landed on a rest day is a run, not "Rest". */}
                            <div className="t-headline" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {h.e.imported && h.type === "rest" ? h.e.hcLabel || (walk ? "Walk" : "Run") : h.title}
                            </div>
                            <div className="t-foot" style={{ color: C.dim, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <span>{date} · Week {h.week}</span>
                              {/* A walk is a session, but it is not a run, and the
                                  card has to say so — otherwise a 12 km amble the
                                  watch logged on its own reads as training. */}
                              {walk && <span className="tag" style={{ color: C.easy, background: tint(C.easy, 0.16) }}>Walk</span>}
                              {h.e.tracked && <span className="tag" style={{ color: C.accent, background: tint(C.accent, 0.14) }}>GPS</span>}
                              {h.e.imported && !h.e.tracked && (
                                <span className="tag" style={{ color: C.good, background: tint(C.good, 0.14) }}>
                                  {h.e.hcSource === "com.sec.android.app.shealth" ? "Samsung Health" : "Imported"}
                                </span>
                              )}
                            </div>
                          </div>
                          {h.e.feel ? <span style={{ fontSize: 24, flexShrink: 0 }} aria-label={`Felt ${h.e.feel} of 5`}>{FEELS[h.e.feel - 1]}</span> : null}
                        </div>

                        {km > 0 && (
                          <div className="num" style={{ fontSize: 40, fontWeight: 700, lineHeight: 1, color: walk ? C.easy : C.accent, margin: "14px 0 2px" }}>
                            {km}<span style={{ fontSize: 20, marginLeft: 2 }}>KM</span>
                          </div>
                        )}

                        {metrics.length > 0 && <MetricGrid items={metrics} size={24} />}

                        {h.e.hrSource === "watch" && (
                          <div className="t-foot" style={{ color: C.dim, marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                            <Icon name="watch" size={14} /> Heart rate from your watch, via Health Connect
                          </div>
                        )}

                        {h.e.stitch && (
                          <div className="t-foot" style={{ color: C.warn, fontWeight: 600, marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
                            <Icon name="bolt" size={14} /> Side stitch on this one
                          </div>
                        )}

                        {h.e.note && (
                          <div className="t-sub" style={{ color: C.dim, marginTop: 10, paddingLeft: 12, borderLeft: `3px solid ${tint(C.accent, 0.5)}` }}>{h.e.note}</div>
                        )}

                        {h.e.splits && h.e.splits.length > 0 && (
                          <div style={{ marginTop: 14 }}>
                            <div className="lab" style={{ marginBottom: 8 }}>Splits</div>
                            <div className="hscroll">
                              {h.e.splits.map((s, i) => (
                                <span key={i} className="split">
                                  <span className="t-cap2" style={{ color: C.dim }}>km {i + 1}</span>
                                  <span className="num" style={{ fontSize: 15, fontWeight: 600, color: s === Math.min(...h.e.splits) ? C.cyan : C.text }}>{fmtPace(s)}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {km > 0 && (
                          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                            <button onClick={() => openShare(runShareSpec(h))} className="btn tinted" style={{ flex: 1, padding: "11px 0" }}>
                              <Icon name="share" size={17} /> Share
                            </button>
                            <button onClick={() => coachThisRun(h)} disabled={runFeedbackBusy === h.key} className="btn" style={{ flex: 1.3, padding: "11px 0", whiteSpace: "nowrap" }}>
                              <Icon name="sparkles" size={16} />
                              {runFeedbackBusy === h.key ? "Reading…" : runFeedback[h.key] ? "Ask again" : `Coach this ${walk ? "walk" : "run"}`}
                            </button>
                          </div>
                        )}

                        {runFeedback[h.key] && (
                          <div className="rise bubble them" style={{ marginTop: 12, maxWidth: "100%" }}>
                            {runFeedback[h.key]}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          );
        })()}

        {tab === "plan" && (
          <div className="rise">
            <Screen eyebrow={todayLabel} title={screenTitle}
              sub={startDate && todayIdx >= 0 && todayIdx < TOTAL
                ? `${schedule} · ${countdown}`
                : hero ? `${schedule} · Week ${hero.week}, ${WEEKS.find((w) => w.n === hero.week)?.label}` : "Every session ticked off"}
              trailing={appControls(36)} />

            {/* Notifications being off is not a settings-screen detail — it is
                the reason the reminders and run alerts the user switched on are
                never arriving, so it is said here, where they actually look. */}
            {(isNative() || notificationsSupported()) && perm !== "granted" && (
              <Group style={{ marginBottom: 14 }}>
                <Cell icon="bell" iconColor={C.warn} title="Notifications are off" sub="Reminders and run alerts can't reach you. Tap to fix." chevron onClick={goToNotifications} />
              </Group>
            )}

            {/* What the watch recorded since last time, one tap from the plan. */}
            {(() => {
              if (!hcScan) return null;
              const ready = hcScan.ready.filter((r) => !hcDismissed.has(r.w.id));
              const merges = (hcScan.merge || []).filter((m) => !hcDismissed.has(m.w.id));
              if (!ready.length && !merges.length) return null;
              const n = ready.length;
              const walks = ready.filter((r) => r.kind === "walk").length;
              const noun = walks === 0 ? "run" : walks === n ? "walk" : "session";
              const first = ready[0];
              const title = n
                ? `${n} new ${noun}${n === 1 ? "" : "s"} from your watch`
                : `Heart rate from your watch for ${merges.length} run${merges.length === 1 ? "" : "s"}`;
              const sub = n
                ? `${first.label} · ${first.when.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}${first.entry.km > 0 ? ` · ${first.entry.km} km` : ""}${n > 1 ? ` and ${n - 1} more` : ""}${merges.length ? ` · plus heart rate for ${merges.length} tracked run${merges.length === 1 ? "" : "s"}` : ""}`
                : "Your watch recorded the runs you tracked with Stride — add its readings to them.";
              return (
                <Group style={{ marginBottom: 14 }}>
                  <div className="cell rise" style={{ alignItems: "flex-start" }}>
                    <IconBadge name="watch" color={C.good} />
                    <span className="cell-main">
                      <span className="cell-title" style={{ fontWeight: 600 }}>{title}</span>
                      <span className="cell-sub">{sub}</span>
                      <span style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button onClick={() => applyHealthImport({ ready, merge: merges })} className="cta tap"
                          style={{ borderRadius: 999, padding: "8px 18px", fontSize: 15, minHeight: 0 }}>
                          {n ? "Import" : "Add heart rate"}
                        </button>
                        <button onClick={() => dismissWatchItems([...ready, ...merges])} className="btn" style={{ padding: "8px 16px", fontSize: 15, minHeight: 0 }}>
                          Not now
                        </button>
                      </span>
                    </span>
                  </div>
                </Group>
              );
            })()}

            {/* Today / next-up hero — the screen's centre of gravity */}
            {hero ? (
              <div className="card accented" style={{ padding: "18px 18px 18px", marginBottom: 14, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="pill" style={{ background: C.accent, color: C.onAccent }}>{heroIdx >= 0 ? "Today" : "Next up"}</span>
                  <span className="t-foot" style={{ fontWeight: 600, color: typeColor(hero.type), display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 7, background: typeColor(hero.type) }} />
                    {hero.type === "run" ? "Run" : hero.type === "easy" ? "Easy" : "Rest"}
                  </span>
                  <span className="t-foot" style={{ color: C.dim }}>· Week {hero.week} · {hero.d.charAt(0) + hero.d.slice(1).toLowerCase()}</span>
                  {heroIdx >= 0 && (
                    <span className="t-foot" style={{ marginLeft: "auto", color: C.dim }}>
                      {dateForDay(startDate, heroIdx).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  )}
                </div>

                <div className="t-title1" style={{ margin: "12px 0 4px", color: heroEntry.done ? C.dim : C.text }}>
                  {hero.title}
                </div>
                <div className="t-sub" style={{ color: C.dim }}>{hero.detail}</div>

                {hero.km > 0 && (
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 22, marginTop: 16, paddingTop: 14, borderTop: "0.5px solid var(--sep)" }}>
                    <Metric label="Target" value={hero.km} unit="km" color={C.accent} size={30} />
                    {heroIdx >= 0 && <Metric label="Day" value={heroIdx + 1} unit={`/${TOTAL}`} size={30} />}
                    {heroEntry.km > 0 && <div style={{ marginLeft: "auto" }}><Metric label="Logged" value={parseFloat(heroEntry.km)} unit="km" color={C.good} size={30} align="right" /></div>}
                  </div>
                )}

                {/* On a rest day the session *is* not running, so offering
                    "Start GPS run" as the primary action would be telling the
                    user to ignore their own plan. Tick it off instead. */}
                <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                  {hero.type === "rest" ? (
                    <>
                      <button onClick={() => update(hero.key, { done: !heroEntry.done })} className="cta tap"
                        style={{ flex: 1.4, borderRadius: 999, padding: "15px 0", fontSize: 17, opacity: heroEntry.done ? 0.8 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                        {heroEntry.done ? <><Icon name="check" size={18} weight={2.6} /> Rest day done</> : "Mark rest day done"}
                      </button>
                      <button onClick={() => { haptic(12); setTrackerOpen(true); }} className="btn" style={{ flex: 1, padding: "15px 0", fontSize: 17 }}>
                        <Icon name="play" size={15} /> Run anyway
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { haptic(12); setTrackerOpen(true); }} className="cta tap"
                        style={{ flex: 1.4, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 999, padding: "15px 0", fontSize: 17 }}>
                        <Icon name="play" size={17} /> Start run
                      </button>
                      <button onClick={() => update(hero.key, { done: !heroEntry.done })} className={`btn${heroEntry.done ? " tinted" : ""}`}
                        style={{ flex: 1, padding: "15px 0", fontSize: 17 }}>
                        {heroEntry.done ? <><Icon name="check" size={18} weight={2.6} /> Done</> : "Mark done"}
                      </button>
                    </>
                  )}
                </div>

                {heroEntry.done && nextUp && nextUp.key !== hero.key && (
                  <div className="t-foot" style={{ color: C.dim, marginTop: 14 }}>
                    Next up: Week {nextUp.week} · {nextUp.d.charAt(0) + nextUp.d.slice(1).toLowerCase()} · {nextUp.title}
                  </div>
                )}
              </div>
            ) : (
              <div className="card glow" style={{ padding: "26px 20px 22px", marginBottom: 14, textAlign: "center" }}>
                <div style={{ fontSize: 46 }}>🎖️</div>
                <div className="t-title2" style={{ marginTop: 8 }}>Mission complete</div>
                <div className="t-sub" style={{ color: C.dim, marginTop: 6 }}>You finished every session. Keep the momentum — let your coach build what's next.</div>
                <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: 18 }}>
                  <button onClick={() => { haptic(12); setTab("coach"); generatePlan(); }} disabled={planBusy} className="cta tap"
                    style={{ display: "inline-flex", alignItems: "center", gap: 7, borderRadius: 999, padding: "13px 22px", fontSize: 17, opacity: planBusy ? 0.6 : 1 }}>
                    <Icon name="sparkles" size={17} /> {planBusy ? "Building…" : "Build my next block"}
                  </button>
                  <button onClick={() => { haptic(12); setTrackerOpen(true); }} className="btn" style={{ padding: "13px 20px", fontSize: 17 }}>
                    <Icon name="play" size={15} /> Victory run
                  </button>
                </div>
              </div>
            )}

            {/* Goal countdown — the target that comes after this block */}
            {goalDate && goalDays != null && goalDays >= 0 && goal && (
              <Group style={{ marginBottom: 14 }}>
                <Cell icon="flag" iconColor={C.orange}
                  title={goalDays === 0 ? `${goal.name} — race day is today` : `${goal.name} in ${goalDays} day${goalDays === 1 ? "" : "s"}`}
                  sub={goalPrediction ? `On track for ${fmtDuration(goalPrediction.sec)}` : "Log a timed run for a prediction"}
                  value={<span className="num" style={{ color: goalReady >= 100 ? C.good : C.dim, fontWeight: 600 }}>{goalReady}%</span>}
                  chevron onClick={() => { setTab("stats"); setStatsView("goal"); haptic(6); }} />
              </Group>
            )}

            {/* Secondary actions — one row, so the hero keeps its single CTA */}
            <div style={{ display: "flex", gap: 10, marginBottom: 28 }}>
              {[
                { icon: "map", color: C.blue, label: "Plan a route", onClick: () => { haptic(10); setRouteMakerOpen(true); } },
                { icon: "sparkles", color: C.purple, label: "Ask the coach", onClick: () => { haptic(8); setTab("coach"); } },
                { icon: "calendar", color: C.warn, label: startDate ? "Schedule" : "Set start date", onClick: () => { haptic(8); setTab("stats"); setStatsView("charts"); } },
              ].map((a) => (
                <button key={a.label} onClick={a.onClick} className="card tap"
                  style={{ flex: 1, border: "none", padding: "14px 6px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, cursor: "pointer", color: C.text }}>
                  <span style={{ width: 40, height: 40, borderRadius: "50%", background: tint(a.color, 0.18), color: a.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon name={a.icon} size={20} weight={2} />
                  </span>
                  <span className="t-foot" style={{ fontWeight: 600, textAlign: "center" }}>{a.label}</span>
                </button>
              ))}
            </div>

            {WEEKS.map((w) => {
              const wDone = w.days.filter((_, i) => log[`w${w.n}d${i}`] && log[`w${w.n}d${i}`].done).length;
              const weekDone = wDone === w.days.length;
              const collapsed = weekDone && !openWeeks[w.n];
              const weekKm = w.days.reduce((sum, d) => sum + (d.km || 0), 0);
              return (
                <section key={w.n} className="stagger" style={{ marginBottom: 24, animationDelay: `${Math.min((w.n - 1) * 0.05, 0.3)}s` }}>
                  <div className={weekDone ? "week-head tap" : "week-head"} role={weekDone ? "button" : undefined}
                    aria-expanded={weekDone ? !collapsed : undefined}
                    onClick={() => { if (weekDone) { setOpenWeeks((o) => ({ ...o, [w.n]: !o[w.n] })); haptic(5); } }}>
                    <span className="t-title3" style={{ color: weekDone ? C.accent : C.text, flexShrink: 0 }}>Week {w.n}</span>
                    <span className="t-sub" style={{ color: C.dim, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.label}</span>
                    <span className="num t-foot" style={{ marginLeft: "auto", color: C.dim, flexShrink: 0 }}>{weekKm.toFixed(0)} km</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <Rings size={22} stroke={3.6} rings={[{ pct: (wDone / w.days.length) * 100, color: C.accent, color2: C.accent2 }]} label={`${wDone} of ${w.days.length} done`} />
                      {weekDone
                        ? <span style={{ color: C.dim, display: "flex", transform: collapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform .3s cubic-bezier(.3,.8,.3,1)" }}><Icon name="chevron" size={15} weight={2.4} /></span>
                        : <span className="num t-foot" style={{ color: C.text, fontWeight: 600 }}>{wDone}/{w.days.length}</span>}
                    </span>
                  </div>
                  {!collapsed && <div className="grp-body">
                    {w.days.map((day, di) => {
                      const key = `w${w.n}d${di}`;
                      const e = log[key] || {};
                      const isOpen = open === key;
                      const flatIdx = (w.n - 1) * 7 + di;
                      const isToday = flatIdx === todayIdx;
                      const col = typeColor(day.type);
                      return (
                        <div key={di} className="sep" style={{ "--inset": "56px" }}>
                          <div className="day-row" role="button" tabIndex={0} aria-expanded={isOpen}
                            onClick={() => { setOpen(isOpen ? null : key); haptic(5); }}
                            onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setOpen(isOpen ? null : key); } }}
                            style={isToday ? { background: `linear-gradient(90deg, ${tint(C.accent, 0.1)}, transparent 70%)` } : undefined}>
                            <button onClick={(ev) => { ev.stopPropagation(); update(key, { done: !e.done }); }}
                              className={`tick${e.done ? " pop" : ""}`}
                              aria-label={e.done ? `Mark ${day.title} not done` : `Mark ${day.title} done`}
                              style={e.done ? { borderColor: col, background: col } : undefined}>
                              {e.done && <Icon name="check" size={15} weight={3} />}
                            </button>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                <span className="t-cap" style={{ fontWeight: 700, letterSpacing: ".03em", color: isToday ? C.accent : col, flexShrink: 0 }}>{day.d}</span>
                                <span className="t-body" style={{ fontWeight: 500, color: e.done ? C.dim : C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{day.title}</span>
                              </div>
                              <div className="t-foot" style={{ color: C.dim, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{day.detail}</div>
                            </div>
                            {isToday
                              ? <span className="pill" style={{ background: C.accent, color: C.onAccent, flexShrink: 0 }}>Today</span>
                              : day.km > 0
                                ? <span className="num" style={{ fontSize: 15, fontWeight: 600, color: e.done ? col : C.dim, flexShrink: 0 }}>{day.km}<span style={{ fontSize: 11, marginLeft: 1 }}>KM</span></span>
                                : <span style={{ color: C.rest, flexShrink: 0, display: "flex" }} aria-label="Rest"><Icon name="moon" size={17} /></span>}
                            <span style={{ color: C.dim2, display: "flex", flexShrink: 0, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .3s cubic-bezier(.3,.8,.3,1)" }}>
                              <Icon name="chevron" size={14} weight={2.4} />
                            </span>
                          </div>

                          {isOpen && (
                            <div className="rise day-editor">
                              <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                                <label style={{ flex: 1 }}>
                                  <span className="lab" style={{ display: "block", marginBottom: 6 }}>Distance · km</span>
                                  <input className="inp num" type="number" inputMode="decimal" placeholder={String(day.km || 0)} value={e.km ?? ""} onChange={(ev) => update(key, { km: ev.target.value })} />
                                </label>
                                <label style={{ flex: 1 }}>
                                  <span className="lab" style={{ display: "block", marginBottom: 6 }}>Time · min</span>
                                  <input className="inp num" type="number" inputMode="numeric" placeholder="—" value={e.min ?? ""} onChange={(ev) => update(key, { min: ev.target.value })} />
                                </label>
                              </div>
                              {fmtPace(paceSec(e.min, e.km)) && (
                                <div className="t-sub" style={{ color: C.cyan, fontWeight: 600, marginBottom: 12 }}>
                                  <span className="num">{fmtPace(paceSec(e.min, e.km))}</span> /km pace
                                </div>
                              )}
                              <div className="editor-row">
                                <span>Side stitch</span>
                                <span style={{ marginLeft: "auto", display: "flex" }}>
                                  <Switch on={!!e.stitch} onClick={() => update(key, { stitch: !e.stitch })} label="Side stitch hit" />
                                </span>
                              </div>
                              <div className="editor-row">
                                <span>Effort felt</span>
                                <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
                                  {FEELS.map((f, i) => {
                                    const sel = e.feel === i + 1;
                                    return (
                                      <button key={i} onClick={() => update(key, { feel: sel ? null : i + 1 })} aria-label={`Effort ${i + 1} of 5`} aria-pressed={sel}
                                        style={{ width: 38, height: 38, minHeight: 38, borderRadius: "50%", border: "none", background: sel ? tint(C.accent, 0.22) : "transparent", boxShadow: sel ? `inset 0 0 0 1.5px ${C.accent}` : "none", fontSize: 20, cursor: "pointer", opacity: !e.feel || sel ? 1 : 0.4, padding: 0 }}>
                                        {f}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <div style={{ margin: "2px 0 14px" }}>
                                <div style={{ fontSize: 15, marginBottom: 8 }}>Session was</div>
                                <div style={{ display: "flex", gap: 6 }}>
                                  {[["easy", "Too easy"], ["ok", "Just right"], ["hard", "Too hard"]].map(([v, lbl]) => {
                                    const sel = e.cal === v;
                                    const tone = v === "hard" ? C.warn : v === "easy" ? C.easy : C.accent;
                                    return (
                                      <button key={v} onClick={() => update(key, { cal: sel ? null : v })} aria-pressed={sel} className="chip"
                                        style={{ flex: 1, fontSize: 14, padding: "8px 4px", whiteSpace: "nowrap", background: sel ? tone : undefined, color: sel ? C.onAccent : C.text }}>
                                        {lbl}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <input className="inp" placeholder="How did it feel? Add a note" value={e.note ?? ""} onChange={(ev) => update(key, { note: ev.target.value })} aria-label="Note" />
                              {e.cal && <div className="t-foot" style={{ color: C.dim, marginTop: 10 }}>The coach uses this — “Adjust upcoming” on the Coach tab re-tunes your next sessions.</div>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>}
                </section>
              );
            })}

            <Group>
              <Cell icon="target" iconColor={C.orange} title="Beat the side stitch" onClick={() => { setTipsOpen((o) => !o); haptic(6); }}
                trailing={<span style={{ color: C.dim2, display: "flex", transform: tipsOpen ? "rotate(90deg)" : "none", transition: "transform .3s cubic-bezier(.3,.8,.3,1)" }}><Icon name="chevron" size={15} weight={2.4} /></span>} />
              {tipsOpen && (
                <div className="rise sep" style={{ "--inset": "60px", padding: "12px 16px 14px 60px" }}>
                  {[
                    ["Belly breathing.", "Deep into your stomach, not shallow into the chest — your #1 weapon."],
                    ["Exhale on the opposite foot", "to the stitch side."],
                    ["No food 2–3h before.", "Don't chug water right before either."],
                    ["Slow down", "to a pace where you could still talk."],
                  ].map(([b, t]) => (
                    <p key={b} className="t-sub" style={{ margin: "0 0 8px", color: C.dim }}><b style={{ color: C.text, fontWeight: 600 }}>{b}</b> {t}</p>
                  ))}
                </div>
              )}
              <Cell icon="heart" iconColor={C.pink} title="Listen to your body"
                sub="Muscle soreness is normal. Sharp joint or shin pain means stop and rest 1–2 days. Don't arrive injured." />
            </Group>

            {/* Wiping every session is the one irreversible thing on this
                screen, so it takes two taps, and says what it will do. */}
            <Group>
              <Cell title={resetArmed ? "Tap again to erase every session" : "Reset all progress"} danger
                sub={resetArmed ? "This can't be undone. Export a backup first if in doubt." : null}
                onClick={armReset} style={{ justifyContent: "center" }} />
            </Group>
          </div>
        )}

        {!loaded && <div className="t-foot" style={{ color: C.dim, marginTop: 12 }}>Loading…</div>}
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
            <span style={{ width: 64, height: 64, borderRadius: "50%", background: tint(C.warn, 0.16), color: C.warn, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="location" size={28} />
            </span>
            <div className="t-title3">Run tracker hit a snag</div>
            <div className="t-sub" style={{ color: C.dim, maxWidth: 320 }}>
              Couldn't start the GPS tracker. Nothing was lost — head back and try again.
            </div>
            <pre style={{ maxWidth: 340, width: "100%", overflow: "auto", textAlign: "left", fontSize: 12, background: C.surface, borderRadius: 14, padding: 12, color: C.warn, whiteSpace: "pre-wrap", margin: 0 }}>{err?.message || String(err)}</pre>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setTrackerOpen(false)} className="btn" style={{ padding: "13px 24px", fontSize: 17 }}>Back</button>
              <button onClick={() => window.location.reload()} className="cta" style={{ padding: "13px 24px", fontSize: 17, borderRadius: 999 }}>Reload</button>
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

// A personal record's value: the number, a quiet unit, or a dash for "not yet".
function PBValue({ v, unit }) {
  if (v == null || v === "") return <span style={{ color: C.dim2 }}>—</span>;
  return (
    <span className="num" style={{ color: C.text, fontWeight: 600 }}>
      {v}<span style={{ fontSize: 13, color: C.dim, marginLeft: 3, fontWeight: 500 }}>{unit}</span>
    </span>
  );
}
