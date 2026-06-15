import React from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { applyAccent, applyPlan } from "./data.js";
import { loadSettings } from "./storage.js";

// Apply the saved accent theme + any custom (AI-extended) plan before the first
// render so there's no color flash and the plan is correct from the start.
const _s = loadSettings();
applyAccent(_s.accent);
applyPlan(_s.customPlan);

// Keep the installed app up to date without prompting.
registerSW({ immediate: true });

// Lock the page background so the area behind the safe-area insets matches the app.
document.documentElement.style.background = "#0c0d10";
document.body.style.margin = "0";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
