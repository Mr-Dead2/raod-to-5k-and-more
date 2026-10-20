// ---------------------------------------------------------------------------
// The Gym tab: for someone who walks into a gym and doesn't know what to do.
//
//   Today      the next workout of your plan, every exercise listed, one Start
//   Plans      ready-made plans, or one the AI coach writes from five answers
//   Exercises  the library — what each move works and how to do it
//   Log        what you've lifted, your best sets, a coach read on any workout
//
// The workout itself runs in WorkoutPlayer, which App mounts above everything.
// All state that outlives this tab (log, plan, workout in progress) lives in
// useGym; what's here is only how the tab is being looked at.
// ---------------------------------------------------------------------------
import React, { useEffect, useMemo, useRef, useState } from "react";
import { C, tint, FEELS } from "../data.js";
import { Icon, IconBadge, Card, Label, Group, Cell, Screen, Segmented, Tile, MetricGrid, Rings } from "./ui.jsx";
import { Sheet } from "./Sheet.jsx";
import { BodyMap } from "./BodyMap.jsx";
import { ExerciseCell, ExerciseSheet, groupColor, equipIcon, shortDate, ago } from "./GymParts.jsx";
import { haptic, confetti } from "../celebrate.js";
import { loadSettings, saveSettings } from "../storage.js";
import { fmtClock } from "../share.js";
import {
  PROGRAMS, EXERCISES, EQUIPMENT, GROUPS, WARMUP, exerciseList, groupOf, muscleNames,
  targetLabel, workoutMinutes, workoutSets, workoutMuscles, suggestion, fmtKg,
  planSessions, nextWorkout, sessionsThisWeek, sameDay, personalBests, setLabel, setsText,
  sessionVolume, sessionSets, normalizeGymPlan, newBestsBySession,
} from "../gym.js";
import { generateGymPlan, tweakGymPlan, coachWorkout, gymAsks } from "../coach.js";

const GOALS = [
  { id: "muscle", label: "Build muscle", words: "build muscle and look more toned" },
  { id: "strength", label: "Get stronger", words: "get stronger" },
  { id: "fat", label: "Lose fat", words: "lose fat while keeping muscle" },
  { id: "running", label: "Run better", words: "get stronger to run faster and stay injury-free" },
  { id: "health", label: "Feel fitter", words: "general fitness and health" },
];
const LEVELS = [
  { id: "new", label: "New to it", words: "complete beginner — never trained in a gym" },
  { id: "some", label: "Some", words: "a few months of gym experience" },
  { id: "exp", label: "Experienced", words: "experienced lifter, a year or more" },
];
const DEFAULT_PREFS = { goal: "strength", level: "new", days: 3, minutes: 45, equipment: "gym", notes: "" };
const TWEAKS = ["Only 30 minutes", "Machines only", "More arms", "Easy on my knees", "More core", "Add a day"];
const LEVEL_TONE = { Beginner: "good", Intermediate: "orange", Advanced: "warn", Custom: "purple" };

const norm = (s) => String(s || "").toLowerCase();
const fmtMins = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
const tonnes = (kg) => (kg >= 10000 ? { value: (kg / 1000).toFixed(kg >= 100000 ? 0 : 1), unit: "t" } : { value: Math.round(kg).toLocaleString(), unit: "kg" });

// What to put next to an exercise in a list: the weight to use today, or a
// "new" tag the first time — the question people have walking up to it.
function hintBadge(t, sessions) {
  const h = suggestion(t.ex, t, sessions);
  if (h.tone === "new") return <span className="tag" style={{ color: C.blue, background: tint(C.blue, 0.16) }}>New</span>;
  const label = h.kg ? `${fmtKg(h.kg)} kg` : h.sec ? `${h.sec} s` : h.reps ? `${h.reps} reps` : null;
  if (!label) return null;
  return (
    <span className="num" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 15, fontWeight: 600, color: h.tone === "up" ? C.good : C.dim }}>
      {h.tone === "up" && <Icon name="arrowUp" size={13} weight={2.6} />}{label}
    </span>
  );
}

const LevelPill = ({ level }) => {
  const col = C[LEVEL_TONE[level] || "purple"];
  return <span className="tag" style={{ color: col, background: tint(col, 0.16) }}>{level}</span>;
};

function ProgramCard({ p, current, onClick, delay = 0 }) {
  const col = C[p.color] || C.accent;
  return (
    <button onClick={onClick} className="card prog-card stagger" aria-label={`${p.name} — ${p.tagline}`}
      style={{ animationDelay: `${delay}s`, ...(current ? { boxShadow: `inset 0 0 0 1.5px ${tint(C.accent, 0.6)}` } : null) }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 13 }}>
        <IconBadge name={p.icon} color={col} size={46} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="t-headline" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
            {current && <span className="pill" style={{ background: C.accent, color: C.onAccent, marginLeft: "auto", flexShrink: 0 }}>Your plan</span>}
          </div>
          <div className="t-foot" style={{ color: C.dim, marginTop: 2 }}>{p.tagline}</div>
        </div>
      </div>
      <div className="meta-row" style={{ marginTop: 12 }}>
        <LevelPill level={p.level} />
        <span className="meta"><Icon name="calendar" size={13} weight={2.2} />{p.days}× a week</span>
        <span className="meta"><Icon name="clock" size={13} weight={2.2} />{p.minutes} min</span>
        <span className="meta"><Icon name={p.equip === "No equipment" ? "body" : p.equip === "Full gym" ? "barbell" : "dumbbell"} size={13} weight={2.2} />{p.equip}</span>
      </div>
    </button>
  );
}

