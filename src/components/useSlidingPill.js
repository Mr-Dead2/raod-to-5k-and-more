import { useEffect, useLayoutEffect, useRef } from "react";
import { createSpring, project, rubberband, velocityTracker, reducedMotion } from "../spring.js";

// ---------------------------------------------------------------------------
// One pill that slides between equal slots — the tab bar's glass lens and the
// segmented control's thumb.
//
// Tapping a slot moves the pill there on a critically damped spring. The pill
// can also be *grabbed*: drag along the track and it stays under the finger
// (rubber-banding past either end), and letting go projects the flick forward
// and lands on the slot it was heading for, keeping the finger's velocity, with
// a little bounce because a throw preceded it. Grab it again mid-flight and it
// carries on from wherever it is on screen.
//
// The pill is driven straight through its style — no React state per frame.
// ---------------------------------------------------------------------------

const DRAG_SLOP = 8;          // px before a press becomes a drag
const TAP_SPRING = { damping: 1, response: 0.38 };
const THROW_SPRING = { damping: 0.8, response: 0.36 };

export function useSlidingPill({ count, index, onSelect }) {
  const trackRef = useRef(null);
  const pillRef = useRef(null);
  const geo = useRef({ slot: 0, max: 0 });
  const drag = useRef(null);
  const swallowClick = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const indexRef = useRef(index);
  indexRef.current = index;

  // Position and "grab" (the lens swelling under a finger) are two springs;
  // both write the same transform.
  const springs = useRef(null);
  if (!springs.current) {
    const paint = () => {
      const el = pillRef.current;
      if (!el || !springs.current) return;
      const { x, grab } = springs.current;
      // A little stretch along the direction of travel encodes speed.
      const s = reducedMotion() ? 0 : Math.min(0.14, Math.abs(x.velocity) / 4200);
      const g = grab.value;
      el.style.transform = `translate3d(${x.value}px,0,0) scale(${(1 + s) * g},${(1 - s * 0.45) * g})`;
    };
    springs.current = {
      x: createSpring({ onUpdate: paint }),
      grab: createSpring({ value: 1, damping: 1, response: 0.25, onUpdate: paint }),
    };
  }

  const measure = () => {
    const el = trackRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const slot = inner / Math.max(1, count);
    geo.current = { slot, max: slot * (count - 1) };
  };

  // First paint and every resize: put the pill in place without animating.
  useLayoutEffect(() => {
    const { x, grab } = springs.current;
    measure();
    x.set(geo.current.slot * indexRef.current);
    const el = trackRef.current;
    let ro;
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => { measure(); if (!drag.current) x.set(geo.current.slot * indexRef.current); });
      ro.observe(el);
    }
    return () => { ro?.disconnect(); x.stop(); grab.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  useEffect(() => {
    if (drag.current?.active) return;
    const { x } = springs.current;
    const to = geo.current.slot * index;
    // Already heading there (a throw just landed on it): leave its bounce alone.
    if (Math.abs(x.target - to) > 0.5) x.to(to, TAP_SPRING);
  }, [index]);

  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    measure();
    drag.current = { id: e.pointerId, x0: e.clientX, from: 0, active: false, vt: velocityTracker() };
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const { x, grab } = springs.current;
    const dx = e.clientX - d.x0;
    if (!d.active) {
      if (Math.abs(dx) < DRAG_SLOP) return;
      d.active = true;
      x.stop();
      d.from = x.value - dx;               // grab it from where it is right now
      grab.to(1.06);
      try { trackRef.current.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    const { max, slot } = geo.current;
    let pos = d.from + dx;
    if (pos < 0) pos = -rubberband(-pos, slot);
    else if (pos > max) pos = max + rubberband(pos - max, slot);
    d.vt.add(pos);
    x.set(pos);
  };

  const end = (e, cancelled) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.active) return;               // a tap: the button's own click handles it
    const { x, grab } = springs.current;
    swallowClick.current = true;         // …but the click that follows a drag must not
    setTimeout(() => { swallowClick.current = false; }, 0);
    grab.to(1);
    const { slot } = geo.current;
    const v = d.vt.velocity();
    let i = cancelled ? indexRef.current : Math.round((x.value + project(v, 0.99)) / Math.max(1, slot));
    i = Math.max(0, Math.min(count - 1, i));
    x.to(slot * i, { velocity: v, ...THROW_SPRING });
    if (!cancelled && i !== indexRef.current) onSelectRef.current?.(i);
  };

  const onClickCapture = (e) => {
    if (swallowClick.current) { e.preventDefault(); e.stopPropagation(); swallowClick.current = false; }
  };

  return {
    trackRef,
    pillRef,
    trackProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e) => end(e, false),
      onPointerCancel: (e) => end(e, true),
      onClickCapture,
    },
  };
}
