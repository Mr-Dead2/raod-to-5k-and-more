// Custom service worker (injectManifest strategy).
// It owns the daily reminder while the app is closed: Chrome wakes it via
// Periodic Background Sync, it reads the reminder from IndexedDB (localStorage
// is not available here) and fires if today's nudge is still due.
import { precacheAndRoute } from "workbox-precaching";
import { idbGet, idbSet } from "./idb.js";

precacheAndRoute(self.__WB_MANIFEST || []);
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

const KEY = "reminder";
const NUDGES = [
  "Lace up — your session is waiting.",
  "Ten minutes in and you'll be glad you went.",
  "Consistency beats intensity. Go log today.",
  "Future you is already grateful. Head out.",
  "The first kilometre is the hardest. Start it.",
];

async function maybeRemind() {
  const r = (await idbGet(KEY)) || {};
  if (!r.enabled) return;
  if (r.skipRest && r.restToday) return;          // quiet on rest days
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (r.lastFired === today) return;
  const [h, m] = String(r.time || "18:00").split(":").map(Number);
  if (now.getHours() < h || (now.getHours() === h && now.getMinutes() < m)) return;
  const nudge = NUDGES[Math.floor(Math.random() * NUDGES.length)];
  await self.registration.showNotification("Stride · time to run", {
    body: `${r.message || "Your next session is waiting."}\n${nudge}`,
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: "stride-reminder",
    renotify: true,
    vibrate: [80, 40, 80],
    actions: [{ action: "open", title: "Open Stride" }],
    data: { url: "./" },
  });
  await idbSet(KEY, { ...r, lastFired: today });
}

self.addEventListener("periodicsync", (e) => {
  // "run5k-reminder" is the tag older installs registered — keep honouring it.
  if (e.tag === "stride-reminder" || e.tag === "run5k-reminder") e.waitUntil(maybeRemind());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) if ("focus" in c) return c.focus();
    if (self.clients.openWindow) return self.clients.openWindow(e.notification.data?.url || "./");
  })());
});
