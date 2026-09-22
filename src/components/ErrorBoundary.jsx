// Error boundary so a thrown render/effect error in any subtree (e.g. the GPS
// tracker or the Leaflet map) shows a readable, on-brand fallback and the actual
// error message — instead of React unmounting the whole tree to a black screen.
// Error boundaries must be class components; there is no hook equivalent.
import React from "react";
import { C, tint } from "../data.js";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    // surface the real cause in the console for diagnosis
    console.error("Caught by ErrorBoundary:", error, info?.componentStack);
  }
  reset = () => this.setState({ error: null });
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // let callers render a custom fallback (e.g. the tracker overlay)
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    const msg = error?.message || String(error);
    return (
      <div style={{
        position: "fixed", inset: 0, zIndex: 9999, background: C.bg, color: C.text,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 14, padding: 24, textAlign: "center", fontFamily: "var(--font)",
        paddingTop: "max(24px, env(safe-area-inset-top))",
      }}>
        <span style={{ width: 64, height: 64, borderRadius: "50%", background: tint(C.warn, 0.16), color: C.warn, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 30, fontWeight: 700 }}>!</span>
        <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.017em" }}>Something glitched</div>
        <div style={{ fontSize: 15, lineHeight: 1.4, color: C.dim, maxWidth: 340 }}>
          The app hit an unexpected error. Your runs are saved on this device — reloading is safe.
        </div>
        <pre style={{
          maxWidth: 360, width: "100%", overflow: "auto", textAlign: "left", fontSize: 12,
          background: C.surface, borderRadius: 14, padding: 12,
          color: C.warn, whiteSpace: "pre-wrap", margin: 0,
        }}>{msg}</pre>
        <button onClick={() => window.location.reload()}
          style={{ border: "none", background: C.accent, color: C.onAccent, borderRadius: 999, padding: "14px 30px", fontSize: 17, fontWeight: 600, cursor: "pointer" }}>
          Reload app
        </button>
      </div>
    );
  }
}
