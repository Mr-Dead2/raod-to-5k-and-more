// Route planner. Every route it produces is built on the real OpenStreetMap
// road/path network (see ../routing.js), so a generated loop or out-and-back
// follows streets, parks and footpaths you can actually run — not a circle or
// a straight line drawn over the map. Saved routes can be reused as a target
// when starting a GPS run.
import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { C, tint } from "../data.js";
import { haptic } from "../celebrate.js";
import { loadSettings, saveSettings } from "../storage.js";
import { LiveMap } from "./LiveMap.jsx";
import { Icon, Segmented, Switch, GlassButton, Metric } from "./ui.jsx";
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
  html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2.5px solid ${C.bg};box-shadow:0 0 0 ${ring ? 2.5 : 1.5}px ${color}, 0 1px 4px rgba(0,0,0,.6)"></div>`,
});

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
  const rootRef = useRef(null);
  const statsRef = useRef(null);
  const panelRef = useRef(null);
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

  // The map runs under floating glass: the stats card on top, the controls
  // panel below. Keep the route inside the clear window between them.
  const fitRoute = (points) => {
    const map = mapRef.current;
    if (!map || !points || points.length < 2) return;
    const top = statsRef.current ? statsRef.current.getBoundingClientRect().bottom + 18 : 40;
    const bottom = panelRef.current ? panelRef.current.getBoundingClientRect().height + 36 : 40;
    map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), {
      paddingTopLeft: [28, top], paddingBottomRight: [28, bottom], maxZoom: 16,
    });
  };

  // Leaflet's own controls (the attribution) must stay visible above the panel.
  useEffect(() => {
    const panel = panelRef.current, root = rootRef.current;
    if (!panel || !root || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => root.style.setProperty("--panel-h", `${panel.offsetHeight}px`));
    ro.observe(panel);
    return () => ro.disconnect();
  }, []);

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
        icon: dotIcon(isStart ? C.accent : isEnd ? C.warn : C.text, isStart || isEnd ? 16 : 12),
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

  const modeHint = useMemo(() => MODES.find((m) => m.id === mode).hint, [mode]);

  return (
    <div ref={rootRef} className="rm" role="dialog" aria-modal="true" aria-label="Route planner">
      {/* Build pane — hidden, not unmounted, so the map survives tab switches */}
      <div className="rm-build" style={{ display: activeTab === "build" ? "block" : "none" }}>
        <div ref={elRef} className="rm-map" aria-label="Route plotting map" />

        {/* Route stats, floating over the map */}
        <div ref={statsRef} className="glass rm-stats">
          <div style={{ display: "flex", gap: 20, alignItems: "flex-end" }}>
            <Metric label="Distance" value={totalKm.toFixed(2)} unit="km" color={C.accent} size={26} />
            <Metric label="Est. time" value={`~${estMinutes}`} unit="min" size={22} />
            {route && <Metric label="On paths" value={route.pathPct} unit="%" color={C.good} size={22} />}
          </div>
          {route && (
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              <Tag label={`${route.busyPct}% busy roads`} tone={route.busyPct > 25 ? C.warn : C.dim} />
              <Tag label={route.repeatPct > 3 ? `${route.repeatPct}% doubles back` : "No doubling back"} tone={C.dim} />
              <Tag label="Follows real roads" tone={C.accent} />
            </div>
          )}
        </div>

        {/* Controls, in a glass panel along the bottom — Maps' card */}
        <div ref={panelRef} className="glass rm-panel">
          <div className="rm-float">
            {!route && !busy && wpts.length === 0 && (
              <div className="glass t-foot" style={{ borderRadius: 999, padding: "8px 14px", color: C.text, pointerEvents: "none", maxWidth: "calc(100% - 70px)" }}>{modeHint}</div>
            )}
            {busy && (
              <div className="glass t-foot" style={{ borderRadius: 999, padding: "8px 14px", color: C.text, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                <span className="spin" style={{ width: 13, height: 13, borderRadius: "50%", border: `2px solid ${tint(C.accent, 0.25)}`, borderTopColor: C.accent, flexShrink: 0 }} />
                {busy === "network" ? "Reading the roads around you…" : "Finding the best route…"}
              </div>
            )}
            <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
              {route && <GlassButton icon="route" label="Fit route" size={46} onClick={() => { haptic(6); fitRoute(route.points); }} />}
              <GlassButton icon="location" label="Centre on my location" size={46} onClick={locateMe} style={{ color: C.blue }} />
            </div>
          </div>

          {err && <div className="t-foot" style={{ color: C.warn, fontWeight: 600, margin: "0 4px 10px" }}>{err}</div>}

          <Segmented items={MODES.map((m) => ({ id: m.id, label: m.label }))} value={mode} onChange={switchMode} style={{ marginBottom: 12 }} />

          {mode === "draw" ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <span className="t-foot" style={{ color: C.dim, flex: 1, paddingLeft: 4 }}>{modeHint}</span>
              <button onClick={() => { haptic(6); setWpts((p) => p.slice(0, -1)); }} disabled={!wpts.length} className="btn" style={{ padding: "9px 14px" }}>Undo</button>
              <button onClick={() => { haptic(8); setWpts([]); setRoute(null); setErr(""); }} disabled={!wpts.length} className="btn danger" style={{ padding: "9px 14px" }}>Clear</button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
              <div className="km-field">
                <button onClick={() => stepKm(-0.5)} aria-label="Decrease distance"><Icon name="minus" size={17} weight={2.2} /></button>
                <input className="num" type="number" inputMode="decimal" step="0.5" min="0.5" max="42" value={targetKmInput}
                  onChange={(e) => setTargetKmInput(e.target.value)} aria-label="Target distance in km" />
                <span>km</span>
                <button onClick={() => stepKm(0.5)} aria-label="Increase distance"><Icon name="plus" size={17} weight={2.2} /></button>
              </div>
              <button onClick={generate} disabled={!!busy} className="cta tap"
                style={{ flex: 1, minWidth: 0, borderRadius: 999, padding: "12px 10px", fontSize: 16, whiteSpace: "nowrap", opacity: busy ? 0.6 : 1 }}>
                {busy ? "Working…" : route ? "Try another" : `Build ${mode === "loop" ? "loop" : "out & back"}`}
              </button>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 4px 10px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="t-sub" style={{ fontWeight: 500 }}>Quiet roads &amp; paths</div>
              <div className="t-foot" style={{ color: C.dim }}>
                {mode === "draw" ? "Each leg is routed along real streets." : "Tap the map, or drag the pin, to move the start."}
              </div>
            </div>
            <Switch on={quiet} onClick={() => { setQuiet((q) => !q); haptic(6); setRoute(null); }} label="Quiet roads and paths" />
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input className="inp" value={routeName} onChange={(e) => setRouteName(e.target.value)}
              placeholder="Name this route" disabled={!canSave} style={{ flex: 1, borderRadius: 999, padding: "10px 16px" }} aria-label="Route name" />
            <button onClick={handleSave} disabled={!canSave} className="cta tap"
              style={{ borderRadius: 999, padding: "11px 20px", fontSize: 16, opacity: canSave ? 1 : 0.45 }}>
              Save
            </button>
          </div>
        </div>
      </div>

      {/* Saved routes pane */}
      {activeTab === "saved" && (
        <div className="rm-saved">
          {savedRoutes.length === 0 ? (
            <div style={{ textAlign: "center", padding: "56px 24px" }}>
              <span style={{ width: 64, height: 64, borderRadius: "50%", background: tint(C.blue, 0.16), color: C.blue, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name="map" size={30} />
              </span>
              <div className="t-title3" style={{ marginTop: 14 }}>No saved routes yet</div>
              <div className="t-sub" style={{ color: C.dim, marginTop: 6 }}>Build a loop or an out &amp; back, then save it here.</div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              {savedRoutes.map((r) => (
                <div key={r.id} className="card rise" style={{ padding: 0, overflow: "hidden" }}>
                  <LiveMap points={r.points} height={128} interactive={false} radius={0} />
                  <div style={{ padding: "12px 16px 16px" }}>
                    <div className="t-headline" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
                    <div className="t-foot" style={{ color: C.dim, marginTop: 2 }}>
                      {r.km} km{r.pathPct != null ? ` · ${r.pathPct}% on paths` : ""} · saved {new Date(r.createdAt).toLocaleDateString()}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                      {onSelectRoute && (
                        <button onClick={() => handleSelect(r)} className="cta tap" style={{ flex: 1, borderRadius: 999, padding: "10px 0", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                          <Icon name="play" size={14} /> Run it
                        </button>
                      )}
                      <button onClick={() => handleEdit(r)} className="btn" style={{ padding: "10px 18px" }}>Edit</button>
                      <button onClick={() => handleDelete(r.id)} className="btn danger" aria-label={deleteArm === r.id ? "Confirm delete" : `Delete ${r.name}`}
                        style={deleteArm === r.id ? { background: C.warn, color: C.onAccent, padding: "10px 16px" } : { padding: "10px 14px" }}>
                        {deleteArm === r.id ? "Delete?" : <Icon name="trash" size={18} />}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Header, over both panes */}
      <div className="rm-head">
        <GlassButton icon="xmark" label="Close route planner" size={44} onClick={() => { haptic(8); onClose(); }} />
        <div className="glass" style={{ borderRadius: 999, flex: 1, maxWidth: 280, padding: 0 }}>
          <Segmented items={[{ id: "build", label: "Build" }, { id: "saved", label: `Saved${savedRoutes.length ? ` · ${savedRoutes.length}` : ""}` }]}
            value={activeTab} onChange={setActiveTab} style={{ background: "transparent" }} />
        </div>
      </div>
    </div>
  );
}

function Tag({ label, tone }) {
  return (
    <span className="tag" style={{ color: tone, background: tint(tone, 0.16), fontSize: 12, fontWeight: 600, letterSpacing: 0, padding: "3px 9px", borderRadius: 999 }}>
      {label}
    </span>
  );
}
