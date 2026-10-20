// ---------------------------------------------------------------------------
// The workout player: a full-screen cover, like the run tracker, that walks
// through a workout one exercise at a time.
//
// The happy path is one big button: "Done · set 1 of 3". Tapping it logs the
// set with the suggested weight and reps (anything typed wins), starts the
// rest timer, and when the exercise is finished moves on to the next one — so
// someone who has never lifted only ever has to do the set and tap the button.
// Timed holds (planks) get a 3-2-1 and a countdown instead, ticked off by
// themselves, because nobody can watch a clock while planking.
//
// The workout is a "draft" (gym.js buildDraft) saved after every change, so a
// minimised player, a killed app or a flat battery loses nothing. Rest and
// holds are timestamps, not counters: a phone that sleeps mid-rest comes back
// showing the right time.
// ---------------------------------------------------------------------------
import React, { useEffect, useMemo, useRef, useState } from "react";
import { C, tint, FEELS } from "../data.js";
import { Icon, Group, Cell, MetricGrid } from "./ui.jsx";
import { Sheet } from "./Sheet.jsx";
import { BodyMap } from "./BodyMap.jsx";
import { HowTo, groupColor, equipIcon } from "./GymParts.jsx";
import { haptic } from "../celebrate.js";
import { primeAudio, beep, speak } from "../cues.js";
import { notifyRestOver, primeGymNotifications } from "../notifications.js";
import { loadSettings, saveSettings, saveActiveWorkout } from "../storage.js";
import { fmtClock } from "../share.js";
import { askAboutExercise } from "../coach.js";
import {
  EXERCISES, EQUIPMENT, groupOf, muscleNames, targetLabel, restLabel, repRange, fmtKg,
  draftItem, addSet, draftToSession, sessionVolume, sessionSets, newBests, setsText, lastPerformance,
} from "../gym.js";

const QUESTIONS = [
  { label: "Machine's taken", q: "The equipment for this is taken. What should I do instead right now, with the same sets and reps?" },
  { label: "Is my weight right?", q: "How do I know if my weight is right for this? What should I change for the next set?" },
  { label: "Form tips", q: "What are the three most important form cues for this, and the most common mistake?" },
  { label: "It hurts", q: "I feel pain (not just effort) doing this. What should I do — stop, change something, or swap it?" },
];

const fmtSec = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const complete = (it) => it.sets.every((s) => s.done);
const clean = (v) => String(v).replace(",", ".").replace(/[^0-9.]/g, "").slice(0, 6);

// The first unfinished exercise after `from`, wrapping round to any skipped.
function nextIncomplete(items, from) {
  for (let k = 1; k <= items.length; k++) {
    const i = (from + k) % items.length;
    if (!complete(items[i])) return i;
  }
  return -1;
}

// What a set says before anything is typed: the weight carried on from an
// earlier set of this exercise, else the suggestion; the target reps or time.
function placeholder(it, si) {
  let kg = it.hint.kg != null ? fmtKg(it.hint.kg) : "";
  for (let k = si - 1; k >= 0; k--) if (it.sets[k].kg !== "") { kg = it.sets[k].kg; break; }
  const [lo] = repRange(it.target);
  return { kg, reps: String(it.hint.reps ?? lo), sec: String(it.hint.sec ?? it.target.sec ?? 30) };
}

const setPatch = (d, i, si, patch) => ({
  ...d,
  items: d.items.map((it, k) => (k !== i ? it : { ...it, sets: it.sets.map((s, j) => (j !== si ? s : { ...s, ...patch })) })),
});

// A ring that drains — rest in the time colour, a hold in the same.
function TimerRing({ pct, children, color = C.yellow }) {
  const R = 24, circ = 2 * Math.PI * R;
  return (
    <span style={{ position: "relative", width: 58, height: 58, flexShrink: 0 }}>
      <svg width="58" height="58" viewBox="0 0 58 58" style={{ transform: "rotate(-90deg)", display: "block" }} aria-hidden="true">
        <circle cx="29" cy="29" r={R} fill="none" stroke={tint(color, 0.2)} strokeWidth="5" />
        <circle cx="29" cy="29" r={R} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - Math.max(0, Math.min(1, pct)))} style={{ transition: "stroke-dashoffset .2s linear" }} />
      </svg>
      <span className="num" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700 }}>{children}</span>
    </span>
  );
}

