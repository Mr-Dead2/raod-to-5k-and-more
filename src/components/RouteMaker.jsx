// Route planner. Every route it produces is built on the real OpenStreetMap
// road/path network (see ../routing.js), so a generated loop or out-and-back
// follows streets, parks and footpaths you can actually run — not a circle or
// a straight line drawn over the map. Saved routes can be reused as a target
// when starting a GPS run.
import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { C } from "../data.js";
import { haptic } from "../celebrate.js";
import { loadSettings, saveSettings } from "../storage.js";
import { LiveMap } from "./LiveMap.jsx";
import {
  loadNetwork, nearestNode, buildLoop, buildOutBack, snapWaypoints,
  radiusForTarget, haversineKm,
} from "../routing.js";

// Dark basemap matching the rest of the app (free, no API key).
const TILES = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
const PACE_MIN_KM = 6.5; // rough planning pace for the time estimate

export function calcRouteKm(points) {
  if (!points || points.length < 2) return 0;
  let dist = 0;
  for (let i = 1; i < points.length; i++) {
    const p1 = Array.isArray(points[i - 1]) ? { lat: points[i - 1][0], lng: points[i - 1][1] } : points[i - 1];
    const p2 = Array.isArray(points[i]) ? { lat: points[i][0], lng: points[i][1] } : points[i];
    dist += haversineKm(p1, p2);
  }
  return dist;
}

export function loadSavedRoutes() {
  const s = loadSettings();
  return Array.isArray(s.savedRoutes) ? s.savedRoutes : [];
}

export function saveCustomRoute(newRoute) {
  const routes = loadSavedRoutes();
  const next = [newRoute, ...routes.filter((r) => r.id !== newRoute.id)];
  saveSettings({ ...loadSettings(), savedRoutes: next });
  return next;
}

export function deleteCustomRoute(id) {
  const routes = loadSavedRoutes();
  const next = routes.filter((r) => r.id !== id);
  saveSettings({ ...loadSettings(), savedRoutes: next });
  return next;
}

const dotIcon = (color, size, ring) => L.divIcon({
  className: "",
  iconSize: [size, size],
  iconAnchor: [size / 2, size / 2],
  html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2.5px solid #0a0b0d;box-shadow:0 0 0 ${ring ? 2.5 : 1.5}px ${color}, 0 1px 4px rgba(0,0,0,.6)"></div>`,
});

const overlayPill = {
  background: "rgba(11,12,15,0.9)", border: `1px solid ${C.line}`, borderRadius: 12,
};

const MODES = [
  { id: "loop", label: "Loop", hint: "A circuit on real streets that brings you back to the start." },
  { id: "outback", label: "Out & back", hint: "Runs out along the best road and returns to the start." },
  { id: "draw", label: "Draw", hint: "Tap the map — each leg is snapped onto real roads." },
];

// Give the browser a frame to paint the busy state before the (synchronous)
// graph search hogs the main thread.
const yieldFrame = () => new Promise((r) => setTimeout(r, 30));

