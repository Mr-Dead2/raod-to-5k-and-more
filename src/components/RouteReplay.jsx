// Full-screen replay of a saved GPS route. Animates a dot along the route
// with a progressive polyline, scrub bar, and live elapsed/distance/pace stats.
import React, { useState, useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { C } from "../data.js";
import { haptic } from "../celebrate.js";
import { Icon, GlassButton, Segmented, Metric } from "./ui.jsx";

const TILES = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
const SPEEDS = [10, 30, 60, 120];

const fmtTime = (ms) => {
  const s = Math.floor((ms || 0) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};
const fmtPace = (spk) => (spk && isFinite(spk) && spk > 0) ? `${Math.floor(spk / 60)}:${String(Math.round(spk % 60)).padStart(2, "0")}` : null;

// Estimate "recent" pace: compare current point to one ~10% of the route back.
function recentPaceSec(route, idx, km, durMs) {
  const n = route.length;
  const fromIdx = Math.max(0, idx - Math.max(5, Math.floor(n * 0.08)));
  if (fromIdx >= idx || !km || !durMs) return 0;
  const segFrac = (idx - fromIdx) / (n - 1);
  const segKm = segFrac * km;
  const segMs = segFrac * durMs;
  return segKm > 0 && segMs > 0 ? (segMs / 1000) / segKm : 0;
}

export function RouteReplay({ run, onClose }) {
  const { route, km = 0, durMs = 0 } = run;
  const n = route ? route.length : 0;

  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Start with a default speed that finishes the route in ~40 s
  const rawSpeed = Math.max(10, Math.min(120, Math.round((durMs / 40000) / 10) * 10)) || 30;
  const defaultSpeed = SPEEDS.reduce((a, b) => (Math.abs(b - rawSpeed) < Math.abs(a - rawSpeed) ? b : a));
  const [speed, setSpeed] = useState(defaultSpeed);

  const elRef = useRef(null);
  const mapRef = useRef(null);
  const bgLineRef = useRef(null);
  const liveLineRef = useRef(null);
  const dotRef = useRef(null);
  const tickRef = useRef(null);

  const progress = n > 1 ? idx / (n - 1) : 0;
  const elapsedMs = progress * (durMs || 0);
  const distKm = progress * km;
  const pace = recentPaceSec(route || [], idx, km, durMs);

  // ── Map init ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!elRef.current) return;
    const map = L.map(elRef.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: true, dragging: true });
    L.tileLayer(TILES, { attribution: ATTR, maxZoom: 19, subdomains: "abcd" }).addTo(map);
    mapRef.current = map;

    if (route && route.length > 1) {
      const ll = route.map((p) => [p[0], p[1]]);
      bgLineRef.current = L.polyline(ll, { color: C.dim, weight: 3, opacity: 0.22, lineJoin: "round" }).addTo(map);
      liveLineRef.current = L.polyline([ll[0]], { color: C.accent, weight: 5, opacity: 0.9, lineJoin: "round", lineCap: "round" }).addTo(map);
      dotRef.current = L.circleMarker(ll[0], { radius: 8, color: C.bg, weight: 2, fillColor: C.accent, fillOpacity: 1 }).addTo(map);
      map.fitBounds(bgLineRef.current.getBounds(), { padding: [24, 24], maxZoom: 17 });
    }

    const t = setTimeout(() => map.invalidateSize(), 0);
    return () => { clearTimeout(t); map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Update marker + polyline when idx changes ────────────────────────────
  useEffect(() => {
    if (!route || !mapRef.current) return;
    const cur = [route[idx][0], route[idx][1]];
    const drawnLL = route.slice(0, idx + 1).map((p) => [p[0], p[1]]);
    liveLineRef.current?.setLatLngs(drawnLL.length > 1 ? drawnLL : [drawnLL[0], drawnLL[0]]);
    dotRef.current?.setLatLng(cur);
    if (playing) mapRef.current.panTo(cur, { animate: true, duration: 0.25, noMoveStart: true });
  }, [idx, route, playing]);

  // ── Playback interval ─────────────────────────────────────────────────────
  useEffect(() => {
    clearInterval(tickRef.current);
    if (!playing || idx >= n - 1) return;
    const ms = Math.max(16, (durMs || n * 300) / speed / n);
    tickRef.current = setInterval(() => {
      setIdx((i) => {
        if (i >= n - 1) { setPlaying(false); return i; }
        return i + 1;
      });
    }, ms);
    return () => clearInterval(tickRef.current);
  }, [playing, speed, durMs, n]);

  const togglePlay = () => {
    haptic(8);
    if (idx >= n - 1) { setIdx(0); setPlaying(true); }
    else setPlaying((p) => !p);
  };

  // The scrubber is direct manipulation: press anywhere on it and the playhead
  // jumps under the finger, then follows it 1:1 — pointer capture keeps it
  // tracking even when the finger wanders off the bar.
  const [scrubbing, setScrubbing] = useState(false);
  const seek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setIdx(Math.round(pct * (n - 1)));
  };
  const onScrubDown = (e) => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    setScrubbing(true);
    setPlaying(false);
    seek(e);
  };
  const onScrubMove = (e) => { if (scrubbing) seek(e); };
  const onScrubUp = () => setScrubbing(false);

  // Keep Leaflet's attribution clear of the bottom panel.
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  useEffect(() => {
    const panel = panelRef.current, root = rootRef.current;
    if (!panel || !root || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => root.style.setProperty("--panel-h", `${panel.offsetHeight}px`));
    ro.observe(panel);
    return () => ro.disconnect();
  }, []);

  if (!route || n < 2) return null;

  return (
    <div ref={rootRef} className="rp" role="dialog" aria-modal="true" aria-label="Route replay">
      <div ref={elRef} className="rp-map" aria-label="Route replay map" />

      {/* Header, floating on glass */}
      <div className="rm-head">
        <GlassButton icon="back" label="Back" size={44} onClick={onClose} />
        <div className="glass" style={{ borderRadius: 999, padding: 0, marginLeft: "auto", width: 220 }}>
          <Segmented items={SPEEDS.map((sp) => ({ id: sp, label: `${sp}×` }))} value={speed} onChange={setSpeed} style={{ background: "transparent" }} />
        </div>
      </div>

      {/* Stats + transport, in one glass panel */}
      <div ref={panelRef} className="glass rm-panel" style={{ padding: "14px 18px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
          <Metric label="Distance" value={distKm.toFixed(2)} unit="km" color={C.accent} size={24} />
          <Metric label="Elapsed" value={fmtTime(elapsedMs)} color={C.yellow} size={24} />
          <Metric label="Pace" value={fmtPace(pace) || "—"} unit={fmtPace(pace) ? "/km" : null} color={fmtPace(pace) ? C.cyan : C.dim2} size={24} align="right" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={togglePlay} aria-label={playing ? "Pause" : idx >= n - 1 ? "Replay from the start" : "Play"}
            className="cta" style={{ width: 52, height: 52, minHeight: 52, borderRadius: "50%", padding: 0, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name={playing ? "pause" : idx >= n - 1 ? "refresh" : "play"} size={idx >= n - 1 && !playing ? 22 : 20} weight={2.6} />
          </button>
          <div className={`scrub${scrubbing ? " dragging" : ""}`} role="slider" aria-label="Replay position"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}
            onPointerDown={onScrubDown} onPointerMove={onScrubMove} onPointerUp={onScrubUp} onPointerCancel={onScrubUp}>
            <div className="scrub-track"><i style={{ width: `${progress * 100}%` }} /></div>
            <div className="scrub-thumb" style={{ left: `${progress * 100}%` }} />
          </div>
        </div>
        <div className="num t-foot" style={{ display: "flex", justifyContent: "space-between", color: C.dim, marginTop: 6, paddingLeft: 66 }}>
          <span>{fmtTime(elapsedMs)}</span><span>{fmtTime(durMs)}</span>
        </div>
      </div>
    </div>
  );
}
