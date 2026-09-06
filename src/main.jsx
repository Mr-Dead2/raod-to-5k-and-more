import React from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";
import "./app.css";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { applyAccent, applyPlan } from "./data.js";
import { loadSettings } from "./storage.js";
import { isNative } from "./native.js";

const _s = loadSettings();
applyAccent(_s.accent);
applyPlan(_s.customPlan);

document.documentElement.style.background = "#07080b";
document.body.style.margin = "0";

// The service worker is a web-only concern, and actively harmful inside the
// Android WebView: Capacitor serves the app from a fixed origin, so a worker
// registered by one APK keeps serving its precached index.html and hashed
// bundles to the *next* APK you install. That is how a freshly built app ends
// up running last month's JavaScript — no new permission prompts, no fixes.
// Natively: never register, and tear down anything an earlier build left.
if (isNative()) {
  (async () => {
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
      await Promise.all(regs.map((r) => r.unregister()));
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch { /* nothing cached */ }
  })();
} else {
  registerSW({ immediate: true });
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </React.StrictMode>
);
