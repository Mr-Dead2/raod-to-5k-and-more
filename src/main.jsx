import React from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";
import "./app.css";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { applyAccent, applyPlan } from "./data.js";
import { loadSettings } from "./storage.js";

const _s = loadSettings();
applyAccent(_s.accent);
applyPlan(_s.customPlan);

document.documentElement.style.background = "#0a0b0d";
document.body.style.margin = "0";
document.documentElement.style.setProperty("--app-accent", "#c8f73c");
registerSW({ immediate: true });

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </React.StrictMode>
);
