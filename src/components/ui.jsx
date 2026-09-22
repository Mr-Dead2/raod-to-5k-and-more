// ---------------------------------------------------------------------------
// Layout primitives and controls, in Apple's idiom.
//
// These MUST live at module scope (here, or next to App). Defined inside a
// component they are a new component type on every render, so React unmounts
// and remounts their whole subtree each time state changes — which destroys a
// focused input. That once made every text field accept exactly one character.
// ---------------------------------------------------------------------------
import React, { useEffect, useId, useRef, useState } from "react";
import { C, tint } from "../data.js";
import { haptic } from "../celebrate.js";
import { reducedMotion } from "../spring.js";
import { useSlidingPill } from "./useSlidingPill.js";

// SF Symbols–style glyphs on a 24-unit grid. Stroke follows currentColor, so
// an icon takes the colour of the text around it.
const ICON_PATHS = {
  play: <path d="M8 5.2v13.6a1.1 1.1 0 0 0 1.7.9l10.6-6.8a1.1 1.1 0 0 0 0-1.8L9.7 4.3A1.1 1.1 0 0 0 8 5.2Z" fill="currentColor" stroke="none" />,
  pause: <g fill="currentColor" stroke="none"><rect x="6" y="4.5" width="4.4" height="15" rx="1.4" /><rect x="13.6" y="4.5" width="4.4" height="15" rx="1.4" /></g>,
  stop: <rect x="5.5" y="5.5" width="13" height="13" rx="3" fill="currentColor" stroke="none" />,
  share: <><path d="M12 3.6v11" /><path d="m7.9 7.4 4.1-4 4.1 4" /><path d="M8.6 10.2H7.3a2.6 2.6 0 0 0-2.6 2.6v5.6A2.6 2.6 0 0 0 7.3 21h9.4a2.6 2.6 0 0 0 2.6-2.6v-5.6a2.6 2.6 0 0 0-2.6-2.6h-1.3" /></>,
  download: <><path d="M12 3.8v11" /><path d="m7.6 10.6 4.4 4.4 4.4-4.4" /><path d="M4.5 15v2.6A2.6 2.6 0 0 0 7.1 20.2h9.8a2.6 2.6 0 0 0 2.6-2.6V15" /></>,
  upload: <><path d="M12 15.2v-11" /><path d="m7.6 8.4 4.4-4.4 4.4 4.4" /><path d="M4.5 15v2.6A2.6 2.6 0 0 0 7.1 20.2h9.8a2.6 2.6 0 0 0 2.6-2.6V15" /></>,
  calendar: <><rect x="3.5" y="4.8" width="17" height="15.7" rx="3.4" /><path d="M3.5 9.6h17M8 2.9v3.6M16 2.9v3.6" /></>,
  target: <><circle cx="12" cy="12" r="8.6" /><circle cx="12" cy="12" r="4.6" /><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" /></>,
  map: <><path d="m3.6 6.6 5.2-2.4 6.4 2.6 5.2-2.4v13l-5.2 2.4-6.4-2.6-5.2 2.4Z" /><path d="M8.8 4.2v13M15.2 6.8v13" /></>,
  bell: <><path d="M17.6 9.2a5.6 5.6 0 1 0-11.2 0c0 5.6-2.4 7.6-2.4 7.6h16s-2.4-2-2.4-7.6" /><path d="M13.7 20.1a2 2 0 0 1-3.4 0" /></>,
  alarm: <><circle cx="12" cy="13" r="7.2" /><path d="M12 9.3V13l2.4 1.6" /><path d="M4.4 5.6 7 3.4M19.6 5.6 17 3.4" /></>,
  flag: <><path d="M5 21V4.2" /><path d="M5 4.4h11.6l-2.2 3.9 2.2 3.9H5" /></>,
  chevron: <path d="m9.2 5.4 6.4 6.6-6.4 6.6" />,
  chevronDown: <path d="m5.4 9.2 6.6 6.4 6.6-6.4" />,
  back: <path d="m14.8 5.4-6.4 6.6 6.4 6.6" />,
  check: <path d="m5 12.6 4.6 4.6L19.2 7.6" />,
  xmark: <path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  heart: <path d="M12 20.2s-7.6-4.5-7.6-10.3A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.6 2.7c0 5.8-7.6 10.3-7.6 10.3Z" fill="currentColor" stroke="none" />,
  flame: <path d="M12 21c-3.8 0-6.5-2.6-6.5-6.1 0-3.1 2.1-5 3.5-7.2.6 1.6 1.4 2.6 2.6 3.1.3-3.5 1.4-6.3 3.9-7.8-.4 2.9.9 5 2.2 6.7 1 1.3 1.8 2.8 1.8 5.2 0 3.6-3.5 6.1-7.5 6.1Z" fill="currentColor" stroke="none" />,
  bolt: <path d="M13.3 2.8 5.6 13.3h5.6l-1.3 7.9 7.7-10.5H12Z" fill="currentColor" stroke="none" />,
  clock: <><circle cx="12" cy="12" r="8.6" /><path d="M12 7.4V12l3.1 1.9" /></>,
  stopwatch: <><circle cx="12" cy="13.6" r="7.4" /><path d="M10 2.6h4M12 2.6v3.6M12 13.6V9.8M18.3 6.3l1.3-1.3" /></>,
  watch: <><rect x="6.8" y="6.6" width="10.4" height="10.8" rx="3" /><path d="m9 6.6.6-3.4h4.8l.6 3.4M9 17.4l.6 3.4h4.8l.6-3.4" /></>,
  palette: <><circle cx="12" cy="12" r="8.4" /><path d="M12 3.6a8.4 8.4 0 0 0 0 16.8Z" fill="currentColor" /></>,
  key: <><circle cx="8" cy="15.6" r="4" /><path d="m10.9 12.7 8.4-8.4M16.4 7.2l2.4 2.4M14 9.6l1.9 1.9" /></>,
  cpu: <><rect x="6.6" y="6.6" width="10.8" height="10.8" rx="2.6" /><rect x="9.8" y="9.8" width="4.4" height="4.4" rx="1" /><path d="M9.8 3.6v3M14.2 3.6v3M9.8 17.4v3M14.2 17.4v3M3.6 9.8h3M3.6 14.2h3M17.4 9.8h3M17.4 14.2h3" /></>,
  trash: <><path d="M4.6 6.6h14.8" /><path d="M9.4 6.6V4.9a1.4 1.4 0 0 1 1.4-1.4h2.4a1.4 1.4 0 0 1 1.4 1.4v1.7" /><path d="m6.6 6.6.8 12.1a2 2 0 0 0 2 1.8h5.2a2 2 0 0 0 2-1.8l.8-12.1" /></>,
  info: <><circle cx="12" cy="12" r="8.6" /><path d="M12 11v5.4" /><path d="M12 7.8h.01" strokeWidth="2.6" /></>,
  location: <path d="M20 4 4.2 10.6l6.8 2.5 2.5 6.8Z" fill="currentColor" stroke="none" />,
  copy: <><rect x="8.6" y="8.6" width="11.8" height="11.8" rx="2.6" /><path d="M15.4 8.6V6.2a2.6 2.6 0 0 0-2.6-2.6H6.2a2.6 2.6 0 0 0-2.6 2.6v6.6a2.6 2.6 0 0 0 2.6 2.6h2.4" /></>,
  text: <path d="M4.6 6.6h14.8M4.6 12h14.8M4.6 17.4h9" />,
  speaker: <><path d="M4 9.4v5.2h3.6l4.6 4V5.4L7.6 9.4Z" /><path d="M15.6 9a4.2 4.2 0 0 1 0 6M18.4 6.4a7.8 7.8 0 0 1 0 11.2" /></>,
  repeat: <><path d="M4.6 11.2a5.4 5.4 0 0 1 5.4-5.4h8.6" /><path d="m15.6 2.8 3 3-3 3" /><path d="M19.4 12.8a5.4 5.4 0 0 1-5.4 5.4H5.4" /><path d="m8.4 21.2-3-3 3-3" /></>,
  pauseCircle: <><circle cx="12" cy="12" r="8.6" /><path d="M10 9.2v5.6M14 9.2v5.6" /></>,
  weight: <path d="M6.4 8v8M17.6 8v8M3.8 10.2v3.6M20.2 10.2v3.6M6.4 12h11.2" />,
  mountain: <path d="M2.6 19.4 9 9.6l3.6 5 2.4-3.3 6.4 8.1Z" fill="currentColor" stroke="none" />,
  wave: <path d="M3 12h2.6l2-4.4 3 8.8 3-12.8 3 10.8 2-2.4H21" />,
  route: <><circle cx="6" cy="6" r="2.2" /><circle cx="18" cy="18" r="2.2" /><path d="M8.2 6H15a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h6.8" /></>,
  sparkles: <><path d="M10.8 3.6 12.4 8a2 2 0 0 0 1.2 1.2l4.4 1.6-4.4 1.6a2 2 0 0 0-1.2 1.2l-1.6 4.4-1.6-4.4A2 2 0 0 0 8 12.4L3.6 10.8 8 9.2a2 2 0 0 0 1.2-1.2Z" fill="currentColor" stroke="none" /><path d="m18.4 15.4.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7Z" fill="currentColor" stroke="none" /></>,
  chart: <><path d="M3.6 3.6v16.8h16.8" /><path d="m7.4 14.2 3.4-4 3.2 2.6 5-6" /></>,
  medal: <><circle cx="12" cy="15" r="5.4" /><path d="M8.6 10.6 5.6 3.6h4l2.4 5 2.4-5h4l-3 7" /></>,
  arrowUp: <><path d="M12 19.4V4.8" /><path d="m6 10.6 6-6 6 6" /></>,
  refresh: <><path d="M19.4 12a7.4 7.4 0 1 1-2.2-5.3" /><path d="M19.4 4v4.6h-4.6" /></>,
  doc: <><path d="M7 3.6h6.4L18 8.2V18a2.4 2.4 0 0 1-2.4 2.4H7A2.4 2.4 0 0 1 4.6 18V6A2.4 2.4 0 0 1 7 3.6Z" /><path d="M13.4 3.6v4.6H18" /></>,
  external: <><path d="M13.6 4.6h5.8v5.8" /><path d="m19.4 4.6-8.2 8.2" /><path d="M17.6 14v3.6a2.4 2.4 0 0 1-2.4 2.4H6.8a2.4 2.4 0 0 1-2.4-2.4V9.2a2.4 2.4 0 0 1 2.4-2.4h3.6" /></>,
  moon: <path d="M19.6 14.6A7.9 7.9 0 0 1 9.4 4.4a7.9 7.9 0 1 0 10.2 10.2Z" />,
  run: <><circle cx="15.2" cy="4.6" r="1.9" fill="currentColor" stroke="none" /><path d="m13.4 8.4-3.6 2.2-3.2.4M13.4 8.4l2.4 3.4 3 1M13.4 8.4l-1.2 5 3.2 3.2v3.8M12.2 13.4l-2.4 3.5-4 .9" /></>,
  gauge: <><path d="M4.4 16.6a7.6 7.6 0 1 1 15.2 0" /><path d="m12 16.6 3.6-4.6" /></>,
};

