import React from "react";
import { C } from "../data.js";

// Weekly km bars: filled bar = logged, faint bar behind = plan target.
export function WeeklyBars({ data }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.target)));
  const W = 320, H = 140, pad = 22, gap = 14;
  const bw = (W - pad * 2 - gap * (data.length - 1)) / data.length;
  const y = (v) => H - pad - (v / max) * (H - pad * 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Kilometres logged per week">
      {data.map((d, i) => {
        const x = pad + i * (bw + gap);
        return (
          <g key={i}>
            <rect x={x} y={y(d.target)} width={bw} height={H - pad - y(d.target)} rx="5" fill={C.surface2} />
            <rect x={x} y={y(d.value)} width={bw} height={H - pad - y(d.value)} rx="5" fill={C.accent}>
              <animate attributeName="height" from="0" to={H - pad - y(d.value)} dur="0.5s" fill="freeze" />
              <animate attributeName="y" from={H - pad} to={y(d.value)} dur="0.5s" fill="freeze" />
            </rect>
            <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill={C.dim} fontWeight="700">
              W{d.label}
            </text>
            <text x={x + bw / 2} y={y(Math.max(d.value, d.target)) - 5} textAnchor="middle" fontSize="9" fill={d.value ? C.accent : C.dim} fontWeight="700">
              {d.value ? d.value.toFixed(1) : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// Cumulative distance area chart over completed sessions (in order).
export function CumulativeArea({ points }) {
  const W = 320, H = 140, pad = 22;
  if (points.length < 2) {
    return (
      <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: C.dim }}>
        Log at least two sessions to see your distance curve.
      </div>
    );
  }
  const max = Math.max(...points.map((p) => p.total));
  const x = (i) => pad + (i / (points.length - 1)) * (W - pad * 2);
  const y = (v) => H - pad - (v / max) * (H - pad * 2);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Cumulative distance">
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={C.accent} stopOpacity="0.35" />
          <stop offset="100%" stopColor={C.accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#fade)" />
      <path d={line} fill="none" stroke={C.accent} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.total)} r="2.5" fill={C.bg} stroke={C.accent} strokeWidth="2" />
      ))}
      <text x={pad} y={H - 6} fontSize="10" fill={C.dim} fontWeight="700">0</text>
      <text x={W - pad} y={H - 6} textAnchor="end" fontSize="10" fill={C.accent} fontWeight="700">
        {max.toFixed(0)} km
      </text>
    </svg>
  );
}
