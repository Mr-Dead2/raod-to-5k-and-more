import React, { useState, useEffect, useRef, useCallback } from "react";
import { C, tint } from "../data.js";
import { LiveMap } from "./LiveMap.jsx";
import { Icon, Group, Cell, Switch, Stepper, Segmented, MetricGrid } from "./ui.jsx";
import { useRunTracker, haversine } from "../tracker.js";
import { haptic } from "../celebrate.js";
import { ensureLocationPermission, isNative } from "../native.js";
import { primeAudio, beep, speak, paceWords } from "../cues.js";
import { loadSettings, saveSettings } from "../storage.js";
import { useHeartRate, hrSupported } from "../hr.js";
import { useStepCounter, cadenceSupported, ensureMotionPermission } from "../cadence.js";
import { notifyRunInterval, primeRunNotifications } from "../notifications.js";

// kcal per kg of body weight per km — standard flat-ground estimates
const KCAL_RUN = 1.036, KCAL_WALK = 0.53;

const fmtTime = (ms) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, "0"), ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
const fmtPace = (secPerKm) => (secPerKm && isFinite(secPerKm) ? `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, "0")}` : null);

// One metric for the Workout grid. No reading yet is an em dash in grey, as
// Health shows it — not a row of hyphens pretending to be a number.
const metric = (label, value, unit, color) => (value == null || value === "" || Number.isNaN(value)
  ? { label, value: "—", color: C.dim2 }
  : { label, value, unit, color });

function recentPaceSec(points, windowM = 200) {
  if (points.length < 2) return 0;
  let i = points.length - 1, dist = 0;
  while (i > 0 && dist < windowM) { dist += haversine(points[i - 1], points[i]); i--; }
  const dt = (points[points.length - 1].t - points[i].t) / 1000;
  if (dist < 20 || dt <= 0) return 0;
  return 1000 / (dist / dt);
}

function downsample(points, max = 250) {
  const compact = (p) => {
    const arr = [Number(p.lat.toFixed(5)), Number(p.lng.toFixed(5))];
    if (p.phase) arr.push(p.phase[0]); // 'r' or 'w' — phase char for map coloring
    return arr;
  };
  if (points.length <= max) return points.map(compact);
  const step = points.length / max;
  const out = [];
  for (let i = 0; i < points.length; i += step) out.push(compact(points[Math.floor(i)]));
  out.push(compact(points[points.length - 1]));
  return out;
}

// Pull a "run X / walk Y" pattern (minutes) out of a session's description.
function parseInterval(detail = "") {
  const m = detail.match(/run\s*(\d+)\s*(?:min)?\s*\/\s*walk\s*(\d+)/i);
  return m ? { run: Number(m[1]), walk: Number(m[2]) } : null;
}

// Live run-vs-walk breakdown while interval cues are on: distance, time and
// pace covered in each phase.
function PhaseBreakdown({ runM, walkM, runSec, walkSec }) {
  if (runM + walkM < 20) return null;
  const block = (label, m, sec, color) => (
    <div className="card" style={{ flex: 1, borderRadius: 20, padding: "12px 14px", background: `linear-gradient(160deg, ${tint(color, 0.16)}, ${C.surface} 70%)` }}>
      <div className="t-foot" style={{ fontWeight: 600, color }}>{label}</div>
      <div className="num" style={{ fontSize: 24, fontWeight: 700, marginTop: 2 }}>{(m / 1000).toFixed(2)}<span style={{ fontSize: 12, color: C.dim, marginLeft: 2 }}>KM</span></div>
      <div className="num t-foot" style={{ color: C.dim, marginTop: 1 }}>{fmtTime(sec * 1000)} · {fmtPace(m > 20 ? sec / (m / 1000) : 0) ? `${fmtPace(sec / (m / 1000))}/km` : "—"}</div>
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
      {block("Running", runM, runSec, C.accent)}
      {block("Walking", walkM, walkSec, C.easy)}
    </div>
  );
}