export const Icon = ({ name, size = 18, weight = 1.9, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={weight}
    strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, display: "block", ...style }} aria-hidden="true">
    {ICON_PATHS[name]}
  </svg>
);

// The coloured rounded square every iOS Settings row leads with.
export const IconBadge = ({ name, color = C.blue, size = 30, glyph = C.text }) => (
  <span className="badge" style={{ width: size, height: size, background: `linear-gradient(180deg, ${tint(color, 1)}, ${tint(color, 0.86)})`, color: glyph }}>
    <Icon name={name} size={Math.round(size * 0.6)} weight={2} />
  </span>
);

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export const Card = ({ children, style, className = "", innerRef }) => (
  <div ref={innerRef} className={`card ${className}`.trim()} style={{ padding: 18, ...style }}>{children}</div>
);

// A card's title: Headline weight, sentence case — how Fitness and Health
// title their cards. Tiny tracked-out capitals are kept for field labels.
export const Label = ({ children, right, style }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, minHeight: 22, ...style }}>
    <span className="t-headline" style={{ minWidth: 0 }}>{children}</span>
    {right != null && <span style={{ marginLeft: "auto", flexShrink: 0 }}>{right}</span>}
  </div>
);

export const Bar = ({ pct, color }) => (
  <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, pct))}%`, ...(color ? { background: color } : null) }} /></div>
);

// An inset grouped list: rows of cells on one rounded surface, with a header
// above and a footnote below, exactly where iOS Settings puts them.
export const Group = ({ header, footer, right, children, style, innerRef }) => (
  <section ref={innerRef} className="grp" style={style}>
    {(header || right) && (
      <div className="grp-head">
        <span>{header}</span>
        {right != null && <span style={{ marginLeft: "auto" }}>{right}</span>}
      </div>
    )}
    <div className="grp-body">{children}</div>
    {footer && <div className="grp-foot">{footer}</div>}
  </section>
);

// One row of a grouped list. A row with an onClick is a button and highlights
// on touch-down like a table cell, rather than shrinking like a button.
export const Cell = ({ icon, iconColor, title, sub, value, trailing, chevron, onClick, danger, accent, children, style, disabled, ariaLabel }) => {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className={`cell${onClick ? " tappable" : ""}`} onClick={onClick} disabled={disabled} aria-label={ariaLabel}
      style={{ "--inset": icon ? "60px" : "16px", ...style }}>
      {icon && <IconBadge name={icon} color={iconColor} />}
      <span className="cell-main">
        <span className="cell-title" style={danger ? { color: C.warn } : accent ? { color: C.accent } : undefined}>{title}</span>
        {sub && <span className="cell-sub">{sub}</span>}
        {children}
      </span>
      {value != null && <span className="cell-value">{value}</span>}
      {trailing}
      {chevron && <span className="cell-chev"><Icon name="chevron" size={15} weight={2.4} /></span>}
    </Tag>
  );
};

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

// Every tab opens with the same shape: today's date, a large title, a line of
// context — and on the right, the controls that belong to the whole app.
export const Screen = ({ eyebrow, title, sub, trailing }) => (
  <header className="screen-head">
    <div style={{ minWidth: 0, flex: 1 }}>
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <h1 className="t-large">{title}</h1>
      {sub && <div className="t-sub" style={{ color: C.dim, marginTop: 3 }}>{sub}</div>}
    </div>
    {trailing && <div className="screen-trail">{trailing}</div>}
  </header>
);

// The navigation bar: invisible at the top of a screen, a blurred glass strip
// with the title centred once the large title has scrolled beneath it. It is
// driven by the --nav-p custom property (see useNavCollapse), never by React
// state, so scrolling costs no re-renders.
export const NavBar = ({ title, trailing }) => (
  <div className="navbar" aria-hidden={false}>
    <div className="navbar-bg" aria-hidden="true" />
    <div className="navbar-row">
      <div className="navbar-title" aria-hidden="true">{title}</div>
      {trailing && <div className="navbar-trail">{trailing}</div>}
    </div>
  </div>
);

export function useNavCollapse() {
  useEffect(() => {
    const root = document.documentElement;
    let raf = 0, last = -1;
    const paint = () => {
      raf = 0;
      const p = Math.max(0, Math.min(1, (window.scrollY - 12) / 40));
      if (Math.abs(p - last) < 0.004) return;
      last = p;
      root.style.setProperty("--nav-p", p.toFixed(3));
      root.classList.toggle("nav-scrolled", p > 0.02);
      root.classList.toggle("nav-collapsed", p > 0.6);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(paint); };
    paint();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

// Segmented control. The thumb is one element on a spring: tapping moves it,
// and it can be grabbed and dragged across segments like the iOS control.
export function Segmented({ items, value, onChange, style }) {
  const i = Math.max(0, items.findIndex((x) => x.id === value));
  const pill = useSlidingPill({
    count: items.length,
    index: i,
    onSelect: (n) => { haptic(5); onChange(items[n].id); },
  });
  return (
    <div ref={pill.trackRef} className="seg" role="tablist" style={style} {...pill.trackProps}>
      <i ref={pill.pillRef} style={{ width: `calc((100% - 6px) / ${items.length})` }} />
      {items.map((x) => (
        <button key={x.id} role="tab" aria-selected={value === x.id} className={value === x.id ? "on" : ""}
          onClick={() => { if (value !== x.id) { haptic(5); onChange(x.id); } }}>{x.label}</button>
      ))}
    </div>
  );
}

// The iOS switch. `muted` is on-but-inert (e.g. notifications not permitted):
// an accent switch that cannot fire would be a lie.
export const Switch = ({ on, onClick, label, muted, disabled }) => (
  <button role="switch" aria-checked={!!on} aria-label={label} onClick={onClick} disabled={disabled}
    className={`sw${on ? " on" : ""}${muted ? " muted" : ""}`}>
    <b />
  </button>
);

// iOS stepper: one capsule, two halves.
export const Stepper = ({ onMinus, onPlus, label, minusDisabled }) => (
  <span className="stepper" role="group" aria-label={label}>
    <button onClick={onMinus} disabled={minusDisabled} aria-label={`Decrease ${label}`}><Icon name="minus" size={17} weight={2.2} /></button>
    <i aria-hidden="true" />
    <button onClick={onPlus} aria-label={`Increase ${label}`}><Icon name="plus" size={17} weight={2.2} /></button>
  </span>
);

// Circular glass button for bar items (share, close…).
export const GlassButton = ({ icon, label, onClick, size = 38, children, style }) => (
  <button onClick={onClick} aria-label={label} className="glass glass-btn" style={{ width: size, height: size, minHeight: size, ...style }}>
    {children || <Icon name={icon} size={Math.round(size * 0.47)} weight={2} />}
  </button>
);

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

// A compact figure tile, as Health draws them: the category in its colour
// with its glyph, then one big rounded number in white.
export const Tile = ({ label, value, unit, sub, hero, color, icon, delay = 0 }) => {
  const tone = hero ? C.accent : color || C.dim;
  return (
    <div className="card stagger" style={{ animationDelay: `${delay}s`, flex: 1, minWidth: 0, borderRadius: 20, padding: "13px 13px 14px", overflow: "hidden" }}>
      <div className="t-foot" style={{ display: "flex", alignItems: "center", gap: 5, color: tone, fontWeight: 600, whiteSpace: "nowrap" }}>
        {icon && <Icon name={icon} size={14} weight={2.2} />}{label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 2, marginTop: 8, whiteSpace: "nowrap" }}>
        <span className="num" style={{ fontSize: 26, fontWeight: 700, color: C.text, lineHeight: 1 }}>{value}</span>
        {unit && <span className="num" style={{ fontSize: 13, fontWeight: 700, color: C.dim, textTransform: "uppercase" }}>{unit}</span>}
      </div>
      {sub && <div className="t-cap" style={{ color: C.dim2, marginTop: 5 }}>{sub}</div>}
    </div>
  );
};

// Fitness-style metric: a plain label over a big rounded number in its colour.
export const Metric = ({ label, value, unit, color, size = 28, align = "left" }) => (
  <div style={{ minWidth: 0, textAlign: align }}>
    <div className="t-sub" style={{ color: C.text, opacity: 0.92, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
    <div className="num" style={{ fontSize: size, fontWeight: 600, color: color || C.text, lineHeight: 1.1, marginTop: 3, whiteSpace: "nowrap" }}>
      {value}
      {unit && <span style={{ fontSize: "0.52em", fontWeight: 700, marginLeft: 2, textTransform: "uppercase", letterSpacing: "0.02em" }}>{unit}</span>}
    </div>
  </div>
);

// Two columns of metrics with hairlines between the rows — the layout of a
// workout summary in Fitness.
export const MetricGrid = ({ items, size = 28, cols = 2 }) => (
  <div className="mgrid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
    {items.filter(Boolean).map((m, i) => (
      <div key={m.label} className="mcell" style={i < cols ? { borderTopWidth: 0 } : undefined}>
        <Metric {...m} size={m.size || size} />
      </div>
    ))}
  </div>
);

// Activity rings. Outermost first; each ring is { pct, color, color2? }. They
// wind up from empty when they first appear, as the Fitness rings do.
export function Rings({ rings, size = 132, stroke = 15, gap = 3, label }) {
  const uid = useId().replace(/:/g, "");
  const [drawn, setDrawn] = useState(() => reducedMotion());
  useEffect(() => {
    if (drawn) return;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setDrawn(true)); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const c = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} style={{ display: "block", flexShrink: 0 }}>
      <defs>
        {rings.map((r, i) => (
          <linearGradient key={i} id={`${uid}-g${i}`} x1="0" y1="0" x2="0" y2={size} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={r.color2 || r.color} />
            <stop offset="100%" stopColor={r.color} />
          </linearGradient>
        ))}
      </defs>
      {rings.map((r, i) => {
        const rad = c - stroke / 2 - i * (stroke + gap);
        if (rad <= stroke / 2) return null;
        const circ = 2 * Math.PI * rad;
        const p = Math.max(0, Math.min(1, (r.pct || 0) / 100));
        return (
          <g key={i} transform={`rotate(-90 ${c} ${c})`}>
            <circle cx={c} cy={c} r={rad} fill="none" stroke={tint(r.color, 0.2)} strokeWidth={stroke} />
            {p > 0 && (
              <circle cx={c} cy={c} r={rad} fill="none" stroke={`url(#${uid}-g${i})`} strokeWidth={stroke}
                strokeLinecap="round" strokeDasharray={circ}
                strokeDashoffset={drawn ? circ * (1 - p) : circ}
                style={{ transition: `stroke-dashoffset 1.2s cubic-bezier(.2,.75,.15,1) ${0.08 * i}s` }} />
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The Dynamic Island–style toast: a black capsule that grows out of the top of
// the screen, then shrinks back the way it came.
// ---------------------------------------------------------------------------
export function Island({ toast }) {
  const [shown, setShown] = useState(toast);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef(0);
  useEffect(() => {
    clearTimeout(timer.current);
    if (toast) { setShown(toast); setLeaving(false); return; }
    if (!shown) return;
    setLeaving(true);
    timer.current = setTimeout(() => { setShown(null); setLeaving(false); }, reducedMotion() ? 0 : 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!shown) return null;
  return (
    <div className={`island${leaving ? " out" : ""}`} role="status" aria-live="polite">
      <div key={`${shown.label || ""}${shown.title}`}>
        <span className="island-icon">{shown.icon}</span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span className="island-label">{shown.label ? shown.label.toLowerCase() : "achievement unlocked"}</span>
          <span className="island-title">{shown.title}</span>
        </span>
      </div>
    </div>
  );
}
