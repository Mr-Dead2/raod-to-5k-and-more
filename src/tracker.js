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

export function useRunTracker() {
  const [status, setStatus] = useState("idle"); // idle | tracking | paused | finished
  const [elapsedMs, setElapsedMs] = useState(0);
  const [distanceM, setDistanceM] = useState(0);
  const [points, setPoints] = useState([]);     // [{lat,lng,t}]
  const [splits, setSplits] = useState([]);      // seconds per completed km
  const [accuracy, setAccuracy] = useState(null);
  const [error, setError] = useState(null);

  const statusRef = useRef(status);
  statusRef.current = status;

  const watchId = useRef(null);
  const ticker = useRef(null);
  const startedAt = useRef(0);   // ms timestamp the current running segment began
  const baseMs = useRef(0);      // accumulated ms from previous segments
  const last = useRef(null);     // last accepted GPS point
  const distRef = useRef(0);     // metres
  const nextKm = useRef(1);
  const splitBase = useRef(0);   // elapsed seconds at the last km marker
  const wakeLock = useRef(null);

  const liveElapsed = () => baseMs.current + (Date.now() - startedAt.current);

  const acquireWake = useCallback(async () => {
    try {
      if ("wakeLock" in navigator) wakeLock.current = await navigator.wakeLock.request("screen");
    } catch { /* fine without it */ }
  }, []);
  const releaseWake = useCallback(() => {
    try { wakeLock.current?.release(); } catch { /* ignore */ }
    wakeLock.current = null;
  }, []);

  // re-acquire the wake lock when returning to the tab mid-run
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible" && statusRef.current === "tracking") acquireWake(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [acquireWake]);

  const onPos = useCallback((pos) => {
    setAccuracy(pos.coords.accuracy);
    if (statusRef.current !== "tracking") return;
    const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, t: Date.now() };
    if (!last.current) { last.current = p; setPoints([p]); return; }

    const d = haversine(last.current, p);
    const dt = Math.max((p.t - last.current.t) / 1000, 0.001);
    const speed = d / dt; // m/s
    // reject GPS jitter (<2 m) and implausible jumps (>11 m/s ≈ world-class sprint)
    if (d < 2 || speed > 11) return;

    distRef.current += d;
    setDistanceM(distRef.current);
    last.current = p;
    setPoints((pts) => [...pts, p]);

    // record per-km splits as we cross each whole kilometre
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

  const start = useCallback(() => {
    setError(null);
    if (!startWatch()) return;
    distRef.current = 0; nextKm.current = 1; splitBase.current = 0; last.current = null; baseMs.current = 0;
    setDistanceM(0); setSplits([]); setPoints([]); setElapsedMs(0);
    startedAt.current = Date.now();
    setStatus("tracking");
    acquireWake();
    ticker.current = setInterval(() => setElapsedMs(liveElapsed()), 250);
  }, [startWatch, acquireWake]);

  const pause = useCallback(() => {
    baseMs.current = liveElapsed();
    clearInterval(ticker.current);
    setStatus("paused");
    releaseWake();
  }, [releaseWake]);

  const resume = useCallback(() => {
    startedAt.current = Date.now();
    setStatus("tracking");
    acquireWake();
    ticker.current = setInterval(() => setElapsedMs(liveElapsed()), 250);
  }, [acquireWake]);

  const finish = useCallback(() => {
    if (statusRef.current === "tracking") baseMs.current = liveElapsed();
    setElapsedMs(baseMs.current);
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
    setStatus("idle"); setElapsedMs(0); setDistanceM(0); setPoints([]); setSplits([]); setError(null); setAccuracy(null);
  }, [releaseWake]);

  useEffect(() => () => { clearInterval(ticker.current); if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current); releaseWake(); }, [releaseWake]);

  return { status, elapsedMs, distanceM, points, splits, accuracy, error, start, pause, resume, finish, reset };
}