// Splits as Fitness shows them: one row per kilometre, a bar as long as the
// kilometre was fast, the fastest picked out in the pace colour.
function SplitsTable({ splits }) {
  if (!splits.length) return null;
  const fast = Math.min(...splits), slow = Math.max(...splits);
  return (
    <div className="card" style={{ padding: "14px 16px 6px", marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", marginBottom: 4 }}>
        <span className="t-headline">Splits</span>
        <span className="t-foot" style={{ marginLeft: "auto", color: C.dim }}>pace per km</span>
      </div>
      {splits.map((s, i) => {
        const w = slow === fast ? 1 : 0.42 + 0.58 * ((slow - s) / (slow - fast));
        const best = s === fast && splits.length > 1;
        return (
          <div key={i} className="split-row">
            <span className="num t-foot" style={{ width: 20, color: C.dim }}>{i + 1}</span>
            <span className="split-bar"><i style={{ width: `${w * 100}%`, background: best ? C.cyan : undefined }} /></span>
            <span className="num" style={{ width: 50, textAlign: "right", fontSize: 16, fontWeight: 600, color: best ? C.cyan : C.text }}>{fmtPace(s)}</span>
          </div>
        );
      })}
    </div>
  );
}

// Workout's big round controls: colour says what they do before the label does.
function RoundControl({ label, color, icon, onClick }) {
  return (
    <button onClick={onClick} className="round-ctl" aria-label={label}>
      <span style={{ background: tint(color, 0.24), color }}><Icon name={icon} size={30} weight={2.8} /></span>
      <span className="t-foot" style={{ fontWeight: 600 }}>{label}</span>
    </button>
  );
}

// The 3-2-1: each number sits in a ring that drains over its second.
function Countdown({ count }) {
  const go = count === "GO";
  return (
    <div className="countdown" role="status" aria-live="assertive">
      <div style={{ position: "relative", width: 236, height: 236 }}>
        <svg width="236" height="236" viewBox="0 0 236 236" style={{ transform: "rotate(-90deg)", display: "block" }} aria-hidden="true">
          <circle cx="118" cy="118" r="106" fill="none" stroke={tint(C.accent, 0.18)} strokeWidth="14" />
          {!go && <circle key={count} cx="118" cy="118" r="106" fill="none" stroke={C.accent} strokeWidth="14" strokeLinecap="round" pathLength="100" strokeDasharray="100" className="count-ring" />}
        </svg>
        <div key={count} className="num pop" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: go ? 78 : 120, fontWeight: 700, color: C.accent }}>
          {go ? "Go" : count}
        </div>
      </div>
    </div>
  );
}

