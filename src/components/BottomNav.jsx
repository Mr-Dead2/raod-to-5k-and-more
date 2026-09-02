import React from "react";
import { C, tint } from "../data.js";

// Inline SVG icons so we don't pull in an icon library.
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

const ITEMS = ["plan", "stats", "coach", "history"];

// A floating dock rather than a full-width bar: it reads as a control that
// sits above the page instead of a slab welded to the bottom of the screen.
// The accent pill slides between tabs, so the active state is a movement.
export function BottomNav({ tab, onChange }) {
  const index = Math.max(0, ITEMS.indexOf(tab));
  return (
    <nav style={{
      position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 50,
      padding: "0 14px calc(12px + env(safe-area-inset-bottom))",
      pointerEvents: "none",
    }}>
      <div style={{
        pointerEvents: "auto",
        maxWidth: 420, margin: "0 auto", position: "relative",
        display: "flex", padding: 6, borderRadius: 22,
        background: "rgba(13,15,19,.82)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        border: `1px solid ${C.line}`,
        boxShadow: `0 18px 40px -18px rgba(0,0,0,.95), inset 0 1px 0 ${tint(C.text, 0.05)}`,
      }}>
        {/* sliding highlight behind the active tab */}
        <span aria-hidden="true" style={{
          position: "absolute", top: 6, bottom: 6, left: 6,
          width: `calc((100% - 12px) / ${ITEMS.length})`,
          transform: `translateX(${index * 100}%)`,
          borderRadius: 17,
          background: `linear-gradient(150deg,${tint(C.accent, .2)},${tint(C.accent2, .1)})`,
          border: `1px solid ${tint(C.accent, .38)}`,
          transition: "transform .32s cubic-bezier(.3,1.3,.5,1)",
        }} />
        {ITEMS.map((t) => {
          const active = tab === t;
          const color = active ? C.accent : C.dim;
          return (
            <button key={t} onClick={() => onChange(t)}
              style={{
                position: "relative", zIndex: 1,
                flex: 1, background: "none", border: "none", cursor: "pointer",
                padding: "9px 0 8px", display: "flex", flexDirection: "column",
                alignItems: "center", gap: 4, color,
                transition: "color .2s ease",
              }}>
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={color}
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {ICONS[t]}
              </svg>
              <span style={{ fontSize: 10, fontWeight: active ? 800 : 600, textTransform: "capitalize", letterSpacing: 0.2 }}>{t}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
