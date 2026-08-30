import { idbGet, idbSet } from "./idb.js";
const KEY="reminder";
const DEFAULT={enabled:false,time:"18:00",lastFired:"",message:"",runKm:true,runInterval:true,runFinish:true};
export async function loadReminder(){return {...DEFAULT,...((await idbGet(KEY))||{})};}
export async function saveReminder(patch){const cur=await loadReminder();const next={...cur,...patch};await idbSet(KEY,next);return next;}
export function notificationsSupported(){return typeof window!=="undefined"&&"Notification" in window&&"serviceWorker" in navigator;}
export function permission(){return notificationsSupported()?Notification.permission:"denied";}
export async function requestPermission(){if(!notificationsSupported())return"denied";try{return await Notification.requestPermission();}catch{return"denied";}}
async function registerPeriodicSync(){try{const reg=await navigator.serviceWorker.ready;if("periodicSync" in reg){const status=await navigator.permissions.query({name:"periodic-background-sync"});if(status.state==="granted")await reg.periodicSync.register("run5k-reminder",{minInterval:12*60*60*1000});}}catch{}}
export async function showReminderNow(body,title="Ready to run?",tag="stride-reminder"){if(permission()!=="granted")return false;const options={body,icon:"icons/icon-192.png",badge:"icons/icon-192.png",tag,vibrate:[80,40,80],renotify:true,data:{url:"./"}};try{const reg=await navigator.serviceWorker.ready;await reg.showNotification(title,options);return true;}catch{try{new Notification(title,options);return true;}catch{return false;}}}
export async function enableReminders(time,message){const perm=permission()==="granted"?"granted":await requestPermission();if(perm!=="granted")return false;await saveReminder({enabled:true,time,message});await registerPeriodicSync();return true;}
export async function disableReminders(){await saveReminder({enabled:false});}
export async function syncMessage(message){const r=await loadReminder();if(r.enabled&&r.message!==message)await saveReminder({message});}
export function startForegroundScheduler(getMessage){const tick=async()=>{const r=await loadReminder();if(!r.enabled||permission()!=="granted")return;const now=new Date();const today=now.toISOString().slice(0,10);if(r.lastFired===today)return;const [h,m]=(r.time||"18:00").split(":").map(Number);if(now.getHours()>h||(now.getHours()===h&&now.getMinutes()>=m)){const msg=getMessage();if(msg&&await showReminderNow(msg)){await saveReminder({lastFired:today});}}};tick();return setInterval(tick,60*1000);}
export async function notifyRunKm(km,pace){const r=await loadReminder();if(r.runKm===false)return false;return showReminderNow(`${km} km complete • ${pace||"Keep going"}`,"Stride • Distance",`stride-km-${km}`);}
export async function notifyRunInterval(label){const r=await loadReminder();if(r.runInterval===false)return false;return showReminderNow(label,"Stride • Training","stride-interval");}
export async function notifyRunFinish(distance,time,pace){const r=await loadReminder();if(r.runFinish===false)return false;return showReminderNow(`${distance} km • ${time} • ${pace||"Great run"}`,"Stride • Run complete","stride-finish");}
export function speak(text){try{if(typeof window!=="undefined"&&"speechSynthesis" in window){window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.rate=.95;u.volume=1;window.speechSynthesis.speak(u);return true;}}catch{}return false;}
