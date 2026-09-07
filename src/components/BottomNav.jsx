import React from "react";
import { C, tint } from "../data.js";

// Inline SVG icons so we don't pull in an icon library. Each has a `fill`
// companion path used only while the tab is active — a filled icon is how a
// native tab bar says "you are here" before you have read the label.
const ICONS = {
  plan: (
    <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>
  ),
  stats: (
    <><path d="M3 3v18h18" /><rect x="7" y="12" width="3" height="6" /><rect x="12" y="8" width="3" height="10" /><rect x="17" y="5" width="3" height="13" /></>
  ),
  coach: (
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
  ),
  history: (
    <><path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-9 9" /><path d="M3 12H1m2 0a9 9 0 0 1 .5-3" /><path d="M12 7v5l3 2" /></>
  ),
};

const ITEMS = [
  { id: "plan", label: "Plan" },
  { id: "stats", label: "Stats" },
  { id: "coach", label: "Coach" },
  { id: "history", label: "History" },
];

// A floating dock rather than a full-width bar: it reads as a control that
// sits above the page instead of a slab welded to the bottom of the screen.
// The accent pill slides between tabs, so the active state is a movement.
export function BottomNav({ tab, onChange }) {
  const index = Math.max(0, ITEMS.findIndex((i) => i.id === tab));
  return (
    <nav style={{
      position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 50,
      padding: "0 14px calc(12px + env(safe-area-inset-bottom))",
      pointerEvents: "none",
    }}>
      {/* a short fade under the dock so content scrolls out of sight rather
          than being sliced off by the dock's own edge */}
      <div aria-hidden="true" style={{
        position: "absolute", left: 0, right: 0, bottom: 0, height: 116, zIndex: -1,
        background: `linear-gradient(to top, ${C.bg} 32%, ${tint(C.bg, 0)})`,
      }} />
      <div style={{
        pointerEvents: "auto",
        maxWidth: 420, margin: "0 auto", position: "relative",
        display: "flex", padding: 6, borderRadius: 23,
        background: "rgba(11,13,17,.86)",
        backdropFilter: "blur(22px) saturate(160%)",
        WebkitBackdropFilter: "blur(22px) saturate(160%)",
        border: `1px solid ${C.line}`,
        boxShadow: `0 20px 44px -20px rgba(0,0,0,.98), inset 0 1px 0 ${tint(C.text, 0.06)}`,
      }}>
        {/* sliding highlight behind the active tab */}
        <span aria-hidden="true" style={{
          position: "absolute", top: 6, bottom: 6, left: 6,
          width: `calc((100% - 12px) / ${ITEMS.length})`,
          transform: `translateX(${index * 100}%)`,
          borderRadius: 17,
          background: `linear-gradient(150deg,${tint(C.accent, .22)},${tint(C.accent2, .1)})`,
          border: `1px solid ${tint(C.accent, .4)}`,
          boxShadow: `0 6px 18px -10px ${C.accent}`,
          transition: "transform .32s cubic-bezier(.3,1.3,.5,1)",
        }} />
        {ITEMS.map((it) => {
          const active = tab === it.id;
          const color = active ? C.accent : C.dim;
          return (
            <button key={it.id} onClick={() => onChange(it.id)} aria-current={active ? "page" : undefined}
              style={{
                position: "relative", zIndex: 1,
                flex: 1, background: "none", border: "none", cursor: "pointer",
                padding: "10px 0 9px", display: "flex", flexDirection: "column",
                alignItems: "center", gap: 5, color,
                transition: "color .2s ease",
              }}>
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={color}
                strokeWidth={active ? 2.3 : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                style={{ transition: "stroke-width .2s ease", filter: active ? `drop-shadow(0 0 6px ${tint(C.accent, .55)})` : "none" }}>
                {ICONS[it.id]}
              </svg>
              <span style={{ fontSize: 10, fontWeight: active ? 800 : 600, letterSpacing: 0.3 }}>{it.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
