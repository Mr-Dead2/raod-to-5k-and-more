import React, { useState, useEffect, useRef, useCallback } from "react";
import { C, tint } from "../data.js";
import { LiveMap } from "./LiveMap.jsx";
import { useRunTracker, haversine } from "../tracker.js";
import { haptic } from "../celebrate.js";
import { ensureLocationPermission, isNative } from "../native.js";
import { primeAudio, beep, speak, paceWords } from "../cues.js";
import { loadSettings, saveSettings } from "../storage.js";
import { useHeartRate, hrSupported } from "../hr.js";
import { useStepCounter, cadenceSupported, ensureMotionPermission } from "../cadence.js";
import { shareRunCard } from "../share.js";
import { notifyRunInterval, primeRunNotifications } from "../notifications.js";

// kcal per kg of body weight per km — standard flat-ground estimates
const KCAL_RUN = 1.036, KCAL_WALK = 0.53;

const fmtTime = (ms) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, "0"), ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
const fmtPace = (secPerKm) => (secPerKm && isFinite(secPerKm) ? `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, "0")}` : "--:--");

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

function Toggle({ on, label, onClick }) {
  return (
    <button onClick={onClick} className="chip"
      style={{ background: on ? C.surface2 : "transparent", color: on ? C.text : C.dim, border: `1px solid ${on ? C.accent : C.line}`, padding: "8px 12px" }}>
      {on ? "✓ " : ""}{label}
    </button>
  );
}

// Pull a "run X / walk Y" pattern (minutes) out of a session's description.
function parseInterval(detail = "") {
  const m = detail.match(/run\s*(\d+)\s*(?:min)?\s*\/\s*walk\s*(\d+)/i);
  return m ? { run: Number(m[1]), walk: Number(m[2]) } : null;
}

function StepCard({ label, val, set, unit = "MIN" }) {
  return (
    <div className="card" style={{ flex: 1, borderRadius: 14, padding: "8px 10px", display: "flex", alignItems: "center", gap: 6 }}>
      <button className="chip" onClick={() => { set((v) => Math.max(0, v - 1)); haptic(6); }} style={{ padding: "4px 11px", fontSize: 16 }}>−</button>
      <div style={{ flex: 1, textAlign: "center" }}>
        <div className="num" style={{ fontSize: 18, fontWeight: 700 }}>{val}</div>
        <div style={{ fontSize: 8, color: C.dim, letterSpacing: 1, fontWeight: 700 }}>{label} {unit}</div>
      </div>
      <button className="chip" onClick={() => { set((v) => v + 1); haptic(6); }} style={{ padding: "4px 11px", fontSize: 16 }}>+</button>
    </div>
  );
}

// Live run-vs-walk breakdown while interval cues are on: distance, time and
// pace covered in each phase.
function PhaseBreakdown({ runM, walkM, runSec, walkSec }) {
  if (runM + walkM < 20) return null;
  const row = (label, m, sec, color) => (
    <div className="card" style={{ flex: 1, borderRadius: 14, padding: "10px", textAlign: "center", borderColor: tint(color, .35), background: `linear-gradient(160deg,${tint(color, .13)},${C.surface} 70%)` }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color }}>{label}</div>
      <div className="num" style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{(m / 1000).toFixed(2)} km</div>
      <div className="num" style={{ fontSize: 11, color: C.dim, marginTop: 1 }}>{fmtTime(sec * 1000)} · {fmtPace(m > 20 ? sec / (m / 1000) : 0)}/km</div>
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
      {row("RUN", runM, runSec, C.accent)}
      {row("WALK", walkM, walkSec, C.easy)}
    </div>
  );
}