function ProgramSheet({ program, mode, current, onUse, onDiscard, onExercise, onClose }) {
  const col = C[program.color] || C.accent;
  return (
    <Sheet title={program.name} sub={mode === "proposal" ? "Written for you by your coach" : null} onClose={onClose}
      footer={({ dismiss }) => (mode === "proposal" ? (
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => { onUse(program); dismiss(); }} className="cta tap" style={{ flex: 1.6, borderRadius: 999, padding: "15px 0", fontSize: 17 }}>Use this plan</button>
          <button onClick={() => { onDiscard && onDiscard(); dismiss(); }} className="btn" style={{ flex: 1, padding: "15px 0", fontSize: 17 }}>Discard</button>
        </div>
      ) : current ? (
        <button className="btn" disabled style={{ width: "100%", padding: "15px 0", fontSize: 17 }}><Icon name="check" size={17} weight={2.6} /> This is your plan</button>
      ) : (
        <button onClick={() => { onUse(program); dismiss(); }} className="cta tap" style={{ width: "100%", borderRadius: 999, padding: "15px 0", fontSize: 17 }}>Start this plan</button>
      ))}>
      <div className="rise">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <IconBadge name={program.icon} color={col} size={56} />
          <div style={{ minWidth: 0 }}>
            <LevelPill level={program.level} />
            <div className="t-sub" style={{ marginTop: 6 }}>{program.tagline}</div>
          </div>
        </div>

        <div className="card flat" style={{ padding: "2px 14px", margin: "16px 0 18px" }}>
          <MetricGrid cols={3} size={24} items={[
            { label: "Per week", value: program.days, unit: program.days === 1 ? "day" : "days" },
            { label: "Workout", value: program.minutes, unit: "min", color: C.yellow },
            { label: "Length", value: program.weeks, unit: "wks" },
          ]} />
        </div>

        {program.about.length > 0 && (
          <div style={{ display: "grid", gap: 10, marginBottom: 18 }}>
            {program.about.map((a, i) => (
              <div key={i} className="t-sub" style={{ display: "flex", gap: 11 }}>
                <span style={{ width: 6, height: 6, borderRadius: 6, background: col, marginTop: 8, flexShrink: 0 }} />
                <span>{a}</span>
              </div>
            ))}
          </div>
        )}

        <div className="meta-row" style={{ marginBottom: 22 }}>
          {program.schedule && <span className="meta"><Icon name="calendar" size={13} weight={2.2} />Try {program.schedule}</span>}
          <span className="meta"><Icon name={program.equip === "No equipment" ? "body" : "dumbbell"} size={13} weight={2.2} />{program.equip}</span>
        </div>

        {program.workouts.map((w) => (
          <Group key={w.id} header={w.name} right={<span style={{ textTransform: "none" }}>about {workoutMinutes(w)} min</span>} footer={w.focus}>
            {w.exercises.map((t, i) => <ExerciseCell key={i} t={t} onClick={() => onExercise(t.ex)} />)}
          </Group>
        ))}
      </div>
    </Sheet>
  );
}

