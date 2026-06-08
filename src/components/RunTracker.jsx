import React, { useState, useEffect, useRef } from "react";
import { C } from "../data.js";
import { RouteMap } from "./Charts.jsx";
import { useRunTracker, haversine } from "../tracker.js";
import { haptic } from "../celebrate.js";
import { ensureLocationPermission } from "../native.js";
import { primeAudio, beep, speak, paceWords } from "../cues.js";

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

export function RunTracker({ onClose, onSave, days, defaultKey }) {
  const [audioOn, setAudioOn] = useState(true);
  const [autoPauseOn, setAutoPauseOn] = useState(true);
  const [count, setCount] = useState(null); // 3..1, "GO", or null
  const t = useRunTracker({ autoPause: autoPauseOn });
  const [dayKey, setDayKey] = useState(defaultKey);
  useEffect(() => { setDayKey(defaultKey); }, [defaultKey]);

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

  const countIv = useRef(null);
  useEffect(() => () => clearInterval(countIv.current), []);
  const beginRun = async () => {
    haptic(15); primeAudio();
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
      <div className="num" style={{ fontSize: 30, fontWeight: 800, color: color || C.text, lineHeight: 1 }}>{value}</div>
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
        <div style={{ position: "absolute", inset: 0, zIndex: 10, background: "rgba(12,13,16,0.96)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div key={count} className="num pop" style={{ fontSize: count === "GO" ? 84 : 120, fontWeight: 800, color: C.accent }}>{count}</div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <div className="syne" style={{ fontSize: 18, fontWeight: 800 }}>{t.status === "finished" ? "RUN SUMMARY" : "TRACK RUN"}</div>
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
          <div style={{ fontSize: 48 }} className="floaty">📍</div>
          <div className="syne" style={{ fontSize: 22, fontWeight: 800 }}>Ready when you are</div>
          <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.6, maxWidth: 320, margin: "0 auto" }}>
            Head outside with a clear view of the sky, then press start. Keep this screen open while you run — your phone's GPS measures distance, pace and your route automatically.
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", margin: "2px auto 0" }}>
            <Toggle on={audioOn} label="🔊 Voice cues" onClick={() => { setAudioOn((v) => !v); haptic(6); }} />
            <Toggle on={autoPauseOn} label="⏯ Auto-pause" onClick={() => { setAutoPauseOn((v) => !v); haptic(6); }} />
          </div>
          <button onClick={beginRun} className="chip cta"
            style={{ padding: "16px 0", fontSize: 16, fontWeight: 800, letterSpacing: 1, maxWidth: 280, margin: "8px auto 0", width: "100%", borderRadius: 999 }}>
            ▶ START RUN
          </button>
        </div>
      )}

      {/* TRACKING / PAUSED */}
      {(t.status === "tracking" || t.status === "paused") && (
        <div className="rise">
          <div style={{ textAlign: "center", margin: "8px 0 6px" }}>
            <div className="num" style={{ fontSize: 30, fontWeight: 800, color: C.accent, lineHeight: 1 }}>{km.toFixed(2)}</div>
            <div style={{ fontSize: 10, letterSpacing: 2, color: C.dim, fontWeight: 700, marginTop: 6 }}>KILOMETRES</div>
          </div>
          <div style={{ height: 22, textAlign: "center", marginBottom: 10 }}>
            {t.autoPaused && <span className="chip" style={{ background: C.warn, color: C.bg, border: "none", fontSize: 10 }}>⏸ AUTO-PAUSED · START MOVING</span>}
            {t.status === "paused" && <span className="chip" style={{ background: C.surface2, color: C.dim, fontSize: 10 }}>PAUSED</span>}
          </div>
          <div style={{ display: "flex", marginBottom: 18 }}>
            <Big label="TIME" value={fmtTime(t.elapsedMs)} />
            <Big label="AVG PACE" value={fmtPace(avgPace)} />
            <Big label="PACE NOW" value={fmtPace(curPace)} color={C.accent} />
          </div>

          <RouteMap points={t.points} height={190} />

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
              <button onClick={() => { haptic(10); t.pause(); }} className="chip" style={{ flex: 1, background: C.surface, color: C.text, padding: "15px 0", fontSize: 15 }}>⏸ PAUSE</button>
            ) : (
              <button onClick={() => { haptic(10); t.resume(); }} className="chip cta" style={{ flex: 1, padding: "15px 0", fontSize: 15, borderRadius: 999 }}>▶ RESUME</button>
            )}
            <button onClick={() => { haptic(15); t.finish(); }} className="chip" style={{ flex: 1, background: C.warn, color: C.bg, border: "none", padding: "15px 0", fontSize: 15 }}>⏹ FINISH</button>
          </div>
        </div>
      )}

      {/* FINISHED */}
      {t.status === "finished" && (
        <div className="rise">
          <div style={{ display: "flex", marginBottom: 16 }}>
            <Big label="DISTANCE" value={`${km.toFixed(2)}`} color={C.accent} />
            <Big label="TIME" value={fmtTime(t.elapsedMs)} />
            <Big label="AVG PACE" value={`${fmtPace(avgPace)}`} />
          </div>

          <RouteMap points={t.points} height={200} />

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
            <button onClick={() => { haptic(8); t.reset(); }} className="chip" style={{ padding: "15px 18px", fontSize: 15 }}>DISCARD</button>
            <button onClick={save} className="chip cta" style={{ flex: 1, padding: "15px 0", fontSize: 15, fontWeight: 800, borderRadius: 999 }}>✓ SAVE RUN</button>
          </div>
        </div>
      )}
    </div>
  );
}
