import React from "react";
import { C, tint } from "../data.js";
import { SILHOUETTE, LIMBS, FRONT, BACK, FIGURE_W, FIGURE_H, FIGURE_GAP } from "../bodyShapes.js";

// ---------------------------------------------------------------------------
// A muscle map: a stylised figure, front and back, with the muscles an
// exercise (or a whole workout) trains lit up — the main ones in the accent,
// the helpers in a softer wash of it. Someone who has never heard of a "lat"
// can still see that a pulldown works their back.
//
// The shapes are plain data in bodyShapes.js, shared with the workout share
// card, which paints the same figure on a canvas.
// ---------------------------------------------------------------------------

const Shape = ({ s }) => {
  const transform = s.rot ? `rotate(${s.rot.join(" ")})` : undefined;
  if (s.t === "ellipse") return <ellipse cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} transform={transform} />;
  if (s.t === "rect") return <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r || 0} transform={transform} />;
  return <path d={s.d} />;
};
const shapes = (list) => list.map((s, i) => <Shape key={i} s={s} />);

function Figure({ view, x, primary, secondary, label }) {
  const fill = (m) => (primary.has(m) ? C.accent : secondary.has(m) ? tint(C.accent, 0.42) : C.surface3);
  const half = (
    <>
      <g fill={C.surface2}>{shapes(LIMBS)}</g>
      {Object.entries(view).map(([m, list]) => (
        <g key={m} fill={fill(m)} style={primary.has(m) ? { filter: `drop-shadow(0 0 3px ${tint(C.accent, 0.55)})` } : undefined}>{shapes(list)}</g>
      ))}
    </>
  );
  return (
    <g transform={`translate(${x} 0)`}>
      <g fill={C.surface2}>{shapes(SILHOUETTE)}</g>
      {half}
      <g transform={`matrix(-1 0 0 1 ${FIGURE_W} 0)`}>{half}</g>
      {label && <text x={FIGURE_W / 2} y={FIGURE_H + 8} textAnchor="middle" fontSize="10" fontWeight="600" fill={C.dim2}>{label}</text>}
    </g>
  );
}

export function BodyMap({ primary = [], secondary = [], height = 150, view = "both", labels = true, style }) {
  const p = new Set(primary), s = new Set(secondary.filter((m) => !p.has(m)));
  const both = view === "both";
  const w = both ? FIGURE_W * 2 + FIGURE_GAP : FIGURE_W;
  const names = [...p].join(", ");
  return (
    <svg viewBox={`0 0 ${w} ${labels ? FIGURE_H + 12 : FIGURE_H}`} height={height} style={{ display: "block", flexShrink: 0, overflow: "visible", ...style }}
      role="img" aria-label={names ? `Works: ${names}` : "Muscle map"}>
      {(both || view === "front") && <Figure view={FRONT} x={0} primary={p} secondary={s} label={labels && both ? "Front" : null} />}
      {(both || view === "back") && <Figure view={BACK} x={both ? FIGURE_W + FIGURE_GAP : 0} primary={p} secondary={s} label={labels && both ? "Back" : null} />}
    </svg>
  );
}
