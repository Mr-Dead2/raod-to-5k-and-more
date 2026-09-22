import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { C, tint } from "../data.js";
import { haptic } from "../celebrate.js";
import { createSpring, project, rubberband, velocityTracker } from "../spring.js";
import { Icon, Segmented } from "./ui.jsx";
import {
  FORMATS, STYLES, formatById, renderCard, canvasBlob, cardText,
  shareBlob, downloadBlob, copyBlob, copyText, cardFileName,
} from "../share.js";

// ---------------------------------------------------------------------------
// The share sheet: pick a size and a look, see the actual image, then send it.
//
// The preview is the real card — the same renderCard() output that gets shared
// — so what you approve is exactly what lands in the feed. Re-renders are
// generation-guarded: a fast tap through the formats would otherwise let a
// slow earlier render overwrite a newer one.
//
// It is presented as an iOS sheet. It rises on a critically damped spring and
// leaves the way it came (down), whichever way it is dismissed. The grabber
// and header are a handle: the sheet tracks the finger 1:1, resists being
// pulled above its resting place, and on release the flick is projected
// forward — thrown far enough, it dismisses carrying the finger's speed;
// otherwise it springs home. Grab it again mid-flight and it simply follows.
// ---------------------------------------------------------------------------

// Which styles make sense for each card kind.
const STYLE_FOR = {
  run: ["bold", "route", "minimal"],
  progress: ["bold"],
  achievement: ["bold"],
  goal: ["bold"],
};

// Content toggles look like switches' little cousins — "what's on the card" is
// a different question from "which card", which the segmented controls ask.
const Toggle = ({ on, set, children }) => (
  <button onClick={() => { set(!on); haptic(5); }} aria-pressed={on} className="chip"
    style={{
      display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, padding: "7px 13px",
      background: on ? tint(C.accent, 0.16) : "var(--fill3)", color: on ? C.accent : C.dim,
    }}>
    <span style={{ display: "flex", width: 14, justifyContent: "center" }}>{on ? <Icon name="check" size={14} weight={2.8} /> : <Icon name="plus" size={13} weight={2.4} />}</span>
    {children}
  </button>
);

// The iOS share sheet's row of round actions.
const Action = ({ icon, label, onClick, disabled }) => (
  <button onClick={onClick} disabled={disabled} className="sheet-action">
    <span><Icon name={icon} size={22} weight={1.9} /></span>
    {label}
  </button>
);

