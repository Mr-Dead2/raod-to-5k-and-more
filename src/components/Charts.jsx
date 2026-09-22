import React from "react";
import { C, typeColor, tint } from "../data.js";

// Hand-rolled SVG charts in the manner of Health: quiet dashed gridlines with
// their values on the right, rounded marks in the accent, the one figure that
// matters called out. Purely presentational — App computes the arrays.

const GRID = "rgba(84,84,88,.65)";

// N×7 calendar grid of the plan (one row per week). Each cell reflects a status.
export function StreakGrid({ cells }) {
  const rows = Array.from({ length: Math.ceil(cells.length / 7) }, (_, i) => i);
  return (
    <div style={{ display: "grid", gap: 7 }}>
      {rows.map((r) => (
        <div key={r} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="num" style={{ width: 24, fontSize: 12, fontWeight: 600, color: C.dim }}>W{r + 1}</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, flex: 1 }}>
            {cells.slice(r * 7, r * 7 + 7).map((c, i) => {
              // Done = filled in the session colour. Today = accent ring.
              // A missed past day is a quiet outlined well, not an alarm.
              const col = typeColor(c.type);
              let bg = "rgba(118,118,128,.18)", ring = "none";
              if (c.done) bg = col;
              else if (c.isToday) { bg = tint(C.accent, 0.14); ring = `inset 0 0 0 2px ${C.accent}`; }
              else if (c.isPast) { bg = "transparent"; ring = `inset 0 0 0 1.5px ${C.line2}`; }
              return (
                <div key={i} title={c.label}
                  style={{
                    aspectRatio: "1", borderRadius: "30%", background: bg, boxShadow: ring,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    animation: "cellIn .4s cubic-bezier(.2,.8,.2,1) both", animationDelay: `${(r * 7 + i) * 0.016}s`,
                  }}>
                  {c.done && (
                    <svg width="46%" height="46%" viewBox="0 0 24 24" fill="none" stroke={C.onAccent} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m5 12.6 4.6 4.6L19.2 7.6" />
                    </svg>
                  )}
                  {!c.done && c.isToday && <span style={{ width: 6, height: 6, borderRadius: 6, background: C.accent }} />}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// Every chart paints its marks with the same accent gradient, so the charts
// read as part of the app rather than as a separate widget. Each <svg> needs
// its own <defs>, hence the shared component.
function AccentDefs({ id }) {
  return (
    <defs>
      <linearGradient id={`${id}-stroke`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor={C.accent2} />
        <stop offset="100%" stopColor={C.accent} />
      </linearGradient>
      <linearGradient id={`${id}-bar`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={C.accent} />
        <stop offset="100%" stopColor={C.accent2} />
      </linearGradient>
      <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={C.accent} stopOpacity="0.32" />
        <stop offset="100%" stopColor={C.accent} stopOpacity="0" />
      </linearGradient>
    </defs>
  );
}

// Three dashed guides with their values on the right edge.
function Guides({ W, left, right, top, bottom, max, fmt }) {
  const rows = [0, 0.5, 1];
  return rows.map((f) => {
    const y = bottom - f * (bottom - top);
    return (
      <g key={f}>
        <line x1={left} x2={right} y1={y} y2={y} stroke={GRID} strokeWidth="1" strokeDasharray={f === 0 ? "none" : "2 4"} />
        <text x={W - 2} y={y + 3.5} textAnchor="end" fontSize="10" fill={C.dim} fontWeight="500">{fmt(max * f)}</text>
      </g>
    );
  });
}

// A rounded-top bar (flat on the baseline), as Health draws them.
const barPath = (x, y, w, h, r) => {
  const rr = Math.min(r, w / 2, h);
  if (h <= 0) return "";
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
};

// Weekly km bars: filled bar = logged, faint bar behind = plan target.
export function WeeklyBars({ data }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.target)));
  const nice = Math.ceil(max / 5) * 5;
  const W = 330, H = 150, left = 4, right = W - 30, top = 16, bottom = H - 22;
  const gap = Math.min(14, (right - left) / data.length * 0.3);
  const bw = Math.min(34, (right - left - gap * (data.length - 1)) / data.length);
  const span = bw * data.length + gap * (data.length - 1);
  const x0 = left + (right - left - span) / 2;
  const y = (v) => bottom - (v / nice) * (bottom - top);
  const best = Math.max(...data.map((d) => d.value));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Kilometres logged per week">
      <AccentDefs id="wb" />
      <Guides W={W} left={left} right={right} top={top} bottom={bottom} max={nice} fmt={(v) => `${Math.round(v)}`} />
      {data.map((d, i) => {
        const x = x0 + i * (bw + gap);
        const hT = bottom - y(d.target), hV = bottom - y(d.value);
        return (
          <g key={i}>
            <path d={barPath(x, y(d.target), bw, hT, 7)} fill="rgba(118,118,128,.2)" />
            {d.value > 0 && (
              <path d={barPath(x, y(d.value), bw, hV, 7)} fill="url(#wb-bar)" style={{ transformOrigin: `0 ${bottom}px`, animation: "barUp .7s cubic-bezier(.2,.8,.2,1) both", animationDelay: `${i * 0.05}s` }} />
            )}
            <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="11" fill={C.dim} fontWeight="600">W{d.label}</text>
            {d.value > 0 && d.value === best && (
              <text x={x + bw / 2} y={y(Math.max(d.value, d.target)) - 5} textAnchor="middle" fontSize="11" fill={C.accent} fontWeight="700">
                {d.value.toFixed(1)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// Pace per run over time. Lower pace = faster, so the Y axis is inverted
// (the line climbing means you're getting quicker).
export function PaceTrend({ points }) {
  const W = 330, H = 150, left = 8, right = W - 38, top = 16, bottom = H - 24;
  if (points.length < 2) {
    return (
      <div className="t-foot" style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: C.dim, textAlign: "center" }}>
        Log time and distance on two runs to see your pace trend.
      </div>
    );
  }
  const secs = points.map((p) => p.sec);
  const min = Math.min(...secs), max = Math.max(...secs);
  const span = Math.max(max - min, 30); // keep near-flat trends readable
  const x = (i) => left + (i / (points.length - 1)) * (right - left);
  const y = (v) => top + ((v - min) / span) * (bottom - top);
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.sec).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${bottom} L${x(0).toFixed(1)},${bottom} Z`;
  const bestI = secs.indexOf(min);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Pace per run over time">
      <AccentDefs id="pt" />
      {[0, 0.5, 1].map((f) => {
        const v = min + f * span;
        const yy = y(v);
        return (
          <g key={f}>
            <line x1={left} x2={right} y1={yy} y2={yy} stroke={GRID} strokeWidth="1" strokeDasharray="2 4" />
            <text x={W - 2} y={yy + 3.5} textAnchor="end" fontSize="10" fill={C.dim} fontWeight="500">{fmt(v)}</text>
          </g>
        );
      })}
      <path d={area} fill="url(#pt-fade)" />
      <path d={line} fill="none" stroke="url(#pt-stroke)" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.sec)} r={i === bestI ? 5 : 2.6} fill={i === bestI ? C.accent : C.surface} stroke={C.accent} strokeWidth={i === bestI ? 0 : 1.8} />
      ))}
      <circle cx={x(bestI)} cy={y(min)} r="10" fill={tint(C.accent, 0.18)} />
      <text x={left} y={H - 6} fontSize="11" fill={C.dim} fontWeight="600">{points.length} runs</text>
      <text x={right} y={H - 6} textAnchor="end" fontSize="11" fill={C.accent} fontWeight="700">
        Best {fmt(min)} /km
      </text>
    </svg>
  );
}

// Cumulative distance area chart over completed sessions (in order).
export function CumulativeArea({ points }) {
  const W = 330, H = 150, left = 8, right = W - 34, top = 16, bottom = H - 24;
  if (points.length < 2) {
    return (
      <div className="t-foot" style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: C.dim, textAlign: "center" }}>
        Log at least two sessions to see your distance curve.
      </div>
    );
  }
  const max = Math.max(...points.map((p) => p.total));
  const nice = Math.max(5, Math.ceil(max / 5) * 5);
  const x = (i) => left + (i / (points.length - 1)) * (right - left);
  const y = (v) => bottom - (v / nice) * (bottom - top);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${bottom} L${x(0).toFixed(1)},${bottom} Z`;
  const last = points.length - 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Cumulative distance">
      <AccentDefs id="ca" />
      <Guides W={W} left={left} right={right} top={top} bottom={bottom} max={nice} fmt={(v) => `${Math.round(v)}`} />
      <path d={area} fill="url(#ca-fade)" />
      <path d={line} fill="none" stroke="url(#ca-stroke)" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(points[last].total)} r="10" fill={tint(C.accent, 0.18)} />
      <circle cx={x(last)} cy={y(points[last].total)} r="4.5" fill={C.accent} />
      <text x={left} y={H - 6} fontSize="11" fill={C.dim} fontWeight="600">{points.length} sessions</text>
      <text x={right} y={H - 6} textAnchor="end" fontSize="11" fill={C.accent} fontWeight="700">
        {max.toFixed(0)} km total
      </text>
    </svg>
  );
}
