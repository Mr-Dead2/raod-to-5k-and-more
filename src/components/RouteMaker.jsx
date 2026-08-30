// Route planner: tap the map to draw a route, drag points to adjust, snap the
// line to real footpaths (best-effort via a free community router), or
// auto-build a loop / out-and-back for a target distance. Saved routes can be
// reused as a target when starting a GPS run.
import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { C } from "../data.js";
import { haptic } from "../celebrate.js";
import { loadSettings, saveSettings } from "../storage.js";
import { LiveMap } from "./LiveMap.jsx";

// Dark basemap matching the rest of the app (free, no API key).
const TILES = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a> · routing <a href="http://project-osrm.org">OSRM</a>';
// Free OSRM community server with a walking profile. Used best-effort to snap
// drawn lines to real paths; on any failure we fall back to straight lines.
const SNAP_URL = "https://routing.openstreetmap.de/routed-foot/route/v1/foot/";
const PACE_MIN_KM = 6.5; // rough planning pace for the time estimate

// Haversine distance in km between two {lat,lng} points.
function haversineKm(p1, p2) {
  const R = 6371;
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((p1.lat * Math.PI) / 180) *
      Math.cos((p2.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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

// Snap an ordered list of waypoints to walkable paths. Returns the full
// geometry plus the router's true distance. Throws on any failure so the
// caller can fall back to straight lines.
async function snapPath(wpts) {
  const coords = wpts.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
  const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(9000) : undefined;
  const res = await fetch(`${SNAP_URL}${coords}?overview=full&geometries=geojson&steps=false`, { signal });
  if (!res.ok) throw new Error("router unavailable");
  const json = await res.json();
  const route = json?.routes?.[0];
  const geo = route?.geometry?.coordinates;
  if (!geo || !geo.length) throw new Error("no route found");
  return { points: geo.map(([lng, lat]) => ({ lat, lng })), km: route.distance / 1000 };
}

// Waypoints of a circle that passes through `start` (not around it), sized so
// the straight-line perimeter is ~targetKm. Snapping to roads stretches the
// distance, so the builder refines the scale against the router's answer.
function loopWpts(start, targetKm, bearing) {
  const n = 8;
  const r = targetKm / (2 * Math.PI); // km
  const latR = r / 110.574;
  const lngR = r / (111.32 * Math.cos((start.lat * Math.PI) / 180));
  const cLat = start.lat + latR * Math.cos(bearing);
  const cLng = start.lng + lngR * Math.sin(bearing);
  const a0 = bearing + Math.PI; // angle from the circle centre back to start
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (i * 2 * Math.PI) / n;
    pts.push({ lat: cLat + latR * Math.cos(a), lng: cLng + lngR * Math.sin(a) });
  }
  return pts; // starts and ends at ~start
}

// Straight out along a bearing to half the target distance, then back.
function outBackWpts(start, targetKm, bearing) {
  const half = targetKm / 2;
  const latD = (half / 110.574) * Math.cos(bearing);
  const lngD = (half / (111.32 * Math.cos((start.lat * Math.PI) / 180))) * Math.sin(bearing);
  return [start, { lat: start.lat + latD, lng: start.lng + lngD }, start];
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

// Small round waypoint marker (drag to move, tap to remove).
const dotIcon = (color, size) => L.divIcon({
  className: "",
  iconSize: [size, size],
  iconAnchor: [size / 2, size / 2],
  html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2.5px solid #0a0b0d;box-shadow:0 0 0 1.5px ${color}, 0 1px 4px rgba(0,0,0,.6)"></div>`,
});

const overlayPill = {
  background: "rgba(11,12,15,0.9)", border: `1px solid ${C.line}`, borderRadius: 12,
};

export function RouteMaker({ onClose, onSelectRoute }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const polylineRef = useRef(null);
  const markersRef = useRef([]);
  const snapSeq = useRef(0);
  const fitNext = useRef(false);

  const [wpts, setWpts] = useState([]);       // editable waypoints [{lat,lng}]
  const [path, setPath] = useState([]);       // displayed geometry (snapped or straight)
  const [pathKm, setPathKm] = useState(0);
  const [snapOn, setSnapOn] = useState(true);
  const [snapBusy, setSnapBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [note, setNote] = useState("");
  const [routeName, setRouteName] = useState("");
  const [targetKmInput, setTargetKmInput] = useState("5.0");
  const [savedRoutes, setSavedRoutes] = useState([]);
  const [activeTab, setActiveTab] = useState("draw"); // draw | saved
  const [userLoc, setUserLoc] = useState(null);
  const [deleteArm, setDeleteArm] = useState(null); // route id awaiting confirm

  useEffect(() => { setSavedRoutes(loadSavedRoutes()); }, []);

  // Locate the user for a sensible map centre and as the default start point.
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLoc(coords);
        if (mapRef.current) mapRef.current.setView([coords.lat, coords.lng], 15);
      },
      () => {},
      { timeout: 5000 }
    );
  }, []);

  // Map init — mounted once; the draw pane is hidden (not unmounted) on the
  // saved tab so the map survives tab switches.
  useEffect(() => {
    let map;
    try {
      map = L.map(elRef.current, { zoomControl: false, attributionControl: true });
      L.tileLayer(TILES, { attribution: ATTR, maxZoom: 19, subdomains: "abcd" }).addTo(map);
      map.setView(userLoc ? [userLoc.lat, userLoc.lng] : [51.505, -0.09], userLoc ? 15 : 13);
      map.on("click", (e) => {
        haptic(5);
        setWpts((prev) => [...prev, { lat: e.latlng.lat, lng: e.latlng.lng }]);
      });
      mapRef.current = map;
    } catch (e) {
      console.warn("RouteMaker map init failed:", e);
    }
    const t = setTimeout(() => map && map.invalidateSize(), 100);
    return () => {
      clearTimeout(t);
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch {}
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Returning to the draw tab: the container was display:none — re-measure.
  useEffect(() => {
    if (activeTab === "draw") {
      const t = setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 60);
      return () => clearTimeout(t);
    }
  }, [activeTab]);

  // Derive the displayed path from the waypoints: straight lines immediately,
  // then snapped to real paths when the router answers (stale replies dropped).
  useEffect(() => {
    const id = ++snapSeq.current;
    setPath(wpts);
    setPathKm(calcRouteKm(wpts));
    if (wpts.length < 2 || !snapOn) return;
    const t = setTimeout(async () => {
      setSnapBusy(true);
      try {
        const r = await snapPath(wpts);
        if (snapSeq.current !== id) return;
        setPath(r.points);
        setPathKm(r.km);
        setNote("");
      } catch {
        if (snapSeq.current === id) setNote("Route service unreachable — showing straight lines.");
      } finally {
        if (snapSeq.current === id) setSnapBusy(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [wpts, snapOn]);

  // Draw the path polyline.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (polylineRef.current) { map.removeLayer(polylineRef.current); polylineRef.current = null; }
    if (path.length > 1) {
      polylineRef.current = L.polyline(path.map((p) => [p.lat, p.lng]), {
        color: C.accent, weight: 4, opacity: 0.9, lineJoin: "round", lineCap: "round",
      }).addTo(map);
      if (fitNext.current) {
        fitNext.current = false;
        map.fitBounds(polylineRef.current.getBounds(), { padding: [36, 36], maxZoom: 16 });
      }
    }
  }, [path]);

  // Waypoint markers: drag to move, tap to remove.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => map.removeLayer(m));
    markersRef.current = wpts.map((p, i) => {
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
      m.on("click", () => {
        haptic(8);
        setWpts((prev) => prev.filter((_, j) => j !== i));
      });
      return m;
    });
  }, [wpts]);

  const totalKm = pathKm;
  const estMinutes = Math.round(totalKm * PACE_MIN_KM);

  // Auto-build a loop or out-and-back near the start point. When snapping is
  // on, refine the size against the router's real distance (roads meander).
  const buildRoute = async (kind) => {
    if (genBusy) return;
    const target = parseFloat(targetKmInput);
    if (!target || target <= 0) return;
    haptic(10);
    setGenBusy(true);
    setNote("");
    const start = wpts[0] || userLoc ||
      (mapRef.current ? { lat: mapRef.current.getCenter().lat, lng: mapRef.current.getCenter().lng } : null);
    if (!start) { setGenBusy(false); return; }
    const bearing = Math.random() * 2 * Math.PI;
    const make = (scale) => (kind === "loop" ? loopWpts(start, target * scale, bearing) : outBackWpts(start, target * scale, bearing));
    let w = make(1);
    if (snapOn) {
      try {
        let scale = 1;
        for (let i = 0; i < 3; i++) {
          const r = await snapPath(w);
          const ratio = target / Math.max(r.km, 0.05);
          if (ratio > 0.9 && ratio < 1.1) break;
          scale *= Math.max(0.4, Math.min(2.2, ratio));
          w = make(scale);
        }
      } catch {
        setNote("Route service unreachable — built a straight-line route.");
      }
    }
    fitNext.current = true;
    setWpts(w);
    setRouteName(`${kind === "loop" ? "Loop" : "Out & back"} ${target} km`);
    setGenBusy(false);
  };

  const stepKm = (d) => {
    const v = Math.max(0.5, Math.min(42, (parseFloat(targetKmInput) || 5) + d));
    setTargetKmInput(String(Math.round(v * 10) / 10));
    haptic(5);
  };

  const handleUndo = () => { haptic(6); setWpts((prev) => prev.slice(0, -1)); };
  const handleClear = () => { haptic(8); setWpts([]); setNote(""); };

  const locateMe = () => {
    haptic(6);
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setUserLoc(coords);
      if (mapRef.current) mapRef.current.setView([coords.lat, coords.lng], 15);
    }, () => {}, { timeout: 5000 });
  };

  const handleSave = () => {
    if (path.length < 2) return;
    haptic(10);
    const name = routeName.trim() || `Custom ${totalKm.toFixed(1)} km route`;
    // Keep saved payloads small: cap the stored geometry at ~400 points.
    const step = Math.max(1, Math.ceil(path.length / 400));
    const pts = path
      .filter((_, i) => i % step === 0 || i === path.length - 1)
      .map((p) => [Number(p.lat.toFixed(5)), Number(p.lng.toFixed(5))]);
    const newRoute = {
      id: "route_" + Date.now(),
      name,
      points: pts,
      wpts: wpts.map((p) => [Number(p.lat.toFixed(5)), Number(p.lng.toFixed(5))]),
      km: Number(totalKm.toFixed(2)),
      createdAt: new Date().toISOString(),
    };
    const updated = saveCustomRoute(newRoute);
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

  const handleEdit = (route) => {
    haptic(8);
    const src = Array.isArray(route.wpts) && route.wpts.length ? route.wpts : route.points;
    fitNext.current = true;
    setWpts(src.map((p) => ({ lat: p[0], lng: p[1] })));
    setRouteName(route.name);
    setActiveTab("draw");
  };

  const handleSelect = (route) => {
    haptic(10);
    if (onSelectRoute) onSelectRoute(route);
    if (onClose) onClose();
  };

  const tabChip = (active) => active
    ? { flex: 1, textAlign: "center", background: C.accent, color: C.bg, border: "none", fontWeight: 800 }
    : { flex: 1, textAlign: "center" };

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
          <h2 className="disp" style={{ fontSize: 20, fontWeight: 700, margin: "1px 0 0" }}>Plan a route</h2>
        </div>
        <button onClick={() => { haptic(8); onClose(); }} className="chip tap" aria-label="Close route planner" style={{ padding: "8px 15px", fontSize: 14 }}>✕</button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, padding: "10px 16px 12px" }}>
        <button onClick={() => { setActiveTab("draw"); haptic(5); }} className="chip tap" style={tabChip(activeTab === "draw")}>Draw & build</button>
        <button onClick={() => { setActiveTab("saved"); haptic(5); }} className="chip tap" style={tabChip(activeTab === "saved")}>
          Saved{savedRoutes.length ? ` (${savedRoutes.length})` : ""}
        </button>
      </div>

      {/* Draw pane — hidden, not unmounted, so the map survives tab switches */}
      <div style={{ flex: 1, display: activeTab === "draw" ? "flex" : "none", flexDirection: "column", minHeight: 0 }}>
        {/* Builder bar */}
        <div style={{ padding: "10px 14px", background: C.surface, borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={() => stepKm(-0.5)} className="chip tap" style={{ padding: "7px 12px" }} aria-label="Decrease distance">−</button>
            <input className="inp num" type="number" inputMode="decimal" step="0.5" min="0.5" max="42" value={targetKmInput}
              onChange={(e) => setTargetKmInput(e.target.value)} aria-label="Target distance in km"
              style={{ width: 64, padding: "7px 4px", fontSize: 14, textAlign: "center" }} />
            <button onClick={() => stepKm(0.5)} className="chip tap" style={{ padding: "7px 12px" }} aria-label="Increase distance">+</button>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.dim }}>km</span>
          </div>
          <button onClick={() => buildRoute("loop")} disabled={genBusy} className="chip cta tap disp" style={{ fontSize: 12.5, padding: "8px 14px", opacity: genBusy ? 0.6 : 1 }}>
            {genBusy ? "Building…" : "⟳ Loop"}
          </button>
          <button onClick={() => buildRoute("outback")} disabled={genBusy} className="chip tap disp" style={{ fontSize: 12.5, padding: "8px 14px", opacity: genBusy ? 0.6 : 1 }}>
            ⇄ Out & back
          </button>
          <button onClick={() => { setSnapOn((s) => !s); haptic(6); }} className="chip tap"
            style={{ fontSize: 11.5, marginLeft: "auto", background: snapOn ? `${C.accent}22` : C.bg, color: snapOn ? C.accent : C.dim, borderColor: snapOn ? C.accent : C.line }}>
            {snapOn ? "● " : "○ "}Snap to paths
          </button>
        </div>
        {note && (
          <div style={{ padding: "7px 14px", fontSize: 11.5, color: C.warn, background: C.surface, borderBottom: `1px solid ${C.line}` }}>{note}</div>
        )}

        {/* Map */}
        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
          <div ref={elRef} style={{ position: "absolute", inset: 0 }} aria-label="Route plotting map" />

          {/* Stats pill */}
          <div style={{ ...overlayPill, position: "absolute", top: 12, left: 12, zIndex: 500, padding: "8px 14px", display: "flex", gap: 14, alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, letterSpacing: 1 }}>DISTANCE</div>
              <div className="num" style={{ fontSize: 18, fontWeight: 700, color: C.accent }}>{totalKm.toFixed(2)} km</div>
            </div>
            <div style={{ borderLeft: `1px solid ${C.line}`, paddingLeft: 12 }}>
              <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, letterSpacing: 1 }}>EST. TIME</div>
              <div className="num" style={{ fontSize: 16, fontWeight: 700 }}>~{estMinutes} min</div>
            </div>
            <div style={{ borderLeft: `1px solid ${C.line}`, paddingLeft: 12 }}>
              <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, letterSpacing: 1 }}>POINTS</div>
              <div className="num" style={{ fontSize: 16, fontWeight: 700 }}>{wpts.length}</div>
            </div>
          </div>

          {/* First-use hint */}
          {wpts.length === 0 && !genBusy && (
            <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", zIndex: 500, pointerEvents: "none", textAlign: "center", maxWidth: 260 }}>
              <div style={{ ...overlayPill, padding: "12px 16px", fontSize: 12.5, color: C.dim, lineHeight: 1.5 }}>
                <b style={{ color: C.text }}>Tap the map</b> to drop points, or set a distance and hit <b style={{ color: C.accent }}>⟳ Loop</b>.<br />
                Drag a dot to move it · tap a dot to remove it.
              </div>
            </div>
          )}

          {/* Snapping indicator */}
          {(snapBusy || genBusy) && (
            <div style={{ ...overlayPill, position: "absolute", bottom: 14, left: "50%", transform: "translateX(-50%)", zIndex: 500, padding: "6px 14px", fontSize: 11.5, color: C.accent, fontWeight: 700 }}>
              {genBusy ? "Building your route…" : "Snapping to paths…"}
            </div>
          )}

          {/* Map action buttons */}
          <div style={{ position: "absolute", bottom: 12, right: 12, zIndex: 500, display: "flex", gap: 8 }}>
            <button onClick={locateMe} className="chip tap" aria-label="Centre on my location"
              style={{ ...overlayPill, color: C.text }}>⌖</button>
            <button onClick={handleUndo} disabled={!wpts.length} className="chip tap"
              style={{ ...overlayPill, color: wpts.length ? C.text : C.dim }}>↩ Undo</button>
            <button onClick={handleClear} disabled={!wpts.length} className="chip tap"
              style={{ ...overlayPill, color: wpts.length ? C.warn : C.dim }}>Clear</button>
          </div>
        </div>

        {/* Save bar */}
        <div style={{ padding: "12px 14px calc(12px + env(safe-area-inset-bottom))", background: C.surface, borderTop: `1px solid ${C.line}`, display: "flex", gap: 10, alignItems: "center" }}>
          <input className="inp" value={routeName} onChange={(e) => setRouteName(e.target.value)}
            placeholder="Route name (e.g. Park loop 5K)" disabled={path.length < 2} style={{ flex: 1 }} />
          <button onClick={handleSave} disabled={path.length < 2} className="tap cta disp"
            style={{ borderRadius: 12, padding: "11px 20px", fontSize: 14, fontWeight: 700, border: "none", opacity: path.length < 2 ? 0.5 : 1 }}>
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
              <div style={{ fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>Draw a route or auto-build a loop on the first tab, then save it here.</div>
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
                        {r.km} km · saved {new Date(r.createdAt).toLocaleDateString()}
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