export function ShareSheet({ spec, onClose, onToast }) {
  const kind = spec.kind || "run";
  const data = spec.data || {};
  const hasRoute = Array.isArray(data.route) && data.route.length > 1;
  const hasSplits = Array.isArray(data.splits) && data.splits.length > 1;

  const [format, setFormat] = useState(spec.format || "square");
  const [style, setStyle] = useState(hasRoute && kind === "run" ? "route" : "bold");
  const [showRoute, setShowRoute] = useState(true);
  const [showSplits, setShowSplits] = useState(true);
  const [showExtras, setShowExtras] = useState(true);
  const [showDate, setShowDate] = useState(true);

  const [url, setUrl] = useState(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");

  const blobRef = useRef(null);
  const urlRef = useRef(null);
  const genRef = useRef(0);
  const noteTimer = useRef(null);

  const styles = STYLES.filter((s) => (STYLE_FOR[kind] || ["bold"]).includes(s.id));
  const canRoute = kind === "run" && hasRoute;

  // --- presentation physics -------------------------------------------------
  const sheetRef = useRef(null);
  const scrimRef = useRef(null);
  const closing = useRef(false);
  const drag = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const height = () => sheetRef.current?.offsetHeight || window.innerHeight;

  const spring = useRef(null);
  if (!spring.current) {
    spring.current = createSpring({
      damping: 1, response: 0.42,
      onUpdate: (y) => {
        if (sheetRef.current) sheetRef.current.style.transform = `translate3d(0,${y}px,0)`;
        // The scrim dims in step with the sheet: continuous feedback, not a fade at the end.
        if (scrimRef.current) scrimRef.current.style.opacity = String(Math.max(0, Math.min(1, 1 - y / height())));
      },
      onRest: (y) => { if (closing.current && y > 0) onCloseRef.current(); },
    });
  }

  useLayoutEffect(() => {
    spring.current.set(height());
    spring.current.to(0);
    const s = spring.current;
    return () => s.stop();
  }, []);

  const dismiss = useCallback((velocity = 0) => {
    if (closing.current) return;
    closing.current = true;
    spring.current.to(height(), { velocity: Math.max(0, velocity), damping: 1, response: 0.34 });
  }, []);

  const onHandleDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest("button")) return;       // the close button is not a handle
    closing.current = false;                       // grabbing it mid-dismiss takes it back
    spring.current.stop();
    drag.current = { id: e.pointerId, y0: e.clientY, from: spring.current.value, vt: velocityTracker() };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onHandleMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    let y = d.from + (e.clientY - d.y0);
    if (y < 0) y = -rubberband(-y, height());       // it can't go higher than home
    d.vt.add(y);
    spring.current.set(y);
  };
  const onHandleUp = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const v = d.vt.velocity();
    const y = spring.current.value;
    // Decide from where the flick is going, not where the finger let go.
    if (y + project(v) > height() * 0.45) { haptic(6); dismiss(v); }
    else spring.current.to(0, { velocity: v, damping: Math.abs(v) > 300 ? 0.8 : 1, response: 0.36 });
  };

  // --- card rendering ---------------------------------------------------------
  const currentSpec = useCallback(() => ({
    kind,
    data,
    title: spec.title,
    format,
    style: canRoute || style !== "route" ? style : "bold",
    options: {
      route: showRoute,
      splits: showSplits,
      extras: showExtras,
      date: showDate,
      note: spec.footer,
    },
  }), [kind, data, spec.title, spec.footer, format, style, canRoute, showRoute, showSplits, showExtras, showDate]);

  // Re-render the preview whenever anything about the card changes.
  useEffect(() => {
    let alive = true;
    const gen = ++genRef.current;
    setBusy(true);
    setErr("");
    (async () => {
      try {
        const canvas = await renderCard(currentSpec());
        const blob = await canvasBlob(canvas);
        if (!alive || gen !== genRef.current) return;
        if (!blob) throw new Error("Could not draw the card");
        blobRef.current = blob;
        const next = URL.createObjectURL(blob);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = next;
        setUrl(next);
      } catch (e) {
        if (alive && gen === genRef.current) setErr(e?.message || "Could not draw the card");
      } finally {
        if (alive && gen === genRef.current) setBusy(false);
      }
    })();
    return () => { alive = false; };
  }, [currentSpec]);

  // Release the last preview URL when the sheet goes away.
  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    if (noteTimer.current) clearTimeout(noteTimer.current);
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  const flash = (msg) => {
    setNote(msg);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(""), 2600);
  };

  const withBlob = async (fn) => {
    if (!blobRef.current) return;
    haptic(10);
    return fn(blobRef.current);
  };

  const doShare = () => withBlob(async (blob) => {
    const res = await shareBlob(blob, cardFileName(currentSpec()), cardText(currentSpec()));
    if (res === "shared") { onToast?.({ icon: "📤", title: "Card shared", label: "SHARE" }); dismiss(); }
    else if (res === "saved") flash("No share sheet here — image saved instead");
    else if (res === "error") flash("Couldn't open the share sheet");
  });

  const doSave = () => withBlob((blob) => {
    const res = downloadBlob(blob, cardFileName(currentSpec()));
    flash(res === "saved" ? "Image saved to your downloads" : "Couldn't save the image");
  });

  const doCopyImage = () => withBlob(async (blob) => {
    const res = await copyBlob(blob);
    flash(res === "copied" ? "Image copied — paste it anywhere" : "This browser won't copy images; use Save");
  });

  const doCopyText = async () => {
    haptic(8);
    const res = await copyText(cardText(currentSpec()));
    flash(res === "copied" ? "Summary copied as text" : "Couldn't copy the text");
  };

  const fmt = formatById(format);
  const previewMaxH = fmt.id === "story" ? 380 : fmt.id === "wide" ? 196 : 300;
  const off = busy || !!err;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 400, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div ref={scrimRef} onClick={() => dismiss()} aria-hidden="true"
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.55)", opacity: 0, touchAction: "none" }} />

      <div ref={sheetRef} role="dialog" aria-modal="true" aria-label="Share card" className="sheet"
        style={{ transform: "translate3d(0,100%,0)" }}>
        {/* The handle: grabber and header. */}
        <div className="sheet-handle" onPointerDown={onHandleDown} onPointerMove={onHandleMove}
          onPointerUp={onHandleUp} onPointerCancel={onHandleUp}>
          <div className="grabber" aria-hidden="true" />
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0 14px" }}>
            <div style={{ minWidth: 0 }}>
              <div className="t-headline">Share card</div>
              <div className="t-foot" style={{ color: C.dim }}>{fmt.hint} · {fmt.w * 2}×{fmt.h * 2}</div>
            </div>
            <button onClick={() => dismiss()} aria-label="Close" className="close-btn" style={{ marginLeft: "auto" }}>
              <Icon name="xmark" size={15} weight={2.6} />
            </button>
          </div>
        </div>

        <div className="sheet-body">
          {/* the actual image that will be shared */}
          <div style={{
            borderRadius: 24, padding: 16, marginBottom: 16,
            background: `radial-gradient(120% 90% at 50% 0%, ${tint(C.accent, 0.1)}, transparent 70%), var(--fill4)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            minHeight: previewMaxH * 0.6,
          }}>
            {err ? (
              <div className="t-sub" style={{ color: C.warn, textAlign: "center", padding: 20 }}>{err}</div>
            ) : url ? (
              <img src={url} alt="Share card preview"
                style={{
                  maxHeight: previewMaxH, maxWidth: "100%", borderRadius: 14, display: "block",
                  boxShadow: "0 24px 48px -22px rgba(0,0,0,.95), 0 0 0 .5px rgba(255,255,255,.12)",
                  opacity: busy ? 0.55 : 1, transition: "opacity .2s ease",
                }} />
            ) : (
              <div className="t-sub" style={{ color: C.dim, padding: 30 }}>Drawing your card…</div>
            )}
          </div>

          <Segmented items={FORMATS.map((f) => ({ id: f.id, label: f.name }))} value={format} onChange={setFormat} style={{ marginBottom: 10 }} />

          {styles.length > 1 && (
            <Segmented items={styles.filter((s) => s.id !== "route" || canRoute).map((s) => ({ id: s.id, label: s.name }))}
              value={style} onChange={setStyle} style={{ marginBottom: 12 }} />
          )}

          {kind === "run" && (hasRoute || hasSplits) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
              {hasRoute && <Toggle on={showRoute} set={setShowRoute}>Route</Toggle>}
              {hasSplits && <Toggle on={showSplits} set={setShowSplits}>Splits</Toggle>}
              <Toggle on={showExtras} set={setShowExtras}>Extras</Toggle>
              <Toggle on={showDate} set={setShowDate}>Date</Toggle>
            </div>
          )}

          <button onClick={doShare} disabled={off} className="cta tap"
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 999, padding: "15px 0", fontSize: 17, opacity: off ? 0.5 : 1 }}>
            <Icon name="share" size={19} /> Share
          </button>

          <div style={{ display: "flex", justifyContent: "space-around", margin: "16px 0 6px" }}>
            <Action icon="download" label="Save" onClick={doSave} disabled={off} />
            <Action icon="copy" label="Copy image" onClick={doCopyImage} disabled={off} />
            <Action icon="text" label="Copy text" onClick={doCopyText} disabled={off} />
          </div>

          <div className="t-foot" style={{ minHeight: 18, color: note ? C.accent : C.dim, textAlign: "center", fontWeight: note ? 600 : 400 }}>
            {note || "Share opens your phone's share sheet — Instagram, WhatsApp, anywhere."}
          </div>
        </div>
      </div>
    </div>
  );
}
