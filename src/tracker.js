// Live GPS run tracking, dependency-free. Wraps a location watch (src/geo.js:
// web Geolocation API, or a native background watcher in the Android app) in a
// small state machine and exposes elapsed time, distance, pace, route points
// and per-km splits. No map library, no backend.
import { useState, useRef, useCallback, useEffect } from "react";
import { startLocationWatch } from "./geo.js";

// Distance between two {lat,lng} points in metres (Haversine).
export function haversine(a, b) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const STOP_MS = 7000;      // auto-pause after this long without real movement
const MAX_ACCURACY_M = 35; // ignore fixes with worse horizontal accuracy
const MAX_SPEED_MS = 11;   // reject implausible jumps (≈ 1:31/km pace)
const MIN_STEP_M = 2;      // reject sub-jitter movement
const PROCESS_NOISE = 3;   // Kalman process noise — assumed runner speed, m/s

export function useRunTracker(opts = {}) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [status, setStatus] = useState("idle"); // idle | tracking | paused | finished
  const [autoPaused, setAutoPaused] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [distanceM, setDistanceM] = useState(0);
  const [points, setPoints] = useState([]);     // [{lat,lng,t}]
  const [splits, setSplits] = useState([]);      // seconds per completed km
  const [accuracy, setAccuracy] = useState(null);
  const [error, setError] = useState(null);

  const statusRef = useRef(status);
  statusRef.current = status;
  const autoPausedRef = useRef(false);

  const watch = useRef(null);    // { stop() } from startLocationWatch
  const ticker = useRef(null);
  const startedAt = useRef(0);   // ms timestamp the current running segment began
  const baseMs = useRef(0);      // accumulated ms from previous segments
  const last = useRef(null);     // last accepted GPS point
  const lastMoveAt = useRef(0);  // last time real movement was seen
  const distRef = useRef(0);     // metres
  const nextKm = useRef(1);
  const splitBase = useRef(0);   // elapsed seconds at the last km marker
  const kalman = useRef(null);   // { lat, lng, variance, t } — smoothing state
  const wakeLock = useRef(null);

  // elapsed time, frozen while auto-paused
  const liveElapsed = () => autoPausedRef.current ? baseMs.current : baseMs.current + (Date.now() - startedAt.current);

  const acquireWake = useCallback(async () => {
    try { if ("wakeLock" in navigator) wakeLock.current = await navigator.wakeLock.request("screen"); } catch { /* fine */ }
  }, []);
  const releaseWake = useCallback(() => { try { wakeLock.current?.release(); } catch { /* ignore */ } wakeLock.current = null; }, []);

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible" && statusRef.current === "tracking") acquireWake(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [acquireWake]);

  const setAuto = (v) => { autoPausedRef.current = v; setAutoPaused(v); };

  // One-dimensional Kalman filter per axis, weighted by the fix's reported
  // accuracy: noisy fixes barely move the estimate, sharp ones pull it hard.
  // Smooths GPS jitter that would otherwise zig-zag and inflate distance.
  const smooth = (f) => {
    const acc = Math.max(f.accuracy || 10, 3);
    const k = kalman.current;
    if (!k) {
      kalman.current = { lat: f.lat, lng: f.lng, variance: acc * acc, t: f.t };
    } else {
      const dt = Math.max((f.t - k.t) / 1000, 0);
      k.variance += dt * PROCESS_NOISE * PROCESS_NOISE;
      const gain = k.variance / (k.variance + acc * acc);
      k.lat += gain * (f.lat - k.lat);
      k.lng += gain * (f.lng - k.lng);
      k.variance *= 1 - gain;
      k.t = f.t;
    }
    return { lat: kalman.current.lat, lng: kalman.current.lng, t: f.t };
  };

  const onFix = useCallback((f) => {
    setAccuracy(f.accuracy);
    if (statusRef.current !== "tracking") return;
    if (f.accuracy != null && f.accuracy > MAX_ACCURACY_M) return; // wait for a usable fix

    const p = smooth(f);
    if (!last.current) { last.current = p; lastMoveAt.current = p.t; setPoints((pts) => [...pts, p]); return; }

    const d = haversine(last.current, p);
    const dt = Math.max((p.t - last.current.t) / 1000, 0.001);
    if (d < MIN_STEP_M || d / dt > MAX_SPEED_MS) return; // reject jitter / implausible jumps

    // real movement: if we were auto-paused, resume the clock now
    if (autoPausedRef.current) { startedAt.current = Date.now(); setAuto(false); }
    lastMoveAt.current = p.t;

    distRef.current += d;
    setDistanceM(distRef.current);
    last.current = p;
    setPoints((pts) => [...pts, p]);

    while (distRef.current / 1000 >= nextKm.current) {
      const sec = liveElapsed() / 1000;
      const split = sec - splitBase.current;
      splitBase.current = sec;
      nextKm.current += 1;
      setSplits((s) => [...s, split]);
    }
    // timers throttle in the background; fixes keep arriving, so use them to
    // keep elapsed time (and the run/walk interval cues) up to date
    setElapsedMs(liveElapsed());
  }, []);

  const startWatch = useCallback(() => {
    watch.current = startLocationWatch(onFix, setError);
    return watch.current != null;
  }, [onFix]);
  const stopWatch = () => { watch.current?.stop(); watch.current = null; };

  const startTicker = useCallback(() => {
    clearInterval(ticker.current);
    ticker.current = setInterval(() => {
      // auto-pause when stopped for a while
      if (optsRef.current.autoPause && statusRef.current === "tracking" && !autoPausedRef.current
          && last.current && Date.now() - lastMoveAt.current > STOP_MS) {
        baseMs.current = liveElapsed();
        setAuto(true);
      }
      setElapsedMs(liveElapsed());
    }, 250);
  }, []);

  const start = useCallback(() => {
    setError(null);
    if (!startWatch()) return;
    distRef.current = 0; nextKm.current = 1; splitBase.current = 0; last.current = null; baseMs.current = 0;
    kalman.current = null;
    lastMoveAt.current = Date.now(); setAuto(false);
    setDistanceM(0); setSplits([]); setPoints([]); setElapsedMs(0);
    startedAt.current = Date.now();
    setStatus("tracking");
    acquireWake();
    startTicker();
  }, [startWatch, acquireWake, startTicker]);

  const pause = useCallback(() => {
    baseMs.current = liveElapsed();
    setAuto(false);
    clearInterval(ticker.current);
    setStatus("paused");
    releaseWake();
  }, [releaseWake]);

  const resume = useCallback(() => {
    startedAt.current = Date.now();
    lastMoveAt.current = Date.now();
    // restart the segment from wherever the runner is now, so ground covered
    // while paused doesn't count and a stale estimate can't cause a jump
    last.current = null;
    kalman.current = null;
    setAuto(false);
    setStatus("tracking");
    acquireWake();
    startTicker();
  }, [acquireWake, startTicker]);

  const finish = useCallback(() => {
    if (statusRef.current === "tracking") baseMs.current = liveElapsed();
    setElapsedMs(baseMs.current);
    setAuto(false);
    clearInterval(ticker.current);
    stopWatch();
    releaseWake();
    setStatus("finished");
  }, [releaseWake]);

  const reset = useCallback(() => {
    clearInterval(ticker.current);
    stopWatch();
    releaseWake();
    setAuto(false);
    kalman.current = null;
    setStatus("idle"); setElapsedMs(0); setDistanceM(0); setPoints([]); setSplits([]); setError(null); setAccuracy(null);
  }, [releaseWake]);

  useEffect(() => () => { clearInterval(ticker.current); stopWatch(); releaseWake(); }, [releaseWake]);

  return { status, autoPaused, elapsedMs, distanceM, points, splits, accuracy, error, start, pause, resume, finish, reset };
}
