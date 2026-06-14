// Cadence (steps per minute) from the device accelerometer. Dependency-free and
// best-effort: where DeviceMotion isn't available or permitted it simply reports
// nothing, so the rest of the tracker is unaffected. Step detection is a smoothed
// peak detector on acceleration magnitude with a refractory period.
import { useState, useEffect, useRef } from "react";

export const cadenceSupported = () =>
  typeof window !== "undefined" && typeof window.DeviceMotionEvent !== "undefined";

// iOS 13+ gates motion behind a permission prompt that must follow a user gesture.
export async function ensureMotionPermission() {
  try {
    const D = window.DeviceMotionEvent;
    if (D && typeof D.requestPermission === "function") {
      const res = await D.requestPermission();
      return res === "granted";
    }
  } catch { /* not required / denied — fall through */ }
  return true;
}

const TH_HI = 1.1;  // m/s² above gravity baseline to arm a step
const TH_LO = 0.35; // must fall back below this to re-arm
const MIN_STEP_MS = 260; // refractory period → caps at ~230 spm
const WINDOW_MS = 5000;  // live-cadence averaging window

// `enabled` attaches the listener (and resets counts); `paused` freezes counting
// without detaching. Returns live `cadence` (spm), total `steps`, and a `reset`.
export function useStepCounter(enabled, paused) {
  const [steps, setSteps] = useState(0);
  const [cadence, setCadence] = useState(0);
  const st = useRef(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const reset = () => { st.current = { steps: 0, recent: [], s: 0, g: 9.81, armed: false, last: 0 }; setSteps(0); setCadence(0); };

  useEffect(() => {
    if (!enabled) return;
    reset();
    const onMotion = (e) => {
      if (pausedRef.current) return;
      const a = e.accelerationIncludingGravity || e.acceleration;
      if (!a) return;
      const m = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
      if (!m) return;
      const c = st.current;
      c.s = c.s ? c.s + 0.35 * (m - c.s) : m; // low-pass smooth
      c.g = c.g + 0.02 * (c.s - c.g);         // slow gravity baseline
      const d = c.s - c.g;
      const now = performance.now();
      if (!c.armed && d > TH_HI) {
        if (now - c.last > MIN_STEP_MS) { c.steps++; c.last = now; c.recent.push(now); }
        c.armed = true;
      } else if (c.armed && d < TH_LO) {
        c.armed = false;
      }
    };
    window.addEventListener("devicemotion", onMotion);
    const iv = setInterval(() => {
      const c = st.current;
      const cut = performance.now() - WINDOW_MS;
      while (c.recent.length && c.recent[0] < cut) c.recent.shift();
      setCadence(Math.round(c.recent.length * (60000 / WINDOW_MS)));
      setSteps(c.steps);
    }, 1000);
    return () => { window.removeEventListener("devicemotion", onMotion); clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { steps, cadence, reset };
}
