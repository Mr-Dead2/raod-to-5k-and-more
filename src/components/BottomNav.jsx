import React from "react";
import { C } from "../data.js";
import { useSlidingPill } from "./useSlidingPill.js";

// SF Symbols–style glyphs, drawn on a 24-unit grid. Each tab has an outline
// form and a filled form: a native tab bar says "you are here" with the fill
// before you have read a word.
const ICONS = {
  plan: {
    line: (
      <><rect x="3.5" y="4.5" width="17" height="16" rx="3.6" /><path d="M3.5 9.4h17M8 2.8v3.4M16 2.8v3.4" /><path d="m9.2 14.6 2 2 3.8-3.9" /></>
    ),
    fill: (
      <><path d="M7.1 4.5h9.8a3.6 3.6 0 0 1 3.6 3.6v1.3h-17V8.1a3.6 3.6 0 0 1 3.6-3.6Z" fill="currentColor" /><path d="M3.5 10.4h17v6.5a3.6 3.6 0 0 1-3.6 3.6H7.1a3.6 3.6 0 0 1-3.6-3.6Z" fill="currentColor" /><path d="M8 2.8v3.4M16 2.8v3.4" /><path d="m9.2 14.9 2 2 3.8-3.9" stroke={C.onAccent} /></>
    ),
  },
  stats: {
    line: (
      <><rect x="3.6" y="12.2" width="4.4" height="8.3" rx="1.5" /><rect x="9.8" y="7.4" width="4.4" height="13.1" rx="1.5" /><rect x="16" y="3.5" width="4.4" height="17" rx="1.5" /></>
    ),
    fill: (
      <g fill="currentColor"><rect x="3.6" y="12.2" width="4.4" height="8.3" rx="1.5" /><rect x="9.8" y="7.4" width="4.4" height="13.1" rx="1.5" /><rect x="16" y="3.5" width="4.4" height="17" rx="1.5" /></g>
    ),
  },
  coach: {
    line: (
      <><path d="M12 3.6c4.9 0 8.6 3.2 8.6 7.4s-3.7 7.4-8.6 7.4c-.9 0-1.8-.1-2.6-.3L5.3 20.3l.9-3.6C4.4 15.3 3.4 13.3 3.4 11 3.4 6.8 7.1 3.6 12 3.6Z" /><path d="M8.4 11h.01M12 11h.01M15.6 11h.01" strokeWidth="2.6" /></>
    ),
    fill: (
      <><path d="M12 3.6c4.9 0 8.6 3.2 8.6 7.4s-3.7 7.4-8.6 7.4c-.9 0-1.8-.1-2.6-.3L5.3 20.3l.9-3.6C4.4 15.3 3.4 13.3 3.4 11 3.4 6.8 7.1 3.6 12 3.6Z" fill="currentColor" /><path d="M8.4 11h.01M12 11h.01M15.6 11h.01" stroke={C.onAccent} strokeWidth="2.6" /></>
    ),
  },
  history: {
    line: (
      <><path d="M4.2 12.8A8 8 0 1 0 6.4 6.2" /><path d="M3.6 4.4v3.7h3.7" /><path d="M12 8v4.4l2.9 1.8" /></>
    ),
    fill: (
      <><circle cx="12.3" cy="12.2" r="8.1" fill="currentColor" stroke="none" /><path d="M3.4 9.6 3.6 4.4" /><path d="M12.3 7.9v4.5l2.9 1.8" stroke={C.onAccent} /></>
    ),
  },
};

const ITEMS = [
  { id: "plan", label: "Plan" },
  { id: "stats", label: "Stats" },
  { id: "coach", label: "Coach" },
  { id: "history", label: "History" },
];

// A floating Liquid Glass tab bar: a capsule of blurred, saturated glass with
// a bright rim, riding above the page. The selected tab sits in a lens of
// lighter glass that slides between tabs on a spring — and can be dragged
// along the bar, the way the iOS tab bar can.
export function BottomNav({ tab, onChange }) {
  const index = Math.max(0, ITEMS.findIndex((i) => i.id === tab));
  const pill = useSlidingPill({
    count: ITEMS.length,
    index,
    onSelect: (i) => onChange(ITEMS[i].id),
  });

  return (
    <nav className="tabbar" aria-label="Sections">
      <div className="tabbar-edge" aria-hidden="true" />
      <div ref={pill.trackRef} className="glass tabbar-track" {...pill.trackProps}>
        <span ref={pill.pillRef} className="tabbar-lens" aria-hidden="true"
          style={{ width: `calc((100% - 8px) / ${ITEMS.length})` }} />
        {ITEMS.map((it) => {
          const active = tab === it.id;
          return (
            <button key={it.id} onClick={() => { if (!active) onChange(it.id); }}
              aria-current={active ? "page" : undefined} className="tabbar-item"
              style={{ color: active ? C.accent : "rgba(235,235,245,.78)" }}>
              <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {active ? ICONS[it.id].fill : ICONS[it.id].line}
              </svg>
              <span>{it.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
