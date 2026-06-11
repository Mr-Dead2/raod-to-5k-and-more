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

// `points` accepts [{lat,lng}] (live) or [[lat,lng]] (stored routes).
export function LiveMap({ points, height = 200, follow = false, interactive = true }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const lineRef = useRef(null);
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
    const ll = (points || []).map((p) => (Array.isArray(p) ? p : [p.lat, p.lng]));
    if (!ll.length) return;
    if (!lineRef.current) {
      lineRef.current = L.polyline(ll, { color: C.accent, weight: 4, opacity: 0.9, lineJoin: "round", lineCap: "round" }).addTo(map);
      startRef.current = L.circleMarker(ll[0], { radius: 6, color: C.accent, weight: 3, fillColor: C.bg, fillOpacity: 1 }).addTo(map);
      endRef.current = L.circleMarker(ll[ll.length - 1], { radius: 6, color: C.accent, weight: 1, fillColor: C.accent, fillOpacity: 1 }).addTo(map);
      if (follow) map.setView(ll[ll.length - 1], 16);
      else map.fitBounds(lineRef.current.getBounds(), { padding: [26, 26], maxZoom: 17 });
    } else {
      lineRef.current.setLatLngs(ll);
      startRef.current.setLatLng(ll[0]);
      endRef.current.setLatLng(ll[ll.length - 1]);
      if (follow) map.panTo(ll[ll.length - 1]);
      else map.fitBounds(lineRef.current.getBounds(), { padding: [26, 26], maxZoom: 17 });
    }
  }, [points, follow]);

  return (
    <div style={{ position: "relative", height, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.line}`, background: C.bg }}>
      <div ref={elRef} style={{ position: "absolute", inset: 0, zIndex: 0 }} aria-label="Run route map" />
      {(!points || points.length === 0) && (
        <div style={{ position: "absolute", inset: 0, zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: C.dim, pointerEvents: "none", textAlign: "center", padding: 12 }}>
          Waiting for GPS — your route will draw here.
        </div>
      )}
    </div>
  );
}
