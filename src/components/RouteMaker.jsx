// Interactive Route Maker (Route Planner) component:
// Allows runners to tap/click on the map to plot a route, calculate distance,
// undo points, clear, and save/load custom routes.
import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { C } from "../data.js";
import { haptic } from "../celebrate.js";
import { loadSettings, saveSettings } from "../storage.js";

const TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Haversine formula to compute distance in km between two lat/lng points
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

export function RouteMaker({ onClose, onSelectRoute }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const polylineRef = useRef(null);
  const markersRef = useRef([]);

  const [points, setPoints] = useState([]); // [{lat, lng}]
  const [routeName, setRouteName] = useState("");
  const [savedRoutes, setSavedRoutes] = useState([]);
  const [activeTab, setActiveTab] = useState("draw"); // draw | saved
  const [userLoc, setUserLoc] = useState(null);

  useEffect(() => {
    setSavedRoutes(loadSavedRoutes());
  }, []);

  // Try to locate user for map center
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setUserLoc(coords);
          if (mapRef.current) {
            mapRef.current.setView([coords.lat, coords.lng], 15);
          }
        },
        () => {},
        { timeout: 5000 }
      );
    }
  }, []);

  useEffect(() => {
    let map;
    try {
      map = L.map(elRef.current, {
        zoomControl: false,
        attributionControl: true,
      });
      L.tileLayer(TILES, { attribution: ATTR, maxZoom: 19, subdomains: "abcd" }).addTo(map);

      const defaultCenter = userLoc ? [userLoc.lat, userLoc.lng] : [51.505, -0.09];
      map.setView(defaultCenter, userLoc ? 15 : 13);

      map.on("click", (e) => {
        haptic(5);
        setPoints((prev) => [...prev, { lat: e.latlng.lat, lng: e.latlng.lng }]);
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
  }, []);

  // Render polyline & markers whenever points change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((m) => map.removeLayer(m));
    markersRef.current = [];
    if (polylineRef.current) {
      map.removeLayer(polylineRef.current);
      polylineRef.current = null;
    }

    if (!points.length) return;

    const latLngs = points.map((p) => [p.lat, p.lng]);
    polylineRef.current = L.polyline(latLngs, {
      color: C.accent,
      weight: 4,
      opacity: 0.9,
      lineJoin: "round",
    }).addTo(map);

    points.forEach((p, idx) => {
      const isStart = idx === 0;
      const isEnd = idx === points.length - 1;
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: isStart || isEnd ? 7 : 4,
        color: isStart ? C.accent : isEnd ? C.warn : C.accent,
        fillColor: isStart ? C.accent : isEnd ? C.warn : C.bg,
        fillOpacity: 1,
        weight: 2,
      }).addTo(map);
      markersRef.current.push(marker);
    });
  }, [points]);

  const totalKm = calcRouteKm(points);
  const estMinutes = Math.round(totalKm * 6.5); // ~6:30/km pace estimate

  const handleUndo = () => {
    haptic(6);
    setPoints((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    haptic(8);
    setPoints([]);
  };

  const handleSave = () => {
    if (points.length < 2) return;
    haptic(10);
    const name = routeName.trim() || `Custom ${totalKm.toFixed(1)} km Route`;
    const newRoute = {
      id: "route_" + Date.now(),
      name,
      points: points.map((p) => [p.lat, p.lng]),
      km: Number(totalKm.toFixed(2)),
      createdAt: new Date().toISOString(),
    };
    const updated = saveCustomRoute(newRoute);
    setSavedRoutes(updated);
    setRouteName("");
    setActiveTab("saved");
  };

  const handleDelete = (id) => {
    haptic(8);
    const updated = deleteCustomRoute(id);
    setSavedRoutes(updated);
  };

  const handleSelect = (route) => {
    haptic(10);
    if (onSelectRoute) onSelectRoute(route);
    if (onClose) onClose();
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999, background: C.bg, color: C.text,
      display: "flex", flexDirection: "column",
      paddingTop: "max(12px, env(safe-area-inset-top))",
      paddingBottom: "max(12px, env(safe-area-inset-bottom))",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px", borderBottom: `1px solid ${C.line}` }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 2, color: C.accent, fontWeight: 800 }}>APP ROUTE MAKER</div>
          <h2 className="disp" style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Plan Custom Route</h2>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => { setActiveTab("draw"); haptic(5); }} className="chip"
            style={activeTab === "draw" ? { background: C.accent, color: C.bg, border: "none" } : {}}>
            Draw
          </button>
          <button onClick={() => { setActiveTab("saved"); haptic(5); }} className="chip"
            style={activeTab === "saved" ? { background: C.accent, color: C.bg, border: "none" } : {}}>
            Saved ({savedRoutes.length})
          </button>
          <button onClick={() => { haptic(8); onClose(); }} className="chip" style={{ padding: "6px 14px" }}>
            ✕
          </button>
        </div>
      </div>

      {activeTab === "draw" ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {/* Map canvas */}
          <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
            <div ref={elRef} style={{ position: "absolute", inset: 0 }} aria-label="Route plotting map" />
            <div style={{
              position: "absolute", top: 12, left: 12, zIndex: 500,
              background: "rgba(11,12,15,0.88)", border: `1px solid ${C.line}`, borderRadius: 12,
              padding: "8px 14px", display: "flex", gap: 14, alignItems: "center",
            }}>
              <div>
                <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, letterSpacing: 1 }}>DISTANCE</div>
                <div className="num" style={{ fontSize: 18, fontWeight: 700, color: C.accent }}>{totalKm.toFixed(2)} km</div>
              </div>
              <div style={{ borderLeft: `1px solid ${C.line}`, paddingLeft: 12 }}>
                <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, letterSpacing: 1 }}>EST. TIME</div>
                <div className="num" style={{ fontSize: 16, fontWeight: 700, color: C.text }}>~{estMinutes} min</div>
              </div>
              <div style={{ borderLeft: `1px solid ${C.line}`, paddingLeft: 12 }}>
                <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, letterSpacing: 1 }}>POINTS</div>
                <div className="num" style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{points.length}</div>
              </div>
            </div>

            <div style={{ position: "absolute", bottom: 12, right: 12, zIndex: 500, display: "flex", gap: 8 }}>
              <button onClick={handleUndo} disabled={!points.length} className="chip tap"
                style={{ background: "rgba(11,12,15,0.88)", color: points.length ? C.text : C.dim, border: `1px solid ${C.line}` }}>
                ↩ Undo
              </button>
              <button onClick={handleClear} disabled={!points.length} className="chip tap"
                style={{ background: "rgba(11,12,15,0.88)", color: points.length ? C.warn : C.dim, border: `1px solid ${C.line}` }}>
                Clear
              </button>
            </div>
          </div>

          {/* Bottom save bar */}
          <div style={{ padding: 14, background: C.surface, borderTop: `1px solid ${C.line}`, display: "flex", gap: 10, alignItems: "center" }}>
            <input className="inp" value={routeName} onChange={(e) => setRouteName(e.target.value)}
              placeholder="Route name (e.g. Park Loop 5K)" disabled={points.length < 2} style={{ flex: 1 }} />
            <button onClick={handleSave} disabled={points.length < 2} className="tap cta disp"
              style={{ borderRadius: 12, padding: "11px 20px", fontSize: 14, fontWeight: 700, opacity: points.length < 2 ? 0.5 : 1 }}>
              Save Route
            </button>
          </div>
        </div>
      ) : (
        /* Saved routes tab */
        <div style={{ flex: 1, padding: 16, overflowY: "auto" }}>
          {savedRoutes.length === 0 ? (
            <div style={{ textAlign: "center", padding: 36, color: C.dim }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🗺️</div>
              <div className="disp" style={{ fontSize: 18, fontWeight: 700, color: C.text }}>No saved routes yet</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>Tap "Draw" at the top to tap points on the map and save your runner route.</div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {savedRoutes.map((r) => (
                <div key={r.id} className="card" style={{ padding: 14, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div className="disp" style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{r.name}</div>
                    <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>
                      {r.km} km · {r.points.length} points · Created {new Date(r.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {onSelectRoute && (
                      <button onClick={() => handleSelect(r)} className="chip cta tap" style={{ fontSize: 12, padding: "6px 12px" }}>
                        Use Route
                      </button>
                    )}
                    <button onClick={() => handleDelete(r.id)} className="chip tap" style={{ fontSize: 12, color: C.warn, padding: "6px 12px" }}>
                      Delete
                    </button>
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
