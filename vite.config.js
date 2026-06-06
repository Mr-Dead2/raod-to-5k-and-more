import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { cloudflare } from "@cloudflare/vite-plugin";

// Default to serving from the site root "/", which is what Cloudflare, Netlify,
// Vercel and local preview all use. GitHub Pages is the exception (it serves
// under /<repo-name>/), so its Actions workflow sets BASE_PATH explicitly.
const base = process.env.BASE_PATH || "/";

export default defineConfig({
  base,
  plugins: [react(), VitePWA({
    strategies: "injectManifest",
    srcDir: "src",
    filename: "sw.js",
    registerType: "autoUpdate",
    includeAssets: ["icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png"],
    manifest: {
      name: "Road to 5K",
      short_name: "Road5K",
      description: "4-week mission to run a continuous 5 km.",
      theme_color: "#0c0d10",
      background_color: "#0c0d10",
      display: "standalone",
      orientation: "portrait",
      start_url: ".",
      scope: ".",
      icons: [
        { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    devOptions: { enabled: true, type: "module" },
  }), cloudflare()],
});