export function RunTracker({ onClose, onSave, days, defaultKey, targetRoute }) {
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
  const saveGoalType = (v) => { setGoalType(v); saveSettings({ ...loadSettings(), runGoalType: v }); haptic(6); };
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
    await ensureLocationPermission();
    // Ask for notification permission here rather than never: the in-run alerts
    // are switched on by default, and a browser only prompts when asked. NOT
    // awaited — a prompt the runner ignores would otherwise hang the countdown
    // and the run would never start.
    primeRunNotifications().catch(() => {});
    if (cadenceOn) await ensureMotionPermission();
    let n = 3; setCount(n); beep(660, 150);
    clearInterval(countIv.current);
    countIv.current = setInterval(() => {
      n -= 1;
      if (n > 0) { setCount(n); beep(660, 150); haptic(10); }
      else if (n === 0) { setCount("GO"); beep(990, 260); haptic(25); if (audioOn) speak("Go"); }
      else { clearInterval(countIv.current); setCount(null); t.start(); }
    }, 1000);
  };

  const Big = ({ label, value, color }) => (
    <div style={{
      flex: 1, textAlign: "center", padding: "11px 4px", borderRadius: 14,
      background: `linear-gradient(160deg,${tint(C.text, .04)},transparent 75%)`,
      border: `1px solid ${C.line}`,
    }}>
      <div className="num" style={{ fontSize: 27, fontWeight: 700, color: color || C.text, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 8.5, letterSpacing: 1.5, color: C.dim, fontWeight: 700, marginTop: 6 }}>{label}</div>
    </div>
  );

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

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200, color: C.text,
      background: `radial-gradient(120% 60% at 50% -10%, ${tint(C.accent, .12)} 0%, transparent 62%), ${C.bg}`,
      display: "flex", flexDirection: "column",
      padding: "max(18px, env(safe-area-inset-top)) 18px calc(18px + env(safe-area-inset-bottom))",
      fontFamily: "'Manrope', system-ui, sans-serif", overflowY: "auto",
    }}>
      {/* 3-2-1 countdown overlay */}
      {count != null && (
        <div style={{ position: "absolute", inset: 0, zIndex: 10, background: "rgba(11,12,15,0.96)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div key={count} className="num pop gtext" style={{ fontSize: count === "GO" ? 84 : 120, fontWeight: 700 }}>{count}</div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <div className="disp" style={{ fontSize: 18, fontWeight: 700 }}>{t.status === "finished" ? "Run summary" : "Track run"}</div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {t.status !== "idle" && t.status !== "finished" && (
            <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, color: accColor }}>
              <span style={{ width: 8, height: 8, borderRadius: 8, background: accColor }} />
              GPS {t.accuracy != null ? `±${Math.round(t.accuracy)}m` : "…"}
            </span>
          )}
          <button onClick={onClose} className="chip" style={{ padding: "6px 12px" }}>✕</button>
        </div>
      </div>

      {t.error && (
        <div style={{ background: C.surface, border: `1px solid ${C.warn}`, color: C.warn, borderRadius: 12, padding: 12, fontSize: 13, marginBottom: 14 }}>{t.error}</div>
      )}

      {/* IDLE */}
      {t.status === "idle" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "center", gap: 16 }}>
          <div style={{ width: 64, height: 64, margin: "0 auto", borderRadius: "50%", background: `${C.accent}14`, border: `1px solid ${C.accent}55`, display: "flex", alignItems: "center", justifyContent: "center", color: C.accent }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
          </div>
          <div className="disp" style={{ fontSize: 22, fontWeight: 700 }}>Ready when you are</div>
          <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.6, maxWidth: 320, margin: "0 auto" }}>
            {isNative()
              ? "Head outside with a clear view of the sky, then press start. You can turn the screen off or switch apps — tracking keeps running in the background (you'll see a notification while it records)."
              : "Head outside with a clear view of the sky, then press start. Keep this screen open while you run — the browser pauses GPS when the screen is off, so the app holds it awake for you."}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", margin: "2px auto 0", flexWrap: "wrap" }}>
            <Toggle on={audioOn} label="Voice cues" onClick={() => { setAudioOn((v) => !v); haptic(6); }} />
            <Toggle on={autoPauseOn} label="Auto-pause" onClick={() => { setAutoPauseOn((v) => !v); haptic(6); }} />
          </div>
          <div style={{ maxWidth: 320, width: "100%", margin: "0 auto" }}>
            <Toggle on={intervalOn} label="Run / walk buzz cues" onClick={() => { setIntervalOn((v) => !v); haptic(6); }} />
            {intervalOn && (
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <StepCard label="RUN" val={runMin} set={setRunMin} />
                <StepCard label="WALK" val={walkMin} set={setWalkMin} />
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <StepCard label="WEIGHT" unit="KG" val={weightKg} set={setWeight} />
            </div>
            <div style={{ fontSize: 10, color: C.dim, marginTop: 6 }}>Weight is only used for the calorie estimate.</div>

            {/* Run goal */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 10, letterSpacing: 1.5, color: C.dim, fontWeight: 700, marginBottom: 8, textAlign: "left" }}>RUN GOAL</div>
              <div style={{ display: "flex", gap: 8 }}>
                {[["none", "Off"], ["distance", "Distance"], ["time", "Time"]].map(([v, lbl]) => (
                  <button key={v} onClick={() => saveGoalType(v)} className="chip"
                    style={{ flex: 1, background: goalType === v ? C.accent : C.surface, color: goalType === v ? C.bg : C.dim, border: `1px solid ${goalType === v ? C.accent : C.line}`, fontWeight: 700 }}>
                    {lbl}
                  </button>
                ))}
              </div>
              {goalType === "distance" && (
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}><StepCard label="GOAL" unit="KM" val={goalDist} set={setGoalDistP} /></div>
              )}
              {goalType === "time" && (
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}><StepCard label="GOAL" unit="MIN" val={goalTime} set={setGoalTimeP} /></div>
              )}
            </div>
            {hrSupported() && (
              <div style={{ marginTop: 12 }}>
                {hr.status === "connected" ? (
                  <Toggle on label={`${hr.deviceName}${hr.bpm ? ` · ${hr.bpm} bpm` : ""} — tap to disconnect`}
                    onClick={() => { hr.disconnect(); haptic(6); }} />
                ) : (
                  <Toggle on={false} label={hr.status === "connecting" ? "Connecting…" : "Connect heart-rate monitor"}
                    onClick={() => { hr.connect(); haptic(6); }} />
                )}
                <div style={{ fontSize: 10, color: C.dim, marginTop: 6, lineHeight: 1.5 }}>
                  Works with any Bluetooth heart-rate device. Galaxy Watch: install a free
                  HR-broadcast app on the watch (e.g. “Heart for Bluetooth”), start it, then connect here.
                </div>
              </div>
            )}
          </div>
          {targetRoute && (
            <div style={{ maxWidth: 320, width: "100%", margin: "0 auto", background: C.surface, border: `1px solid ${C.accent}`, borderRadius: 12, padding: 10, textAlign: "left" }}>
              <div style={{ fontSize: 9, color: C.accent, fontWeight: 800, letterSpacing: 1 }}>TARGET ROUTE</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 8 }}>{targetRoute.name} ({targetRoute.km} km)</div>
              <LiveMap points={[]} ghost={targetRoute.points} height={140} interactive={false} />
              <div style={{ fontSize: 10.5, color: C.dim, marginTop: 6 }}>Drawn as a dashed guide on your run map.</div>
            </div>
          )}
          <button onClick={beginRun} className="chip cta disp"
            style={{ padding: "16px 0", fontSize: 16, fontWeight: 700, maxWidth: 280, margin: "8px auto 0", width: "100%", borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" /></svg>
            Start run
          </button>
        </div>
      )}

      {/* TRACKING / PAUSED */}
      {(t.status === "tracking" || t.status === "paused") && (
        <div className="rise">
          <div style={{ textAlign: "center", margin: "10px 0 6px" }}>
            <div className="num gtext" style={{ fontSize: 66, fontWeight: 700, lineHeight: .95 }}>{km.toFixed(2)}</div>
            <div style={{ fontSize: 10, letterSpacing: 2.4, color: C.dim, fontWeight: 800, marginTop: 8 }}>KILOMETRES</div>
          </div>
          <div style={{ height: 22, textAlign: "center", marginBottom: 10 }}>
            {t.autoPaused && <span className="chip" style={{ background: C.warn, color: C.bg, border: "none", fontSize: 10 }}>AUTO-PAUSED · START MOVING</span>}
            {t.status === "paused" && <span className="chip" style={{ background: C.surface2, color: C.dim, fontSize: 10 }}>PAUSED</span>}
          </div>

          {goalActive && (
            <div className="card" style={{ borderRadius: 14, padding: "12px 14px", marginBottom: 14, borderColor: goalDone ? tint(C.accent, .5) : C.line }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 7 }}>
                <span style={{ fontSize: 10, letterSpacing: 1.5, color: C.dim, fontWeight: 700 }}>GOAL · {goalName}</span>
                <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: goalDone ? C.accent : C.text }}>{Math.round(goalPct * 100)}%</span>
              </div>
              <div className="bar" style={{ height: 7 }}><i style={{ width: `${goalPct * 100}%` }} /></div>
              <div style={{ fontSize: 11, color: goalDone ? C.accent : C.dim, fontWeight: 600, marginTop: 7 }}>{goalSub}</div>
            </div>
          )}

          {phase && (
            <div className="rise" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, background: phase === "RUN" ? `${C.accent}1a` : `${C.easy}1a`, border: `1px solid ${phase === "RUN" ? C.accent : C.easy}`, borderRadius: 14, padding: "12px 14px", marginBottom: 14 }}>
              <div style={{ textAlign: "center" }}>
                <div className="disp" style={{ fontSize: 20, fontWeight: 700, color: phase === "RUN" ? C.accent : C.easy }}>{phase} NOW</div>
                <div className="num" style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>{Math.floor(phaseLeft / 60)}:{String(phaseLeft % 60).padStart(2, "0")} left in this interval</div>
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <Big label="TIME" value={fmtTime(t.elapsedMs)} />
            <Big label="AVG PACE" value={fmtPace(avgPace)} />
            <Big label="PACE NOW" value={fmtPace(curPace)} color={C.accent} />
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: cadenceOn || hr.status === "connected" ? 10 : 18 }}>
            <Big label="SPEED KM/H" value={speedNow ? speedNow.toFixed(1) : "--"} />
            <Big label="ELEV GAIN" value={`+${Math.round(t.elevGainM)}m`} />
            <Big label="KCAL" value={Math.round(kcal)} />
          </div>
          {cadenceOn && (
            <div style={{ display: "flex", gap: 8, marginBottom: hr.status === "connected" ? 10 : 18 }}>
              <Big label="CADENCE SPM" value={cad.cadence || "--"} color={C.accent} />
              <Big label="AVG SPM" value={avgCadence || "--"} />
              <Big label="STEPS" value={cad.steps || "--"} />
            </div>
          )}
          {hr.status === "connected" && (
            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              <Big label="HEART RATE" value={hr.bpm ?? "--"} color={C.warn} />
              <Big label="AVG HR" value={hrAvg || "--"} />
              <Big label="MAX HR" value={hrMax || "--"} />
            </div>
          )}

          <PhaseBreakdown runM={t.phaseDist.run} walkM={t.phaseDist.walk} runSec={runTimeSec} walkSec={walkTimeSec} />

          <LiveMap points={t.points} ghost={targetRoute && targetRoute.points} height={230} follow />

          {t.splits.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: C.dim, fontWeight: 700, marginBottom: 8 }}>SPLITS / KM</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {t.splits.map((s, i) => (<span key={i} className="chip" style={{ background: C.surface, color: C.text }}>{i + 1}k · {fmtPace(s)}</span>))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
            {t.status === "tracking" ? (
              <button onClick={() => { haptic(10); t.pause(); }} className="chip tap" style={{ flex: 1, color: C.text, padding: "15px 0", fontSize: 15, fontWeight: 800, borderRadius: 999 }}>Pause</button>
            ) : (
              <button onClick={() => { haptic(10); t.resume(); }} className="chip cta" style={{ flex: 1, padding: "15px 0", fontSize: 15, fontWeight: 800, borderRadius: 999 }}>Resume</button>
            )}
            <button onClick={() => { haptic(15); t.finish(); }} className="chip tap" style={{ flex: 1, background: C.warn, color: C.bg, border: "none", padding: "15px 0", fontSize: 15, fontWeight: 800, borderRadius: 999 }}>Finish</button>
          </div>
        </div>
      )}

      {/* FINISHED */}
      {t.status === "finished" && (
        <div className="rise">
          <div style={{ display: "flex", marginBottom: 12 }}>
            <Big label="DISTANCE" value={`${km.toFixed(2)}`} color={C.accent} />
            <Big label="TIME" value={fmtTime(t.elapsedMs)} />
            <Big label="AVG PACE" value={`${fmtPace(avgPace)}`} />
          </div>
          <div style={{ display: "flex", marginBottom: 16 }}>
            <Big label="ELEV GAIN" value={`+${Math.round(t.elevGainM)}m`} />
            <Big label="KCAL" value={Math.round(kcal)} />
            <Big label="TOP SPEED" value={t.maxSpeedMs ? `${(t.maxSpeedMs * 3.6).toFixed(1)}` : "--"} />
          </div>
          {hrAvg > 0 && (
            <div style={{ display: "flex", marginBottom: 16 }}>
              <Big label="AVG HR" value={hrAvg} color={C.warn} />
              <Big label="MAX HR" value={hrMax} />
            </div>
          )}
          {avgCadence > 0 && (
            <div style={{ display: "flex", marginBottom: 16 }}>
              <Big label="AVG CADENCE" value={`${avgCadence}`} color={C.accent} />
              <Big label="STEPS" value={cad.steps.toLocaleString()} />
            </div>
          )}

          <PhaseBreakdown runM={t.phaseDist.run} walkM={t.phaseDist.walk} runSec={runTimeSec} walkSec={walkTimeSec} />

          <LiveMap points={t.points} ghost={targetRoute && targetRoute.points} height={220} />

          {t.splits.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: C.dim, fontWeight: 700, marginBottom: 8 }}>SPLITS / KM</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {t.splits.map((s, i) => (<span key={i} className="chip" style={{ background: C.surface, color: C.text }}>{i + 1}k · {fmtPace(s)}</span>))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 10, letterSpacing: 2, color: C.dim, fontWeight: 700, marginBottom: 6 }}>SAVE TO SESSION</div>
            <select className="inp" value={dayKey} onChange={(e) => setDayKey(e.target.value)}>
              {days.map((f) => (<option key={f.key} value={f.key}>W{f.week} · {f.d} · {f.title}</option>))}
            </select>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button onClick={() => { haptic(8); t.reset(); }} className="chip" style={{ padding: "15px 18px", fontSize: 15 }}>Discard</button>
            <button onClick={save} className="chip cta" style={{ flex: 1, padding: "15px 0", fontSize: 15, fontWeight: 800, borderRadius: 999 }}>Save run</button>
          </div>
          <button onClick={async () => {
            haptic(8);
            await shareRunCard({ km: Number(km.toFixed(2)), min: Number((t.elapsedMs / 60000).toFixed(1)), durMs: t.elapsedMs, route: downsample(t.points), elev: Math.round(t.elevGainM), kcal: Math.round(kcal), ...(runKm + walkKm > 0.02 ? { runKm: Number(runKm.toFixed(2)), walkKm: Number(walkKm.toFixed(2)) } : {}), date: new Date().toISOString() });
          }} className="chip" style={{ width: "100%", marginTop: 10, padding: "13px 0", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="12" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><path d="m8.7 10.7 6.6-3.4M8.7 13.3l6.6 3.4" /></svg>
            Share run card
          </button>
        </div>
      )}
    </div>
  );
}
