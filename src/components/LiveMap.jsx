// Real map for run routes: Leaflet over CARTO's dark OSM tiles (free with
// attribution, no API key). Used live in the tracker (follow mode keeps the
// runner centred) and as static thumbnails in History. Tiles need internet;
// offline the route still draws on the dark background, like the old SVG map.
import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { C } from "../data.js";

const TILES = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

// phase char stored in routes: 'r' = run, 'w' = walk
const phaseColor = (ph) => (ph === "walk" || ph === "w") ? C.easy : C.accent;

// Normalize a raw point (live {lat,lng,phase?} or stored [lat,lng,char?]) to {lat,lng,phase}
const norm = (p) => Array.isArray(p)
  ? { lat: p[0], lng: p[1], phase: p[2] === "r" ? "run" : p[2] === "w" ? "walk" : null }
  : { lat: p.lat, lng: p.lng, phase: p.phase || null };

// Split a normalised point array into consecutive same-phase segments.
// Each segment overlaps by 1 point with the next to avoid visual gaps.
function toSegments(pts) {
  if (!pts.length) return [];
  const segs = [];
  let cur = { phase: pts[0].phase, lls: [[pts[0].lat, pts[0].lng]] };
  for (let i = 1; i < pts.length; i++) {
    const { lat, lng, phase } = pts[i];
    if (phase === cur.phase) {
      cur.lls.push([lat, lng]);
    } else {
      cur.lls.push([lat, lng]); // bridge point to close gap
      segs.push(cur);
      cur = { phase, lls: [[lat, lng]] };
    }
  }
  segs.push(cur);
  return segs;
}

// `points` accepts [{lat,lng,phase?}] (live) or [[lat,lng,phase_char?]] (stored routes).
export function LiveMap({ points, height = 200, follow = false, interactive = true }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const segLinesRef = useRef([]);
  const startRef = useRef(null);
  const endRef = useRef(null);

  useEffect(() => {
    const map = L.map(elRef.current, {
      zoomControl: false,
      attributionControl: true,
      dragging: interactive,
      touchZoom: interactive,
      doubleClickZoom: interactive,
      scrollWheelZoom: false,
      boxZoom: false,
      keyboard: false,
    });
    L.tileLayer(TILES, { attribution: ATTR, maxZoom: 19, subdomains: "abcd" }).addTo(map);
    map.setView([0, 0], 2);
    mapRef.current = map;
    // container is sized by the parent after mount — recalc once laid out
    const t = setTimeout(() => map.invalidateSize(), 0);
    return () => { clearTimeout(t); map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pts = (points || []).map(norm);
    if (!pts.length) return;

    const segs = toSegments(pts);
    const ll_all = pts.map((p) => [p.lat, p.lng]);

    // Rebuild all segment polylines (clear previous, draw new)
    segLinesRef.current.forEach((line) => map.removeLayer(line));
    segLinesRef.current = segs.map((seg) =>
      L.polyline(seg.lls, {
        color: phaseColor(seg.phase),
        weight: 4,
        opacity: 0.9,
        lineJoin: "round",
        lineCap: "round",
      }).addTo(map)
    );

    if (!startRef.current) {
      startRef.current = L.circleMarker(ll_all[0], {
        radius: 6, color: C.accent, weight: 3, fillColor: C.bg, fillOpacity: 1,
      }).addTo(map);
      endRef.current = L.circleMarker(ll_all[ll_all.length - 1], {
        radius: 6, color: C.accent, weight: 1, fillColor: C.accent, fillOpacity: 1,
      }).addTo(map);
      if (follow) map.setView(ll_all[ll_all.length - 1], 16);
      else map.fitBounds(L.latLngBounds(ll_all), { padding: [26, 26], maxZoom: 17 });
    } else {
      startRef.current.setLatLng(ll_all[0]);
      endRef.current.setLatLng(ll_all[ll_all.length - 1]);
      // keep markers above the newly-added segment lines
      startRef.current.bringToFront();
      endRef.current.bringToFront();
      if (follow) map.panTo(ll_all[ll_all.length - 1]);
      else map.fitBounds(L.latLngBounds(ll_all), { padding: [26, 26], maxZoom: 17 });
    }
  }, [points, follow]);

  // Show legend only when there are phase-tagged points (interval mode was on)
  const hasPhases = (points || []).some((p) => Array.isArray(p) ? p[2] : p.phase);

  return (
    <div style={{ position: "relative", height, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.line}`, background: C.bg }}>
      <div ref={elRef} style={{ position: "absolute", inset: 0, zIndex: 0 }} aria-label="Run route map" />
      {(!points || points.length === 0) && (
        <div style={{ position: "absolute", inset: 0, zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: C.dim, pointerEvents: "none", textAlign: "center", padding: 12 }}>
          Waiting for GPS — your route will draw here.
        </div>
      )}
      {hasPhases && (
        <div style={{
          position: "absolute", top: 8, right: 8, zIndex: 500,
          background: "rgba(11,12,15,0.82)", borderRadius: 8, padding: "5px 9px",
          display: "flex", flexDirection: "column", gap: 4, pointerEvents: "none",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 18, height: 3, background: C.accent, borderRadius: 2, display: "inline-block" }} />
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: C.accent }}>RUN</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 18, height: 3, background: C.easy, borderRadius: 2, display: "inline-block" }} />
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: C.easy }}>WALK</span>
          </div>
        </div>
      )}
    </div>
  );
}
