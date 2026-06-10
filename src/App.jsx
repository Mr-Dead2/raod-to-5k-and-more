import React, { useState, useEffect, useRef, useMemo } from "react";
import { WEEKS, FLAT, TOTAL, C, typeColor } from "./data.js";
import { loadLog, saveLog, loadSettings, saveSettings } from "./storage.js";
import { WeeklyBars, CumulativeArea, StreakGrid, RouteMap } from "./components/Charts.jsx";
import { BottomNav } from "./components/BottomNav.jsx";
import { RunTracker } from "./components/RunTracker.jsx";
import { ACHIEVEMENTS, unlockedIds } from "./achievements.js";
import { haptic, confetti } from "./celebrate.js";
import {
  notificationsSupported, permission, loadReminder, saveReminder,
  enableReminders, disableReminders, showReminderNow, syncMessage,
  startForegroundScheduler,
} from "./notifications.js";
import {
  isNative, nativeEnableReminder, nativeDisableReminder, nativeUpdateReminder,
  ensureLocationPermission, styleStatusBar, nativeShareBackup,
} from "./native.js";

const DAY = 86400000;
const paceSec = (min, km) => {
  const m = parseFloat(min), k = parseFloat(km);
  if (!m || !k) return 0;
  return (m * 60) / k;
};
const fmtPace = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : null);

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
  const [startDate, setStartDate] = useState("");
  const [toast, setToast] = useState(null);
  const [trackerOpen, setTrackerOpen] = useState(false);

  // reminders
  const [remOn, setRemOn] = useState(false);
  const [remTime, setRemTime] = useState("18:00");
  const [perm, setPerm] = useState("default");

  // install prompt
  const [installEvt, setInstallEvt] = useState(null);

  // stopwatch
  const [swMs, setSwMs] = useState(0);
  const [swRun, setSwRun] = useState(false);
  const swRef = useRef(null);

  useEffect(() => {
    setLog(loadLog());
    setStartDate(loadSettings().startDate || "");
    setLoaded(true);
    (async () => {
      const r = await loadReminder();
      setRemOn(!!r.enabled);
      setRemTime(r.time || "18:00");
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

  const importRef = useRef(null);
  const exportData = async () => {
    haptic(8);
    const payload = { app: "road-to-5k", version: 2, exportedAt: new Date().toISOString(), log, settings: { ...loadSettings(), startDate } };
    const json = JSON.stringify(payload, null, 2);
    const filename = `road-to-5k-backup-${new Date().toISOString().slice(0, 10)}.json`;
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
        haptic([10, 30, 10]);
        setToast({ icon: "✅", title: `Backup restored — ${restored} session${restored === 1 ? "" : "s"}`, label: "BACKUP" });
      } else setToast({ icon: "⚠️", title: "Not a valid backup file", label: "BACKUP" });
    } catch { setToast({ icon: "⚠️", title: "Couldn't read that file", label: "BACKUP" }); }
  };
  const shareProgress = async () => {
    haptic(8);
    const text = `Road to 5K — ${stats.done}/${TOTAL} sessions done, ${stats.kmLogged.toFixed(1)} km logged, best streak ${stats.best} days. ${pct}% of the way to a continuous 5K! 🏃`;
    try {
      if (navigator.share) await navigator.share({ title: "Road to 5K", text });
      else { await navigator.clipboard.writeText(text); setToast({ icon: "📋", title: "Copied to clipboard", label: "SHARE" }); }
    } catch { /* user cancelled */ }
  };

  const stats = useMemo(() => {
    let kmLogged = 0, done = 0, stitches = 0, runsLogged = 0, maxKm = 0, bestPaceSec = 0, stitchlessRuns = 0;
    let timeSum = 0, paceKmSum = 0;
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
      if (mm > 0 && k > 0) { timeSum += mm * 60; paceKmSum += k; }
    });
    let best = 0, cur = 0;
    FLAT.forEach((f) => { if (log[f.key] && log[f.key].done) { cur++; best = Math.max(best, cur); } else cur = 0; });
    const fullWeeks = WEEKS.filter((w) => w.days.every((_, i) => log[`w${w.n}d${i}`] && log[`w${w.n}d${i}`].done)).length;
    const avgPaceSec = paceKmSum > 0 ? timeSum / paceKmSum : 0;
    return { kmLogged, done, stitches, runsLogged, best, maxKm, bestPaceSec, stitchlessRuns, fullWeeks, avgPaceSec, projected5kSec: avgPaceSec * 5 };
  }, [log]);

  const weekly = useMemo(() => WEEKS.map((w) => {
    let value = 0, target = 0;
    w.days.forEach((day, di) => {
      target += day.km || 0;
      const e = log[`w${w.n}d${di}`];
      const k = e && parseFloat(e.km);
      if (k && !isNaN(k)) value += k;
    });
    return { label: w.n, value, target };
  }), [log]);

  const todayIdx = todayIndexOf(startDate);

  const cells = useMemo(() => FLAT.map((f, i) => ({
    done: !!(log[f.key] && log[f.key].done),
    type: f.type,
    isToday: i === todayIdx,
    isPast: startDate && i < todayIdx,
    label: startDate ? dateForDay(startDate, i).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : f.d,
  })), [log, startDate, todayIdx]);

  const history = useMemo(() => {
    const items = FLAT.map((f) => ({ ...f, e: log[f.key] || {} }))
      .filter((f) => f.e.done || parseFloat(f.e.km) > 0);
    items.sort((a, b) => (b.e.date || "").localeCompare(a.e.date || ""));
    return items;
  }, [log]);

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
    if (fresh) { setToast(fresh); haptic([10, 30, 10]); }
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
  const saveTrackedRun = (r) => {
    update(r.dayKey, {
      done: true, km: r.km, min: r.min, tracked: true, route: r.route, splits: r.splits, durMs: r.durMs,
      elev: r.elev, kcal: r.kcal, runKm: r.runKm, walkKm: r.walkKm,
    });
    setTrackerOpen(false);
    setTab("history");
  };

  const msg = nextUp ? `Today: Week ${nextUp.week} · ${nextUp.d} · ${nextUp.title} — ${nextUp.detail}` : "You finished the plan — go enjoy a victory run! 🎖️";
  const msgRef = useRef(msg);
  msgRef.current = msg;
  useEffect(() => {
    if (!remOn) return;
    syncMessage(msg);
    if (isNative()) nativeUpdateReminder(remTime, msg);
  }, [msg, remOn]);

  useEffect(() => {
    const stop = startForegroundScheduler(() => msgRef.current);
    return stop;
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
  let eyebrow = "4-WEEK MISSION", countdown = null;
  if (startDate) {
    if (todayIdx < 0) eyebrow = `STARTS IN ${-todayIdx} DAY${-todayIdx === 1 ? "" : "S"}`;
    else if (todayIdx >= TOTAL) eyebrow = "PLAN COMPLETE 🎖️";
    else {
      eyebrow = `DAY ${todayIdx + 1} OF ${TOTAL}`;
      const toGoal = TOTAL - 1 - todayIdx;
      countdown = toGoal > 0 ? `${toGoal} days to your 5K` : "Race day is today! 🏁";
    }
  }

  const Stat = ({ label, value, sub, color, delay = 0 }) => (
    <div className="card tap stagger" style={{ animationDelay: `${delay}s`, flex: 1, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 12px" }}>
      <div className="num" style={{ fontSize: 27, fontWeight: 800, color: color || C.text, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, letterSpacing: 1.5, color: C.dim, marginTop: 6, fontWeight: 600 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{sub}</div>}
    </div>
  );
  const Card = ({ children, style }) => (
    <div className="card" style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16, ...style }}>{children}</div>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Manrope', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=Manrope:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        button { font-family: inherit; }
        .syne { font-family: 'Syne', sans-serif; }
        .num { font-family: 'Syne', sans-serif; font-variant-numeric: tabular-nums; }
        input { font-family: 'Manrope', sans-serif; }
        .row, .card { transition: background .15s ease, border-color .15s ease, transform .12s ease, box-shadow .2s ease; }
        .tap { cursor: pointer; }
        .tap:active { transform: scale(.97); }
        .glow { box-shadow: 0 0 0 1px ${C.accent}, 0 0 26px -6px ${C.accent}; }
        @keyframes rise { from { opacity:0; transform: translateY(8px) } to { opacity:1; transform:none } }
        @keyframes pop { 0%{ transform:scale(.6) } 60%{ transform:scale(1.18) } 100%{ transform:scale(1) } }
        @keyframes toastIn { from{ opacity:0; transform: translate(-50%, -16px) } to{ opacity:1; transform: translate(-50%,0) } }
        .rise { animation: rise .3s ease both; }
        .pop { animation: pop .32s ease; }
        .inp { background:${C.bg}; border:1px solid ${C.line}; color:${C.text}; border-radius:10px; padding:9px 11px; width:100%; font-size:14px; font-weight:600; outline:none; }
        .inp:focus { border-color:${C.accent}; }
        .chip { cursor:pointer; border-radius:999px; padding:7px 13px; font-size:12px; font-weight:700; border:1px solid ${C.line}; background:${C.bg}; color:${C.dim}; transition: transform .12s ease; }
        .chip:active { transform: scale(.96); }
        .sw { width:46px; height:27px; border-radius:999px; border:none; cursor:pointer; position:relative; transition:background .2s; }
        .sw b { position:absolute; top:3px; left:3px; width:21px; height:21px; border-radius:50%; background:#fff; transition:left .2s; }
        html, body { background:${C.bg}; }
        /* ambient glow behind the header */
        .appbg { position:fixed; inset:0; pointer-events:none; z-index:0;
          background:
            radial-gradient(120% 60% at 85% -8%, ${C.accent}1f, transparent 60%),
            radial-gradient(90% 50% at -10% 4%, ${C.easy}14, transparent 55%); }
        /* cards get a subtle top-lit depth + hairline highlight */
        .card { background: linear-gradient(180deg, ${C.surface}, ${C.surface2}) !important;
          box-shadow: 0 1px 0 0 rgba(255,255,255,.03) inset, 0 10px 30px -22px #000; }
        .card.glow { box-shadow: 0 0 0 1px ${C.accent}, 0 0 26px -6px ${C.accent}; }
        /* gradient primary call-to-action with a slow sheen */
        .cta { position:relative; overflow:hidden; border:none !important;
          background: linear-gradient(135deg, ${C.accent}, ${C.easy}) !important; color:${C.bg} !important;
          box-shadow: 0 10px 30px -10px ${C.accent}; }
        .cta::after { content:""; position:absolute; top:0; bottom:0; width:40%; left:-60%;
          background: linear-gradient(100deg, transparent, rgba(255,255,255,.45), transparent);
          transform: skewX(-18deg); animation: sheen 4.5s ease-in-out infinite; }
        @keyframes sheen { 0%,55%{ left:-60% } 80%,100%{ left:140% } }
        /* breathing glow for the hero "next up" card */
        @keyframes pulseGlow { 0%,100%{ box-shadow: 0 0 0 1px ${C.accent}88, 0 0 22px -10px ${C.accent} } 50%{ box-shadow: 0 0 0 1px ${C.accent}, 0 0 40px -6px ${C.accent} } }
        .breathe { animation: pulseGlow 3.4s ease-in-out infinite; }
        /* staggered fade/scale used by stat cards, weeks and grid cells */
        @keyframes cellIn { from{ opacity:0; transform: scale(.5) } to{ opacity:1; transform: none } }
        @keyframes slideUp { from{ opacity:0; transform: translateY(14px) } to{ opacity:1; transform:none } }
        .stagger { opacity:0; animation: slideUp .45s ease forwards; }
        @keyframes spin { to { transform: rotate(360deg) } }
        .spin { animation: spin 1s linear infinite; }
        @keyframes floaty { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(-6px) } }
        .floaty { animation: floaty 3s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce){ .breathe,.stagger,.cta::after,.spin{ animation:none !important } .stagger{ opacity:1 } }
      `}</style>

      <div className="appbg" />

      {/* Achievement toast */}
      {toast && (
        <div style={{ position: "fixed", top: "calc(14px + env(safe-area-inset-top))", left: "50%", transform: "translateX(-50%)", zIndex: 9998, animation: "toastIn .3s ease both", width: "calc(100% - 32px)", maxWidth: 380 }}>
          <div className="glow" style={{ display: "flex", alignItems: "center", gap: 12, background: C.surface, border: `1px solid ${C.accent}`, borderRadius: 14, padding: "12px 14px" }}>
            <span style={{ fontSize: 26 }}>{toast.icon}</span>
            <div>
              <div style={{ fontSize: 10, letterSpacing: 1.5, color: C.accent, fontWeight: 800 }}>{toast.label || "ACHIEVEMENT UNLOCKED"}</div>
              <div className="syne" style={{ fontSize: 15, fontWeight: 800 }}>{toast.title}</div>
            </div>
          </div>
        </div>
      )}

      <div style={{ position: "relative", zIndex: 1, maxWidth: 620, margin: "0 auto", padding: "max(22px, env(safe-area-inset-top)) 16px calc(96px + env(safe-area-inset-bottom))" }}>
        {/* Top bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 3, color: C.accent, fontWeight: 700 }}>{eyebrow}</div>
            <h1 className="syne" style={{ fontSize: 30, fontWeight: 800, margin: "2px 0 0", letterSpacing: -0.5 }}>ROAD TO 5K</h1>
            {countdown && <div style={{ fontSize: 12, color: C.dim, marginTop: 3, fontWeight: 600 }}>{countdown}</div>}
          </div>
          <div style={{ position: "relative", width: 108, height: 108 }}>
            <svg width="108" height="108" style={{ transform: "rotate(-90deg)" }}>
              <defs>
                <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={C.accent} />
                  <stop offset="100%" stopColor={C.easy} />
                </linearGradient>
              </defs>
              <circle cx="54" cy="54" r={R} fill="none" stroke={C.surface2} strokeWidth="9" />
              <circle cx="54" cy="54" r={R} fill="none" stroke="url(#ring)" strokeWidth="9" strokeLinecap="round"
                strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - pctShown / 100)} style={{ transition: "stroke-dashoffset .25s ease", filter: `drop-shadow(0 0 6px ${C.accent}66)` }} />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <span className="num" style={{ fontSize: 24, fontWeight: 800 }}>{pctShown}%</span>
              <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1 }}>{stats.done}/{TOTAL} DAYS</span>
            </div>
          </div>
        </div>

        {installEvt && (
          <button onClick={doInstall} className="chip" style={{ width: "100%", padding: "11px 14px", marginBottom: 14, background: C.accent, color: C.bg, border: "none", fontSize: 13 }}>
            ⬇ Install Road to 5K on your phone
          </button>
        )}

        {tab === "stats" && (
          <div className="rise">
            <button onClick={() => { haptic(12); setTrackerOpen(true); }} className="tap cta"
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 9, borderRadius: 14, padding: "16px 0", fontSize: 15, fontWeight: 800, letterSpacing: 0.5, marginBottom: 14, cursor: "pointer" }}>
              <span style={{ width: 9, height: 9, borderRadius: 9, background: C.bg }} /> TRACK A RUN WITH GPS
            </button>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <Stat label="KM LOGGED" value={kmShown.toFixed(1)} color={C.accent} delay={0} />
              <Stat label="BEST STREAK" value={stats.best} sub="days in a row" delay={0.05} />
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <Stat label="RUNS DONE" value={stats.runsLogged} delay={0.1} />
              <Stat label="STITCHES" value={stats.stitches} sub="should drop!" color={stats.stitches ? C.warn : C.easy} delay={0.15} />
            </div>

            {/* Personal bests */}
            <Card style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: C.dim, fontWeight: 700, marginBottom: 10 }}>PERSONAL BESTS</div>
              <div style={{ display: "flex", gap: 8 }}>
                <PB label="FASTEST" value={fmtPace(stats.bestPaceSec) || "—"} unit="/km" />
                <PB label="LONGEST" value={stats.maxKm ? stats.maxKm : "—"} unit={stats.maxKm ? "km" : ""} />
                <PB label="BIG WEEK" value={(Math.max(0, ...weekly.map((w) => w.value))).toFixed(1)} unit="km" />
              </div>
            </Card>

            {stats.projected5kSec > 0 && (
              <Card style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ fontSize: 30 }}>🎯</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, letterSpacing: 2, color: C.dim, fontWeight: 700 }}>PROJECTED 5K TIME</div>
                  <div className="num" style={{ fontSize: 24, fontWeight: 800, color: C.accent }}>{fmtPace(stats.projected5kSec)}</div>
                  <div style={{ fontSize: 11, color: C.dim }}>at your average logged pace ({fmtPace(stats.avgPaceSec)}/km)</div>
                </div>
              </Card>
            )}

            {/* Schedule / today */}
            <Card style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: C.dim, fontWeight: 700, marginBottom: 6 }}>PLAN SCHEDULE</div>
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
              <div style={{ fontSize: 10, letterSpacing: 2, color: C.dim, fontWeight: 700, marginBottom: 8 }}>KM PER WEEK · LOGGED VS PLAN</div>
              <WeeklyBars data={weekly} />
            </Card>
            <Card style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: C.dim, fontWeight: 700, marginBottom: 8 }}>CUMULATIVE DISTANCE</div>
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
                      style={{ textAlign: "center", padding: "10px 4px", borderRadius: 12, background: got ? C.surface2 : "transparent", border: `1px solid ${got ? C.line : "transparent"}`, opacity: got ? 1 : 0.4 }}>
                      <div style={{ fontSize: 24, filter: got ? "none" : "grayscale(1)" }}>{a.icon}</div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: got ? C.text : C.dim, marginTop: 4, lineHeight: 1.2 }}>{a.title}</div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Reminders */}
            <Card style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, letterSpacing: 2, color: C.dim, fontWeight: 700 }}>DAILY REMINDER</div>
                  <div style={{ fontSize: 13, color: C.text, marginTop: 3, fontWeight: 600 }}>Get nudged to do your session</div>
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
              {!isNative() && !notificationsSupported() && <div style={{ fontSize: 11, color: C.warn, marginTop: 8 }}>This browser can't show notifications.</div>}
              {!isNative() && notificationsSupported() && perm === "denied" && <div style={{ fontSize: 11, color: C.warn, marginTop: 8 }}>Notifications are blocked — enable them in your browser/site settings.</div>}
              <div style={{ fontSize: 11, color: C.dim, marginTop: 8, lineHeight: 1.5 }}>
                {isNative()
                  ? "Reminders run in the background and fire even when the app is closed."
                  : "Tip: install the app (Add to Home Screen) for the most reliable reminders."}
              </div>
            </Card>

            {/* Data & backup */}
            <Card style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: C.dim, fontWeight: 700, marginBottom: 10 }}>DATA & BACKUP</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={exportData} className="chip tap" style={{ flex: 1, background: C.surface2, color: C.text, padding: "11px 0" }}>⬇ Export</button>
                <button onClick={() => importRef.current?.click()} className="chip tap" style={{ flex: 1, background: C.surface2, color: C.text, padding: "11px 0" }}>⬆ Import</button>
                <button onClick={shareProgress} className="chip tap" style={{ flex: 1, background: C.surface2, color: C.text, padding: "11px 0" }}>↗ Share</button>
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
              <div style={{ fontSize: 10, letterSpacing: 2, color: C.dim, fontWeight: 700 }}>TREADMILL STOPWATCH · NO GPS</div>
              <div className="num" style={{ fontSize: 52, fontWeight: 800, margin: "6px 0 12px", color: swRun ? C.accent : C.text }}>{fmt(swMs)}</div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                <button onClick={() => { setSwRun((r) => !r); haptic(10); }} className="chip"
                  style={{ background: swRun ? C.warn : C.accent, color: C.bg, border: "none", padding: "11px 26px", fontSize: 14 }}>
                  {swRun ? "PAUSE" : swMs ? "RESUME" : "START"}
                </button>
                <button onClick={() => { setSwRun(false); setSwMs(0); haptic(8); }} className="chip" style={{ padding: "11px 22px", fontSize: 14 }}>RESET</button>
              </div>
            </Card>
          </div>
        )}

        {tab === "history" && (
          <div className="rise">
            {history.length === 0 ? (
              <Card style={{ textAlign: "center" }}>
                <div className="syne" style={{ fontSize: 18, fontWeight: 800 }}>No runs logged yet</div>
                <div style={{ fontSize: 13, color: C.dim, marginTop: 4 }}>Tick off a day on the Plan tab and it'll show up here.</div>
              </Card>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {history.map((h, idx) => {
                  const p = fmtPace(paceSec(h.e.min, h.e.km));
                  const date = h.e.date ? new Date(h.e.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
                  const extras = [];
                  if (h.e.elev > 0) extras.push(`▲ ${h.e.elev} m`);
                  if (h.e.kcal > 0) extras.push(`🔥 ${h.e.kcal} kcal`);
                  if (h.e.runKm > 0) extras.push(`🏃 ${h.e.runKm} km`);
                  if (h.e.walkKm > 0) extras.push(`🚶 ${h.e.walkKm} km`);
                  return (
                    <Card key={h.key} style={{ padding: "12px 14px", animation: `rise .3s ease both`, animationDelay: `${Math.min(idx * 0.03, 0.3)}s` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ width: 4, alignSelf: "stretch", borderRadius: 4, background: typeColor(h.type) }} />
                        <div style={{ flex: 1 }}>
                          <div className="syne" style={{ fontSize: 15, fontWeight: 700 }}>{h.title}</div>
                          <div style={{ fontSize: 11, color: C.dim }}>Week {h.week} · {h.d} · {date}</div>
                          {h.e.note && <div style={{ fontSize: 12, color: C.dim, marginTop: 4, fontStyle: "italic" }}>“{h.e.note}”</div>}
                        </div>
                        <div style={{ textAlign: "right" }}>
                          {parseFloat(h.e.km) > 0 && <div className="num" style={{ fontSize: 18, fontWeight: 800, color: C.accent }}>{parseFloat(h.e.km)} km</div>}
                          <div style={{ fontSize: 11, color: C.dim }}>{h.e.min ? `${h.e.min} min` : ""}{p ? ` · ${p}/km` : ""}</div>
                          {h.e.stitch && <div style={{ fontSize: 10, color: C.warn, fontWeight: 700 }}>STITCH 😣</div>}
                          {h.e.tracked && <div style={{ fontSize: 9, color: C.easy, fontWeight: 800, letterSpacing: 1 }}>● GPS</div>}
                        </div>
                      </div>
                      {(extras.length > 0 || (h.e.route && h.e.route.length > 1)) && (
                        <div style={{ marginTop: 10 }}>
                          {h.e.route && h.e.route.length > 1 && (
                            <RouteMap points={h.e.route.map(([lat, lng]) => ({ lat, lng }))} height={130} />
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
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === "plan" && (
          <div className="rise">
            <button onClick={() => { haptic(12); setTrackerOpen(true); }} className="tap cta"
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 9, borderRadius: 14, padding: "16px 0", fontSize: 15, fontWeight: 800, letterSpacing: 0.5, marginBottom: 14, cursor: "pointer" }}>
              <span style={{ width: 9, height: 9, borderRadius: 9, background: C.bg }} /> TRACK A RUN WITH GPS
            </button>
            {!startDate && (
              <button onClick={() => { setTab("stats"); haptic(8); }} className="chip"
                style={{ width: "100%", padding: "11px 14px", marginBottom: 14, background: C.surface, color: C.text, fontSize: 13 }}>
                📅 Add your start date to highlight today's run
              </button>
            )}
            {/* Next up */}
            {nextUp ? (
              <div className="breathe" style={{ background: `linear-gradient(135deg, ${C.surface2}, ${C.surface})`, borderRadius: 16, padding: 18, marginBottom: 18, position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", right: -30, top: -30, width: 120, height: 120, borderRadius: "50%", background: `radial-gradient(circle, ${C.accent}22, transparent 70%)` }} />
                <div style={{ fontSize: 10, letterSpacing: 2, color: C.accent, fontWeight: 700 }}>NEXT UP · WEEK {nextUp.week}</div>
                <div className="syne" style={{ fontSize: 25, fontWeight: 800, margin: "5px 0 3px" }}>{nextUp.d} · {nextUp.title}</div>
                <div style={{ fontSize: 13, color: C.dim }}>{nextUp.detail}</div>
              </div>
            ) : (
              <div className="glow" style={{ background: C.surface, borderRadius: 16, padding: 18, marginBottom: 18, textAlign: "center" }}>
                <div className="syne" style={{ fontSize: 22, fontWeight: 800 }}>🎖️ MISSION COMPLETE</div>
                <div style={{ fontSize: 13, color: C.dim, marginTop: 4 }}>You built up to 5 km. Go crush that army run.</div>
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
              return (
                <div key={w.n} className="stagger" style={{ marginBottom: 22, animationDelay: `${(w.n - 1) * 0.06}s` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
                    <span className="syne" style={{ fontSize: 14, fontWeight: 800, letterSpacing: 1 }}>WEEK {w.n}</span>
                    <span style={{ fontSize: 11, color: C.dim }}>{w.label}</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: C.dim, fontWeight: 600 }}>{wDone}/{w.days.length}</span>
                  </div>
                  <div style={{ display: "grid", gap: 7 }}>
                    {w.days.map((day, di) => {
                      const key = `w${w.n}d${di}`;
                      const e = log[key] || {};
                      const isOpen = open === key;
                      const flatIdx = (w.n - 1) * 7 + di;
                      const isToday = flatIdx === todayIdx;
                      return (
                        <div key={di}>
                          <div className="row tap" onClick={() => { setOpen(isOpen ? null : key); haptic(5); }}
                            style={{ display: "flex", alignItems: "center", gap: 12, background: C.surface, border: `1px solid ${isToday ? C.accent : e.done ? typeColor(day.type) : C.line}`, borderRadius: isOpen ? "12px 12px 0 0" : 12, padding: "11px 13px", boxShadow: isToday ? `0 0 18px -8px ${C.accent}` : "none" }}>
                            <button onClick={(ev) => { ev.stopPropagation(); update(key, { done: !e.done }); }}
                              className={e.done ? "pop" : ""}
                              style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 8, border: `2px solid ${e.done ? typeColor(day.type) : C.line}`, background: e.done ? typeColor(day.type) : "transparent", color: C.bg, fontWeight: 900, fontSize: 15, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              {e.done ? "✓" : ""}
                            </button>
                            <div style={{ width: 30, fontSize: 11, fontWeight: 700, color: C.dim }}>{day.d}</div>
                            <div style={{ flex: 1 }}>
                              <div className="syne" style={{ fontSize: 16, fontWeight: 700, textDecoration: e.done ? "line-through" : "none", color: e.done ? C.dim : C.text }}>{day.title}</div>
                              <div style={{ fontSize: 11, color: C.dim, marginTop: 1 }}>{day.detail}</div>
                            </div>
                            {isToday && <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: 1, color: C.bg, background: C.accent, padding: "3px 6px", borderRadius: 6 }}>TODAY</span>}
                            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: typeColor(day.type) }}>{day.type.toUpperCase()}</span>
                          </div>

                          {isOpen && (
                            <div className="rise" style={{ background: C.surface2, border: `1px solid ${C.line}`, borderTop: "none", borderRadius: "0 0 12px 12px", padding: 14 }}>
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
                                  {e.stitch ? "YES 😣" : "NO 🙌"}
                                </button>
                              </div>
                              <input className="inp" placeholder="How did it feel? (note)" value={e.note ?? ""} onChange={(ev) => update(key, { note: ev.target.value })} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 13, fontSize: 12, lineHeight: 1.5, color: C.dim, marginBottom: 14 }}>
              <b style={{ color: C.text }}>Listen to your body.</b> Muscle soreness = normal. Sharp joint or shin pain = stop and rest 1–2 days. Don't arrive injured.
            </div>
            <button onClick={reset} className="chip" style={{ fontSize: 11, letterSpacing: 1 }}>RESET ALL PROGRESS</button>
          </div>
        )}

        {!loaded && <div style={{ fontSize: 11, color: C.dim, marginTop: 12 }}>loading…</div>}
      </div>

      <BottomNav tab={tab} onChange={(t) => { setTab(t); setOpen(null); haptic(6); }} />

      {trackerOpen && (
        <RunTracker
          days={FLAT}
          defaultKey={trackDefaultKey}
          onSave={saveTrackedRun}
          onClose={() => setTrackerOpen(false)}
        />
      )}
    </div>
  );
}

function PB({ label, value, unit }) {
  return (
    <div style={{ flex: 1, textAlign: "center", background: C.surface2, borderRadius: 12, padding: "10px 6px" }}>
      <div className="num" style={{ fontSize: 19, fontWeight: 800, color: C.text }}>{value}<span style={{ fontSize: 11, color: C.dim, fontWeight: 700 }}>{unit ? " " + unit : ""}</span></div>
      <div style={{ fontSize: 9, letterSpacing: 1, color: C.dim, marginTop: 4, fontWeight: 700 }}>{label}</div>
    </div>
  );
}
