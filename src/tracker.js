// Live GPS run tracking, dependency-free. Wraps the Geolocation API in a small
// state machine and exposes elapsed time, distance, pace, route points and
// per-km splits. Pure browser APIs — no map library, no backend.
import { useState, useRef, useCallback, useEffect } from "react";

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

const STOP_MS = 7000; // auto-pause after this long without real movement

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

  const watchId = useRef(null);
  const ticker = useRef(null);
  const startedAt = useRef(0);   // ms timestamp the current running segment began
  const baseMs = useRef(0);      // accumulated ms from previous segments
  const last = useRef(null);     // last accepted GPS point
  const lastMoveAt = useRef(0);  // last time real movement was seen
  const distRef = useRef(0);     // metres
  const nextKm = useRef(1);
  const splitBase = useRef(0);   // elapsed seconds at the last km marker
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

  const onPos = useCallback((pos) => {
    setAccuracy(pos.coords.accuracy);
    if (statusRef.current !== "tracking") return;
    const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, t: Date.now() };
    if (!last.current) { last.current = p; lastMoveAt.current = p.t; setPoints([p]); return; }

    const d = haversine(last.current, p);
    const dt = Math.max((p.t - last.current.t) / 1000, 0.001);
    const speed = d / dt; // m/s
    if (d < 2 || speed > 11) return; // reject jitter / implausible jumps

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
  }, []);

  const startWatch = useCallback(() => {
    if (!("geolocation" in navigator)) { setError("This device has no GPS / location support."); return false; }
    watchId.current = navigator.geolocation.watchPosition(
      onPos,
      (e) => setError(e.code === 1 ? "Location permission denied — allow it to track your run." : "Couldn't get a GPS signal. Head outside with a clear view of the sky."),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
    return true;
  }, [onPos]);

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
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    releaseWake();
    setStatus("finished");
  }, [releaseWake]);

  const reset = useCallback(() => {
    clearInterval(ticker.current);
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    releaseWake();
    setAuto(false);
    setStatus("idle"); setElapsedMs(0); setDistanceM(0); setPoints([]); setSplits([]); setError(null); setAccuracy(null);
  }, [releaseWake]);

  useEffect(() => () => { clearInterval(ticker.current); if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current); releaseWake(); }, [releaseWake]);

  return { status, autoPaused, elapsedMs, distanceM, points, splits, accuracy, error, start, pause, resume, finish, reset };
}
