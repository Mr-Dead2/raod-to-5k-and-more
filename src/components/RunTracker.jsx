import React, { useState, useEffect, useRef } from "react";
import { C } from "../data.js";
import { LiveMap } from "./LiveMap.jsx";
import { useRunTracker, haversine } from "../tracker.js";
import { haptic } from "../celebrate.js";
import { ensureLocationPermission, isNative } from "../native.js";
import { primeAudio, beep, speak, paceWords } from "../cues.js";
import { loadSettings, saveSettings } from "../storage.js";
import { useHeartRate, hrSupported } from "../hr.js";

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
  const compact = (p) => [Number(p.lat.toFixed(5)), Number(p.lng.toFixed(5))];
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
    <div style={{ flex: 1, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "8px 10px", display: "flex", alignItems: "center", gap: 6 }}>
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
    <div style={{ flex: 1, background: C.surface, borderRadius: 12, padding: "9px 10px", textAlign: "center", borderTop: `2px solid ${color}` }}>
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

export function RunTracker({ onClose, onSave, days, defaultKey }) {
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

  const t = useRunTracker({
    autoPause: autoPauseOn,
    interval: intervalOn && runMin > 0 && walkMin > 0 ? { runSec: runMin * 60, walkSec: walkMin * 60 } : null,
  });

  // body weight for the calorie estimate, remembered between runs
  const [weightKg, setWeightKg] = useState(() => loadSettings().weightKg || 70);
  const setWeight = (fn) => setWeightKg((v) => {
    const n = Math.max(30, typeof fn === "function" ? fn(v) : fn);
    saveSettings({ ...loadSettings(), weightKg: n });
    return n;
  });

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
    if (!phase) { prevPhase.current = null; return; }
    if (prevPhase.current && prevPhase.current !== phase) {
      if (phase === "WALK") { haptic([0, 250, 130, 250]); beep(440, 320); if (audioOn) speak("Walk now"); }
      else { haptic([0, 130, 90, 130, 90, 360]); beep(990, 320); if (audioOn) speak("Run now"); }
    }
    prevPhase.current = phase;
  }, [phase, audioOn]);

  const countIv = useRef(null);
  useEffect(() => () => clearInterval(countIv.current), []);
  const beginRun = async () => {
    haptic(15); primeAudio();
    hrAgg.current = { sum: 0, n: 0, max: 0 };
    await ensureLocationPermission();
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
    <div style={{ flex: 1, textAlign: "center" }}>
      <div className="num" style={{ fontSize: 30, fontWeight: 700, color: color || C.text, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 9, letterSpacing: 1.5, color: C.dim, fontWeight: 700, marginTop: 5 }}>{label}</div>
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
    });
    haptic([15, 30, 15]);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200, background: C.bg, color: C.text,
      display: "flex", flexDirection: "column",
      padding: "max(18px, env(safe-area-inset-top)) 18px calc(18px + env(safe-area-inset-bottom))",
      fontFamily: "'Manrope', system-ui, sans-serif", overflowY: "auto",
    }}>
      {/* 3-2-1 countdown overlay */}
      {count != null && (
        <div style={{ position: "absolute", inset: 0, zIndex: 10, background: "rgba(11,12,15,0.96)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div key={count} className="num pop" style={{ fontSize: count === "GO" ? 84 : 120, fontWeight: 700, color: C.accent }}>{count}</div>
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
          <div style={{ textAlign: "center", margin: "8px 0 6px" }}>
            <div className="num" style={{ fontSize: 30, fontWeight: 700, color: C.accent, lineHeight: 1 }}>{km.toFixed(2)}</div>
            <div style={{ fontSize: 10, letterSpacing: 2, color: C.dim, fontWeight: 700, marginTop: 6 }}>KILOMETRES</div>
          </div>
          <div style={{ height: 22, textAlign: "center", marginBottom: 10 }}>
            {t.autoPaused && <span className="chip" style={{ background: C.warn, color: C.bg, border: "none", fontSize: 10 }}>AUTO-PAUSED · START MOVING</span>}
            {t.status === "paused" && <span className="chip" style={{ background: C.surface2, color: C.dim, fontSize: 10 }}>PAUSED</span>}
          </div>

          {phase && (
            <div className="rise" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, background: phase === "RUN" ? `${C.accent}1a` : `${C.easy}1a`, border: `1px solid ${phase === "RUN" ? C.accent : C.easy}`, borderRadius: 14, padding: "12px 14px", marginBottom: 14 }}>
              <div style={{ textAlign: "center" }}>
                <div className="disp" style={{ fontSize: 20, fontWeight: 700, color: phase === "RUN" ? C.accent : C.easy }}>{phase} NOW</div>
                <div className="num" style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>{Math.floor(phaseLeft / 60)}:{String(phaseLeft % 60).padStart(2, "0")} left in this interval</div>
              </div>
            </div>
          )}
          <div style={{ display: "flex", marginBottom: 14 }}>
            <Big label="TIME" value={fmtTime(t.elapsedMs)} />
            <Big label="AVG PACE" value={fmtPace(avgPace)} />
            <Big label="PACE NOW" value={fmtPace(curPace)} color={C.accent} />
          </div>
          <div style={{ display: "flex", marginBottom: hr.status === "connected" ? 14 : 18 }}>
            <Big label="SPEED KM/H" value={speedNow ? speedNow.toFixed(1) : "--"} />
            <Big label="ELEV GAIN" value={`+${Math.round(t.elevGainM)}m`} />
            <Big label="KCAL" value={Math.round(kcal)} />
          </div>
          {hr.status === "connected" && (
            <div style={{ display: "flex", marginBottom: 18 }}>
              <Big label="HEART RATE" value={hr.bpm ?? "--"} color={C.warn} />
              <Big label="AVG HR" value={hrAvg || "--"} />
              <Big label="MAX HR" value={hrMax || "--"} />
            </div>
          )}

          <PhaseBreakdown runM={t.phaseDist.run} walkM={t.phaseDist.walk} runSec={runTimeSec} walkSec={walkTimeSec} />

          <LiveMap points={t.points} height={230} follow />

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
              <button onClick={() => { haptic(10); t.pause(); }} className="chip" style={{ flex: 1, background: C.surface, color: C.text, padding: "15px 0", fontSize: 15, fontWeight: 800 }}>Pause</button>
            ) : (
              <button onClick={() => { haptic(10); t.resume(); }} className="chip cta" style={{ flex: 1, padding: "15px 0", fontSize: 15, fontWeight: 800, borderRadius: 999 }}>Resume</button>
            )}
            <button onClick={() => { haptic(15); t.finish(); }} className="chip" style={{ flex: 1, background: C.warn, color: C.bg, border: "none", padding: "15px 0", fontSize: 15, fontWeight: 800 }}>Finish</button>
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

          <PhaseBreakdown runM={t.phaseDist.run} walkM={t.phaseDist.walk} runSec={runTimeSec} walkSec={walkTimeSec} />

          <LiveMap points={t.points} height={220} />

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
        </div>
      )}
    </div>
  );
}
