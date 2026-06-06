import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Where the app is served from depends on the host:
//  - GitHub Pages serves it under /<repo-name>/.
//  - Netlify / Vercel / Cloudflare Pages serve it from the root "/".
// We auto-detect those hosts (they set these env vars during their build) so it
// "just works" on whichever you pick. Override manually with BASE_PATH if needed.
const onRootHost = process.env.NETLIFY || process.env.VERCEL || process.env.CF_PAGES;
const base = process.env.BASE_PATH || (onRootHost ? "/" : "/raod-to-5k-and-more/");

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
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
    }),
  ],
});
