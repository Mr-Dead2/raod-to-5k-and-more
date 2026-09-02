import React, { useState, useEffect, useRef, useMemo } from "react";
import { shareRunCard } from "./share.js";
import { RouteReplay } from "./components/RouteReplay.jsx";
import { RouteMaker } from "./components/RouteMaker.jsx";
import { WEEKS, FLAT, TOTAL, DEFAULT_WEEKS, C, typeColor, ACCENTS, applyAccent, applyPlan, tint } from "./data.js";
import { extendPlan, planSplit, adaptedPlan } from "./plan.js";
import { loadLog, saveLog, loadSettings, saveSettings } from "./storage.js";
import { WeeklyBars, CumulativeArea, StreakGrid, PaceTrend } from "./components/Charts.jsx";
import { LiveMap } from "./components/LiveMap.jsx";
import { BottomNav } from "./components/BottomNav.jsx";
import { RunTracker } from "./components/RunTracker.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { ACHIEVEMENTS, unlockedIds } from "./achievements.js";
import { buildSummary, askCoach, generatePlanBlock, adaptPlanBlock, coachRun, ANALYSE_PROMPT, QUICK_ASKS, DEFAULT_MODEL, DEFAULT_GOAL } from "./coach.js";
import { haptic, confetti } from "./celebrate.js";
import {
  notificationsSupported, permission, loadReminder, saveReminder,
  enableReminders, disableReminders, showReminderNow, syncMessage,
  startForegroundScheduler, sendTestNotification, notifyMilestone,
} from "./notifications.js";
import {
  RACES, raceById, bestReference, predictAll, readiness, daysUntil,
  fmtDuration, CONFIDENCE_LABEL, DEFAULT_GOAL_RACE,
} from "./goals.js";
import {
  isNative, nativeEnableReminder, nativeDisableReminder, nativeUpdateReminder,
  ensureLocationPermission, styleStatusBar, nativeShareBackup,
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [toast, setToast] = useState(null);
  const [trackerOpen, setTrackerOpen] = useState(false);
  const [accent, setAccent] = useState("lime");
  const [histFilter, setHistFilter] = useState("all"); // all | run | gps
  const [openWeeks, setOpenWeeks] = useState({}); // completed weeks expanded by tap
  const [replayRun, setReplayRun] = useState(null); // run object being replayed
  const [routeMakerOpen, setRouteMakerOpen] = useState(false);
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
    if (Array.isArray(s.coachChat)) setCoachChat(s.coachChat);
    else if (s.coachLast?.text) setCoachChat([{ role: "assistant", content: s.coachLast.text }]); // migrate old single reply
    setLoaded(true);
    (async () => {
      const r = await loadReminder();
      setRemOn(!!r.enabled);
      setRemTime(r.time || "18:00");
      setNotif({ runLive: r.runLive !== false, runKm: r.runKm !== false, runInterval: r.runInterval !== false, runFinish: r.runFinish !== false, milestone: r.milestone !== false, skipRest: !!r.skipRest });
    })();
    if (notificationsSupported()) setPerm(permission());
    // native app setup (no-ops on the web)
    styleStatusBar();
    ensureLocationPermission();
  }, []);

  useEffect(() => {
    const h = (e) => { e.preventDefault(); setInstallEvt(e); };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

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
  };
  const testNotification = async () => {
    const ok = await sendTestNotification();
    if (notificationsSupported()) setPerm(permission());
    setToast(ok
      ? { icon: "\u2713", title: "Test notification sent", label: "NOTIFICATIONS" }
      : { icon: "\u26a0\ufe0f", title: "Couldn't send — permission blocked", label: "NOTIFICATIONS" });
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

  // Send a message through the coach. `content` is what the model receives;
  // `display` (optional) is the friendlier text shown in the user bubble.
  const sendToCoach = async (content, display) => {
    if (coachBusy) return;
    if (!coachKey.trim()) { setCoachErr("Add your free Groq API key below first."); setShowKey(true); return; }
    haptic(8);
    setCoachErr("");
    const base = [...coachChat, { role: "user", content, display: display || content }];
    setCoachChat(base);
    setCoachBusy(true);
    try {
      const summary = buildSummary({ stats, weekly, history, goal: coachGoal, race: coachRaceGoal });
      const messages = base.map((m) => ({ role: m.role, content: m.content })); // strip display before sending
      const text = await askCoach({ apiKey: coachKey.trim(), model: coachModel.trim() || DEFAULT_MODEL, summary, messages });
      persistChat([...base, { role: "assistant", content: text }]);
      haptic([10, 20, 10]);
    } catch (e) {
      setCoachErr(e.message || "Couldn't reach the coach.");
      setCoachChat(coachChat); // roll the optimistic user bubble back on failure
      haptic(8);
    } finally {
      setCoachBusy(false);
    }
  };
  const analyseCoach = () => sendToCoach(ANALYSE_PROMPT, "Analyse my training");
  const askCoachInput = () => { const q = coachInput.trim(); if (!q) return; setCoachInput(""); sendToCoach(q); };
  const clearCoachChat = () => { persistChat([]); setCoachErr(""); haptic(6); };

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
      const summary = buildSummary({ stats, weekly, history, goal: coachGoal, race: coachRaceGoal });
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
      const summary = buildSummary({ stats, weekly, history, goal: coachGoal, race: coachRaceGoal });
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
      const summary = buildSummary({ stats, weekly, history, goal: coachGoal, race: coachRaceGoal });
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
  const shareProgress = async () => {
    haptic(8);
    const text = `Stride — ${stats.done}/${TOTAL} sessions done, ${stats.kmLogged.toFixed(1)} km logged, best streak ${stats.best} days. ${pct}% of the plan complete! 🏃`;
    try {
      if (navigator.share) await navigator.share({ title: "Stride", text });
      else { await navigator.clipboard.writeText(text); setToast({ icon: "📋", title: "Copied to clipboard", label: "SHARE" }); }
    } catch { /* user cancelled */ }
  };

  const stats = useMemo(() => {
    let kmLogged = 0, done = 0, stitches = 0, runsLogged = 0, maxKm = 0, bestPaceSec = 0, stitchlessRuns = 0;
    let timeSum = 0, paceKmSum = 0, minTotal = 0, earlyRuns = 0, lateRuns = 0;
    let bestSplitSec = 0, bestElevM = 0, totalKcal = 0;
    FLAT.forEach((f) => {
      const e = log[f.key];
      if (!e) return;
      if (e.done) done++;
      const k = parseFloat(e.km);
      if (!isNaN(k)) { kmLogged += k; if (k > 0) { runsLogged++; maxKm = Math.max(maxKm, k); if (!e.stitch) stitchlessRuns++; } }
      if (e.stitch) stitches++;
      const ps = paceSec(e.min, e.km);
      if (ps && (bestPaceSec === 0 || ps < bestPaceSec)) bestPaceSec = ps;
      const mm = parseFloat(e.min);
      if (mm > 0) minTotal += mm;
      if (mm > 0 && k > 0) { timeSum += mm * 60; paceKmSum += k; }
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
    .filter((h) => paceSec(h.e.min, h.e.km) > 0)
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
  const raceRef = useMemo(() => bestReference(history.map((h) => ({
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
      setRemOn(ok); setPerm(permission());
      if (ok && !isNative()) showReminderNow(`Reminders on — I'll nudge you around ${remTime} ✅`);
    }
  };
  const changeTime = async (t) => {
    setRemTime(t);
    if (remOn) { await saveReminder({ time: t }); if (isNative()) await nativeUpdateReminder(t, msgRef.current); }
  };
  const doInstall = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; setInstallEvt(null); };

  const fmt = (ms) => { const s = Math.floor(ms / 1000), m = Math.floor(s / 60); return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };

  const R = 46, CIRC = 2 * Math.PI * R;

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
  const Stat = ({ label, value, sub, hero, color, delay = 0 }) => (
    <div className="card stagger" style={{ animationDelay: `${delay}s`, flex: 1, borderRadius: 18, padding: "15px 15px 14px", overflow: "hidden" }}>
      <div className={`num${hero ? " gtext" : ""}`} style={{ fontSize: 30, fontWeight: 700, color: hero ? undefined : color || C.text, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 9.5, letterSpacing: 1.5, color: C.dim, marginTop: 8, fontWeight: 700, textTransform: "uppercase" }}>{label}</div>
      {sub && <div style={{ fontSize: 10.5, color: C.dim2, marginTop: 3 }}>{sub}</div>}
    </div>
  );
  const Card = ({ children, style, className = "" }) => (
    <div className={`card ${className}`.trim()} style={{ borderRadius: 20, padding: 18, ...style }}>{children}</div>
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

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Manrope', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        button { font-family: inherit; }
        html, body { background:${C.bg}; }
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

        /* --- surfaces: lit from the top-left, hairline highlight on the rim --- */
        .card {
          position:relative;
          background:linear-gradient(158deg, ${tint(C.text, 0.045)} 0%, ${C.surface} 34%, ${C.bgSoft} 100%);
          border:1px solid ${C.line};
          box-shadow:0 20px 44px -32px rgba(0,0,0,.95), inset 0 1px 0 ${tint(C.text, 0.05)};
        }
        .card.glow { border-color:${tint(C.accent, .45)}; box-shadow:${C.glow}, inset 0 1px 0 ${tint(C.accent, .16)}; }
        .card.accented { background:linear-gradient(150deg, ${tint(C.accent, .16)} 0%, ${tint(C.accent2, .07)} 46%, ${C.bgSoft} 100%); border-color:${tint(C.accent, .3)}; }

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

        /* thin gradient progress bar, used for weeks, goals and readiness */
        .bar { height:6px; border-radius:999px; background:${C.bgSoft}; overflow:hidden; border:1px solid ${C.line}; }
        .bar > i { display:block; height:100%; border-radius:999px; background:${C.grad}; transition:width .55s cubic-bezier(.2,.8,.2,1); }

        .sw { width:46px; height:27px; border-radius:999px; border:none; cursor:pointer; position:relative; transition:background .2s; }
        .sw b { position:absolute; top:3px; left:3px; width:21px; height:21px; border-radius:50%; background:#fff; transition:left .2s; }

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
        @keyframes pulseRing { 0%,100% { opacity:.45 } 50% { opacity:.9 } }
        .rise { animation:rise .3s ease both; }
        .pop { animation:pop .32s ease; }
        .stagger { opacity:0; animation:slideUp .45s ease forwards; }
        .spin { animation:spin 1s linear infinite; }

        @media (prefers-reduced-motion: reduce) {
          .stagger, .spin, .aurora i { animation:none !important; }
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

      <div style={{ position: "relative", zIndex: 1, maxWidth: 620, margin: "0 auto", padding: "max(22px, env(safe-area-inset-top)) 16px calc(112px + env(safe-area-inset-bottom))" }}>
        {/* Top bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <Mark />
              <h1 className="disp gtext" style={{ fontSize: 30, fontWeight: 700, margin: 0, letterSpacing: -1 }}>Stride</h1>
            </div>
            <div style={{ fontSize: 9.5, letterSpacing: 2.4, color: C.dim, fontWeight: 800, marginTop: 6 }}>{eyebrow}</div>
            {countdown && <div style={{ fontSize: 12, color: C.dim, marginTop: 3, fontWeight: 600 }}>{countdown}</div>}
          </div>
          <div style={{ position: "relative", width: 100, height: 100, flexShrink: 0 }}>
            <svg width="100" height="100" style={{ transform: "rotate(-90deg)" }}>
              <defs>
                <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={C.accent} />
                  <stop offset="100%" stopColor={C.accent2} />
                </linearGradient>
              </defs>
              <circle cx="50" cy="50" r={R} fill="none" stroke={C.surface2} strokeWidth="7" />
              <circle cx="50" cy="50" r={R} fill="none" stroke="url(#ringGrad)" strokeWidth="7" strokeLinecap="round"
                strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - pctShown / 100)}
                style={{ transition: "stroke-dashoffset .45s cubic-bezier(.2,.8,.2,1)", filter: `drop-shadow(0 0 7px ${tint(C.accent, .5)})` }} />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <span className="num gtext" style={{ fontSize: 24, fontWeight: 700 }}>{pctShown}%</span>
              <span style={{ fontSize: 8.5, color: C.dim, letterSpacing: 1.2, fontWeight: 700 }}>{stats.done}/{TOTAL} DAYS</span>
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
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <button onClick={() => { haptic(12); setTrackerOpen(true); }} className="tap cta disp"
                style={{ flex: 1.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 16, padding: "16px 0", fontSize: 16, fontWeight: 700, cursor: "pointer" }}>
                <Icon name="play" size={17} /> Track run
              </button>
              <button onClick={() => { haptic(10); setRouteMakerOpen(true); }} className="card tap disp"
                style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 16, padding: "16px 0", fontSize: 14, fontWeight: 700, cursor: "pointer", color: C.text }}>
                <Icon name="map" size={16} /> Routes
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <Stat label="KM LOGGED" value={kmShown.toFixed(1)} hero delay={0} />
              <Stat label="STREAK" value={stats.curStreak} sub={`best ${stats.best} day${stats.best === 1 ? "" : "s"}`} delay={0.05} />
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <Stat label="RUNS DONE" value={stats.runsLogged} delay={0.1} />
              <Stat label="TIME ON FEET" value={stats.minTotal ? fmtMin(stats.minTotal) : "—"} delay={0.15} />
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <Stat label="AVG PACE" value={fmtPace(stats.avgPaceSec) || "—"} sub={stats.avgPaceSec ? "min / km" : ""} delay={0.2} />
              <Stat label="STITCHES" value={stats.stitches} sub="should drop!" color={stats.stitches ? C.warn : C.easy} delay={0.25} />
            </div>

            {/* Personal bests */}
            <Card style={{ marginBottom: 12 }}>
              <Label>Personal records</Label>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <PB label="BEST PACE" value={fmtPace(stats.bestPaceSec) || "—"} unit="/km" color={C.accent} />
                <PB label="LONGEST RUN" value={stats.maxKm ? stats.maxKm + " km" : "—"} />
                <PB label="BIG WEEK" value={(Math.max(0, ...weekly.map((w) => w.value))).toFixed(1) + " km"} />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <PB label="FASTEST KM" value={fmtPace(stats.bestSplitSec) || "—"} unit={stats.bestSplitSec ? "/km" : ""} color={C.accent} />
                <PB label="BEST CLIMB" value={stats.bestElevM ? `+${stats.bestElevM} m` : "—"} />
                <PB label="TOTAL KCAL" value={stats.totalKcal ? Math.round(stats.totalKcal).toLocaleString() : "—"} />
              </div>
            </Card>

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
                    ? <>predicted from your {raceRef.km.toFixed(1)} km in {fmtDuration(raceRef.sec)}<br /><span style={{ color: C.dim2 }}>{CONFIDENCE_LABEL[goalPrediction.confidence]}</span></>
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
                    : `Longest run so far ${stats.maxKm || 0} km. The ${goal.name} is ${goal.km.toFixed(goal.km % 1 ? 1 : 0)} km.`) : ""}
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
              <Label right={raceRef && <span style={{ fontSize: 10, color: C.dim2, fontWeight: 600 }}>from {raceRef.km.toFixed(1)} km</span>}>
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

            {/* Achievements */}
            <Card style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 10, letterSpacing: 2, color: C.dim, fontWeight: 700 }}>ACHIEVEMENTS</span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: C.accent, fontWeight: 700 }}>{unlocked.size}/{ACHIEVEMENTS.length}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                {ACHIEVEMENTS.map((a) => {
                  const got = unlocked.has(a.id);
                  return (
                    <div key={a.id} title={`${a.title} — ${a.desc}`}
                      style={{
                        textAlign: "center", padding: "11px 4px", borderRadius: 13,
                        background: got ? `linear-gradient(150deg,${tint(C.accent, .14)},${tint(C.accent2, .06)})` : "transparent",
                        border: `1px solid ${got ? tint(C.accent, .3) : "transparent"}`,
                        opacity: got ? 1 : 0.38,
                      }}>
                      <div style={{ fontSize: 24, filter: got ? "none" : "grayscale(1)" }}>{a.icon}</div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: got ? C.text : C.dim, marginTop: 4, lineHeight: 1.2 }}>{a.title}</div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Settings & tools — collapsed by default to keep Stats scannable */}
            <button onClick={() => { setSettingsOpen((o) => !o); haptic(6); }} className="card tap"
              style={{ width: "100%", textAlign: "left", padding: "14px 16px", marginBottom: 12, borderRadius: 16, color: C.text, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ color: C.accent, display: "flex" }}><Icon name="bell" size={16} /></span>
              Settings &amp; tools
              <span style={{ fontSize: 11, color: C.dim2, fontWeight: 600 }}>· appearance, alerts, backup</span>
              <span style={{ marginLeft: "auto", color: C.dim, fontWeight: 700 }}>{settingsOpen ? "▾" : "▸"}</span>
            </button>

            {settingsOpen && (<div className="rise">
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
            </Card>

            {/* Notifications */}
            <Card style={{ marginBottom: 12 }}>
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
              ].map(([key, title, desc]) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{title}</div>
                    <div style={{ fontSize: 11, color: C.dim2, marginTop: 2, lineHeight: 1.4 }}>{desc}</div>
                  </div>
                  <button onClick={() => toggleNotif(key)} className="sw" style={{ background: notif[key] ? C.accent : C.line, flexShrink: 0 }} aria-label={`Toggle ${title}`}>
                    <b style={{ left: notif[key] ? 22 : 3 }} />
                  </button>
                </div>
              ))}

              <button onClick={testNotification} className="chip tap" style={{ marginTop: 12, width: "100%", padding: "11px 0", fontWeight: 700, color: C.text }}>
                Send me a test notification
              </button>

              {!isNative() && !notificationsSupported() && <div style={{ fontSize: 11, color: C.warn, marginTop: 10 }}>This browser can't show notifications.</div>}
              {!isNative() && notificationsSupported() && perm === "denied" && <div style={{ fontSize: 11, color: C.warn, marginTop: 10 }}>Notifications are blocked — enable them in your browser or site settings.</div>}
              <div style={{ fontSize: 11, color: C.dim2, marginTop: 10, lineHeight: 1.5 }}>
                {isNative()
                  ? "Reminders run in the background and fire even when the app is closed."
                  : "The web can't guarantee an exact alarm once the app is fully closed. Install it to your home screen for the most reliable delivery."}
              </div>
            </Card>

            {/* Data & backup */}
            <Card style={{ marginBottom: 12 }}>
              <Label>Data &amp; backup</Label>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={exportData} className="chip tap" style={{ flex: 1, background: C.surface2, color: C.text, padding: "11px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}><Icon name="download" size={14} /> Export</button>
                <button onClick={() => importRef.current?.click()} className="chip tap" style={{ flex: 1, background: C.surface2, color: C.text, padding: "11px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}><Icon name="upload" size={14} /> Import</button>
                <button onClick={shareProgress} className="chip tap" style={{ flex: 1, background: C.surface2, color: C.text, padding: "11px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}><Icon name="share" size={14} /> Share</button>
              </div>
              <input ref={importRef} type="file" accept="application/json,.json" style={{ display: "none" }}
                onChange={(e) => { importData(e.target.files[0]); e.target.value = ""; }} />
              <div style={{ fontSize: 11, color: C.dim, marginTop: 8, lineHeight: 1.5 }}>
                {isNative()
                  ? "Export opens the share sheet — send the backup file to Drive, email or your new phone, then Import it there."
                  : "Export saves your runs to a file; Import restores them (e.g. on a new phone or a new version of the app)."}
                {" "}Importing merges with what's already here, so nothing gets wiped. Your data lives only on this device.
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

        {tab === "coach" && (
          <div className="rise">
            <div style={{ display: "flex", alignItems: "baseline", marginBottom: 14 }}>
              <h2 className="disp" style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>AI coach</h2>
              <span style={{ marginLeft: "auto", fontSize: 10, color: C.dim, fontWeight: 600 }}>powered by Groq</span>
            </div>

            {!coachKey && (
              <Card style={{ marginBottom: 12, borderColor: C.accent }}>
                <div style={{ fontSize: 13, color: C.text, lineHeight: 1.55, marginBottom: 10 }}>
                  Add a free Groq API key to unlock your coach — chat, run analysis, and AI-built plans. It's stored only on this device.
                </div>
                <label style={{ fontSize: 10, color: C.dim, fontWeight: 700, letterSpacing: 1 }}>GROQ API KEY</label>
                <input className="inp" type={showKey ? "text" : "password"} value={coachKey}
                  onChange={(e) => saveCoachKey(e.target.value)} placeholder="gsk_…"
                  autoComplete="off" autoCorrect="off" spellCheck={false} style={{ marginTop: 6 }} />
                <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: C.dim, marginTop: 9, cursor: "pointer" }}>
                  <input type="checkbox" checked={showKey} onChange={(e) => setShowKey(e.target.checked)} /> Show key
                </label>
                <div style={{ fontSize: 11, color: C.dim, marginTop: 10, lineHeight: 1.5 }}>
                  Get one free at <span style={{ color: C.text, fontWeight: 600 }}>console.groq.com/keys</span>.
                </div>
              </Card>
            )}

            {/* Chat */}
            <Card style={{ marginBottom: 12 }}>
              <Label>Ask your coach</Label>

              <label style={{ fontSize: 10, color: C.dim, fontWeight: 700, letterSpacing: 1 }}>MY GOAL</label>
              <input className="inp" value={coachGoal} onChange={(e) => saveCoachGoal(e.target.value)}
                placeholder={DEFAULT_GOAL} style={{ marginTop: 6, marginBottom: 12 }} />

              {coachChat.length > 0 && (
                <div className="rise" style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                  {coachChat.map((m, i) => (
                    <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "92%" }}>
                      <div style={{
                        background: m.role === "user" ? C.grad : C.surface2,
                        color: m.role === "user" ? C.bg : C.text,
                        border: m.role === "user" ? "none" : `1px solid ${C.line}`,
                        borderRadius: 14, padding: "10px 13px", fontSize: 13, lineHeight: 1.55,
                        whiteSpace: "pre-wrap", fontWeight: m.role === "user" ? 600 : 400,
                      }}>{m.display || m.content}</div>
                    </div>
                  ))}
                  {coachBusy && (
                    <div style={{ alignSelf: "flex-start", fontSize: 12, color: C.dim, padding: "2px 4px" }}>Coach is thinking…</div>
                  )}
                </div>
              )}

              {coachErr && <div style={{ fontSize: 12, color: C.warn, marginBottom: 10, lineHeight: 1.5 }}>{coachErr}</div>}

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {QUICK_ASKS.map((q) => (
                  <button key={q.label} onClick={() => sendToCoach(q.text, q.label)} disabled={coachBusy} className="chip tap"
                    style={{ background: C.surface2, color: C.text, opacity: coachBusy ? 0.5 : 1 }}>{q.label}</button>
                ))}
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input className="inp" value={coachInput} onChange={(e) => setCoachInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") askCoachInput(); }}
                  placeholder="Ask your coach anything…" disabled={coachBusy} />
                <button onClick={askCoachInput} disabled={coachBusy || !coachInput.trim()} className="tap cta"
                  style={{ borderRadius: 10, padding: "9px 16px", fontSize: 14, fontWeight: 700, flexShrink: 0, opacity: coachBusy || !coachInput.trim() ? 0.5 : 1 }}>Send</button>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button onClick={analyseCoach} disabled={coachBusy} className="chip tap" style={{ flex: 1, opacity: coachBusy ? 0.5 : 1 }}>
                  {coachChat.length ? "Re-analyse my training" : "Analyse my training"}
                </button>
                {coachChat.length > 0 && (
                  <button onClick={clearCoachChat} disabled={coachBusy} className="chip tap" style={{ opacity: coachBusy ? 0.5 : 1 }}>Clear</button>
                )}
              </div>
            </Card>

            {/* Plan tools */}
            <Card style={{ marginBottom: 12 }}>
              <Label>Your training plan</Label>
              <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.5, marginBottom: 10 }}>
                Build a fresh block when you've smashed your goal, or re-tune your upcoming sessions from the too easy / too hard feedback you leave on completed days. Nothing logged is lost.
              </div>

              {proposedPlan && (() => {
                const newWeeks = proposedPlan.weeks.slice(proposedPlan.fromIdx);
                const verb = proposedPlan.mode === "adapt" ? "adjusted" : "new";
                return (
                  <div className="rise" style={{ background: C.surface2, border: `1px solid ${C.accent}`, borderRadius: 12, padding: 12, marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: C.accent, fontWeight: 700, marginBottom: 8 }}>Proposed — {newWeeks.length} {verb} week{newWeeks.length === 1 ? "" : "s"}</div>
                    {newWeeks.map((w) => {
                      const km = w.days.reduce((s, d) => s + (d.km || 0), 0);
                      return (
                        <div key={w.n} style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Week {w.n} · {w.label} <span style={{ color: C.dim, fontWeight: 600 }}>· {km.toFixed(1)} km</span></div>
                          <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.5 }}>
                            {w.days.map((d) => `${d.d} ${d.km ? d.title : "rest"}`).join(" · ")}
                          </div>
                        </div>
                      );
                    })}
                    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                      <button onClick={applyProposedPlan} className="tap cta" style={{ flex: 1, borderRadius: 10, padding: "10px 0", fontSize: 13, fontWeight: 700 }}>
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

            {/* Setup */}
            {coachKey && (
              <Card style={{ marginBottom: 12 }}>
                <details>
                  <summary style={{ fontSize: 11, color: C.dim, cursor: "pointer", fontWeight: 700, letterSpacing: 1 }}>GROQ KEY &amp; MODEL · edit</summary>
                  <div style={{ marginTop: 12 }}>
                    <label style={{ fontSize: 10, color: C.dim, fontWeight: 700, letterSpacing: 1 }}>GROQ API KEY</label>
                    <input className="inp" type={showKey ? "text" : "password"} value={coachKey}
                      onChange={(e) => saveCoachKey(e.target.value)} placeholder="gsk_…"
                      autoComplete="off" autoCorrect="off" spellCheck={false} style={{ marginTop: 6 }} />
                    <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: C.dim, marginTop: 9, cursor: "pointer" }}>
                      <input type="checkbox" checked={showKey} onChange={(e) => setShowKey(e.target.checked)} /> Show key
                    </label>
                    <label style={{ fontSize: 10, color: C.dim, fontWeight: 700, letterSpacing: 1, display: "block", marginTop: 12 }}>MODEL</label>
                    <input className="inp" value={coachModel} onChange={(e) => saveCoachModel(e.target.value)}
                      placeholder={DEFAULT_MODEL} autoComplete="off" spellCheck={false} style={{ marginTop: 6 }} />
                    <div style={{ fontSize: 11, color: C.dim, marginTop: 12, lineHeight: 1.5 }}>
                      Stored only on this device and sent straight to Groq — no server in between.
                    </div>
                  </div>
                </details>
              </Card>
            )}
          </div>
        )}

        {tab === "history" && (() => {
          const shown = history.filter((h) =>
            histFilter === "gps" ? h.e.tracked : histFilter === "run" ? parseFloat(h.e.km) > 0 : true);
          const shownKm = shown.reduce((s, h) => s + (parseFloat(h.e.km) || 0), 0);
          const shownMin = shown.reduce((s, h) => s + (parseFloat(h.e.min) || 0), 0);
          return (
          <div className="rise">
            {history.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
                {[["all", "All"], ["run", "Runs"], ["gps", "GPS"]].map(([id, lbl]) => (
                  <button key={id} onClick={() => { setHistFilter(id); haptic(5); }} className={`chip tap${histFilter === id ? " on" : ""}`}>
                    {lbl}
                  </button>
                ))}
                <span className="num" style={{ marginLeft: "auto", fontSize: 11, color: C.dim, fontWeight: 600 }}>
                  {shown.length} · {shownKm.toFixed(1)} km{shownMin ? ` · ${fmtMin(shownMin)}` : ""}
                </span>
              </div>
            )}
            {history.length === 0 ? (
              <Card style={{ textAlign: "center" }}>
                <div className="disp" style={{ fontSize: 18, fontWeight: 700 }}>No runs logged yet</div>
                <div style={{ fontSize: 13, color: C.dim, marginTop: 4 }}>Tick off a day on the Plan tab and it'll show up here.</div>
              </Card>
            ) : shown.length === 0 ? (
              <Card style={{ textAlign: "center" }}>
                <div style={{ fontSize: 13, color: C.dim }}>Nothing matches this filter yet.</div>
              </Card>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {shown.map((h, idx) => {
                  const p = fmtPace(paceSec(h.e.min, h.e.km));
                  const date = h.e.date ? new Date(h.e.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
                  const extras = [];
                  if (h.e.elev > 0) extras.push(`▲ ${h.e.elev} m`);
                  if (h.e.kcal > 0) extras.push(`${h.e.kcal} kcal`);
                  if (h.e.runKm > 0) extras.push(`Run ${h.e.runKm} km`);
                  if (h.e.walkKm > 0) extras.push(`Walk ${h.e.walkKm} km`);
                  if (h.e.hrAvg > 0) extras.push(`♥ ${h.e.hrAvg} avg · ${h.e.hrMax} max`);
                  if (h.e.cadence > 0) extras.push(`${h.e.cadence} spm`);
                  return (
                    <Card key={h.key} style={{ padding: "12px 14px", animation: `rise .3s ease both`, animationDelay: `${Math.min(idx * 0.03, 0.3)}s` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ width: 4, alignSelf: "stretch", borderRadius: 4, background: typeColor(h.type) }} />
                        <div style={{ flex: 1 }}>
                          <div className="disp" style={{ fontSize: 15, fontWeight: 700 }}>{h.title}{h.e.feel ? ` ${FEELS[h.e.feel - 1]}` : ""}</div>
                          <div style={{ fontSize: 11, color: C.dim }}>Week {h.week} · {h.d} · {date}</div>
                          {h.e.note && <div style={{ fontSize: 12, color: C.dim, marginTop: 4, fontStyle: "italic" }}>"{h.e.note}"</div>}
                        </div>
                        <div style={{ textAlign: "right" }}>
                          {parseFloat(h.e.km) > 0 && <div className="num gtext" style={{ fontSize: 19, fontWeight: 700 }}>{parseFloat(h.e.km)} km</div>}
                          <div style={{ fontSize: 11, color: C.dim }}>{h.e.min ? `${h.e.min} min` : ""}{p ? ` · ${p}/km` : ""}</div>
                          {h.e.stitch && <div style={{ fontSize: 10, color: C.warn, fontWeight: 700 }}>STITCH</div>}
                          {h.e.tracked && <div style={{ fontSize: 9, color: C.easy, fontWeight: 800, letterSpacing: 1 }}>● GPS</div>}
                          {parseFloat(h.e.km) > 0 && (
                            <button onClick={() => { haptic(8); shareRunCard({ km: h.e.km, min: h.e.min, durMs: h.e.durMs, route: h.e.route, elev: h.e.elev, kcal: h.e.kcal, runKm: h.e.runKm, walkKm: h.e.walkKm, date: h.e.date }); }}
                              className="chip" style={{ padding: "4px 10px", fontSize: 10, marginTop: 5 }}>
                              <Icon name="share" size={11} style={{ display: "inline", verticalAlign: "middle", marginRight: 3 }} />share
                            </button>
                          )}
                        </div>
                      </div>
                      {(extras.length > 0 || (h.e.route && h.e.route.length > 1)) && (
                        <div style={{ marginTop: 10 }}>
                          {h.e.route && h.e.route.length > 1 && (
                            <div style={{ position: "relative" }}>
                              <LiveMap points={h.e.route} height={150} interactive={false} />
                              <button onClick={() => { haptic(8); setReplayRun({ route: h.e.route, km: h.e.km, durMs: h.e.durMs }); }}
                                className="chip" style={{ position: "absolute", bottom: 8, right: 8, zIndex: 500, background: "rgba(11,12,15,0.82)", color: C.accent, border: `1px solid ${C.accent}55`, padding: "5px 11px", fontSize: 11, fontWeight: 700 }}>
                                ▶ Replay
                              </button>
                            </div>
                          )}
                          {extras.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                              {extras.map((x, i) => (
                                <span key={i} className="chip" style={{ background: C.surface2, color: C.dim, fontSize: 11 }}>{x}</span>
                              ))}
                            </div>
                          )}
                          {h.e.splits && h.e.splits.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                              {h.e.splits.map((s, i) => (
                                <span key={i} className="chip" style={{ background: C.surface2, color: C.text, fontSize: 11 }}>{i + 1}k · {fmtPace(s)}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {parseFloat(h.e.km) > 0 && (
                        <div style={{ marginTop: 10 }}>
                          {runFeedback[h.key] ? (
                            <div className="rise" style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: 11, fontSize: 12.5, lineHeight: 1.55, color: C.text, whiteSpace: "pre-wrap" }}>
                              {runFeedback[h.key]}
                              <button onClick={() => coachThisRun(h)} disabled={runFeedbackBusy === h.key} className="chip tap" style={{ marginTop: 8, fontSize: 11 }}>
                                {runFeedbackBusy === h.key ? "…" : "Ask again"}
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => coachThisRun(h)} disabled={runFeedbackBusy === h.key} className="chip tap"
                              style={{ fontSize: 11, opacity: runFeedbackBusy === h.key ? 0.6 : 1 }}>
                              {runFeedbackBusy === h.key ? "Coach is reading…" : "🧠 Coach this run"}
                            </button>
                          )}
                        </div>
                      )}
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
            {!startDate && (
              <button onClick={() => { setTab("stats"); haptic(8); }} className="chip"
                style={{ width: "100%", padding: "11px 14px", marginBottom: 14, background: C.surface, color: C.text, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <Icon name="calendar" size={14} /> Add your start date to highlight today's run
              </button>
            )}
            {/* Today / next-up hero with inline actions */}
            {hero ? (
              <div className="card accented" style={{ borderRadius: 22, padding: "18px 20px 20px", marginBottom: 18, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    fontSize: 9.5, letterSpacing: 1.6, fontWeight: 800, color: C.bg,
                    background: C.grad, borderRadius: 999, padding: "4px 10px",
                  }}>
                    {heroIdx >= 0 ? "TODAY" : "NEXT UP"}
                  </span>
                  <span style={{ fontSize: 10, letterSpacing: 1.6, color: typeColor(hero.type), fontWeight: 800 }}>
                    WEEK {hero.week} · {hero.d} · {hero.type.toUpperCase()}
                  </span>
                  {heroIdx >= 0 && (
                    <span style={{ marginLeft: "auto", fontSize: 11, color: C.dim, fontWeight: 600 }}>
                      {dateForDay(startDate, heroIdx).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  )}
                </div>
                <div className="disp" style={{ fontSize: 30, fontWeight: 700, margin: "10px 0 3px", lineHeight: 1.1, textDecoration: heroEntry.done ? "line-through" : "none", color: heroEntry.done ? C.dim : C.text }}>
                  {hero.title}
                </div>
                <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.5 }}>{hero.detail}</div>
                {hero.km > 0 && (
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 12 }}>
                    <span className="num gtext" style={{ fontSize: 26, fontWeight: 700 }}>{hero.km}</span>
                    <span className="lab">km on the plan</span>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 15 }}>
                  <button onClick={() => { haptic(12); setTrackerOpen(true); }} className="tap cta disp"
                    style={{ flex: 1.4, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 14, padding: "13px 0", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}>
                    <Icon name="play" size={15} /> Start GPS run
                  </button>
                  <button onClick={() => update(hero.key, { done: !heroEntry.done })} className="chip tap"
                    style={{ flex: 1, padding: "13px 0", fontSize: 13, fontWeight: 700, background: heroEntry.done ? tint(C.accent, .16) : C.bgSoft, color: heroEntry.done ? C.accent : C.dim, borderColor: heroEntry.done ? tint(C.accent, .4) : C.line }}>
                    {heroEntry.done ? "Done ✓" : "Mark done"}
                  </button>
                </div>
                {heroEntry.done && nextUp && nextUp.key !== hero.key && (
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 12 }}>
                    Next up: Week {nextUp.week} · {nextUp.d} · {nextUp.title}
                  </div>
                )}
              </div>
            ) : (
              <div className="card glow" style={{ borderRadius: 16, padding: 18, marginBottom: 18, textAlign: "center" }}>
                <div className="disp" style={{ fontSize: 22, fontWeight: 700 }}>🎖️ Mission complete</div>
                <div style={{ fontSize: 13, color: C.dim, marginTop: 4 }}>You finished every session. Keep the momentum — let your coach build what's next.</div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 12 }}>
                  <button onClick={() => { haptic(12); setTab("coach"); generatePlan(); }} disabled={planBusy} className="tap cta disp"
                    style={{ display: "inline-flex", alignItems: "center", gap: 7, borderRadius: 12, padding: "12px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: planBusy ? 0.6 : 1 }}>
                    🚀 {planBusy ? "Building…" : "Build my next block"}
                  </button>
                  <button onClick={() => { haptic(12); setTrackerOpen(true); }} className="chip tap disp"
                    style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "12px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                    <Icon name="play" size={15} /> Victory run
                  </button>
                </div>
              </div>
            )}

            {/* Goal countdown strip — the target that comes after this block */}
            {goalDate && goalDays != null && goalDays >= 0 && goal && (
              <div className="card tap" onClick={() => { setTab("stats"); haptic(6); }}
                style={{ display: "flex", alignItems: "center", gap: 12, borderRadius: 16, padding: "13px 15px", marginBottom: 16 }}>
                <span style={{ color: C.accent, display: "flex" }}><Icon name="flag" size={18} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="lab" style={{ marginBottom: 2 }}>{goal.name}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                    {goalDays === 0 ? "Race day is today" : `${goalDays} day${goalDays === 1 ? "" : "s"} to race day`}
                    {goalPrediction ? ` · on track for ${fmtDuration(goalPrediction.sec)}` : ""}
                  </div>
                </div>
                <span className="num" style={{ fontSize: 13, fontWeight: 800, color: goalReady >= 100 ? C.good : C.dim }}>{goalReady}%</span>
              </div>
            )}

            <button onClick={() => { setTipsOpen((o) => !o); haptic(6); }} className="chip"
              style={{ width: "100%", textAlign: "left", padding: "12px 14px", marginBottom: 16, background: C.surface, color: C.text, fontSize: 13 }}>
              {tipsOpen ? "▾" : "▸"} Beat the side stitch
            </button>
            {tipsOpen && (
              <div className="rise" style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 16px", marginBottom: 16, fontSize: 13, lineHeight: 1.55, color: C.dim }}>
                <p style={{ margin: "0 0 7px" }}><b style={{ color: C.text }}>Belly breathing.</b> Deep into your stomach, not shallow into the chest — your #1 weapon.</p>
                <p style={{ margin: "0 0 7px" }}><b style={{ color: C.text }}>Exhale on the opposite foot</b> to the stitch side.</p>
                <p style={{ margin: "0 0 7px" }}><b style={{ color: C.text }}>No food 2–3h before.</b> Don't chug water right before either.</p>
                <p style={{ margin: 0 }}><b style={{ color: C.text }}>Slow down</b> to a pace where you could still talk.</p>
              </div>
            )}

            {WEEKS.map((w) => {
              const wDone = w.days.filter((_, i) => log[`w${w.n}d${i}`] && log[`w${w.n}d${i}`].done).length;
              const weekDone = wDone === w.days.length;
              const collapsed = weekDone && !openWeeks[w.n];
              return (
                <div key={w.n} className="stagger" style={{ marginBottom: 22, animationDelay: `${(w.n - 1) * 0.06}s` }}>
                  <div className={weekDone ? "tap" : ""}
                    onClick={() => { if (weekDone) { setOpenWeeks((o) => ({ ...o, [w.n]: !o[w.n] })); haptic(5); } }}
                    style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                    <span className="disp" style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1.2, color: weekDone ? C.accent : C.text }}>WEEK {w.n}</span>
                    <span style={{ fontSize: 11, color: C.dim }}>{w.label}</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: weekDone ? C.accent : C.dim, fontWeight: 700 }}>
                      {weekDone ? `✓ done ${collapsed ? "▸" : "▾"}` : `${wDone}/${w.days.length}`}
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
                      return (
                        <div key={di}>
                          <div className="row tap card" onClick={() => { setOpen(isOpen ? null : key); haptic(5); }}
                            style={{
                              display: "flex", alignItems: "center", gap: 12, padding: "12px 13px",
                              borderColor: isToday ? tint(C.accent, .55) : e.done ? tint(typeColor(day.type), .45) : C.line,
                              borderRadius: isOpen ? "14px 14px 0 0" : 14,
                              boxShadow: isToday ? C.glow : undefined,
                            }}>
                            <button onClick={(ev) => { ev.stopPropagation(); update(key, { done: !e.done }); }}
                              className={e.done ? "pop" : ""}
                              style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 8, border: `2px solid ${e.done ? typeColor(day.type) : C.line}`, background: e.done ? typeColor(day.type) : "transparent", color: C.bg, fontWeight: 900, fontSize: 15, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              {e.done ? "✓" : ""}
                            </button>
                            <div style={{ width: 30, fontSize: 11, fontWeight: 700, color: C.dim }}>{day.d}</div>
                            <div style={{ flex: 1 }}>
                              <div className="disp" style={{ fontSize: 16, fontWeight: 700, textDecoration: e.done ? "line-through" : "none", color: e.done ? C.dim : C.text }}>{day.title}</div>
                              <div style={{ fontSize: 11, color: C.dim, marginTop: 1 }}>{day.detail}</div>
                            </div>
                            {isToday && <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: 1, color: C.bg, background: C.grad, padding: "3px 7px", borderRadius: 999 }}>TODAY</span>}
                            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: typeColor(day.type) }}>{day.type.toUpperCase()}</span>
                          </div>

                          {isOpen && (
                            <div className="rise" style={{ background: C.bgSoft, border: `1px solid ${C.line}`, borderTop: "none", borderRadius: "0 0 14px 14px", padding: 14 }}>
                              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                                <div style={{ flex: 1 }}>
                                  <label style={{ fontSize: 10, color: C.dim, fontWeight: 700, letterSpacing: 1 }}>DISTANCE (km)</label>
                                  <input className="inp" type="number" inputMode="decimal" placeholder={String(day.km || 0)} value={e.km ?? ""} onChange={(ev) => update(key, { km: ev.target.value })} />
                                </div>
                                <div style={{ flex: 1 }}>
                                  <label style={{ fontSize: 10, color: C.dim, fontWeight: 700, letterSpacing: 1 }}>TIME (min)</label>
                                  <input className="inp" type="number" inputMode="numeric" placeholder="—" value={e.min ?? ""} onChange={(ev) => update(key, { min: ev.target.value })} />
                                </div>
                              </div>
                              {fmtPace(paceSec(e.min, e.km)) && (
                                <div style={{ fontSize: 11, color: C.accent, fontWeight: 700, marginBottom: 10 }}>Pace: {fmtPace(paceSec(e.min, e.km))} / km</div>
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

            <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 13, fontSize: 12, lineHeight: 1.5, color: C.dim, marginBottom: 14 }}>
              <b style={{ color: C.text }}>Listen to your body.</b> Muscle soreness = normal. Sharp joint or shin pain = stop and rest 1–2 days. Don't arrive injured.
            </div>
            <button onClick={reset} className="chip" style={{ fontSize: 11 }}>Reset all progress</button>
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
