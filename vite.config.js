import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { cloudflare } from "@cloudflare/vite-plugin";
const base = process.env.BASE_PATH || "/";
export default defineConfig({
  base,
  // Stamped into the bundle so the app can show which build is actually
  // running — the first thing to check when a fix "did not work".
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  plugins: [react(), VitePWA({
    strategies:"injectManifest", srcDir:"src", filename:"sw.js", registerType:"autoUpdate",
    includeAssets:["icons/icon-192.png","icons/icon-512.png","icons/maskable-512.png"],
    manifest:{name:"Stride",short_name:"Stride",description:"A modern run tracker for building speed, distance and consistency.",theme_color:"#07080b",background_color:"#07080b",display:"standalone",orientation:"portrait",start_url:".",scope:".",icons:[{src:"icons/icon-192.png",sizes:"192x192",type:"image/png"},{src:"icons/icon-512.png",sizes:"512x512",type:"image/png"},{src:"icons/maskable-512.png",sizes:"512x512",type:"image/png",purpose:"maskable"}]},
    devOptions:{enabled:true,type:"module"}
  }), cloudflare()]
});