export function RouteMaker({ onClose, onSelectRoute }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const lineRef = useRef(null);
  const markersRef = useRef([]);
  const startMarkerRef = useRef(null);
  const jobSeq = useRef(0);

  const [mode, setMode] = useState("loop");
  const [start, setStart] = useState(null);        // {lat,lng} route origin
  const [wpts, setWpts] = useState([]);            // draw-mode waypoints
  const [route, setRoute] = useState(null);        // {points, km, pathPct, busyPct, repeatPct}
  const [busy, setBusy] = useState(null);          // 'network' | 'search' | null
  const [quiet, setQuiet] = useState(true);        // prefer paths / avoid main roads
  const [err, setErr] = useState("");
  const [routeName, setRouteName] = useState("");
  const [targetKmInput, setTargetKmInput] = useState("5.0");
  const [savedRoutes, setSavedRoutes] = useState([]);
  const [activeTab, setActiveTab] = useState("build"); // build | saved
  const [userLoc, setUserLoc] = useState(null);
  const [deleteArm, setDeleteArm] = useState(null);

  useEffect(() => { setSavedRoutes(loadSavedRoutes()); }, []);

  const target = Math.max(0.5, Math.min(42, parseFloat(targetKmInput) || 5));

  // Locate the user for the map centre and the default start point.
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLoc(coords);
        setStart((s) => s || coords);
        if (mapRef.current) mapRef.current.setView([coords.lat, coords.lng], 15);
      },
      () => {},
      { timeout: 8000, enableHighAccuracy: true }
    );
  }, []);

  // Map init — mounted once; the build pane is hidden (not unmounted) on the
  // saved tab so the map survives tab switches.
  useEffect(() => {
    let map;
    try {
      map = L.map(elRef.current, { zoomControl: false, attributionControl: true });
      L.tileLayer(TILES, { attribution: ATTR, maxZoom: 19, subdomains: "abcd" }).addTo(map);
      map.setView(userLoc ? [userLoc.lat, userLoc.lng] : [51.505, -0.09], userLoc ? 15 : 13);
      mapRef.current = map;
    } catch (e) {
      console.warn("RouteMaker map init failed:", e);
    }
    const t = setTimeout(() => map && map.invalidateSize(), 100);
    return () => {
      clearTimeout(t);
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch { /* already gone */ }
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Map taps: place waypoints while drawing, otherwise move the start point.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onClick = (e) => {
      const pt = { lat: e.latlng.lat, lng: e.latlng.lng };
      haptic(5);
      if (mode === "draw") setWpts((prev) => [...prev, pt]);
      else { setStart(pt); setRoute(null); setErr(""); }
    };
    map.on("click", onClick);
    return () => map.off("click", onClick);
  }, [mode]);

  // Returning to the build tab: the container was display:none — re-measure.
  useEffect(() => {
    if (activeTab === "build") {
      const t = setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 60);
      return () => clearTimeout(t);
    }
  }, [activeTab]);

  const fitRoute = (points) => {
    const map = mapRef.current;
    if (!map || !points || points.length < 2) return;
    map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 16 });
  };

  // Draw the route polyline.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (lineRef.current) { map.removeLayer(lineRef.current); lineRef.current = null; }
    const pts = route ? route.points : (wpts.length > 1 ? wpts : null);
    if (!pts || pts.length < 2) return;
    lineRef.current = L.polyline(pts.map((p) => [p.lat, p.lng]), {
      color: C.accent, weight: 5, opacity: route ? 0.95 : 0.45,
      dashArray: route ? null : "6 8", lineJoin: "round", lineCap: "round",
    }).addTo(map);
  }, [route, wpts]);

  // Start pin + draw-mode waypoint markers (drag to move, tap to remove).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (startMarkerRef.current) { map.removeLayer(startMarkerRef.current); startMarkerRef.current = null; }
    if (start && mode !== "draw") {
      const m = L.marker([start.lat, start.lng], { draggable: true, icon: dotIcon(C.accent, 18, true), keyboard: false }).addTo(map);
      m.on("dragend", () => {
        const ll = m.getLatLng();
        haptic(6);
        setStart({ lat: ll.lat, lng: ll.lng });
        setRoute(null);
      });
      startMarkerRef.current = m;
    }
    markersRef.current.forEach((m) => map.removeLayer(m));
    markersRef.current = mode === "draw" ? wpts.map((p, i) => {
      const isStart = i === 0;
      const isEnd = i === wpts.length - 1 && wpts.length > 1;
      const m = L.marker([p.lat, p.lng], {
        draggable: true,
        icon: dotIcon(isStart ? C.accent : isEnd ? C.warn : "#ffffff", isStart || isEnd ? 16 : 12),
        keyboard: false,
      }).addTo(map);
      m.on("dragend", () => {
        const ll = m.getLatLng();
        haptic(6);
        setWpts((prev) => prev.map((q, j) => (j === i ? { lat: ll.lat, lng: ll.lng } : q)));
      });
      m.on("click", () => { haptic(8); setWpts((prev) => prev.filter((_, j) => j !== i)); });
      return m;
    }) : [];
  }, [wpts, start, mode]);

  // Draw mode: snap the tapped waypoints onto the road network.
  useEffect(() => {
    if (mode !== "draw") return;
    if (wpts.length < 2) { setRoute(null); return;}
    const id = ++jobSeq.current;
    const t = setTimeout(async () => {
      setBusy("network");
      setErr("");
      try {
        const mid = wpts.reduce((a, p) => ({ lat: a.lat + p.lat / wpts.length, lng: a.lng + p.lng / wpts.length }), { lat: 0, lng: 0 });
        const spread = Math.max(...wpts.map((p) => haversineKm(mid, p)));
        const graph = await loadNetwork(mid, Math.min(6000, Math.max(900, spread * 1000 + 700)));
        if (jobSeq.current !== id) return;
        setBusy("search");
        await yieldFrame();
        const snapped = snapWaypoints(graph, wpts);
        if (jobSeq.current !== id) return;
        setRoute(snapped);
      } catch (e) {
        if (jobSeq.current !== id) return;
        setRoute(null);
        setErr(`Couldn't snap to roads (${e.message}) — showing your straight line.`);
      } finally {
        if (jobSeq.current === id) setBusy(null);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [wpts, mode]);

  const mapCentre = () => {
    const map = mapRef.current;
    return map ? { lat: map.getCenter().lat, lng: map.getCenter().lng } : null;
  };

  // Build a loop / out-and-back on the real network around the start point.
  const generate = async () => {
    if (busy) return;
    const origin = start || userLoc || mapCentre();
    if (!origin) { setErr("Tap the map to pick a start point."); return; }
    setStart(origin);
    haptic(10);
    const id = ++jobSeq.current;
    setErr("");
    setBusy("network");
    try {
      const graph = await loadNetwork(origin, radiusForTarget(target, mode));
      if (jobSeq.current !== id) return;
      setBusy("search");
      await yieldFrame();
      const node = nearestNode(graph, origin);
      const r = mode === "loop"
        ? buildLoop(graph, node, target, { quiet, seed: Math.floor(Math.random() * 1e9), timeBudgetMs: 2500 })
        : buildOutBack(graph, node, target, { quiet });
      if (jobSeq.current !== id) return;
      setRoute(r);
      setRouteName(`${mode === "loop" ? "Loop" : "Out & back"} ${r.km.toFixed(1)} km`);
      fitRoute(r.points);
    } catch (e) {
      if (jobSeq.current !== id) return;
      setErr(
        /overpass|fetch|network|Failed/i.test(e.message)
          ? "Can't reach the map data service — check your connection and try again."
          : `No ${target} km ${mode === "loop" ? "loop" : "out & back"} found here: ${e.message}. Try another start point or distance.`
      );
    } finally {
      if (jobSeq.current === id) setBusy(null);
    }
  };

  const stepKm = (d) => {
    const v = Math.max(0.5, Math.min(42, (parseFloat(targetKmInput) || 5) + d));
    setTargetKmInput(String(Math.round(v * 10) / 10));
    haptic(5);
  };

  const switchMode = (id) => {
    if (id === mode) return;
    haptic(6);
    jobSeq.current++;
    setMode(id);
    setRoute(null);
    setErr("");
    setBusy(null);
    if (id !== "draw") setWpts([]);
  };

  const locateMe = () => {
    haptic(6);
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setUserLoc(coords);
      setStart(coords);
      setRoute(null);
      if (mapRef.current) mapRef.current.setView([coords.lat, coords.lng], 15);
    }, () => setErr("Location unavailable — tap the map to set your start instead."), { timeout: 8000 });
  };

  const totalKm = route ? route.km : calcRouteKm(wpts);
  const estMinutes = Math.round(totalKm * PACE_MIN_KM);
  const canSave = !!route && route.points.length > 1;

  const handleSave = () => {
    if (!canSave) return;
    haptic(10);
    const name = routeName.trim() || `Custom ${totalKm.toFixed(1)} km route`;
    // Keep saved payloads small: cap the stored geometry at ~400 points.
    const step = Math.max(1, Math.ceil(route.points.length / 400));
    const pts = route.points
      .filter((_, i) => i % step === 0 || i === route.points.length - 1)
      .map((p) => [Number(p.lat.toFixed(5)), Number(p.lng.toFixed(5))]);
    const updated = saveCustomRoute({
      id: "route_" + Date.now(),
      name,
      points: pts,
      wpts: mode === "draw" ? wpts.map((p) => [Number(p.lat.toFixed(5)), Number(p.lng.toFixed(5))]) : [],
      km: Number(totalKm.toFixed(2)),
      pathPct: route.pathPct ?? null,
      createdAt: new Date().toISOString(),
    });
    setSavedRoutes(updated);
    setRouteName("");
    setActiveTab("saved");
  };

  const handleDelete = (id) => {
    if (deleteArm !== id) {
      haptic(6);
      setDeleteArm(id);
      setTimeout(() => setDeleteArm((cur) => (cur === id ? null : cur)), 2600);
      return;
    }
    haptic(10);
    setDeleteArm(null);
    setSavedRoutes(deleteCustomRoute(id));
  };

  const handleEdit = (r) => {
    haptic(8);
    const pts = (r.points || []).map((p) => ({ lat: p[0], lng: p[1] }));
    setMode(Array.isArray(r.wpts) && r.wpts.length ? "draw" : mode);
    if (Array.isArray(r.wpts) && r.wpts.length) setWpts(r.wpts.map((p) => ({ lat: p[0], lng: p[1] })));
    else { setRoute({ points: pts, km: r.km, pathPct: r.pathPct ?? 0, busyPct: 0, repeatPct: 0 }); setStart(pts[0] || null); }
    setRouteName(r.name);
    setActiveTab("build");
    setTimeout(() => fitRoute(pts), 120);
  };

  const handleSelect = (r) => {
    haptic(10);
    if (onSelectRoute) onSelectRoute(r);
    if (onClose) onClose();
  };

  const tabChip = (active) => active
    ? { flex: 1, textAlign: "center", background: C.accent, color: C.bg, border: "none", fontWeight: 800 }
    : { flex: 1, textAlign: "center" };

  const modeHint = useMemo(() => MODES.find((m) => m.id === mode).hint, [mode]);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999, background: C.bg, color: C.text,
      display: "flex", flexDirection: "column",
      paddingTop: "max(10px, env(safe-area-inset-top))",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 16px 0" }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 2, color: C.accent, fontWeight: 800 }}>ROUTE PLANNER</div>
          <h2 className="disp" style={{ fontSize: 20, fontWeight: 700, margin: "1px 0 0" }}>Routes on real roads</h2>
        </div>
        <button onClick={() => { haptic(8); onClose(); }} className="chip tap" aria-label="Close route planner" style={{ padding: "8px 15px", fontSize: 14 }}>✕</button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, padding: "10px 16px 12px" }}>
        <button onClick={() => { setActiveTab("build"); haptic(5); }} className="chip tap" style={tabChip(activeTab === "build")}>Build</button>
        <button onClick={() => { setActiveTab("saved"); haptic(5); }} className="chip tap" style={tabChip(activeTab === "saved")}>
          Saved{savedRoutes.length ? ` (${savedRoutes.length})` : ""}
        </button>
      </div>

      {/* Build pane — hidden, not unmounted, so the map survives tab switches */}
      <div style={{ flex: 1, display: activeTab === "build" ? "flex" : "none", flexDirection: "column", minHeight: 0 }}>
        {/* Controls */}
        <div style={{ padding: "10px 14px 11px", background: C.surface, borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, display: "grid", gap: 9 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {MODES.map((m) => (
              <button key={m.id} onClick={() => switchMode(m.id)} className="chip tap disp"
                style={{
                  flex: 1, textAlign: "center", fontSize: 12.5, padding: "8px 0",
                  background: mode === m.id ? C.accent : C.bg, color: mode === m.id ? C.bg : C.dim,
                  border: `1px solid ${mode === m.id ? C.accent : C.line}`, fontWeight: mode === m.id ? 800 : 600,
                }}>
                {m.label}
              </button>
            ))}
          </div>

          {mode === "draw" ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 11.5, color: C.dim, flex: 1 }}>{modeHint}</span>
              <button onClick={() => { haptic(6); setWpts((p) => p.slice(0, -1)); }} disabled={!wpts.length} className="chip tap"
                style={{ fontSize: 12, padding: "7px 12px", color: wpts.length ? C.text : C.dim }}>Undo</button>
              <button onClick={() => { haptic(8); setWpts([]); setRoute(null); setErr(""); }} disabled={!wpts.length} className="chip tap"
                style={{ fontSize: 12, padding: "7px 12px", color: wpts.length ? C.warn : C.dim }}>Clear</button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button onClick={() => stepKm(-0.5)} className="chip tap" style={{ padding: "7px 12px" }} aria-label="Decrease distance">−</button>
                <input className="inp num" type="number" inputMode="decimal" step="0.5" min="0.5" max="42" value={targetKmInput}
                  onChange={(e) => setTargetKmInput(e.target.value)} aria-label="Target distance in km"
                  style={{ width: 62, padding: "7px 4px", fontSize: 14, textAlign: "center" }} />
                <button onClick={() => stepKm(0.5)} className="chip tap" style={{ padding: "7px 12px" }} aria-label="Increase distance">+</button>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.dim }}>km</span>
              </div>
              <button onClick={generate} disabled={!!busy} className="chip cta tap disp"
                style={{ flex: 1, minWidth: 130, fontSize: 13, padding: "9px 14px", opacity: busy ? 0.6 : 1 }}>
                {busy ? "Working…" : route ? "Try another route" : `Build ${mode === "loop" ? "loop" : "out & back"}`}
              </button>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={() => { setQuiet((q) => !q); haptic(6); setRoute(null); }} className="chip tap"
              style={{ fontSize: 11.5, background: quiet ? `${C.accent}22` : C.bg, color: quiet ? C.accent : C.dim, borderColor: quiet ? C.accent : C.line }}>
              {quiet ? "● " : "○ "}Quiet roads & paths
            </button>
            <span style={{ fontSize: 11, color: C.dim, flex: 1, lineHeight: 1.35 }}>
              {mode === "draw" ? "Legs are routed along real streets." : "Tap the map (or drag the pin) to move the start."}
            </span>
          </div>
        </div>

        {err && (
          <div style={{ padding: "7px 14px", fontSize: 11.5, color: C.warn, background: C.surface, borderBottom: `1px solid ${C.line}` }}>{err}</div>
        )}

        {/* Map */}
        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
          <div ref={elRef} style={{ position: "absolute", inset: 0 }} aria-label="Route plotting map" />

          {/* Route stats */}
          <div style={{ ...overlayPill, position: "absolute", top: 12, left: 12, right: 12, zIndex: 500, padding: "8px 12px" }}>
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, letterSpacing: 1 }}>DISTANCE</div>
                <div className="num" style={{ fontSize: 18, fontWeight: 700, color: C.accent }}>{totalKm.toFixed(2)} km</div>
              </div>
              <div style={{ borderLeft: `1px solid ${C.line}`, paddingLeft: 12 }}>
                <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, letterSpacing: 1 }}>EST. TIME</div>
                <div className="num" style={{ fontSize: 16, fontWeight: 700 }}>~{estMinutes} min</div>
              </div>
              {route && (
                <div style={{ borderLeft: `1px solid ${C.line}`, paddingLeft: 12 }}>
                  <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, letterSpacing: 1 }}>ON PATHS</div>
                  <div className="num" style={{ fontSize: 16, fontWeight: 700 }}>{route.pathPct}%</div>
                </div>
              )}
            </div>
            {route && (
              <div style={{ display: "flex", gap: 6, marginTop: 7, flexWrap: "wrap" }}>
                <Tag label={`${route.busyPct}% busy roads`} tone={route.busyPct > 25 ? C.warn : C.dim} />
                <Tag label={route.repeatPct > 3 ? `${route.repeatPct}% doubles back` : "no doubling back"} tone={C.dim} />
                <Tag label="follows real roads" tone={C.accent} />
              </div>
            )}
          </div>

          {/* First-use hint */}
          {!route && !busy && wpts.length === 0 && (
            <div style={{ position: "absolute", left: "50%", bottom: 64, transform: "translateX(-50%)", zIndex: 500, pointerEvents: "none", textAlign: "center", maxWidth: 280 }}>
              <div style={{ ...overlayPill, padding: "11px 15px", fontSize: 12.5, color: C.dim, lineHeight: 1.5 }}>{modeHint}</div>
            </div>
          )}

          {/* Busy indicator */}
          {busy && (
            <div style={{ ...overlayPill, position: "absolute", bottom: 62, left: "50%", transform: "translateX(-50%)", zIndex: 500, padding: "7px 15px", fontSize: 11.5, color: C.accent, fontWeight: 700 }}>
              {busy === "network" ? "Reading the roads around you…" : "Finding the best route…"}
            </div>
          )}

          {/* Map action buttons */}
          <div style={{ position: "absolute", bottom: 12, right: 12, zIndex: 500, display: "flex", gap: 8 }}>
            <button onClick={locateMe} className="chip tap" aria-label="Centre on my location"
              style={{ ...overlayPill, color: C.text }}>⌖ My location</button>
            {route && (
              <button onClick={() => { haptic(6); fitRoute(route.points); }} className="chip tap"
                style={{ ...overlayPill, color: C.text }}>Fit route</button>
            )}
          </div>
        </div>

        {/* Save bar */}
        <div style={{ padding: "12px 14px calc(12px + env(safe-area-inset-bottom))", background: C.surface, borderTop: `1px solid ${C.line}`, display: "flex", gap: 10, alignItems: "center" }}>
          <input className="inp" value={routeName} onChange={(e) => setRouteName(e.target.value)}
            placeholder="Route name (e.g. Park loop 5K)" disabled={!canSave} style={{ flex: 1 }} />
          <button onClick={handleSave} disabled={!canSave} className="tap cta disp"
            style={{ borderRadius: 12, padding: "11px 20px", fontSize: 14, fontWeight: 700, border: "none", opacity: canSave ? 1 : 0.5 }}>
            Save route
          </button>
        </div>
      </div>

      {/* Saved routes pane */}
      {activeTab === "saved" && (
        <div style={{ flex: 1, padding: "4px 16px calc(16px + env(safe-area-inset-bottom))", overflowY: "auto" }}>
          {savedRoutes.length === 0 ? (
            <div style={{ textAlign: "center", padding: 36, color: C.dim }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🗺️</div>
              <div className="disp" style={{ fontSize: 18, fontWeight: 700, color: C.text }}>No saved routes yet</div>
              <div style={{ fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>Build a loop or out &amp; back on the first tab, then save it here.</div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {savedRoutes.map((r) => (
                <div key={r.id} className="card rise" style={{ padding: 12, border: `1px solid ${C.line}`, borderRadius: 14 }}>
                  <LiveMap points={r.points} height={96} interactive={false} />
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="disp" style={{ fontSize: 15.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
                      <div style={{ fontSize: 11.5, color: C.dim, marginTop: 2 }}>
                        {r.km} km{r.pathPct != null ? ` · ${r.pathPct}% on paths` : ""} · saved {new Date(r.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      {onSelectRoute && (
                        <button onClick={() => handleSelect(r)} className="chip cta tap" style={{ fontSize: 12, padding: "7px 13px" }}>Use</button>
                      )}
                      <button onClick={() => handleEdit(r)} className="chip tap" style={{ fontSize: 12, padding: "7px 11px" }}>Edit</button>
                      <button onClick={() => handleDelete(r.id)} className="chip tap"
                        style={{ fontSize: 12, padding: "7px 11px", color: C.warn, borderColor: deleteArm === r.id ? C.warn : C.line, background: deleteArm === r.id ? `${C.warn}22` : C.bg, fontWeight: deleteArm === r.id ? 800 : 600 }}>
                        {deleteArm === r.id ? "Sure?" : "Delete"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Tag({ label, tone }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.3, color: tone, border: `1px solid ${tone}44`, borderRadius: 999, padding: "3px 8px" }}>
      {label}
    </span>
  );
}
