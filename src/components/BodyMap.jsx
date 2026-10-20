import React from "react";
import { C, tint } from "../data.js";

// ---------------------------------------------------------------------------
// A muscle map: a stylised figure, front and back, with the muscles an
// exercise (or a whole workout) trains lit up — the main ones in the accent,
// the helpers in a softer wash of it. Someone who has never heard of a "lat"
// can still see that a pulldown works their back.
//
// Each figure is drawn on a 100 × 222 grid as its left half, then mirrored.
// Muscle ids match gym.js MUSCLES.
// ---------------------------------------------------------------------------

const SILHOUETTE = (
  <>
    <rect x="45" y="23" width="10" height="13" rx="3" />
    <path d="M29 35Q50 29.5 71 35L73.5 47Q71.5 74 66.5 98L68.5 115H31.5L33.5 98Q28.5 74 26.5 47Z" />
  </>
);
const LIMBS = (
  <>
    <rect x="18.5" y="36" width="10.4" height="43" rx="5.2" transform="rotate(6 23.7 36)" />
    <rect x="14.8" y="75.5" width="8.6" height="37" rx="4.3" transform="rotate(7 19.1 75.5)" />
    <ellipse cx="14.4" cy="116.5" rx="4" ry="5.6" />
    <path d="M32 110H50L48.4 161Q42.2 167 36 161Z" />
    <path d="M35.8 159H48L45.6 205H39.4Z" />
    <ellipse cx="42.2" cy="208.5" rx="6.4" ry="3.6" />
  </>
);

// Left-half muscle shapes, per view.
const FRONT = {
  shoulders: <ellipse cx="26.2" cy="42" rx="6.9" ry="7.7" />,
  chest: <path d="M49 38.5C42 37.5 34.5 39 32.5 44.5C31 50 33.5 56.5 40 58C44.5 59 49 57.5 49 55Z" />,
  biceps: <ellipse cx="22.6" cy="58.5" rx="4.4" ry="10.2" transform="rotate(6 22.6 58.5)" />,
  forearms: <ellipse cx="17.6" cy="91" rx="3.8" ry="12.4" transform="rotate(7 17.6 91)" />,
  abs: <><rect x="43.6" y="61.5" width="5.6" height="9.6" rx="2.4" /><rect x="43.6" y="73.2" width="5.6" height="9.6" rx="2.4" /><rect x="43.6" y="84.9" width="5.6" height="10.6" rx="2.4" /></>,
  obliques: <path d="M35.6 61C37.2 72 38.4 84 39.2 97L42.2 96V62Z" />,
  quads: <path d="M34 116C32.6 130 34 147 38.6 158.5H45.6C48.6 146 49.3 130 48.3 116Z" />,
  calves: <ellipse cx="39.8" cy="180" rx="4.1" ry="12.6" />,
};
const BACK = {
  upperBack: <path d="M50 25.5C46 31 40.5 35 35.6 38.6L42 52.5L50 63.5Z" />,
  shoulders: <ellipse cx="26.2" cy="42" rx="6.9" ry="7.7" />,
  lats: <path d="M34.8 45C33 56 34.8 72 42.6 87.5L49.2 88.5V66L41.4 54Z" />,
  triceps: <ellipse cx="22.6" cy="58.5" rx="4.4" ry="10.2" transform="rotate(6 22.6 58.5)" />,
  forearms: <ellipse cx="17.6" cy="91" rx="3.8" ry="12.4" transform="rotate(7 17.6 91)" />,
  lowerBack: <rect x="43.8" y="89" width="5.4" height="15.5" rx="2.5" />,
  glutes: <ellipse cx="41.4" cy="115.5" rx="8.6" ry="8.9" />,
  hamstrings: <path d="M34.2 127C33.6 139 35.6 150.5 39.2 159.5H45.6C48 150.5 48.6 139 48 127Z" />,
  calves: <ellipse cx="40.4" cy="178.5" rx="5.2" ry="12.2" />,
};

function Figure({ shapes, x, primary, secondary, label }) {
  const fill = (m) => (primary.has(m) ? C.accent : secondary.has(m) ? tint(C.accent, 0.42) : C.surface3);
  const half = (
    <>
      <g fill={C.surface2}>{LIMBS}</g>
      {Object.entries(shapes).map(([m, el]) => (
        <g key={m} fill={fill(m)} style={primary.has(m) ? { filter: `drop-shadow(0 0 3px ${tint(C.accent, 0.55)})` } : undefined}>{el}</g>
      ))}
    </>
  );
  return (
    <g transform={`translate(${x} 0)`}>
      <g fill={C.surface2}>
        <ellipse cx="50" cy="13.5" rx="9.6" ry="11.6" />
        {SILHOUETTE}
      </g>
      {half}
      <g transform="matrix(-1 0 0 1 100 0)">{half}</g>
      {label && <text x="50" y="222" textAnchor="middle" fontSize="10" fontWeight="600" fill={C.dim2}>{label}</text>}
    </g>
  );
}

export function BodyMap({ primary = [], secondary = [], height = 150, view = "both", labels = true, style }) {
  const p = new Set(primary), s = new Set(secondary.filter((m) => !p.has(m)));
  const both = view === "both";
  const w = both ? 212 : 100;
  const names = [...p].join(", ");
  return (
    <svg viewBox={`0 0 ${w} ${labels ? 226 : 214}`} height={height} style={{ display: "block", flexShrink: 0, overflow: "visible", ...style }}
      role="img" aria-label={names ? `Works: ${names}` : "Muscle map"}>
      {(both || view === "front") && <Figure shapes={FRONT} x={0} primary={p} secondary={s} label={labels && both ? "Front" : null} />}
      {(both || view === "back") && <Figure shapes={BACK} x={both ? 112 : 0} primary={p} secondary={s} label={labels && both ? "Back" : null} />}
    </svg>
  );
}