function RestDock({ rest, now, onAdjust, onSkip }) {
  const left = rest.until - now;
  const over = left <= 0;
  return (
    <div className={`rest-dock glass${over ? " over" : ""}`} role="timer" aria-live="off"
      aria-label={over ? "Rest over" : `Resting, ${Math.ceil(left / 1000)} seconds left`}>
      <TimerRing pct={over ? 1 : left / (rest.total * 1000)} color={over ? C.accent : C.yellow}>
        {over ? <span style={{ color: C.accent, display: "flex" }}><Icon name="check" size={22} weight={3} /></span> : fmtSec(left)}
      </TimerRing>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="t-headline" style={{ color: over ? C.accent : C.text }}>{over ? "Go!" : "Rest"}</div>
        <div className="t-foot clamp2" style={{ color: C.dim }}>{rest.label}</div>
      </div>
      {!over && (
        <>
          <button className="rest-btn" onClick={() => onAdjust(-15)} aria-label="15 seconds less rest">−15</button>
          <button className="rest-btn" onClick={() => onAdjust(15)} aria-label="15 seconds more rest">+15</button>
        </>
      )}
      <button className="rest-btn skip" onClick={onSkip}>{over ? "OK" : "Skip"}</button>
    </div>
  );
}

function HoldDock({ hold, now, name, onDone }) {
  const t = now - hold.start;
  const ready = t < 0;
  return (
    <div className="rest-dock glass" role="timer" aria-live="off">
      <TimerRing pct={ready ? 0 : t / (hold.goal * 1000)}>
        {ready ? Math.ceil(-t / 1000) : fmtSec(hold.goal * 1000 - t)}
      </TimerRing>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="t-headline" style={{ color: ready ? C.text : C.yellow }}>{ready ? "Get in position…" : "Hold it"}</div>
        <div className="t-foot" style={{ color: C.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name} · {hold.goal} s</div>
      </div>
      <button className="rest-btn skip" onClick={onDone}>{ready ? "Cancel" : "Stop"}</button>
    </div>
  );
}

function SetRow({ ex, it, i, s, si, isNext, need, onField, onTick }) {
  const ph = placeholder(it, si);
  return (
    <div className={`gp-set${s.done ? " done" : ""}${isNext ? " next" : ""}`}>
      <span className="gp-set-n num">{si + 1}</span>
      {ex.kind === "weight" && (
        <input id={`kg-${i}-${si}`} className={`gp-inp num${need ? " need" : ""}`} inputMode="decimal" autoComplete="off"
          value={s.kg} placeholder={ph.kg || (ex.optionalLoad ? "–" : "kg")}
          onChange={(e) => onField(i, si, "kg", e.target.value)} aria-label={`Set ${si + 1} weight in kilograms`} />
      )}
      {ex.kind === "time" ? (
        <input className="gp-inp num" inputMode="numeric" autoComplete="off" value={s.sec} placeholder={ph.sec}
          onChange={(e) => onField(i, si, "sec", e.target.value)} aria-label={`Set ${si + 1} seconds`} style={{ gridColumn: "2 / 4" }} />
      ) : (
        <input className="gp-inp num" inputMode="numeric" autoComplete="off" value={s.reps} placeholder={ph.reps}
          onChange={(e) => onField(i, si, "reps", e.target.value)} aria-label={`Set ${si + 1} reps`}
          style={ex.kind === "reps" ? { gridColumn: "2 / 4" } : undefined} />
      )}
      <button className={`gp-tick${s.done ? " on pop" : ""}`} onClick={() => onTick(i, si)}
        aria-label={s.done ? `Set ${si + 1} done — tap to undo` : `Mark set ${si + 1} done`}>
        <Icon name="check" size={20} weight={3} />
      </button>
    </div>
  );
}

function ExercisePanel({ d, i, sessions, need, howOpen, onHow, onField, onTick, onAddSet, onRemoveSet, onSwap, ask, onAsk }) {
  const it = d.items[i];
  const ex = EXERCISES[it.ex];
  const col = groupColor(ex);
  const firstTime = !lastPerformance(it.ex, sessions);
  const open = howOpen[it.ex] ?? firstTime;
  const nextSi = it.sets.findIndex((s) => !s.done);
  const tone = it.hint.tone === "up" ? C.good : C.blue;
  const started = it.sets.some((s) => s.done);
  const canRemove = it.sets.length > 1 && !it.sets[it.sets.length - 1].done;
  const cols = ex.kind === "weight" ? ["kg", "Reps"] : [ex.kind === "time" ? "Seconds" : "Reps"];
  return (
    <div className="rise" key={`${i}-${it.ex}`}>
      <div className="card accented" style={{ padding: 16, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t-foot" style={{ color: col, fontWeight: 600 }}>Exercise {i + 1} of {d.items.length} · {groupOf(ex).name}</div>
            <div className="t-title2" style={{ marginTop: 4 }}>{ex.name}</div>
            <div className="t-callout num" style={{ marginTop: 8, fontWeight: 600 }}>{targetLabel(it.target, ex)}</div>
            <div className="t-foot" style={{ color: C.dim, marginTop: 3, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
              <Icon name="timer" size={13} /> {restLabel(it.target.rest || 90)}
              <span style={{ opacity: 0.6 }}>·</span>
              <Icon name={equipIcon(ex)} size={13} /> {EQUIPMENT[ex.equip].name}
            </div>
          </div>
          <BodyMap primary={ex.primary} secondary={ex.secondary} height={112} />
        </div>
        {it.hint.text && (
          <div className="gp-hint" style={{ background: tint(tone, 0.14) }}>
            <span style={{ color: tone, display: "flex", paddingTop: 1 }}>
              <Icon name={it.hint.tone === "up" ? "arrowUp" : it.hint.tone === "new" ? "sparkles" : "target"} size={16} weight={2.4} />
            </span>
            <span>{it.hint.text}</span>
          </div>
        )}
        {it.swappedFrom && EXERCISES[it.swappedFrom] && (
          <div className="t-foot" style={{ color: C.dim, marginTop: 8 }}>Swapped in for {EXERCISES[it.swappedFrom].name}.</div>
        )}
      </div>

      <div className="card" style={{ padding: "4px 14px 8px", marginBottom: 12 }}>
        <div className="gp-set gp-set-head">
          <span style={{ textAlign: "center" }}>Set</span>
          {cols.length === 2
            ? <><span style={{ textAlign: "center" }}>{cols[0]}</span><span style={{ textAlign: "center" }}>{cols[1]}</span></>
            : <span style={{ textAlign: "center", gridColumn: "2 / 4" }}>{cols[0]}{ex.perSide ? " · each side" : ""}</span>}
          <span style={{ textAlign: "center" }}>Done</span>
        </div>
        {it.sets.map((s, si) => (
          <SetRow key={si} ex={ex} it={it} i={i} s={s} si={si} isNext={si === nextSi} need={need === `${i}:${si}`} onField={onField} onTick={onTick} />
        ))}
        {need && need.startsWith(`${i}:`) && (
          <div className="t-foot rise" style={{ color: C.warn, fontWeight: 600, padding: "6px 2px 2px" }}>
            Type the weight you used in kg, then tap done again.
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "8px 2px 4px" }}>
          <button className="link" onClick={() => onAddSet(i)} style={{ minHeight: 0, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon name="plus" size={15} weight={2.4} /> Add set
          </button>
          {canRemove && <button className="link" onClick={() => onRemoveSet(i)} style={{ minHeight: 0, color: C.dim }}>Remove set</button>}
        </div>
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 12, overflow: "hidden" }}>
        <button className="cell tappable" onClick={() => onHow(it.ex, !open)} aria-expanded={open} style={{ "--inset": "60px" }}>
          <span className="badge" style={{ width: 30, height: 30, background: `linear-gradient(180deg, ${C.yellow}, ${tint(C.yellow, 0.86)})`, color: C.onAccent }}>
            <Icon name="bulb" size={18} weight={2} />
          </span>
          <span className="cell-main"><span className="cell-title">How to do it</span>{firstTime && <span className="cell-sub">First time — worth a read</span>}</span>
          <span className="cell-chev" style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .3s cubic-bezier(.3,.8,.3,1)" }}>
            <Icon name="chevron" size={15} weight={2.4} />
          </span>
        </button>
        {open && <div className="rise" style={{ padding: "4px 16px 18px" }}><HowTo ex={ex} /></div>}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button onClick={() => onSwap(i)} disabled={started || !ex.alts.length} className="btn" style={{ flex: 1, padding: "12px 0" }}
          title={started ? "Already started — finish it or move on" : undefined}>
          <Icon name="swap" size={17} /> Swap exercise
        </button>
      </div>

      <div className="card" style={{ padding: "14px 14px 14px", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ color: C.purple, display: "flex" }}><Icon name="sparkles" size={17} /></span>
          <span className="t-headline">Ask the coach</span>
        </div>
        <div className="hscroll" style={{ flexWrap: "wrap" }}>
          {QUESTIONS.map((q) => (
            <button key={q.label} onClick={() => onAsk(q)} disabled={ask && ask.busy} className={`chip${ask && ask.i === i && ask.label === q.label ? " on" : ""}`} style={{ flexShrink: 0 }}>{q.label}</button>
          ))}
        </div>
        {ask && ask.i === i && (
          ask.nokey ? (
            <div className="t-foot rise" style={{ color: C.dim, marginTop: 12 }}>
              Add your free Groq key on the Coach tab to switch the AI on — your workout is saved if you step out.
            </div>
          ) : (
            <div className="rise bubble them" style={{ marginTop: 12, maxWidth: "100%" }}>
              {ask.text || <span style={{ color: C.dim }}>Thinking…</span>}
            </div>
          )
        )}
      </div>
    </div>
  );
}

export function WorkoutPlayer({ draft, sessions, coach, onSave, onDiscard, onMinimize }) {
  const [d, setD] = useState(draft);
  const [now, setNow] = useState(() => Date.now());
  const [sound, setSound] = useState(() => loadSettings().gymSound !== false);
  const [swapFor, setSwapFor] = useState(null);
  const [howOpen, setHowOpen] = useState({});
  const [need, setNeed] = useState(null);
  const [ask, setAsk] = useState(null);
  const [discardArmed, setDiscardArmed] = useState(false);
  const scrollRef = useRef(null);
  const stripRef = useRef(null);
  const cues = useRef({ beeped: "", rest: 0, hold: 0 });
  const askAbort = useRef(null);
  const discardTimer = useRef(0);

  // Saved after every change: the draft is the workout.
  useEffect(() => { saveActiveWorkout(d); }, [d]);

  const timing = !!(d.rest || d.hold);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), timing ? 200 : 1000);
    return () => clearInterval(id);
  }, [timing]);

  // Ask for notification permission from the tap that opened the workout —
  // fire-and-forget, never awaited (see ensureNotificationPermission).
  useEffect(() => { primeGymNotifications(); }, []);

  // Keep the screen awake between sets; the browser drops the lock whenever
  // the page is hidden, so take it again on the way back.
  useEffect(() => {
    let lock = null;
    const take = async () => {
      try { if ("wakeLock" in navigator && document.visibilityState === "visible") lock = await navigator.wakeLock.request("screen"); } catch { /* not allowed */ }
    };
    const onVis = () => { if (document.visibilityState === "visible") { setNow(Date.now()); take(); } };
    take();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      try { lock && lock.release(); } catch { /* already released */ }
    };
  }, []);

  useEffect(() => () => { askAbort.current?.abort(); clearTimeout(discardTimer.current); }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    const strip = stripRef.current, chip = strip && strip.querySelector(".gp-chip.on");
    if (strip && chip) strip.scrollTo({ left: chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2, behavior: "smooth" });
  }, [d.cur, d.finished]);

  const items = d.items;
  const item = items[d.cur] || items[0];
  const ex = EXERCISES[item.ex];
  const allSets = items.flatMap((it) => it.sets);
  const doneSets = allSets.filter((s) => s.done).length;
  const elapsed = now - d.startedAt;

  // --- actions ----------------------------------------------------------------

  const onField = (i, si, key, value) => {
    setD((x) => setPatch(x, i, si, { [key]: clean(value) }));
    if (need === `${i}:${si}`) setNeed(null);
  };

  // Log a set (or undo one). Empty fields take what the placeholder offered,
  // so following the suggestion is a single tap. Then rest, and when this was
  // the exercise's last set, move straight on to the next exercise.
  const tick = (i, si, holdSec) => {
    primeAudio();
    const it = d.items[i];
    const e = EXERCISES[it.ex];
    const s = it.sets[si];
    if (s.done && holdSec == null) {
      haptic(8);
      setD((x) => setPatch(x, i, si, { done: false, at: null }));
      return;
    }
    const ph = placeholder(it, si);
    const filled = e.kind === "time"
      ? { sec: holdSec != null ? String(holdSec) : s.sec !== "" ? s.sec : ph.sec }
      : { reps: s.reps !== "" ? s.reps : ph.reps, ...(e.kind === "weight" ? { kg: s.kg !== "" ? s.kg : ph.kg } : null) };
    if (e.kind === "weight" && !e.optionalLoad && !(parseFloat(filled.kg) > 0)) {
      setNeed(`${i}:${si}`);
      haptic(10);
      setTimeout(() => document.getElementById(`kg-${i}-${si}`)?.focus(), 40);
      return;
    }
    setNeed(null);
    const at = Date.now();
    let next = setPatch(d, i, si, { ...filled, done: true, at });
    const it2 = next.items[i];
    const more = it2.sets.findIndex((z) => !z.done);
    let cur = next.cur, label = null, speech = null;
    if (more >= 0) {
      label = `Then set ${more + 1} of ${it2.sets.length}`;
      speech = `Rest over. Set ${more + 1} of ${e.name}.`;
    } else {
      const ni = nextIncomplete(next.items, i);
      if (ni >= 0) {
        cur = ni;
        const nx = EXERCISES[next.items[ni].ex];
        label = `Then ${nx.name}`;
        speech = `Rest over. Next up, ${nx.name}.`;
      }
    }
    const rest = label ? { until: at + (it2.target.rest || 90) * 1000, total: it2.target.rest || 90, label, speech } : null;
    next = { ...next, cur, rest, hold: null };
    haptic(rest ? 14 : [15, 30, 15]);
    setD(next);
  };

  const startHold = (i, si) => {
    primeAudio();
    haptic(10);
    const goal = Math.max(5, Math.round(Number(placeholder(d.items[i], si).sec) || 30));
    setD((x) => ({ ...x, rest: null, hold: { i, si, start: Date.now() + 3000, goal } }));
  };
  const stopHold = () => {
    const h = d.hold;
    if (!h) return;
    const held = Math.floor((Date.now() - h.start) / 1000);
    if (held >= 1) tick(h.i, h.si, held);
    else { haptic(6); setD((x) => ({ ...x, hold: null })); }
  };

  // Rest and hold cues: a beep for each of the last three seconds, then a buzz,
  // a tone and a spoken line. A timer that ran out while the app was away is
  // just cleared on return — no beeps for something that already happened.
  useEffect(() => {
    const c = cues.current;
    const r = d.rest;
    if (r) {
      const left = r.until - now;
      const s = Math.ceil(left / 1000);
      if (sound && s >= 1 && s <= 3 && c.beeped !== `r${r.until}:${s}`) { c.beeped = `r${r.until}:${s}`; beep(660, 90, 0.12); }
      if (left <= 0 && c.rest !== r.until) {
        c.rest = r.until;
        if (left > -5000) {
          haptic([30, 60, 30]);
          if (sound) { beep(880, 260, 0.2); setTimeout(() => speak(r.speech), 320); }
        }
        if (typeof document !== "undefined" && document.hidden) notifyRestOver(r.label).catch?.(() => {});
      }
      if (left <= -4000) setD((x) => (x.rest && x.rest.until === r.until ? { ...x, rest: null } : x));
    }
    const h = d.hold;
    if (h) {
      const t = now - h.start;
      const s = Math.ceil(-t / 1000);
      if (t < 0 && s >= 1 && s <= 3 && c.beeped !== `h${h.start}:${s}`) { c.beeped = `h${h.start}:${s}`; if (sound) beep(660, 90, 0.12); }
      if (t >= 0 && c.beeped !== `h${h.start}:go`) { c.beeped = `h${h.start}:go`; haptic(20); if (sound) beep(880, 200, 0.18); }
      if (t >= h.goal * 1000 && c.hold !== h.start) {
        c.hold = h.start;
        if (t > h.goal * 1000 + 60000) {
          // Ended long ago — the app was closed or asleep. Whether the hold
          // happened is the user's call, so don't log it for them.
          setD((x) => (x.hold && x.hold.start === h.start ? { ...x, hold: null } : x));
        } else {
          haptic([30, 60, 30]);
          if (sound) { beep(988, 320, 0.2); setTimeout(() => speak("Time. Well held."), 340); }
          tick(h.i, h.si, h.goal);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  // The big button does whatever comes next.
  const cta = () => {
    const si = item.sets.findIndex((s) => !s.done);
    if (si >= 0) return ex.kind === "time" ? startHold(d.cur, si) : tick(d.cur, si);
    const ni = nextIncomplete(items, d.cur);
    if (ni >= 0) { haptic(8); setD((x) => ({ ...x, cur: ni })); return; }
    finish();
  };

  const finish = () => { haptic(12); setD((x) => ({ ...x, finished: true, rest: null, hold: null })); };

  const addSetTo = (i) => { haptic(6); setD((x) => ({ ...x, items: x.items.map((it, k) => (k === i ? addSet(it) : it)) })); };
  const removeSetFrom = (i) => {
    haptic(6);
    setD((x) => ({ ...x, items: x.items.map((it, k) => (k === i && it.sets.length > 1 && !it.sets[it.sets.length - 1].done ? { ...it, sets: it.sets.slice(0, -1) } : it)) }));
  };

  // Only before the first set is done: swapping mid-exercise would mix two
  // exercises' sets into one row of the log.
  const swap = (i, exId) => {
    haptic(10);
    setD((x) => ({
      ...x,
      items: x.items.map((it, k) => (k !== i ? it
        : { ...draftItem(exId, { ...it.target, sets: it.sets.length }, sessions), swappedFrom: it.swappedFrom || it.ex })),
    }));
  };

  const adjustRest = (delta) => {
    haptic(6);
    setD((x) => (x.rest ? { ...x, rest: { ...x.rest, until: Math.max(Date.now() + 1000, x.rest.until + delta * 1000), total: Math.max(5, x.rest.total + delta) } } : x));
  };
  const skipRest = () => { haptic(8); setD((x) => ({ ...x, rest: null })); };

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    saveSettings({ ...loadSettings(), gymSound: next });
    if (next) { primeAudio(); beep(880, 90, 0.1); }
    haptic(6);
  };

  const askCoach = async (q) => {
    if (!coach.apiKey) { setAsk({ i: d.cur, label: q.label, nokey: true }); haptic(8); return; }
    askAbort.current?.abort();
    const ctrl = new AbortController();
    askAbort.current = ctrl;
    const i = d.cur, it = d.items[i], e = EXERCISES[it.ex];
    const last = lastPerformance(it.ex, sessions);
    const doneNow = it.sets.filter((s) => s.done).map((s) => ({ kg: parseFloat(s.kg) || 0, reps: parseFloat(s.reps) || 0, sec: parseFloat(s.sec) || 0 }));
    setAsk({ i, label: q.label, busy: true, text: "" });
    haptic(8);
    try {
      const text = await askAboutExercise({
        apiKey: coach.apiKey, model: coach.model, summary: coach.getSummary(), signal: ctrl.signal,
        question: q.q,
        exercise: {
          name: e.name,
          target: targetLabel(it.target, e),
          lastTime: last ? setsText({ kind: e.kind, sets: last.sets }) : null,
          today: doneNow.length ? setsText({ kind: e.kind, sets: doneNow }) : null,
        },
      });
      setAsk((a) => (a && a.i === i ? { ...a, busy: false, text } : a));
      haptic([10, 20, 10]);
    } catch (err) {
      if (err?.name !== "AbortError") setAsk((a) => (a && a.i === i ? { ...a, busy: false, text: `⚠️ ${err.message || "Couldn't reach the coach."}` } : a));
    }
  };

  const armDiscard = () => {
    clearTimeout(discardTimer.current);
    if (discardArmed) { setDiscardArmed(false); onDiscard(); return; }
    haptic(8);
    setDiscardArmed(true);
    discardTimer.current = setTimeout(() => setDiscardArmed(false), 3500);
  };

  // --- the finish screen ---------------------------------------------------------
  const session = useMemo(() => (d.finished ? draftToSession(d) : null), [d]);
  const prs = useMemo(() => (session ? newBests(session, sessions) : []), [session, sessions]);

  const ctaLabel = (() => {
    const si = item.sets.findIndex((s) => !s.done);
    if (si >= 0) {
      return ex.kind === "time"
        ? { icon: "play", text: `Start set ${si + 1} · ${placeholder(item, si).sec} s hold` }
        : { icon: "check", text: `Done · set ${si + 1} of ${item.sets.length}` };
    }
    const ni = nextIncomplete(items, d.cur);
    if (ni >= 0) return { icon: "chevron", text: `Next: ${EXERCISES[items[ni].ex].name}` };
    return { icon: "flag", text: "Finish workout" };
  })();

  return (
    <div ref={scrollRef} className="tracker" role="dialog" aria-modal="true" aria-label={`Workout: ${d.workoutName}`}>
      <div className="tracker-inner">
        <div className="gp-head">
          <button onClick={() => onMinimize(d)} className="close-btn" aria-label="Minimise — the workout keeps going"
            style={{ width: 34, height: 34, minHeight: 34 }}>
            <Icon name="chevronDown" size={17} weight={2.6} />
          </button>
          <div style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
            <div className="t-headline" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.finished ? "Workout complete" : d.workoutName}</div>
            <div className="t-foot num" style={{ color: C.yellow, fontWeight: 600 }}>
              {fmtClock(d.finished && session ? session.durMs : elapsed)}
              <span style={{ color: C.dim, fontWeight: 500 }}> · {doneSets} of {allSets.length} sets</span>
            </div>
          </div>
          <button onClick={toggleSound} className="close-btn" aria-label={sound ? "Mute beeps and voice" : "Turn beeps and voice on"} aria-pressed={sound}
            style={{ width: 34, height: 34, minHeight: 34, color: sound ? C.text : C.dim }}>
            <Icon name={sound ? "speaker" : "mute"} size={17} />
          </button>
          {!d.finished && (
            <button onClick={finish} className="btn tinted" style={{ padding: "7px 14px", fontSize: 15, minHeight: 34 }}>Finish</button>
          )}
        </div>

        {!d.finished ? (
          <div className="tracker-body">
            <div ref={stripRef} className="hscroll gp-strip" role="tablist" aria-label="Exercises">
              {items.map((it, i) => {
                const e = EXERCISES[it.ex], dn = complete(it);
                return (
                  <button key={i} role="tab" aria-selected={i === d.cur} onClick={() => { haptic(5); setD((x) => ({ ...x, cur: i })); }}
                    className={`gp-chip${i === d.cur ? " on" : ""}${dn ? " done" : ""}`}>
                    <i>{dn ? <Icon name="check" size={12} weight={3.2} /> : i + 1}</i>
                    <span>{e.name}</span>
                  </button>
                );
              })}
            </div>

            <ExercisePanel d={d} i={d.cur} sessions={sessions} need={need} howOpen={howOpen}
              onHow={(id, v) => { haptic(5); setHowOpen((m) => ({ ...m, [id]: v })); }}
              onField={onField} onTick={tick} onAddSet={addSetTo} onRemoveSet={removeSetFrom}
              onSwap={(i) => { haptic(6); setSwapFor(i); }} ask={ask} onAsk={askCoach} />

            <div className="tracker-dock">
              {d.hold ? (
                <HoldDock hold={d.hold} now={now} name={EXERCISES[d.items[d.hold.i].ex].name} onDone={stopHold} />
              ) : d.rest ? (
                <RestDock rest={d.rest} now={now} onAdjust={adjustRest} onSkip={skipRest} />
              ) : (
                <button onClick={cta} className="cta tap"
                  style={{ width: "100%", borderRadius: 999, padding: "17px 0", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}>
                  <Icon name={ctaLabel.icon} size={19} weight={ctaLabel.icon === "check" ? 2.8 : 2.2} /> {ctaLabel.text}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="rise tracker-body">
            {session && session.exercises.length ? (
              <>
                <div className="card accented" style={{ padding: "16px 18px 8px", marginBottom: 14 }}>
                  <div className="t-foot" style={{ color: C.dim, fontWeight: 600 }}>
                    {new Date(session.date).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
                  </div>
                  <div className="t-title2" style={{ marginTop: 2 }}>{d.workoutName}</div>
                  <MetricGrid size={30} items={[
                    { label: "Time", value: fmtClock(session.durMs), color: C.yellow },
                    { label: "Lifted", value: Math.round(sessionVolume(session)).toLocaleString(), unit: "kg", color: C.accent },
                    { label: "Sets", value: sessionSets(session) },
                    { label: "Exercises", value: session.exercises.length },
                  ]} />
                </div>

                {prs.length > 0 && (
                  <Group header="New personal bests">
                    {prs.map((p) => (
                      <Cell key={p.ex} icon="trophy" iconColor={C.yellow} title={p.name} sub={`Was ${p.was}`}
                        value={<span className="num" style={{ color: C.accent, fontWeight: 700 }}>{p.label}</span>} />
                    ))}
                  </Group>
                )}

                <Group header="What you did">
                  {session.exercises.map((e) => (
                    <Cell key={e.ex} title={e.name} value={<span className="num t-foot" style={{ color: C.dim }}>{setsText(e)}</span>} />
                  ))}
                </Group>

                <div className="card" style={{ padding: 16, marginBottom: 14 }}>
                  <div className="t-headline" style={{ marginBottom: 10 }}>How did it feel?</div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
                    {FEELS.map((f, k) => {
                      const sel = d.feel === k + 1;
                      return (
                        <button key={k} onClick={() => { haptic(6); setD((x) => ({ ...x, feel: sel ? null : k + 1 })); }} aria-label={`Effort ${k + 1} of 5`} aria-pressed={sel}
                          style={{ width: 52, height: 52, minHeight: 52, borderRadius: "50%", border: "none", padding: 0, fontSize: 27, cursor: "pointer",
                            background: sel ? tint(C.accent, 0.22) : "var(--fill4)", boxShadow: sel ? `inset 0 0 0 1.5px ${C.accent}` : "none", opacity: !d.feel || sel ? 1 : 0.45 }}>
                          {f}
                        </button>
                      );
                    })}
                  </div>
                  <input className="inp" value={d.note || ""} onChange={(e) => setD((x) => ({ ...x, note: e.target.value }))}
                    placeholder="Add a note (optional)" aria-label="Workout note" />
                </div>
              </>
            ) : (
              <div className="card" style={{ padding: "28px 20px", textAlign: "center", marginBottom: 14 }}>
                <div className="t-title3">No sets ticked yet</div>
                <div className="t-sub" style={{ color: C.dim, marginTop: 6 }}>Go back and tick the sets you did — or discard this one.</div>
              </div>
            )}

            <div className="tracker-dock" style={{ display: "grid", gap: 10 }}>
              {session && session.exercises.length > 0 && (
                <button onClick={() => onSave(session, prs)} className="cta tap"
                  style={{ width: "100%", borderRadius: 999, padding: "17px 0", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}>
                  <Icon name="check" size={19} weight={2.8} /> Save workout
                </button>
              )}
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => { haptic(6); setD((x) => ({ ...x, finished: false })); }} className="btn" style={{ flex: 1, padding: "13px 0" }}>Back to workout</button>
                <button onClick={armDiscard} className="btn danger" style={{ flex: 1, padding: "13px 0" }}>{discardArmed ? "Tap to discard" : "Discard"}</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {swapFor != null && d.items[swapFor] && (() => {
        const e = EXERCISES[d.items[swapFor].ex];
        const at = swapFor;
        return (
          <Sheet title={`Instead of ${e.name}`} sub="Same sets and reps — pick whatever's free" onClose={() => setSwapFor(null)}>
            {({ dismiss }) => (
              <Group style={{ marginBottom: 0 }}>
                {e.alts.filter((a) => EXERCISES[a]).map((a) => {
                  const alt = EXERCISES[a];
                  return (
                    <Cell key={a} icon={equipIcon(alt)} iconColor={groupColor(alt)} title={alt.name}
                      sub={`${EQUIPMENT[alt.equip].name} · ${muscleNames(alt, 2)}`}
                      trailing={<span className="t-sub" style={{ color: C.accent, fontWeight: 600 }}>Swap</span>}
                      onClick={() => { swap(at, a); dismiss(); }} />
                  );
                })}
              </Group>
            )}
          </Sheet>
        );
      })()}
    </div>
  );
}
