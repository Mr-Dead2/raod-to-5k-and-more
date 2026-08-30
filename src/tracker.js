// Live GPS run tracking, dependency-free. Wraps a location watch (src/geo.js:
// web Geolocation API, or a native background watcher in the Android app) in a
// small state machine and exposes elapsed time, distance, pace, route points
// and per-km splits. No map library, no backend.
import { useState, useRef, useCallback, useEffect } from "react";
import { startLocationWatch } from "./geo.js";
import { notifyRunKm, notifyRunFinish } from "./notifications.js";

export function haversine(a, b) {
  const R = 6371000, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const STOP_MS = 7000, MAX_ACCURACY_M = 35, MAX_SPEED_MS = 11, MIN_STEP_M = 2, PROCESS_NOISE = 3, CLIMB_HYST_M = 2;
export function useRunTracker(opts = {}) {
  const optsRef = useRef(opts); optsRef.current = opts;
  const [status,setStatus]=useState("idle"),[autoPaused,setAutoPaused]=useState(false),[elapsedMs,setElapsedMs]=useState(0),[distanceM,setDistanceM]=useState(0),[points,setPoints]=useState([]),[splits,setSplits]=useState([]),[accuracy,setAccuracy]=useState(null),[error,setError]=useState(null),[elevGainM,setElevGainM]=useState(0),[maxSpeedMs,setMaxSpeedMs]=useState(0),[phaseDist,setPhaseDist]=useState({run:0,walk:0});
  const statusRef=useRef(status); statusRef.current=status; const autoPausedRef=useRef(false),watch=useRef(null),ticker=useRef(null),startedAt=useRef(0),baseMs=useRef(0),last=useRef(null),lastMoveAt=useRef(0),distRef=useRef(0),nextKm=useRef(1),splitBase=useRef(0),kalman=useRef(null),alt=useRef(null),elevRef=useRef(0),maxSpeedRef=useRef(0),phaseDistRef=useRef({run:0,walk:0}),lastPhaseRef=useRef(null),wakeLock=useRef(null);
  const liveElapsed=()=>autoPausedRef.current?baseMs.current:baseMs.current+(Date.now()-startedAt.current);
  const acquireWake=useCallback(async()=>{try{if("wakeLock"in navigator)wakeLock.current=await navigator.wakeLock.request("screen")}catch{}},[]);
  const releaseWake=useCallback(()=>{try{wakeLock.current?.release()}catch{}wakeLock.current=null},[]);
  useEffect(()=>{const onVis=()=>{if(document.visibilityState==="visible"&&statusRef.current==="tracking")acquireWake()};document.addEventListener("visibilitychange",onVis);return()=>document.removeEventListener("visibilitychange",onVis)},[acquireWake]);
  const setAuto=v=>{autoPausedRef.current=v;setAutoPaused(v)};
  const smooth=f=>{const acc=Math.max(f.accuracy||10,3),k=kalman.current;if(!k)kalman.current={lat:f.lat,lng:f.lng,variance:acc*acc,t:f.t};else{const dt=Math.max((f.t-k.t)/1000,0);k.variance+=dt*PROCESS_NOISE*PROCESS_NOISE;const gain=k.variance/(k.variance+acc*acc);k.lat+=gain*(f.lat-k.lat);k.lng+=gain*(f.lng-k.lng);k.variance*=1-gain;k.t=f.t}return{lat:kalman.current.lat,lng:kalman.current.lng,t:f.t}};
  const onFix=useCallback(f=>{setAccuracy(f.accuracy);if(statusRef.current!=="tracking")return;if(f.accuracy!=null&&f.accuracy>MAX_ACCURACY_M)return;const p=smooth(f);if(!last.current){const iv0=optsRef.current.interval,ph0=iv0&&iv0.runSec>0&&iv0.walkSec>0?((liveElapsed()/1000)%(iv0.runSec+iv0.walkSec)<iv0.runSec?"run":"walk"):null;last.current=p;lastMoveAt.current=p.t;setPoints(pts=>[...pts,ph0?{...p,phase:ph0}:p]);return}const d=haversine(last.current,p),dt=Math.max((p.t-last.current.t)/1000,.001);if(d<MIN_STEP_M||d/dt>MAX_SPEED_MS)return;if(autoPausedRef.current){startedAt.current=Date.now();setAuto(false)}lastMoveAt.current=p.t;distRef.current+=d;setDistanceM(distRef.current);const segSpeed=d/dt;if(segSpeed>maxSpeedRef.current){maxSpeedRef.current=segSpeed;setMaxSpeedMs(segSpeed)}if(f.alt!=null&&isFinite(f.alt)){if(!alt.current)alt.current={smooth:f.alt,ref:f.alt};else{const a=alt.current;a.smooth+=.3*(f.alt-a.smooth);if(a.smooth-a.ref>=CLIMB_HYST_M){elevRef.current+=a.smooth-a.ref;a.ref=a.smooth;setElevGainM(elevRef.current)}else if(a.smooth<a.ref)a.ref=a.smooth}}
    const iv=optsRef.current.interval;let pointPhase=null;if(iv&&iv.runSec>0&&iv.walkSec>0){const pos=(liveElapsed()/1000)%(iv.runSec+iv.walkSec);pointPhase=pos<iv.runSec?"run":"walk";phaseDistRef.current={...phaseDistRef.current,[pointPhase]:phaseDistRef.current[pointPhase]+d};setPhaseDist(phaseDistRef.current);if(lastPhaseRef.current!==null&&pointPhase!==lastPhaseRef.current)optsRef.current.onPhaseChange?.(pointPhase);lastPhaseRef.current=pointPhase}last.current=p;setPoints(pts=>[...pts,pointPhase?{...p,phase:pointPhase}:p]);while(distRef.current/1000>=nextKm.current){const sec=liveElapsed()/1000,split=sec-splitBase.current,k=nextKm.current;splitBase.current=sec;nextKm.current+=1;setSplits(s=>[...s,split]);notifyRunKm(k,split).catch?.(()=>{})}setElapsedMs(liveElapsed())
  },[]);
  const startWatch=useCallback(()=>{watch.current=startLocationWatch(onFix,setError);return watch.current!=null},[onFix]); const stopWatch=()=>{watch.current?.stop();watch.current=null};
  const startTicker=useCallback(()=>{clearInterval(ticker.current);ticker.current=setInterval(()=>{if(optsRef.current.autoPause&&statusRef.current==="tracking"&&!autoPausedRef.current&&last.current&&Date.now()-lastMoveAt.current>STOP_MS){baseMs.current=liveElapsed();setAuto(true)}setElapsedMs(liveElapsed())},250)},[]);
  const start=useCallback(()=>{setError(null);if(!startWatch())return;distRef.current=0;nextKm.current=1;splitBase.current=0;last.current=null;baseMs.current=0;kalman.current=null;alt.current=null;elevRef.current=0;maxSpeedRef.current=0;phaseDistRef.current={run:0,walk:0};lastPhaseRef.current=null;lastMoveAt.current=Date.now();setAuto(false);setDistanceM(0);setSplits([]);setPoints([]);setElapsedMs(0);setElevGainM(0);setMaxSpeedMs(0);setPhaseDist({run:0,walk:0});startedAt.current=Date.now();setStatus("tracking");acquireWake();startTicker()},[startWatch,acquireWake,startTicker]);
  const pause=useCallback(()=>{baseMs.current=liveElapsed();setAuto(false);clearInterval(ticker.current);setStatus("paused");releaseWake()},[releaseWake]);
  const resume=useCallback(()=>{startedAt.current=Date.now();lastMoveAt.current=Date.now();last.current=null;kalman.current=null;alt.current=null;setAuto(false);setStatus("tracking");acquireWake();startTicker()},[acquireWake,startTicker]);
  const finish=useCallback(()=>{if(statusRef.current==="tracking")baseMs.current=liveElapsed();setElapsedMs(baseMs.current);setAuto(false);clearInterval(ticker.current);stopWatch();releaseWake();setStatus("finished");const km=distRef.current/1000,sec=baseMs.current/1000;const pace=km>0?sec/km:0;notifyRunFinish(km.toFixed(2),`${Math.floor(sec/60)}:${String(Math.floor(sec%60)).padStart(2,"0")}`,pace?`${Math.floor(pace/60)}:${String(Math.round(pace%60)).padStart(2,"0")}/km`:"").catch?.(()=>{})},[releaseWake]);
  const reset=useCallback(()=>{clearInterval(ticker.current);stopWatch();releaseWake();setAuto(false);kalman.current=null;alt.current=null;elevRef.current=0;maxSpeedRef.current=0;phaseDistRef.current={run:0,walk:0};setStatus("idle");setElapsedMs(0);setDistanceM(0);setPoints([]);setSplits([]);setError(null);setAccuracy(null);setElevGainM(0);setMaxSpeedMs(0);setPhaseDist({run:0,walk:0})},[releaseWake]);
  useEffect(()=>()=>{clearInterval(ticker.current);stopWatch();releaseWake()},[releaseWake]);
  return{status,autoPaused,elapsedMs,distanceM,points,splits,accuracy,error,elevGainM,maxSpeedMs,phaseDist,start,pause,resume,finish,reset};
}
