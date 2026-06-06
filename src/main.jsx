import React from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";

// Keep the installed app up to date without prompting.
registerSW({ immediate: true });

// Lock the page background so the area behind the safe-area insets matches the app.
document.documentElement.style.background = "#0c0d10";
document.body.style.margin = "0";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
