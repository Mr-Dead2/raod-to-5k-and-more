// Custom service worker (injectManifest strategy).
import { precacheAndRoute } from "workbox-precaching";
import { idbGet, idbSet } from "./idb.js";
precacheAndRoute(self.__WB_MANIFEST || []);
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
const KEY="reminder";
async function maybeRemind(){const r=(await idbGet(KEY))||{};if(!r.enabled)return;const now=new Date(),today=now.toISOString().slice(0,10);if(r.lastFired===today)return;const [h,m]=String(r.time||"18:00").split(":").map(Number);if(now.getHours()>h||(now.getHours()===h&&now.getMinutes()>=m)){await self.registration.showNotification("Stride",{body:r.message||"Time to run — your next session is waiting.",icon:"icons/icon-192.png",badge:"icons/icon-192.png",tag:"stride-reminder",vibrate:[80,40,80],data:{url:"./"}});await idbSet(KEY,{...r,lastFired:today})}}
self.addEventListener("periodicsync",e=>{if(e.tag==="run5k-reminder")e.waitUntil(maybeRemind())});
self.addEventListener("notificationclick",e=>{e.notification.close();e.waitUntil((async()=>{const all=await self.clients.matchAll({type:"window",includeUncontrolled:true});for(const c of all){if("focus"in c)return c.focus()}if(self.clients.openWindow)return self.clients.openWindow(e.notification.data?.url||"./")})())});
