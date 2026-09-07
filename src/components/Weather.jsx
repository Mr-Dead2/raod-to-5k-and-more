import React, { useState, useEffect, useRef, useCallback } from "react";
import { C, tint } from "../data.js";
import { getWeather, runAdvice } from "../weather.js";

// ---------------------------------------------------------------------------
// The conditions strip.
//
// It answers the two questions a runner has before going out — what to wear,
// and whether to wait — and nothing else. When there is nothing worth saying
// it renders the reading alone rather than manufacturing advice.
//
// Weather is a nicety: no permission is requested for it, nothing blocks on
// it, and every failure is silent. If location or the network says no, the
// strip simply does not appear.
// ---------------------------------------------------------------------------

// A position, but only if the browser will give one up cheaply. Weather must
// never be the thing that raises a location prompt over someone's plan, so this
// asks only when permission has already been granted, and gives up quickly.
function quietPosition({ timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => done(null), timeoutMs);
    const go = () => navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(timer); done({ lat: p.coords.latitude, lon: p.coords.longitude }); },
      () => { clearTimeout(timer); done(null); },
      { enableHighAccuracy: false, maximumAge: 15 * 60000, timeout: timeoutMs },
    );
    // Where the Permissions API exists, only ask when the answer is already
    // yes. Everywhere else the tracker has usually asked already.
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: "geolocation" })
        .then((s) => (s.state === "granted" ? go() : done(null)))
        .catch(go);
    } else go();
  });
}

export function useWeather({ enabled = true } = {}) {
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(false);
  const asked = useRef(false);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const pos = await quietPosition();
      const w = await getWeather({ lat: pos?.lat, lon: pos?.lon, force });
      setWeather(w);
    } catch { /* weather never breaks a screen */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!enabled || asked.current) return;
    asked.current = true;
    load();
  }, [enabled, load]);

  return { weather, loading, refresh: () => load(true) };
}

const timeLabel = (t) =>
  new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export function WeatherStrip({ weather, compact = false, onRefresh }) {
  if (!weather) return null;
  const advice = runAdvice(weather);
  const warn = advice?.warning;

  return (
    <div className="card" style={{
      borderRadius: 18, padding: compact ? "11px 13px" : "13px 15px", marginBottom: compact ? 10 : 12,
      borderColor: warn ? tint(C.warn, .35) : C.line,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: compact ? 24 : 27, lineHeight: 1 }} aria-hidden="true">{weather.icon}</span>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
            <span className="num" style={{ fontSize: compact ? 19 : 22, fontWeight: 700, color: C.text, lineHeight: 1 }}>
              {weather.temp}{weather.tempUnit}
            </span>
            {weather.feels !== weather.temp && (
              <span style={{ fontSize: 11.5, color: C.dim, fontWeight: 600 }}>
                feels {weather.feels}{weather.tempUnit}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {weather.label} · {weather.wind} {weather.windUnit} wind
            {weather.humidity ? ` · ${weather.humidity}% humidity` : ""}
          </div>
        </div>

        {onRefresh && (
          <button onClick={onRefresh} className="chip tap" aria-label="Refresh the weather"
            style={{ padding: "6px 10px", fontSize: 11, flexShrink: 0 }}>↻</button>
        )}
      </div>

      {advice?.dress && (
        <div style={{ fontSize: 12, color: C.text, marginTop: 10, lineHeight: 1.5 }}>{advice.dress}</div>
      )}

      {warn && (
        <div style={{
          display: "flex", gap: 8, alignItems: "flex-start", marginTop: 9, padding: "8px 10px",
          borderRadius: 11, background: tint(C.warn, .1), border: `1px solid ${tint(C.warn, .32)}`,
        }}>
          <span style={{ fontSize: 12, flexShrink: 0 }} aria-hidden="true">⚠️</span>
          <span style={{ fontSize: 11.5, color: C.text, lineHeight: 1.5 }}>{warn}</span>
        </div>
      )}

      {advice?.window && (
        <div style={{ fontSize: 11.5, color: C.accent, marginTop: 8, fontWeight: 600 }}>
          Better around {timeLabel(advice.window.t)} — {advice.window.rainChance}% rain, {advice.window.wind} {weather.windUnit} wind.
        </div>
      )}
    </div>
  );
}