export function RunTracker({ onClose, onSave, onShare, days, defaultKey, targetRoute }) {
  const [audioOn, setAudioOn] = useState(true);
  const [autoPauseOn, setAutoPauseOn] = useState(true);
  const [count, setCount] = useState(null); // 3..1, "GO", or null
  const [dayKey, setDayKey] = useState(defaultKey);
  useEffect(() => { setDayKey(defaultKey); }, [defaultKey]);

  // run/walk intervals, pre-filled from the upcoming session's pattern
  const parsed = parseInterval(days.find((d) => d.key === defaultKey)?.detail);
  const [intervalOn, setIntervalOn] = useState(!!parsed);
  const [runMin, setRunMin] = useState(parsed?.run || 6);
  const [walkMin, setWalkMin] = useState(parsed?.walk || 1);

  // Stable ref so callbacks from the GPS fix path don't close over stale state
  const audioOnRef = useRef(audioOn);
  useEffect(() => { audioOnRef.current = audioOn; }, [audioOn]);

  // Deduplication ref — prevents double-firing when both GPS-fix path and
  // ticker-based React effect detect the same phase transition.
  const lastCuedPhaseRef = useRef(null);
  const announcePhaseCue = useCallback((ph) => {
    if (ph === lastCuedPhaseRef.current) return;
    lastCuedPhaseRef.current = ph;
    if (ph === "walk") { haptic([0, 250, 130, 250]); beep(440, 320); if (audioOnRef.current) speak("Walk now"); }
    else { haptic([0, 130, 90, 130, 90, 360]); beep(990, 320); if (audioOnRef.current) speak("Run now"); }
    // Also post a notice, so the cue lands with the phone pocketed and locked.
    notifyRunInterval(ph === "walk" ? "Walk now — ease off and recover." : "Run now — pick the pace back up.").catch?.(() => {});
  }, []);

  const t = useRunTracker({
    autoPause: autoPauseOn,
    interval: intervalOn && runMin > 0 && walkMin > 0 ? { runSec: runMin * 60, walkSec: walkMin * 60 } : null,
    // Called directly from the GPS fix callback — more reliable for background/
    // screen-off cues on native Android than the React effect path below.
    onPhaseChange: announcePhaseCue,
  });

  // body weight for the calorie estimate, remembered between runs
  const [weightKg, setWeightKg] = useState(() => loadSettings().weightKg || 70);
  const setWeight = (fn) => setWeightKg((v) => {
    const n = Math.max(30, typeof fn === "function" ? fn(v) : fn);
    saveSettings({ ...loadSettings(), weightKg: n });
    return n;
  });

  // cadence (steps/min) — counts while tracking and not paused
  const cadenceOn = cadenceSupported();
  const tracking = t.status === "tracking" || t.status === "paused";
  const cad = useStepCounter(cadenceOn && tracking, t.status === "paused" || t.autoPaused);

  // run goal (distance or time), remembered between runs
  const [goalType, setGoalType] = useState(() => loadSettings().runGoalType || "none"); // none | distance | time
  const [goalDist, setGoalDist] = useState(() => loadSettings().runGoalDist || 5);
  const [goalTime, setGoalTime] = useState(() => loadSettings().runGoalTime || 30);
  const saveGoalType = (v) => { setGoalType(v); saveSettings({ ...loadSettings(), runGoalType: v }); };
  const setGoalDistP = (fn) => setGoalDist((v) => { const n = Math.max(1, typeof fn === "function" ? fn(v) : fn); saveSettings({ ...loadSettings(), runGoalDist: n }); return n; });
  const setGoalTimeP = (fn) => setGoalTime((v) => { const n = Math.max(1, typeof fn === "function" ? fn(v) : fn); saveSettings({ ...loadSettings(), runGoalTime: n }); return n; });

  // optional Bluetooth heart-rate monitor (chest strap / watch broadcasting HR)
  const hr = useHeartRate();
  const hrAgg = useRef({ sum: 0, n: 0, max: 0 });
  useEffect(() => {
    if (t.status === "tracking" && hr.bpm > 0) {
      const a = hrAgg.current;
      a.sum += hr.bpm; a.n += 1; a.max = Math.max(a.max, hr.bpm);
    }
  }, [hr.bpm, t.status]);
  const hrAvg = hrAgg.current.n ? Math.round(hrAgg.current.sum / hrAgg.current.n) : 0;
  const hrMax = hrAgg.current.max;
  // A monitor that is momentarily reconnecting still counts as present: hiding
  // its row would make the whole screen jump every time a watch's broadcast app
  // blinks, and would read as "gone" when it is coming straight back.
  const hrLive = hr.status === "connected" || hr.status === "reconnecting";

  // spoken / beep cue whenever a new km split is recorded
  const prevSplits = useRef(0);
  useEffect(() => {
    if (t.splits.length > prevSplits.current) {
      const k = t.splits.length, pace = t.splits[k - 1];
      beep(880, 200); haptic(12);
      if (audioOn) speak(`${k} kilometer${k > 1 ? "s" : ""} done. Pace ${paceWords(pace)} per kilometer.`);
    }
    prevSplits.current = t.splits.length;
  }, [t.splits, audioOn]);

  const km = t.distanceM / 1000;
  const elapsedSec = t.elapsedMs / 1000;
  const avgPace = km > 0.02 ? elapsedSec / km : 0;
  const curPace = t.status === "tracking" && !t.autoPaused ? recentPaceSec(t.points) : 0;
  const accColor = t.accuracy == null ? C.dim : t.accuracy <= 12 ? C.easy : t.accuracy <= 30 ? C.accent : C.warn;

  const speedNow = curPace > 0 ? 3600 / curPace : 0; // km/h
  // distance covered while running vs walking (run/walk cues only)
  const runKm = t.phaseDist.run / 1000, walkKm = t.phaseDist.walk / 1000;
  // anything tracked outside the interval phases burns at the running rate
  const otherKm = Math.max(0, km - runKm - walkKm);
  const kcal = weightKg * (runKm * KCAL_RUN + walkKm * KCAL_WALK + otherKm * KCAL_RUN);

  // average cadence over the (non-paused) elapsed time
  const avgCadence = cad.steps > 0 && elapsedSec > 5 ? Math.round(cad.steps / (elapsedSec / 60)) : 0;

  // run goal progress
  const goalActive = goalType !== "none" && tracking;
  let goalPct = 0, goalName = "", goalSub = "", goalDone = false;
  if (goalType === "distance" && goalDist > 0) {
    goalDone = km >= goalDist;
    goalPct = Math.min(1, km / goalDist);
    const rem = Math.max(0, goalDist - km);
    const eta = rem > 0 && avgPace > 0 ? rem * avgPace : 0;
    goalName = `${goalDist} km`;
    goalSub = goalDone ? "Goal reached 🎉" : `${rem.toFixed(2)} km to go${eta ? ` · ~${fmtTime(eta * 1000)} left` : ""}`;
  } else if (goalType === "time" && goalTime > 0) {
    const em = elapsedSec / 60;
    goalDone = em >= goalTime;
    goalPct = Math.min(1, em / goalTime);
    const remSec = Math.max(0, goalTime * 60 - elapsedSec);
    goalName = `${goalTime} min`;
    goalSub = goalDone ? "Goal reached 🎉" : `${fmtTime(remSec * 1000)} to go · ${km.toFixed(2)} km so far`;
  }

  // run/walk phase derived from elapsed time (so it freezes with pause/auto-pause)
  const cycleSec = (runMin + walkMin) * 60;
  const intervalActive = intervalOn && runMin > 0 && walkMin > 0 && (t.status === "tracking" || t.status === "paused");
  let phase = null, phaseLeft = 0;
  if (intervalActive && cycleSec > 0) {
    const pos = elapsedSec % cycleSec;
    if (pos < runMin * 60) { phase = "RUN"; phaseLeft = Math.ceil(runMin * 60 - pos); }
    else { phase = "WALK"; phaseLeft = Math.ceil(cycleSec - pos); }
  }
  // time spent in each phase follows directly from elapsed time and the cycle
  let runTimeSec = 0, walkTimeSec = 0;
  if (intervalOn && cycleSec > 0 && runMin > 0 && walkMin > 0) {
    const fullCycles = Math.floor(elapsedSec / cycleSec);
    runTimeSec = fullCycles * runMin * 60 + Math.min(elapsedSec % cycleSec, runMin * 60);
    walkTimeSec = Math.max(0, elapsedSec - runTimeSec);
  }
  const prevPhase = useRef(null);
  useEffect(() => {
    if (!phase) { prevPhase.current = null; lastCuedPhaseRef.current = null; return; }
    // Ticker-based fallback for web or when GPS fixes are infrequent.
    // announcePhaseCue deduplicates against the GPS-fix path above.
    if (prevPhase.current && prevPhase.current !== phase) announcePhaseCue(phase.toLowerCase());
    prevPhase.current = phase;
  }, [phase, announcePhaseCue]);

  // celebrate hitting the run goal, once per run
  const goalCued = useRef(false);
  useEffect(() => { if (t.status === "idle" || t.status === "finished") goalCued.current = false; }, [t.status]);
  useEffect(() => {
    if (goalActive && goalDone && !goalCued.current) {
      goalCued.current = true;
      haptic([0, 200, 100, 200, 100, 500]); beep(990, 500);
      if (audioOnRef.current) speak(goalType === "distance" ? `Goal reached. ${goalDist} kilometers done.` : "Time goal reached. Great work.");
    }
  }, [goalActive, goalDone, goalType, goalDist]);

  const countIv = useRef(null);
  useEffect(() => () => clearInterval(countIv.current), []);
  const beginRun = async () => {
    haptic(15); primeAudio();
    hrAgg.current = { sum: 0, n: 0, max: 0 };
    // Nothing on this path may be awaited. Every one of these can raise a system
    // permission dialog, and a dialog the runner ignores (or swipes away) leaves
    // its promise pending for the life of the app — awaiting one meant tapping
    // Start and watching nothing happen. Ask for all three, start the countdown
    // regardless: the location watcher asks again itself when it starts, and the
    // alerts simply stay quiet if the answer never comes.
    ensureLocationPermission().catch(() => {});
    primeRunNotifications().catch(() => {});
    if (cadenceOn) ensureMotionPermission().catch(() => {});
    let n = 3; setCount(n); beep(660, 150);
    clearInterval(countIv.current);
    countIv.current = setInterval(() => {
      n -= 1;
      if (n > 0) { setCount(n); beep(660, 150); haptic(10); }
      else if (n === 0) { setCount("GO"); beep(990, 260); haptic(25); if (audioOn) speak("Go"); }
      else { clearInterval(countIv.current); setCount(null); t.start(); }
    }, 1000);
  };

  const save = () => {
    onSave({
      dayKey,
      km: Number(km.toFixed(2)),
      min: Number((t.elapsedMs / 60000).toFixed(1)),
      route: downsample(t.points),
      splits: t.splits,
      durMs: t.elapsedMs,
      elev: Math.round(t.elevGainM),
      kcal: Math.round(kcal),
      ...(runKm + walkKm > 0.02 ? { runKm: Number(runKm.toFixed(2)), walkKm: Number(walkKm.toFixed(2)) } : {}),
      ...(hrAvg > 0 ? { hrAvg, hrMax } : {}),
      ...(avgCadence > 0 ? { cadence: avgCadence, steps: cad.steps } : {}),
    });
    haptic([15, 30, 15]);
  };


  // Closing mid-run throws the run away, so while there is a run to lose the
  // close button takes a second tap — and says what it will do on the first.
  const [closeArmed, setCloseArmed] = useState(false);
  const closeTimer = useRef(0);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const requestClose = () => {
    if (t.status === "idle" || closeArmed) { clearTimeout(closeTimer.current); onClose(); return; }
    haptic(8);
    setCloseArmed(true);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setCloseArmed(false), 3000);
  };

  const stepper = (label, set, step = 1, min = 0) => (
    <Stepper label={label}
      onMinus={() => { set((v) => Math.max(min, v - step)); haptic(6); }}
      onPlus={() => { set((v) => v + step); haptic(6); }} />
  );

  const title = t.status === "finished" ? "Run summary" : t.status === "paused" ? "Paused" : "Outdoor run";

  return (
    <div className="tracker" role="dialog" aria-modal="true" aria-label="Run tracker">
      {/* 3-2-1 countdown overlay */}
      {count != null && <Countdown count={count} />}

      <div className="tracker-inner">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, minHeight: 44 }}>
          <h1 className="t-title1" style={{ margin: 0, minWidth: 0 }}>{title}</h1>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            {tracking && (
              <span className="gps-pill" style={{ color: accColor }}>
                <i style={{ background: accColor }} />
                GPS {t.accuracy != null ? `±${Math.round(t.accuracy)} m` : "…"}
              </span>
            )}
            {closeArmed ? (
              <button onClick={requestClose} className="btn danger" style={{ padding: "7px 14px", fontSize: 15, minHeight: 0 }}>Discard run</button>
            ) : (
              <button onClick={requestClose} className="close-btn" aria-label="Close tracker"><Icon name="xmark" size={15} weight={2.6} /></button>
            )}
          </div>
        </div>

        {t.error && (
          <div className="t-sub" style={{ background: tint(C.warn, 0.14), color: C.text, borderRadius: 16, padding: "12px 14px", marginBottom: 16, display: "flex", gap: 10 }}>
            <span style={{ color: C.warn, display: "flex", flexShrink: 0, paddingTop: 2 }}><Icon name="info" size={18} /></span>{t.error}
          </div>
        )}

        {/* IDLE */}
        {t.status === "idle" && (
          <div className="rise tracker-body">
            <div className="card accented" style={{ padding: "18px 18px", marginBottom: 26, display: "flex", gap: 14, alignItems: "center" }}>
              <span style={{ width: 54, height: 54, borderRadius: "50%", flexShrink: 0, background: tint(C.accent, 0.18), color: C.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name="run" size={30} weight={2.1} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="t-headline">Ready when you are</div>
                <div className="t-foot" style={{ color: C.dim, marginTop: 3 }}>
                  {isNative()
                    ? "Head outside with a clear view of the sky. You can turn the screen off or switch apps — tracking keeps running, with a notification while it records."
                    : "Head outside with a clear view of the sky. Keep this screen open while you run — the browser pauses GPS when the screen is off, so the app holds it awake for you."}
                </div>
              </div>
            </div>

            <Group header="Cues">
              <Cell icon="speaker" iconColor={C.blue} title="Voice cues" sub="Splits and pace, spoken"
                trailing={<Switch on={audioOn} onClick={() => { setAudioOn((v) => !v); haptic(6); }} label="Voice cues" />} />
              <Cell icon="pauseCircle" iconColor={C.orange} title="Auto-pause" sub="Stops the clock when you stop"
                trailing={<Switch on={autoPauseOn} onClick={() => { setAutoPauseOn((v) => !v); haptic(6); }} label="Auto-pause" />} />
              <Cell icon="repeat" iconColor={C.purple} title="Run / walk intervals" sub="A buzz and a voice at every switch"
                trailing={<Switch on={intervalOn} onClick={() => { setIntervalOn((v) => !v); haptic(6); }} label="Run / walk intervals" />} />
              {intervalOn && (
                <>
                  <Cell title="Run" value={<span className="num" style={{ color: C.text }}>{runMin} min</span>} trailing={stepper("run minutes", setRunMin)} style={{ "--inset": "60px", paddingLeft: 60 }} />
                  <Cell title="Walk" value={<span className="num" style={{ color: C.text }}>{walkMin} min</span>} trailing={stepper("walk minutes", setWalkMin)} style={{ "--inset": "60px", paddingLeft: 60 }} />
                </>
              )}
            </Group>

            <Group header="Goal">
              <div className="cell" style={{ display: "block", padding: 12 }}>
                <Segmented items={[{ id: "none", label: "Open" }, { id: "distance", label: "Distance" }, { id: "time", label: "Time" }]}
                  value={goalType} onChange={saveGoalType} />
              </div>
              {goalType === "distance" && (
                <Cell icon="flag" iconColor={C.accent} title="Distance" value={<span className="num" style={{ color: C.text }}>{goalDist} km</span>} trailing={stepper("goal distance", setGoalDistP, 1, 1)} />
              )}
              {goalType === "time" && (
                <Cell icon="clock" iconColor={C.yellow} title="Time" value={<span className="num" style={{ color: C.text }}>{goalTime} min</span>} trailing={stepper("goal time", setGoalTimeP, 1, 1)} />
              )}
            </Group>

            <Group header="You" footer="Weight is only used for the calorie estimate.">
              <Cell icon="weight" iconColor={C.pink} title="Weight" value={<span className="num" style={{ color: C.text }}>{weightKg} kg</span>} trailing={stepper("weight", setWeight, 1, 30)} />
            </Group>

            {hrSupported() && (
              <Group header="Heart rate"
                footer={<>Works with any Bluetooth heart-rate strap or band. <b style={{ color: C.text, fontWeight: 600 }}>Can't see your watch?</b> A scan only
                  finds devices that are broadcasting, and a watch paired to this phone usually isn't — so it is listed from
                  your paired devices instead. Tap it and Stride will tell you straight whether it can send a pulse. Samsung
                  watches only can while an HR-broadcast app is running on the watch itself, and on the Tizen watches (Watch 3
                  and older) those can no longer be installed. <b style={{ color: C.text, fontWeight: 600 }}>A Galaxy Watch 3 still works after the run:</b> wear
                  it, and once it syncs Stride adds the heart rate it measured to this run through Health Connect
                  (Stats → Setup → Your watch).</>}>
                {hr.status === "connected" ? (
                  <Cell icon="heart" iconColor={C.warn} title={hr.deviceName} sub={hr.bpm ? `${hr.bpm} bpm · connected` : "Connected"}
                    trailing={<button onClick={() => { hr.disconnect(); haptic(6); }} className="link" style={{ minHeight: 0 }}>Disconnect</button>} />
                ) : (
                  <Cell icon="heart" iconColor={C.warn}
                    title={hr.status === "connecting" ? "Connecting…"
                      : hr.status === "reconnecting" ? "Reconnecting…"
                        : hr.hasSavedDevice ? "Connect heart-rate monitor" : "Find a heart-rate monitor"}
                    chevron onClick={() => { hr.connect({ silent: hr.hasSavedDevice }); haptic(6); }} />
                )}
                {/* A remembered device connects with one tap; the picker has to
                    stay reachable for a second strap, or a wrong first pick. */}
                {hr.status !== "connected" && hr.status !== "connecting" && hr.status !== "reconnecting" && (
                  <>
                    {hr.hasSavedDevice && (
                      <Cell title="Pick a different device" accent style={{ "--inset": "60px", paddingLeft: 60 }}
                        onClick={() => { hr.canPickFromList ? hr.startScan({ anyDevice: true }) : hr.connect({ silent: false }); haptic(6); }} />
                    )}
                    {/* A scan only ever sees devices that are ADVERTISING, and a
                        watch bonded to the phone has stopped advertising — which
                        is why dropping the service filter still found nothing.
                        Natively this lists the phone's paired devices too, so
                        the watch can be pointed at directly. */}
                    <Cell title={hr.canPickFromList ? "Show paired & nearby devices" : "Show every nearby device"} accent style={{ "--inset": "60px", paddingLeft: 60 }}
                      onClick={() => { hr.canPickFromList ? hr.startScan({ anyDevice: true }) : hr.connect({ anyDevice: true }); haptic(6); }} />
                  </>
                )}

                {/* The device list: paired first, because that is where a watch
                    actually lives. */}
                {(hr.scanning || hr.devices.length > 0) && hr.status !== "connected" && (
                  <>
                    <div className="cell rise" style={{ minHeight: 40, paddingTop: 8, paddingBottom: 8 }}>
                      <span className="lab" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {hr.scanning ? "Looking" : "Devices"}
                        {hr.scanning && (
                          <span className="spin" style={{ width: 12, height: 12, borderRadius: "50%", border: `2px solid ${tint(C.accent, 0.25)}`, borderTopColor: C.accent }} />
                        )}
                      </span>
                      <button onClick={() => { hr.scanning ? hr.stopScan() : hr.startScan({ anyDevice: true }); haptic(5); }}
                        className="link" style={{ marginLeft: "auto", minHeight: 0 }}>
                        {hr.scanning ? "Stop" : "Scan again"}
                      </button>
                    </div>
                    {hr.devices.length === 0 ? (
                      <div className="cell"><span className="cell-sub" style={{ fontSize: 15 }}>
                        Nothing yet. If your watch is paired to this phone it should appear here even
                        while it isn't broadcasting — if it doesn't, pair it in Android's Bluetooth
                        settings first.
                      </span></div>
                    ) : hr.devices.map((d) => (
                      <Cell key={d.id} icon="watch" iconColor={C.gray} title={d.name || "Unnamed device"}
                        sub={d.source === "scan" ? `Broadcasting now${d.rssi != null ? ` · ${d.rssi} dBm` : ""}`
                          : d.source === "connected" ? "Connected to this phone" : "Paired to this phone"}
                        trailing={<span className="t-sub" style={{ color: C.accent, fontWeight: 600, flexShrink: 0 }}>Connect</span>}
                        onClick={() => { hr.connect({ deviceId: d.id, deviceName: d.name || "That device" }); haptic(8); }} />
                    ))}
                  </>
                )}

                {hr.error && (
                  <button className="cell rise" onClick={hr.dismissError} style={{ background: tint(C.warn, 0.12), alignItems: "flex-start" }}>
                    <span style={{ color: C.warn, display: "flex", paddingTop: 1 }}><Icon name="info" size={18} /></span>
                    <span className="cell-main"><span className="t-foot" style={{ color: C.text }}>{hr.error}</span></span>
                  </button>
                )}
              </Group>
            )}

            {targetRoute && (
              <Group header="Target route" footer="Drawn as a dashed guide on your run map.">
                <div style={{ padding: "14px 14px 14px" }}>
                  <div className="t-headline">{targetRoute.name} <span style={{ color: C.dim, fontWeight: 500 }}>· {targetRoute.km} km</span></div>
                  <div style={{ marginTop: 12 }}><LiveMap points={[]} ghost={targetRoute.points} height={150} interactive={false} radius={14} /></div>
                </div>
              </Group>
            )}

            <div className="tracker-dock">
              <button onClick={beginRun} className="cta tap"
                style={{ width: "100%", borderRadius: 999, padding: "17px 0", fontSize: 19, display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}>
                <Icon name="play" size={19} /> Start
              </button>
            </div>
          </div>
        )}

        {/* TRACKING / PAUSED — Workout's display: time in yellow, distance huge */}
        {tracking && (
          <div className="rise tracker-body">
            <div className="num" style={{ fontSize: 60, fontWeight: 600, color: C.yellow, lineHeight: 1, letterSpacing: "-.02em", opacity: t.status === "paused" ? 0.55 : 1 }}>{fmtTime(t.elapsedMs)}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 8 }}>
              <span className="num" style={{ fontSize: 84, fontWeight: 700, lineHeight: 0.95, color: C.accent, letterSpacing: "-.03em" }}>{km.toFixed(2)}</span>
              <span className="num" style={{ fontSize: 28, fontWeight: 700, color: C.accent }}>KM</span>
            </div>
            <div style={{ minHeight: 30, marginTop: 10 }}>
              {t.autoPaused && <span className="pill" style={{ background: tint(C.orange, 0.2), color: C.orange }}>Auto-paused · start moving</span>}
              {t.status === "paused" && <span className="pill" style={{ background: "var(--fill3)", color: C.text }}>Paused</span>}
            </div>

            {goalActive && (
              <div className="card" style={{ padding: "12px 14px", marginTop: 6, boxShadow: goalDone ? `inset 0 0 0 1px ${tint(C.accent, 0.5)}` : undefined }}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                  <span className="t-foot" style={{ fontWeight: 600, color: C.dim }}>Goal · {goalName}</span>
                  <span className="num t-foot" style={{ marginLeft: "auto", fontWeight: 700, color: goalDone ? C.accent : C.text }}>{Math.round(goalPct * 100)}%</span>
                </div>
                <div className="bar" style={{ height: 8 }}><i style={{ width: `${goalPct * 100}%` }} /></div>
                <div className="t-foot" style={{ color: goalDone ? C.accent : C.dim, fontWeight: 600, marginTop: 8 }}>{goalSub}</div>
              </div>
            )}

            {phase && (
              <div className="rise" key={phase} style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12, borderRadius: 20, padding: "14px 16px", background: tint(phase === "RUN" ? C.accent : C.easy, 0.16) }}>
                <span style={{ width: 44, height: 44, borderRadius: "50%", flexShrink: 0, background: phase === "RUN" ? C.accent : C.easy, color: C.onAccent, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name="run" size={24} weight={2.2} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="t-title3" style={{ color: phase === "RUN" ? C.accent : C.easy }}>{phase === "RUN" ? "Run now" : "Walk now"}</div>
                  <div className="num t-foot" style={{ color: C.dim }}>{Math.floor(phaseLeft / 60)}:{String(phaseLeft % 60).padStart(2, "0")} left in this interval</div>
                </div>
              </div>
            )}

            <div className="card" style={{ padding: "4px 16px", marginTop: 14 }}>
              <MetricGrid size={28} items={[
                metric("Avg pace", fmtPace(avgPace), "/km", C.cyan),
                metric("Pace now", fmtPace(curPace), "/km", C.cyan),
                metric("Speed", speedNow ? speedNow.toFixed(1) : null, "km/h"),
                { label: "Elevation", value: `+${Math.round(t.elevGainM)}`, unit: "m", color: C.good },
                { label: "Energy", value: Math.round(kcal), unit: "kcal", color: C.pink },
                cadenceOn && metric("Cadence", cad.cadence || null, "spm", C.purple),
                cadenceOn && metric("Avg cadence", avgCadence || null, "spm"),
                cadenceOn && metric("Steps", cad.steps || null),
                hrLive && metric(hr.status === "reconnecting" ? "Heart rate · reconnecting" : "Heart rate", hr.bpm ?? null, "bpm", C.warn),
                hrLive && metric("Avg heart rate", hrAvg || null, "bpm"),
                hrLive && metric("Max heart rate", hrMax || null, "bpm"),
              ]} />
            </div>

            <PhaseBreakdown runM={t.phaseDist.run} walkM={t.phaseDist.walk} runSec={runTimeSec} walkSec={walkTimeSec} />

            <div style={{ marginTop: 14 }}>
              <LiveMap points={t.points} ghost={targetRoute && targetRoute.points} height={240} follow radius={22} />
            </div>

            <SplitsTable splits={t.splits} />

            <div className="tracker-dock" style={{ display: "flex", justifyContent: "center", gap: 56 }}>
              <RoundControl label="End" color={C.warn} icon="xmark" onClick={() => { haptic(15); t.finish(); }} />
              {t.status === "tracking"
                ? <RoundControl label="Pause" color={C.yellow} icon="pause" onClick={() => { haptic(10); t.pause(); }} />
                : <RoundControl label="Resume" color={C.good} icon="play" onClick={() => { haptic(10); t.resume(); }} />}
            </div>
          </div>
        )}

        {/* FINISHED */}
        {t.status === "finished" && (
          <div className="rise tracker-body">
            <div className="card accented" style={{ padding: "16px 18px 8px", marginBottom: 14 }}>
              <div className="t-foot" style={{ color: C.dim, fontWeight: 600 }}>
                {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, margin: "4px 0 8px" }}>
                <span className="num gtext" style={{ fontSize: 66, fontWeight: 700, lineHeight: 1, letterSpacing: "-.03em" }}>{km.toFixed(2)}</span>
                <span className="num" style={{ fontSize: 24, fontWeight: 700, color: C.accent }}>KM</span>
              </div>
              <MetricGrid size={26} items={[
                { label: "Time", value: fmtTime(t.elapsedMs), color: C.yellow },
                metric("Avg pace", fmtPace(avgPace), "/km", C.cyan),
                { label: "Energy", value: Math.round(kcal), unit: "kcal", color: C.pink },
                { label: "Elevation", value: `+${Math.round(t.elevGainM)}`, unit: "m", color: C.good },
                metric("Top speed", t.maxSpeedMs ? (t.maxSpeedMs * 3.6).toFixed(1) : null, "km/h"),
                hrAvg > 0 && { label: "Avg heart rate", value: hrAvg, unit: "bpm", color: C.warn },
                hrAvg > 0 && { label: "Max heart rate", value: hrMax, unit: "bpm", color: C.warn },
                avgCadence > 0 && { label: "Avg cadence", value: avgCadence, unit: "spm", color: C.purple },
                avgCadence > 0 && { label: "Steps", value: cad.steps.toLocaleString() },
              ]} />
            </div>

            <PhaseBreakdown runM={t.phaseDist.run} walkM={t.phaseDist.walk} runSec={runTimeSec} walkSec={walkTimeSec} />

            <div style={{ marginTop: 14 }}>
              <LiveMap points={t.points} ghost={targetRoute && targetRoute.points} height={220} radius={22} />
            </div>

            <SplitsTable splits={t.splits} />

            <Group header="Save to session" style={{ marginTop: 26 }}>
              <div className="cell">
                <select className="inp" value={dayKey} onChange={(e) => setDayKey(e.target.value)} aria-label="Session to save this run into"
                  style={{ background: "transparent", padding: "4px 0", fontSize: 17 }}>
                  {days.map((f) => (<option key={f.key} value={f.key}>Week {f.week} · {f.d.charAt(0) + f.d.slice(1).toLowerCase()} · {f.title}</option>))}
                </select>
              </div>
            </Group>

            <div className="tracker-dock" style={{ display: "grid", gap: 10 }}>
              <button onClick={save} className="cta tap" style={{ width: "100%", borderRadius: 999, padding: "16px 0", fontSize: 18 }}>Save run</button>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => {
                  haptic(8);
                  // Hand the run to the app's share sheet rather than firing a card
                  // blind: the sheet previews it and offers every size and layout.
                  onShare?.({
                    km: Number(km.toFixed(2)), min: Number((t.elapsedMs / 60000).toFixed(1)), durMs: t.elapsedMs,
                    route: downsample(t.points), splits: t.splits,
                    elev: Math.round(t.elevGainM), kcal: Math.round(kcal),
                    ...(runKm + walkKm > 0.02 ? { runKm: Number(runKm.toFixed(2)), walkKm: Number(walkKm.toFixed(2)) } : {}),
                    ...(hrAvg > 0 ? { hrAvg, hrMax } : {}),
                    ...(avgCadence > 0 ? { cadence: avgCadence } : {}),
                    date: new Date().toISOString(),
                  });
                }} className="btn" style={{ flex: 1, padding: "13px 0" }}>
                  <Icon name="share" size={18} /> Share card
                </button>
                <button onClick={() => { haptic(8); t.reset(); }} className="btn danger" style={{ flex: 1, padding: "13px 0" }}>Discard</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
