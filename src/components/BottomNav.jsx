import React from "react";
import { C } from "../data.js";

// Simple inline SVG icons so we don't pull in an icon library.
const ICONS = {
  plan: (a) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  ),
  stats: (a) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" /><rect x="7" y="12" width="3" height="6" /><rect x="12" y="8" width="3" height="10" /><rect x="17" y="5" width="3" height="13" />
    </svg>
  ),
  history: (a) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-9 9" /><path d="M3 12H1m2 0a9 9 0 0 1 .5-3" /><path d="M12 7v5l3 2" />
    </svg>
  ),
};

export function BottomNav({ tab, onChange }) {
  const items = ["plan", "stats", "history"];
  return (
    <nav aria-label="Main" style={{
      position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 50,
      background: "rgba(18,20,25,0.85)", backdropFilter: "blur(14px)",
      WebkitBackdropFilter: "blur(14px)",
      borderTop: `1px solid ${C.line}`,
      paddingBottom: "env(safe-area-inset-bottom)",
    }}>
      <div style={{ maxWidth: 620, margin: "0 auto", display: "flex" }}>
        {items.map((t) => {
          const active = tab === t;
          const color = active ? C.accent : C.dim;
          return (
            <button key={t} onClick={() => onChange(t)} aria-current={active ? "page" : undefined}
              style={{
                flex: 1, background: "none", border: "none", cursor: "pointer",
                padding: "8px 0 7px", display: "flex", flexDirection: "column",
                alignItems: "center", gap: 3, color,
              }}>
              <span style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: "4px 16px", borderRadius: 999,
                background: active ? `${C.accent}1c` : "transparent",
                transform: active ? "translateY(-1px)" : "none",
                transition: "transform .2s, background .2s",
              }}>
                {ICONS[t](color)}
              </span>
              <span style={{ fontSize: 10, fontWeight: active ? 800 : 700, letterSpacing: 0.5, textTransform: "uppercase" }}>{t}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
