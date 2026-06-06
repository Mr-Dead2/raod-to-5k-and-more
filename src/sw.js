// Custom service worker (injectManifest strategy).
import { precacheAndRoute } from "workbox-precaching";
import { idbGet, idbSet } from "./idb.js";

// Precache the built app shell so it works offline.
precacheAndRoute(self.__WB_MANIFEST || []);

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

const KEY = "reminder";

// Fire the reminder if it's enabled, due today, and not already fired today.
async function maybeRemind() {
  const r = (await idbGet(KEY)) || {};
  if (!r.enabled) return;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (r.lastFired === today) return;
  const [h, m] = String(r.time || "18:00").split(":").map(Number);
  const due = now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
  if (!due) return;
  await self.registration.showNotification("Road to 5K", {
    body: r.message || "Time to lace up — you've got a session today.",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: "run5k-reminder",
    vibrate: [80, 40, 80],
    data: { url: "./" },
  });
  await idbSet(KEY, { ...r, lastFired: today });
}

// Chrome wakes the SW roughly twice a day for installed PWAs.
self.addEventListener("periodicsync", (e) => {
  if (e.tag === "run5k-reminder") e.waitUntil(maybeRemind());
});

// Tapping a notification focuses an open tab or opens the app.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if ("focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(e.notification.data?.url || "./");
    })()
  );
});
