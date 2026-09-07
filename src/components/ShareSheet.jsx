import React, { useState, useEffect, useRef, useCallback } from "react";
import { C, tint } from "../data.js";
import { haptic } from "../celebrate.js";
import {
  FORMATS, STYLES, formatById, renderCard, canvasBlob, cardText,
  shareBlob, downloadBlob, copyBlob, copyText, cardFileName,
} from "../share.js";

// ---------------------------------------------------------------------------
// The share sheet: pick a size and a look, see the actual image, then send it.
//
// The preview is the real card — the same renderCard() output that gets shared
// — so what you approve is exactly what lands in the feed. Re-renders are
// generation-guarded: a fast tap through the format chips would otherwise let
// a slow earlier render overwrite a newer one.
// ---------------------------------------------------------------------------

const Ico = ({ d, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true">
    {d}
  </svg>
);
const IconShare = <><circle cx="6" cy="12" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><path d="m8.7 10.7 6.6-3.4M8.7 13.3l6.6 3.4" /></>;
const IconSave = <><path d="M12 3v12" /><path d="m6 11 6 6 6-6" /><path d="M4 21h16" /></>;
const IconCopy = <><rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>;
const IconText = <><path d="M4 6h16M4 12h16M4 18h10" /></>;

// Which styles make sense for each card kind.
const STYLE_FOR = {
  run: ["bold", "route", "minimal"],
  progress: ["bold"],
  achievement: ["bold"],
  goal: ["bold"],
};

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
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    if (res === "shared") { onToast?.({ icon: "📤", title: "Card shared", label: "SHARE" }); onClose(); }
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
  const previewMaxH = fmt.id === "story" ? 380 : fmt.id === "wide" ? 200 : 300;

  // Content toggles get an outlined on-state rather than the filled gradient
  // the format/style choices use — "which card" and "what's on it" are two
  // different questions and shouldn't look like the same control.
  const Toggle = ({ on, set, children }) => (
    <button onClick={() => { set(!on); haptic(5); }} className="chip tap"
      style={{
        fontSize: 11.5, padding: "7px 13px",
        display: "inline-flex", alignItems: "center", gap: 6,
        background: on ? tint(C.accent, .12) : C.bgSoft,
        color: on ? C.accent : C.dim2,
        borderColor: on ? tint(C.accent, .4) : C.line,
        fontWeight: on ? 800 : 600,
      }}>
      <span style={{
        width: 6, height: 6, borderRadius: 6, flexShrink: 0,
        background: on ? C.accent : C.line2,
      }} />
      {children}
    </button>
  );

  const Action = ({ icon, label: lbl, onClick, primary }) => (
    <button onClick={onClick} disabled={busy || !!err}
      className={primary ? "tap cta disp" : "card tap"}
      style={{
        flex: primary ? 1.6 : 1, display: "flex", flexDirection: primary ? "row" : "column",
        alignItems: "center", justifyContent: "center", gap: primary ? 9 : 5,
        borderRadius: 15, padding: primary ? "15px 0" : "12px 0",
        fontSize: primary ? 15.5 : 11, fontWeight: primary ? 800 : 700,
        color: primary ? undefined : C.text, cursor: "pointer",
        opacity: busy || err ? 0.5 : 1,
      }}>
      <Ico d={icon} size={primary ? 17 : 16} />{lbl}
    </button>
  );

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 400,
      background: "rgba(4,5,8,.72)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
      animation: "rise .22s ease both",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 560, maxHeight: "94vh", overflowY: "auto",
        background: `linear-gradient(178deg, ${tint(C.accent, .07)} 0%, ${C.surface} 18%, ${C.bg} 100%)`,
        border: `1px solid ${C.line}`, borderBottom: "none",
        borderRadius: "26px 26px 0 0",
        boxShadow: "0 -24px 60px -20px rgba(0,0,0,.9)",
        padding: `14px 16px calc(18px + env(safe-area-inset-bottom))`,
        animation: "slideUp .28s cubic-bezier(.2,.9,.3,1) both",
      }}>
        <div style={{ width: 40, height: 4, borderRadius: 4, background: C.line2, margin: "0 auto 14px" }} />

        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div className="disp" style={{ fontSize: 19, fontWeight: 700 }}>Share your card</div>
            <div style={{ fontSize: 11.5, color: C.dim, marginTop: 2 }}>{fmt.hint} · {fmt.w * 2}×{fmt.h * 2}</div>
          </div>
          <button onClick={onClose} className="chip tap" style={{ marginLeft: "auto", padding: "7px 13px" }}>Close</button>
        </div>

        {/* the actual image that will be shared */}
        <div style={{
          borderRadius: 20, padding: 14, marginBottom: 14,
          background: `radial-gradient(120% 90% at 50% 0%, ${tint(C.accent, .1)}, transparent 70%), ${C.bgSoft}`,
          border: `1px solid ${C.line}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          minHeight: previewMaxH * 0.6,
        }}>
          {err ? (
            <div style={{ fontSize: 12.5, color: C.warn, textAlign: "center", lineHeight: 1.6, padding: 20 }}>{err}</div>
          ) : url ? (
            <img src={url} alt="Share card preview"
              style={{
                maxHeight: previewMaxH, maxWidth: "100%", borderRadius: 14, display: "block",
                boxShadow: `0 22px 44px -22px rgba(0,0,0,.95), 0 0 0 1px ${C.line}`,
                opacity: busy ? 0.55 : 1, transition: "opacity .2s ease",
              }} />
          ) : (
            <div style={{ fontSize: 12, color: C.dim, padding: 30 }}>Drawing your card…</div>
          )}
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {FORMATS.map((f) => (
            <button key={f.id} onClick={() => { setFormat(f.id); haptic(5); }}
              className={`chip tap${format === f.id ? " on" : ""}`} style={{ flex: 1, textAlign: "center" }}>
              {f.name}
            </button>
          ))}
        </div>

        {styles.length > 1 && (
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {styles.map((s) => {
              const off = s.id === "route" && !canRoute;
              return (
                <button key={s.id} onClick={() => { if (!off) { setStyle(s.id); haptic(5); } }} disabled={off}
                  className={`chip tap${style === s.id && !off ? " on" : ""}`}
                  style={{ flex: 1, textAlign: "center", opacity: off ? 0.35 : 1 }}>
                  {s.name}
                </button>
              );
            })}
          </div>
        )}

        {kind === "run" && (hasRoute || hasSplits) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
            {hasRoute && <Toggle on={showRoute} set={setShowRoute}>Route</Toggle>}
            {hasSplits && <Toggle on={showSplits} set={setShowSplits}>Splits</Toggle>}
            <Toggle on={showExtras} set={setShowExtras}>Extras</Toggle>
            <Toggle on={showDate} set={setShowDate}>Date</Toggle>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <Action icon={IconShare} label="Share" onClick={doShare} primary />
          <Action icon={IconSave} label="Save" onClick={doSave} />
          <Action icon={IconCopy} label="Copy" onClick={doCopyImage} />
          <Action icon={IconText} label="Text" onClick={doCopyText} />
        </div>

        <div style={{ minHeight: 18, fontSize: 11.5, color: note ? C.accent : C.dim2, textAlign: "center", fontWeight: 600, lineHeight: 1.5 }}>
          {note || "Share opens your phone's share sheet — Instagram, WhatsApp, anywhere."}
        </div>
      </div>
    </div>
  );
}
