// Full-screen replay of a saved GPS route. Animates a dot along the route
// with a progressive polyline, scrub bar, and live elapsed/distance/pace stats.
import React, { useState, useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { C } from "../data.js";
import { haptic } from "../celebrate.js";

const TILES = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
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
  const defaultSpeed = Math.max(10, Math.min(120, Math.round((durMs / 40000) / 10) * 10)) || 30;
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

  const scrub = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setIdx(Math.round(pct * (n - 1)));
    setPlaying(false);
  };

  if (!route || n < 2) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: C.bg, display: "flex", flexDirection: "column", fontFamily: "'Manrope', system-ui, sans-serif" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "max(14px, env(safe-area-inset-top)) 16px 10px", background: C.bg, borderBottom: `1px solid ${C.line}` }}>
        <button onClick={onClose} className="chip" style={{ padding: "6px 14px", fontSize: 13 }}>← Back</button>
        <div className="disp" style={{ fontSize: 16, fontWeight: 700 }}>Route Replay</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 5 }}>
          {SPEEDS.map((s) => (
            <button key={s} onClick={() => { setSpeed(s); haptic(5); }} className="chip"
              style={{ padding: "5px 9px", fontSize: 11, background: speed === s ? C.accent : "transparent", color: speed === s ? C.bg : C.dim, border: `1px solid ${speed === s ? C.accent : C.line}` }}>
              {s}×
            </button>
          ))}
        </div>
      </div>

      {/* Map */}
      <div ref={elRef} style={{ flex: 1, minHeight: 0 }} aria-label="Route replay map" />

      {/* Stats strip */}
      <div style={{ display: "flex", justifyContent: "space-around", padding: "11px 16px", background: C.surface, borderTop: `1px solid ${C.line}` }}>
        {[
          { label: "DISTANCE", value: `${distKm.toFixed(2)} km` },
          { label: "ELAPSED", value: fmtTime(elapsedMs) },
          { label: "RECENT PACE", value: (fmtPace(pace) || "--:--") + "/km" },
        ].map(({ label, value }) => (
          <div key={label} style={{ textAlign: "center" }}>
            <div className="num" style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
            <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, letterSpacing: 1.5, marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Scrub bar + controls */}
      <div style={{ padding: "12px 16px calc(14px + env(safe-area-inset-bottom))", background: C.surface, borderTop: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={togglePlay} className="chip cta disp"
          style={{ padding: "10px 22px", fontSize: 18, fontWeight: 800, borderRadius: 999, flexShrink: 0, letterSpacing: 0 }}>
          {playing ? "❚❚" : idx >= n - 1 ? "↺" : "▶"}
        </button>
        <div onClick={scrub} style={{ flex: 1, height: 6, background: C.surface2, borderRadius: 4, cursor: "pointer", position: "relative", touchAction: "none" }}>
          <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${progress * 100}%`, background: C.accent, borderRadius: 4 }} />
          <div style={{ position: "absolute", top: -5, left: `calc(${progress * 100}% - 8px)`, width: 16, height: 16, borderRadius: 8, background: C.accent, border: `2px solid ${C.bg}`, boxShadow: "0 1px 4px rgba(0,0,0,.5)" }} />
        </div>
        <div className="num" style={{ fontSize: 11, color: C.dim, flexShrink: 0, minWidth: 80, textAlign: "right" }}>{fmtTime(elapsedMs)} / {fmtTime(durMs)}</div>
      </div>
    </div>
  );
}
