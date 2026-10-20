import React, { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { C } from "../data.js";
import { haptic } from "../celebrate.js";
import { createSpring, project, rubberband, velocityTracker } from "../spring.js";
import { Icon } from "./ui.jsx";

// ---------------------------------------------------------------------------
// A presentation sheet, presented the way the share sheet is: it rises on a
// critically damped spring, its grabber and header are a handle that tracks
// the finger 1:1, and a flick is projected forward — thrown far enough it
// leaves at the finger's speed, otherwise it springs home. Whatever dismisses
// it (close, Escape, the scrim, an action), it leaves downward, the way it came.
//
// It renders through a portal: sheets open from inside .page (a stacking
// context) and from inside the workout player, and must sit above both. Sheets
// stack — the newest is on top and is the only one Escape closes.
//
// `children` and `footer` may be functions of { dismiss }, so an action can
// close the sheet with its exit animation instead of unmounting it mid-frame.
// ---------------------------------------------------------------------------

const open = [];

export function Sheet({ title, sub, label, onClose, children, footer, tall }) {
  const sheetRef = useRef(null);
  const scrimRef = useRef(null);
  const closing = useRef(false);
  const drag = useRef(null);
  const id = useRef(Symbol("sheet"));
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const height = () => sheetRef.current?.offsetHeight || window.innerHeight;

  const spring = useRef(null);
  if (!spring.current) {
    spring.current = createSpring({
      damping: 1, response: 0.42,
      onUpdate: (y) => {
        if (sheetRef.current) sheetRef.current.style.transform = `translate3d(0,${y}px,0)`;
        if (scrimRef.current) scrimRef.current.style.opacity = String(Math.max(0, Math.min(1, 1 - y / height())));
      },
      onRest: (y) => { if (closing.current && y > 0) onCloseRef.current?.(); },
    });
  }

  useLayoutEffect(() => {
    spring.current.set(height());
    spring.current.to(0);
    const s = spring.current, me = id.current;
    open.push(me);
    return () => {
      s.stop();
      const i = open.indexOf(me);
      if (i >= 0) open.splice(i, 1);
    };
  }, []);

  const dismiss = useCallback((velocity = 0) => {
    if (closing.current) return;
    closing.current = true;
    spring.current.to(height(), { velocity: Math.max(0, velocity), damping: 1, response: 0.34 });
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && open[open.length - 1] === id.current) dismiss(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  const onHandleDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest("button")) return;
    closing.current = false;
    spring.current.stop();
    drag.current = { id: e.pointerId, y0: e.clientY, from: spring.current.value, vt: velocityTracker() };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onHandleMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    let y = d.from + (e.clientY - d.y0);
    if (y < 0) y = -rubberband(-y, height());
    d.vt.add(y);
    spring.current.set(y);
  };
  const onHandleUp = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const v = d.vt.velocity();
    const y = spring.current.value;
    if (y + project(v) > height() * 0.45) { haptic(6); dismiss(v); }
    else spring.current.to(0, { velocity: v, damping: Math.abs(v) > 300 ? 0.8 : 1, response: 0.36 });
  };

  const body = typeof children === "function" ? children({ dismiss }) : children;
  const foot = typeof footer === "function" ? footer({ dismiss }) : footer;

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 400, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div ref={scrimRef} onClick={() => dismiss()} aria-hidden="true"
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.55)", opacity: 0, touchAction: "none" }} />
      <div ref={sheetRef} role="dialog" aria-modal="true" aria-label={label || title} className="sheet"
        style={{ transform: "translate3d(0,100%,0)", ...(tall ? { height: "94vh" } : null) }}>
        <div className="sheet-handle" onPointerDown={onHandleDown} onPointerMove={onHandleMove}
          onPointerUp={onHandleUp} onPointerCancel={onHandleUp}>
          <div className="grabber" aria-hidden="true" />
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0 12px" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="t-headline" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
              {sub && <div className="t-foot" style={{ color: C.dim }}>{sub}</div>}
            </div>
            <button onClick={() => dismiss()} aria-label="Close" className="close-btn">
              <Icon name="xmark" size={15} weight={2.6} />
            </button>
          </div>
        </div>
        <div className="sheet-body" style={foot ? { paddingBottom: 18, flex: 1 } : { flex: 1 }}>{body}</div>
        {foot && <div className="sheet-foot">{foot}</div>}
      </div>
    </div>,
    document.body,
  );
}