function WorkoutSheet({ workout, sessions, onStart, onExercise, onClose }) {
  const mus = workoutMuscles(workout);
  return (
    <Sheet title={workout.name} sub={`${workout.focus} · about ${workoutMinutes(workout)} min`} onClose={onClose}
      footer={({ dismiss }) => (
        <button onClick={() => { dismiss(); onStart(workout); }} className="cta tap"
          style={{ width: "100%", borderRadius: 999, padding: "15px 0", fontSize: 17, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Icon name="play" size={17} /> Start this workout
        </button>
      )}>
      <div className="rise">
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0", marginBottom: 14, borderRadius: 22, background: "var(--fill4)" }}>
          <BodyMap primary={mus.primary} secondary={mus.secondary} height={170} />
        </div>
        <div className="tip" style={{ marginBottom: 18, background: tint(C.blue, 0.12) }}>
          <span style={{ color: C.blue }}><Icon name="info" size={18} /></span><span>{WARMUP}</span>
        </div>
        <Group style={{ marginBottom: 0 }}>
          {workout.exercises.map((t, i) => <ExerciseCell key={i} t={t} onClick={() => onExercise(t.ex)} value={hintBadge(t, sessions)} />)}
        </Group>
      </div>
    </Sheet>
  );
}

function SessionCard({ s, bests, busy, feedback, armed, onCoach, onDelete, idx }) {
  const vol = sessionVolume(s);
  return (
    <div className="card" style={{ padding: "14px 16px 16px", animation: "rise .34s cubic-bezier(.2,.8,.2,1) both", animationDelay: `${Math.min(idx * 0.04, 0.3)}s` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: tint(C.accent, 0.16), color: C.accent }}>
          <Icon name="dumbbell" size={22} weight={2} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t-headline" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.workoutName}</div>
          <div className="t-foot" style={{ color: C.dim }}>{shortDate(s.date)}{s.programName ? ` · ${s.programName}` : ""}</div>
        </div>
        {s.feel ? <span style={{ fontSize: 24, flexShrink: 0 }} aria-label={`Felt ${s.feel} of 5`}>{FEELS[s.feel - 1]}</span> : null}
      </div>

      <div style={{ marginTop: 6 }}>
        <MetricGrid cols={3} size={22} items={[
          { label: "Time", value: fmtClock(s.durMs || 0), color: C.yellow },
          { label: "Lifted", value: tonnes(vol).value, unit: tonnes(vol).unit, color: C.accent },
          { label: "Sets", value: sessionSets(s) },
        ]} />
      </div>

      <div style={{ marginTop: 4 }}>
        {(s.exercises || []).map((e, i) => (
          <div key={i} className="split-row" style={{ alignItems: "baseline" }}>
            <span className="t-sub" style={{ flex: 1, minWidth: 0 }}>{e.name}</span>
            <span className="num t-foot" style={{ color: C.dim, textAlign: "right" }}>{setsText(e)}</span>
          </div>
        ))}
      </div>

      {bests.length > 0 && (
        <div className="t-foot" style={{ color: C.yellow, fontWeight: 600, marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="trophy" size={15} /> New best: {bests.map((b) => `${b.name} ${b.label}`).join(" · ")}
        </div>
      )}
      {s.note && <div className="t-sub" style={{ color: C.dim, marginTop: 10, paddingLeft: 12, borderLeft: `3px solid ${tint(C.accent, 0.5)}` }}>{s.note}</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button onClick={onCoach} disabled={busy} className="btn tinted" style={{ flex: 1.5, padding: "11px 0", whiteSpace: "nowrap" }}>
          <Icon name="sparkles" size={16} /> {busy ? "Reading…" : feedback ? "Ask again" : "Coach this workout"}
        </button>
        <button onClick={onDelete} className={`btn${armed ? " danger" : ""}`} style={{ flex: armed ? 1.3 : 0.7, padding: "11px 0", whiteSpace: "nowrap" }}
          aria-label={armed ? "Tap again to delete this workout" : "Delete this workout"}>
          {armed ? "Tap to delete" : <Icon name="trash" size={17} />}
        </button>
      </div>
      {feedback && <div className="rise bubble them" style={{ marginTop: 12, maxWidth: "100%" }}>{feedback}</div>}
    </div>
  );
}

export function GymTab({ gym, eyebrow, trailing, coach, onStartWorkout, onResume, onDiscardActive, onAskCoach, onNeedKey, setToast }) {
  const [view, setView] = useState("today");
  const [progSheet, setProgSheet] = useState(null);   // { program, mode: "browse" | "proposal" }
  const [workSheet, setWorkSheet] = useState(null);   // a workout to preview
  const [exSheet, setExSheet] = useState(null);       // exercise id
  const [prefs, setPrefs] = useState(() => ({ ...DEFAULT_PREFS, ...(loadSettings().gymPrefs || {}) }));
  const [aiBusy, setAiBusy] = useState(null);         // "build" | "tweak"
  const [aiErr, setAiErr] = useState("");
  const [tweak, setTweak] = useState("");
  const [feedback, setFeedback] = useState({});       // { [sessionId]: text }
  const [fbBusy, setFbBusy] = useState(null);
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [armed, setArmed] = useState(null);           // two-tap confirmations
  const armTimer = useRef(0);
  const abortRef = useRef(null);

  useEffect(() => () => { clearTimeout(armTimer.current); abortRef.current?.abort(); }, []);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "auto" }); }, [view]);

  const sessions = gym.log;
  const program = gym.program;
  const active = gym.active;
  const done = useMemo(() => planSessions(gym.plan, sessions), [gym.plan, sessions]);
  const next = useMemo(() => nextWorkout(program, done), [program, done]);
  const last = sessions[0] || null;
  const trainedToday = !!last && sameDay(last.date);
  const thisWeek = sessionsThisWeek(sessions);
  const total = program ? program.days * program.weeks : 0;
  const curWeek = program ? Math.min(program.weeks, Math.floor(done.length / program.days) + 1) : 0;
  const planDone = !!program && done.length >= total;
  const bests = useMemo(() => personalBests(sessions), [sessions]);
  const bestsBySession = useMemo(() => newBestsBySession(sessions), [sessions]);

  // Destructive actions take a second tap within a few seconds.
  const arm = (key, fn) => {
    clearTimeout(armTimer.current);
    if (armed === key) { setArmed(null); fn(); return; }
    haptic(8);
    setArmed(key);
    armTimer.current = setTimeout(() => setArmed(null), 3500);
  };

  const choosePlan = (p, { rewrite = false } = {}) => {
    gym.startPlan(p, { keepProgress: rewrite });
    haptic([12, 30, 12]);
    confetti({ count: 80 });
    setToast(rewrite
      ? { icon: "✏️", title: "Plan updated — your progress carries on", label: "GYM" }
      : { icon: "💪", title: `${p.name} is your plan`, label: "GYM" });
    setView("today");
  };

  const start = (w) => { haptic(12); onStartWorkout(program, w); };

  // --- the AI coach ---------------------------------------------------------
  const runAi = async (kind, call) => {
    if (aiBusy) return;
    if (!coach.apiKey) { setAiErr("nokey"); haptic(8); return; }
    haptic(8);
    setAiErr("");
    setAiBusy(kind);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const p = normalizeGymPlan(await call(ctrl.signal));
      if (!p) throw new Error("The plan came back unusable — try again.");
      setProgSheet({ program: p, mode: "proposal", rewrite: kind === "tweak" });
      haptic([10, 20, 10]);
    } catch (e) {
      if (e?.name !== "AbortError") { setAiErr(e.message || "Couldn't reach the coach."); haptic(8); }
    } finally {
      setAiBusy(null);
      abortRef.current = null;
    }
  };

  const buildPlan = () => {
    saveSettings({ ...loadSettings(), gymPrefs: prefs });
    runAi("build", (signal) => generateGymPlan({
      apiKey: coach.apiKey, model: coach.model, signal, summary: coach.getSummary(),
      prefs: {
        ...prefs,
        goal: (GOALS.find((g) => g.id === prefs.goal) || GOALS[1]).words,
        level: (LEVELS.find((l) => l.id === prefs.level) || LEVELS[0]).words,
      },
    }));
  };

  const tweakPlan = (text) => {
    const request = (text ?? tweak).trim();
    if (!request || !program) return;
    runAi("tweak", (signal) => tweakGymPlan({ apiKey: coach.apiKey, model: coach.model, program, request, summary: coach.getSummary(), signal }));
  };

  const coachThis = async (s) => {
    if (fbBusy) return;
    if (!coach.apiKey) { onNeedKey(); return; }
    haptic(8);
    setFbBusy(s.id);
    try {
      const text = await coachWorkout({
        apiKey: coach.apiKey, model: coach.model, summary: coach.getSummary(),
        workout: {
          date: s.date ? s.date.slice(0, 10) : null,
          workout: s.workoutName,
          plan: s.programName,
          minutes: Math.round((s.durMs || 0) / 60000),
          feel: s.feel || null,
          note: s.note || null,
          lifts: (s.exercises || []).map((e) => `${e.name}: ${setsText(e)}`),
          newBests: (bestsBySession.get(s.id) || []).map((b) => `${b.name} ${b.label} (was ${b.was})`),
        },
      });
      setFeedback((m) => ({ ...m, [s.id]: text }));
      haptic([10, 20, 10]);
    } catch (e) {
      setFeedback((m) => ({ ...m, [s.id]: `⚠️ ${e.message || "Couldn't reach the coach."}` }));
    } finally {
      setFbBusy(null);
    }
  };

  const askAbout = (ex) => onAskCoach(
    `Explain how to do ${ex.name} properly, as if I'm new to the gym: setup, the movement, breathing, the most common mistake, and how heavy I should start.`,
    `How do I do ${ex.name}?`,
  );

  const aiError = aiErr && (
    <div className="rise" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, padding: "11px 12px 11px 14px", borderRadius: 16, background: tint(aiErr === "nokey" ? C.purple : C.warn, 0.14) }}>
      <span className="t-foot" style={{ flex: 1, color: C.text }}>
        {aiErr === "nokey" ? "The AI coach needs your free Groq key — add it on the Coach tab, it takes a minute." : aiErr}
      </span>
      {aiErr === "nokey" && <button onClick={onNeedKey} className="btn" style={{ padding: "7px 14px", fontSize: 14, flexShrink: 0 }}>Add key</button>}
    </div>
  );

  const asks = gymAsks({ next, hasSessions: sessions.length > 0 });

  // --- views ----------------------------------------------------------------

  const activeCard = active && (() => {
    const all = active.items.flatMap((it) => it.sets);
    const n = all.filter((s) => s.done).length;
    return (
      <div className="card accented glow rise" style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="pill" style={{ background: C.yellow, color: C.onAccent }}>In progress</span>
          <span className="t-foot" style={{ color: C.dim }}>{Date.now() - active.startedAt < 60000 ? "just started" : `started ${fmtMins(Date.now() - active.startedAt)} ago`}</span>
        </div>
        <div className="t-title1" style={{ margin: "12px 0 4px" }}>{active.workoutName}</div>
        <div className="t-sub" style={{ color: C.dim }}>{n} of {all.length} sets done</div>
        <div style={{ margin: "14px 0 18px" }}><div className="bar" style={{ height: 8 }}><i style={{ width: `${(n / Math.max(1, all.length)) * 100}%` }} /></div></div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => { haptic(12); onResume(); }} className="cta tap"
            style={{ flex: 1.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 999, padding: "15px 0", fontSize: 17 }}>
            <Icon name="play" size={17} /> Resume
          </button>
          <button onClick={() => arm("discard", onDiscardActive)} className={`btn${armed === "discard" ? " danger" : ""}`} style={{ flex: 1, padding: "15px 0", fontSize: 16 }}>
            {armed === "discard" ? "Tap to discard" : "Discard"}
          </button>
        </div>
      </div>
    );
  })();

  const todayView = !program ? (
    <div className="rise">
      {activeCard}
      <div className="card accented" style={{ padding: "22px 20px 20px", marginBottom: 14, overflow: "hidden" }}>
        <div style={{
          position: "relative", display: "flex", justifyContent: "center", padding: "6px 0 2px",
          background: `radial-gradient(60% 70% at 50% 55%, ${tint(C.accent, 0.16)}, transparent 72%)`,
        }}>
          <BodyMap primary={["chest", "quads", "lats", "shoulders", "glutes"]} secondary={["abs", "biceps", "triceps", "hamstrings", "upperBack", "calves"]} height={150} labels={false} />
          <span style={{ position: "absolute", left: 0, top: 4, width: 46, height: 46, borderRadius: "50%", background: C.grad, color: C.onAccent, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: C.glow }}>
            <Icon name="dumbbell" size={26} weight={2.1} />
          </span>
        </div>
        <div className="t-title2" style={{ marginTop: 14 }}>Know exactly what to do at the gym</div>
        <div className="t-sub" style={{ color: C.dim, marginTop: 6 }}>
          Pick a plan and Stride walks you through every workout: which exercise, how to do it, how many sets and
          reps, how heavy to go, and how long to rest.
        </div>
        <button onClick={() => setProgSheet({ program: PROGRAMS[0], mode: "browse" })} className="cta tap"
          style={{ width: "100%", borderRadius: 999, padding: "15px 0", fontSize: 17, marginTop: 18 }}>
          See the beginner plan
        </button>
        <button onClick={() => setView("plans")} className="btn" style={{ width: "100%", padding: "14px 0", fontSize: 16, marginTop: 10 }}>
          Browse all plans
        </button>
      </div>

      <Group header="How it works">
        <Cell icon="list" iconColor={C.blue} title="Pick a plan" sub="Ready-made for beginners — or written for you by the AI coach" />
        <Cell icon="play" iconColor={C.good} title="Tap Start at the gym" sub="One exercise at a time, with how to do it" />
        <Cell icon="timer" iconColor={C.yellow} title="Do a set, tap done" sub="It times your rest and tells you when to go again" />
        <Cell icon="trophy" iconColor={C.orange} title="Get stronger" sub="It remembers your weights and says when to go heavier" />
      </Group>

      <Card className="glow" style={{ marginBottom: 26 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <IconBadge name="sparkles" color={C.purple} size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t-headline">Want one made just for you?</div>
            <div className="t-foot" style={{ color: C.dim }}>Five quick answers and your coach writes the plan.</div>
          </div>
        </div>
        <button onClick={() => setView("plans")} className="btn tinted" style={{ width: "100%", marginTop: 14, padding: "13px 0", fontSize: 16 }}>
          <Icon name="sparkles" size={16} /> Build my plan with AI
        </button>
      </Card>
    </div>
  ) : (
    <div className="rise">
      {activeCard}

      {planDone && !active && (
        <div className="card glow rise" style={{ padding: "20px 18px", marginBottom: 14, textAlign: "center" }}>
          <div style={{ fontSize: 40 }}>🏆</div>
          <div className="t-title2" style={{ marginTop: 6 }}>Plan complete</div>
          <div className="t-sub" style={{ color: C.dim, marginTop: 6 }}>
            You finished all {total} workouts of {program.name}. Keep going with it, pick a new plan, or let the coach write your next one.
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
            <button onClick={() => setView("plans")} className="cta tap" style={{ borderRadius: 999, padding: "12px 20px", fontSize: 16 }}>
              <Icon name="sparkles" size={15} /> Choose what's next
            </button>
          </div>
        </div>
      )}

      {!active && next && (
        <div className="card accented" style={{ padding: "18px 18px 16px", marginBottom: 14, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="pill" style={trainedToday ? { background: C.good, color: C.onAccent } : { background: C.accent, color: C.onAccent }}>
              {trainedToday ? "Done today" : "Next workout"}
            </span>
            <span className="t-foot" style={{ color: C.dim }}>{trainedToday ? "Next up · " : ""}Workout {Math.min(done.length + 1, total)} of {total}</span>
          </div>

          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="t-title1">{next.name}</div>
              <div className="t-sub" style={{ color: C.dim, marginTop: 2 }}>{next.focus}</div>
              <div className="meta-row" style={{ marginTop: 12 }}>
                <span className="meta"><Icon name="list" size={13} weight={2.2} />{next.exercises.length} exercises</span>
                <span className="meta"><Icon name="repeat" size={13} weight={2.2} />{workoutSets(next)} sets</span>
                <span className="meta" style={{ color: C.yellow }}><Icon name="clock" size={13} weight={2.2} />~{workoutMinutes(next)} min</span>
              </div>
            </div>
            {(() => { const m = workoutMuscles(next); return <BodyMap primary={m.primary} secondary={m.secondary} height={118} />; })()}
          </div>

          {trainedToday && (
            <div className="t-sub" style={{ color: C.dim, marginTop: 12 }}>
              Nice work today — muscles grow while you rest. Come back for this one {program.days >= 4 ? "tomorrow" : "after a rest day"}.
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            {next.exercises.map((t, i) => {
              const ex = EXERCISES[t.ex];
              return (
                <button key={i} className="gym-ex-row" onClick={() => { haptic(5); setExSheet(t.ex); }}>
                  <span className="gym-n num">{i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="t-body" style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ex.name}</span>
                    <span className="t-foot" style={{ color: C.dim }}>{targetLabel(t, ex)}</span>
                  </span>
                  {hintBadge(t, sessions)}
                  <span style={{ color: C.dim2, display: "flex" }}><Icon name="chevron" size={14} weight={2.4} /></span>
                </button>
              );
            })}
          </div>

          <button onClick={() => start(next)} className={trainedToday ? "btn" : "cta tap"}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 999, padding: "15px 0", fontSize: 17, marginTop: 14 }}>
            <Icon name="play" size={17} /> {trainedToday ? "Start anyway" : "Start workout"}
          </button>
          {last && !trainedToday && (
            <div className="t-foot" style={{ color: C.dim, marginTop: 12, textAlign: "center" }}>
              Last workout: {last.workoutName} · {ago(last.date)}
            </div>
          )}
        </div>
      )}

      <Group>
        <Cell icon="calendar" iconColor={C.orange} title="This week"
          sub={program.schedule ? `Try ${program.schedule}` : `${program.days} workouts a week`}
          value={<span className="num" style={{ color: C.text, fontWeight: 600 }}>{thisWeek} of {program.days}</span>}
          trailing={<Rings size={28} stroke={4.5} rings={[{ pct: (thisWeek / program.days) * 100, color: C.orange }]} label={`${thisWeek} of ${program.days} this week`} />} />
        <Cell icon={program.icon} iconColor={C[program.color] || C.accent} title={program.name}
          sub={`Week ${curWeek} of ${program.weeks} · ${done.length} of ${total} workouts`} chevron
          onClick={() => { haptic(5); setProgSheet({ program, mode: "browse" }); }} />
      </Group>

      <Group header="Workouts in this plan" footer="Tap one to see it — or to do it out of order if the gym is busy.">
        {program.workouts.map((w) => {
          const lastW = done.find((s) => s.workoutId === w.id);
          return (
            <Cell key={w.id} title={w.name} sub={`${w.focus} · ~${workoutMinutes(w)} min`}
              icon="dumbbell" iconColor={next && next.id === w.id ? C.accent : C.gray}
              value={lastW ? <span className="t-foot">{ago(lastW.date)}</span> : null} chevron
              onClick={() => { haptic(5); setWorkSheet(w); }} />
          );
        })}
      </Group>

      <Card style={{ marginBottom: 12 }}>
        <Label right={<span style={{ color: C.purple, display: "flex" }}><Icon name="sparkles" size={18} /></span>}>Ask your coach</Label>
        <div className="t-sub" style={{ color: C.dim, marginBottom: 12 }}>Anything about the gym — it can see your plan and what you've lifted.</div>
        <div className="hscroll" style={{ flexWrap: "wrap" }}>
          {asks.map((q) => (
            <button key={q.label} onClick={() => onAskCoach(q.text, q.label)} className="chip" style={{ flexShrink: 0 }}>{q.label}</button>
          ))}
        </div>
      </Card>

      <Card style={{ marginBottom: 26 }}>
        <Label>Change your plan</Label>
        <div className="t-sub" style={{ color: C.dim, marginBottom: 12 }}>
          Say what you'd like different. The coach rewrites the plan, and you see it before anything changes.
        </div>
        <div className="composer">
          <input value={tweak} onChange={(e) => setTweak(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") tweakPlan(); }}
            placeholder="e.g. I only have 30 minutes" disabled={!!aiBusy} aria-label="What should change about your plan" />
          <button onClick={() => tweakPlan()} disabled={!!aiBusy || !tweak.trim()} aria-label="Rewrite my plan" className="send">
            {aiBusy === "tweak" ? <span className="spin" style={{ width: 15, height: 15, borderRadius: "50%", border: `2px solid ${C.dim}`, borderTopColor: "transparent" }} /> : <Icon name="arrowUp" size={17} weight={2.6} />}
          </button>
        </div>
        <div className="hscroll" style={{ marginTop: 10 }}>
          {TWEAKS.map((t) => (
            <button key={t} onClick={() => { setTweak(t); tweakPlan(t); }} disabled={!!aiBusy} className="chip" style={{ flexShrink: 0 }}>{t}</button>
          ))}
        </div>
        {aiBusy === "tweak" && <div className="t-foot rise" style={{ color: C.dim, marginTop: 10 }}>Rewriting your plan…</div>}
        {aiError}
      </Card>

      <Group>
        <Cell icon="swap" iconColor={C.blue} title="Switch plan" chevron onClick={() => setView("plans")} />
        <Cell title={armed === "stop" ? "Tap again to stop this plan" : "Stop this plan"} danger
          sub={armed === "stop" ? "Your logged workouts are kept." : null}
          onClick={() => arm("stop", () => { gym.stopPlan(); setToast({ icon: "👋", title: "Plan stopped — your log is kept", label: "GYM" }); })}
          style={{ justifyContent: "center" }} />
      </Group>
    </div>
  );

  const plansView = (
    <div className="rise">
      <Card className="glow" style={{ marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <IconBadge name="sparkles" color={C.purple} size={36} />
          <span className="t-headline">Build a plan with AI</span>
        </div>
        <div className="t-sub" style={{ color: C.dim, marginBottom: 16 }}>Five quick answers and your coach writes a plan around you — you see it before it's used.</div>

        <div className="lab" style={{ marginBottom: 8 }}>Your goal</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {GOALS.map((g) => (
            <button key={g.id} onClick={() => { setPrefs((p) => ({ ...p, goal: g.id })); haptic(5); }}
              className={`chip${prefs.goal === g.id ? " on" : ""}`} aria-pressed={prefs.goal === g.id}>{g.label}</button>
          ))}
        </div>
        <div className="lab" style={{ marginBottom: 8 }}>Experience</div>
        <Segmented items={LEVELS.map((l) => ({ id: l.id, label: l.label }))} value={prefs.level} onChange={(v) => setPrefs((p) => ({ ...p, level: v }))} style={{ marginBottom: 16 }} />
        <div className="lab" style={{ marginBottom: 8 }}>Days a week</div>
        <Segmented items={[2, 3, 4, 5].map((n) => ({ id: n, label: `${n} days` }))} value={prefs.days} onChange={(v) => setPrefs((p) => ({ ...p, days: v }))} style={{ marginBottom: 16 }} />
        <div className="lab" style={{ marginBottom: 8 }}>Time per workout</div>
        <Segmented items={[30, 45, 60, 75].map((n) => ({ id: n, label: `${n} min` }))} value={prefs.minutes} onChange={(v) => setPrefs((p) => ({ ...p, minutes: v }))} style={{ marginBottom: 16 }} />
        <div className="lab" style={{ marginBottom: 8 }}>Equipment</div>
        <Segmented items={[{ id: "gym", label: "Full gym" }, { id: "dumbbells", label: "Dumbbells" }, { id: "none", label: "None" }]}
          value={prefs.equipment} onChange={(v) => setPrefs((p) => ({ ...p, equipment: v }))} style={{ marginBottom: 16 }} />
        <input className="inp" value={prefs.notes} onChange={(e) => setPrefs((p) => ({ ...p, notes: e.target.value }))}
          placeholder="Anything else? An injury, a favourite exercise…" aria-label="Anything else the coach should know" />
        <button onClick={buildPlan} disabled={!!aiBusy} className="cta tap"
          style={{ width: "100%", borderRadius: 999, padding: "15px 0", fontSize: 17, marginTop: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          {aiBusy === "build"
            ? <><span className="spin" style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${C.onAccent}`, borderTopColor: "transparent" }} /> Writing your plan…</>
            : <><Icon name="sparkles" size={17} /> Build my plan</>}
        </button>
        {aiError}
      </Card>

      <div className="t-title3" style={{ margin: "0 4px 4px" }}>Ready-made plans</div>
      <div className="t-foot" style={{ color: C.dim, margin: "0 4px 12px" }}>Tap one to see every workout before you start.</div>
      {program && program.custom && (
        <ProgramCard p={program} current onClick={() => setProgSheet({ program, mode: "browse" })} />
      )}
      {PROGRAMS.map((p, i) => (
        <ProgramCard key={p.id} p={p} delay={Math.min(i * 0.04, 0.24)} current={!!program && program.id === p.id}
          onClick={() => { haptic(5); setProgSheet({ program: p, mode: "browse" }); }} />
      ))}
    </div>
  );

  const q = norm(query.trim());
  const shownEx = exerciseList().filter((x) =>
    (groupFilter === "all" || groupOf(x).id === groupFilter)
    && (!q || norm(`${x.name} ${muscleNames(x, 9)} ${EQUIPMENT[x.equip].name} ${(x.aka || []).join(" ")}`).includes(q)));
  const exercisesView = (
    <div className="rise">
      <div className="search" style={{ marginBottom: 12 }}>
        <Icon name="search" size={17} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search exercises or muscles" aria-label="Search exercises" />
        {query && <button onClick={() => setQuery("")} className="close-btn" aria-label="Clear search" style={{ width: 22, height: 22, minHeight: 22 }}><Icon name="xmark" size={11} weight={3} /></button>}
      </div>
      <div className="hscroll" style={{ marginBottom: 18 }}>
        {[{ id: "all", name: "All" }, ...GROUPS].map((g) => (
          <button key={g.id} onClick={() => { setGroupFilter(g.id); haptic(5); }} className={`chip${groupFilter === g.id ? " on" : ""}`}
            aria-pressed={groupFilter === g.id} style={{ flexShrink: 0 }}>{g.name}</button>
        ))}
      </div>
      {shownEx.length === 0 && (
        <Card style={{ textAlign: "center", padding: 24 }}><div className="t-sub" style={{ color: C.dim }}>Nothing matches “{query}”.</div></Card>
      )}
      {GROUPS.map((g) => {
        const list = shownEx.filter((x) => groupOf(x).id === g.id);
        if (!list.length) return null;
        return (
          <Group key={g.id} header={g.name} right={<span style={{ textTransform: "none" }}>{list.length}</span>}>
            {list.map((x) => {
              const b = bests.get(x.id);
              return (
                <Cell key={x.id} icon={equipIcon(x)} iconColor={groupColor(x)} title={x.name}
                  sub={`${EQUIPMENT[x.equip].name} · ${muscleNames(x, 2)}`}
                  value={b ? <span className="num t-foot" style={{ color: C.dim }}>{setLabel(b.set, b.kind)}</span> : null}
                  chevron onClick={() => { haptic(5); setExSheet(x.id); }} />
              );
            })}
          </Group>
        );
      })}
    </div>
  );

  const vol = sessions.reduce((v, s) => v + sessionVolume(s), 0);
  const time = sessions.reduce((t, s) => t + (s.durMs || 0), 0);
  const topBests = [...bests.entries()].sort((a, b) => (b[1].date || "").localeCompare(a[1].date || "")).slice(0, 6);
  const logView = sessions.length === 0 ? (
    <div className="rise">
      <Card style={{ textAlign: "center", padding: "34px 20px" }}>
        <span style={{ width: 64, height: 64, borderRadius: "50%", background: tint(C.accent, 0.14), color: C.accent, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="dumbbell" size={32} weight={2} />
        </span>
        <div className="t-title3" style={{ marginTop: 14 }}>No workouts yet</div>
        <div className="t-sub" style={{ color: C.dim, marginTop: 6 }}>Finish a workout and it lands here, with every set you did and your best lifts.</div>
        <button onClick={() => setView(program ? "today" : "plans")} className="cta tap"
          style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 18, borderRadius: 999, padding: "13px 24px", fontSize: 17 }}>
          {program ? <><Icon name="play" size={16} /> Go to today's workout</> : "Pick a plan"}
        </button>
      </Card>
    </div>
  ) : (
    <div className="rise">
      <div style={{ display: "flex", gap: 10, marginBottom: 22 }}>
        <Tile label="Workouts" icon="dumbbell" color={C.accent} value={sessions.length} sub={`${thisWeek} this week`} />
        <Tile label="Lifted" icon="trophy" color={C.pink} value={tonnes(vol).value} unit={tonnes(vol).unit} delay={0.04} />
        <Tile label="Time" icon="clock" color={C.yellow} value={fmtMins(time)} delay={0.08} />
      </div>

      {topBests.length > 0 && (
        <Group header="Best sets">
          {topBests.map(([id, b]) => (
            <Cell key={id} icon="trophy" iconColor={C.yellow} title={b.name} sub={shortDate(b.date)}
              value={<span className="num" style={{ color: C.text, fontWeight: 600 }}>{setLabel(b.set, b.kind)}</span>}
              chevron={!!EXERCISES[id]} onClick={EXERCISES[id] ? () => setExSheet(id) : undefined} />
          ))}
        </Group>
      )}

      <div style={{ display: "grid", gap: 14 }}>
        {sessions.map((s, i) => (
          <SessionCard key={s.id} s={s} idx={i}
            bests={bestsBySession.get(s.id) || []}
            busy={fbBusy === s.id} feedback={feedback[s.id]} armed={armed === `del:${s.id}`}
            onCoach={() => coachThis(s)}
            onDelete={() => arm(`del:${s.id}`, () => { gym.deleteSession(s.id); haptic(10); })} />
        ))}
      </div>
    </div>
  );

  return (
    <div className="rise">
      <Screen eyebrow={eyebrow} title="Gym"
        sub={active ? `${active.workoutName} in progress`
          : program ? `${program.name} · week ${curWeek} of ${program.weeks}`
            : "Pick a plan to get started"}
        trailing={trailing} />

      <Segmented
        items={[{ id: "today", label: "Today" }, { id: "plans", label: "Plans" }, { id: "exercises", label: "Exercises" }, { id: "log", label: "Log" }]}
        value={view} onChange={setView} style={{ marginBottom: 18 }} />

      {view === "today" && todayView}
      {view === "plans" && plansView}
      {view === "exercises" && exercisesView}
      {view === "log" && logView}

      {progSheet && (
        <ProgramSheet program={progSheet.program} mode={progSheet.mode}
          current={!!program && progSheet.mode === "browse" && (program.id === progSheet.program.id)}
          onUse={(p) => choosePlan(p, { rewrite: !!progSheet.rewrite })}
          onExercise={(id) => setExSheet(id)}
          onClose={() => setProgSheet(null)} />
      )}
      {workSheet && (
        <WorkoutSheet workout={workSheet} sessions={sessions}
          onStart={(w) => start(w)}
          onExercise={(id) => setExSheet(id)}
          onClose={() => setWorkSheet(null)} />
      )}
      {exSheet && (
        <ExerciseSheet exId={exSheet} sessions={sessions}
          onAlt={(id) => { haptic(5); setExSheet(id); }}
          onAsk={askAbout}
          onClose={() => setExSheet(null)} />
      )}
    </div>
  );
}
