// ---------------------------------------------------------------------------
// Pieces shared by the Gym tab and the workout player: how an exercise is
// explained, how one is listed, and the sheet that says everything about one.
// Module scope, like every other component that might wrap an input.
// ---------------------------------------------------------------------------
import React from "react";
import { C, tint, FEELS } from "../data.js";
import { Icon, IconBadge, Cell, Group, MetricGrid } from "./ui.jsx";
import { Sheet } from "./Sheet.jsx";
import { BodyMap } from "./BodyMap.jsx";
import { fmtClock } from "../share.js";
import {
  EXERCISES, EQUIPMENT, MUSCLES, groupOf, muscleNames, targetLabel, restLabel,
  lastPerformance, personalBests, setsText, setLabel, sessionVolume, sessionSets,
} from "../gym.js";

export const groupColor = (ex) => C[groupOf(ex).color] || C.accent;
export const equipIcon = (ex) => (EQUIPMENT[ex && ex.equip] || EQUIPMENT.bodyweight).icon;

export const shortDate = (iso) => (iso
  ? new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
  : "—");

const longDate = (iso) => (iso
  ? new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })
  : "—");

// "today", "yesterday", "3 days ago", then the date.
export function ago(iso, now = new Date()) {
  if (!iso) return "";
  const a = new Date(iso); a.setHours(0, 0, 0, 0);
  const b = new Date(now); b.setHours(0, 0, 0, 0);
  const d = Math.round((b - a) / 86400000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// The numbered steps and the one tip that matters most.
export function HowTo({ ex }) {
  return (
    <>
      <ol className="steps">
        {ex.steps.map((s, i) => <li key={i}><b>{i + 1}</b><span>{s}</span></li>)}
      </ol>
      {ex.tip && (
        <div className="tip" style={{ marginTop: 14 }}>
          <span><Icon name="bulb" size={18} /></span>
          <span>{ex.tip}</span>
        </div>
      )}
    </>
  );
}

// One exercise of a workout, as a settings-style row.
export function ExerciseCell({ t, onClick, value }) {
  const ex = EXERCISES[t.ex];
  if (!ex) return null;
  return (
    <Cell icon={equipIcon(ex)} iconColor={groupColor(ex)} title={ex.name}
      sub={`${targetLabel(t, ex)} · ${restLabel(t.rest || 90)}`} value={value} chevron={!!onClick} onClick={onClick} />
  );
}

export function MuscleChips({ ex }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {ex.primary.map((m) => (
        <span key={m} className="meta" style={{ background: tint(C.accent, 0.16), color: C.accent }}>{MUSCLES[m]}</span>
      ))}
      {ex.secondary.map((m) => <span key={m} className="meta">{MUSCLES[m]}</span>)}
    </div>
  );
}

// Everything about one exercise: what it works, how to do it, what you've done
// on it, and what to do instead when it isn't possible.
export function ExerciseSheet({ exId, sessions, onAlt, onAsk, onClose }) {
  const ex = EXERCISES[exId];
  if (!ex) return null;
  const last = lastPerformance(ex.id, sessions);
  const best = personalBests(sessions).get(ex.id);
  return (
    <Sheet title={ex.name} sub={`${groupOf(ex).name} · ${EQUIPMENT[ex.equip].name}${ex.perSide ? " · each side" : ""}`} onClose={onClose}>
      <div key={ex.id} className="rise">
        <div style={{
          display: "flex", justifyContent: "center", padding: "12px 0 10px", marginBottom: 14, borderRadius: 22,
          background: `radial-gradient(80% 70% at 50% 40%, ${tint(C.accent, 0.1)}, transparent 70%), var(--fill4)`,
        }}>
          <BodyMap primary={ex.primary} secondary={ex.secondary} height={196} />
        </div>
        <MuscleChips ex={ex} />

        <div className="t-title3" style={{ margin: "22px 0 12px" }}>How to do it</div>
        <HowTo ex={ex} />

        {(last || best) && (
          <Group header="Your numbers" style={{ marginTop: 24, marginBottom: 0 }}>
            {best && <Cell icon="trophy" iconColor={C.yellow} title="Best set" sub={shortDate(best.date)}
              value={<span className="num" style={{ color: C.text, fontWeight: 600 }}>{setLabel(best.set, best.kind)}</span>} />}
            {last && <Cell icon="clock" iconColor={C.blue} title="Last time" sub={shortDate(last.date)}
              value={<span className="num" style={{ color: C.text, fontWeight: 600 }}>{setsText({ kind: ex.kind, sets: last.sets })}</span>} />}
          </Group>
        )}

        {ex.alts.length > 0 && (
          <Group header="Can't do it? Try instead" style={{ marginTop: 24, marginBottom: 0 }}>
            {ex.alts.filter((a) => EXERCISES[a]).map((a) => {
              const alt = EXERCISES[a];
              return <Cell key={a} icon={equipIcon(alt)} iconColor={groupColor(alt)} title={alt.name}
                sub={`${EQUIPMENT[alt.equip].name} · ${muscleNames(alt, 2)}`} chevron onClick={() => onAlt(a)} />;
            })}
          </Group>
        )}

        {onAsk && (
          <button onClick={() => onAsk(ex)} className="btn tinted" style={{ width: "100%", marginTop: 22, padding: "13px 0", fontSize: 16 }}>
            <Icon name="sparkles" size={17} /> Ask the coach about this
          </button>
        )}
      </div>
    </Sheet>
  );
}

// One logged gym workout, laid out the way History lays out a run: what it
// was, the weight moved as the big number (sets, for a bodyweight session),
// time and sets in their metric colours, every exercise, any new bests — and
// only the actions the caller hands in. Deleting sits in the header, away from
// the everyday buttons, and takes a second tap.
export function GymSessionCard({ s, bests = [], idx = 0, tagged, onShare, onCoach, coachBusy, feedback, onDelete, armed }) {
  const vol = sessionVolume(s);
  const sets = sessionSets(s);
  const reps = (s.exercises || []).reduce((n, e) => n + (e.sets || []).reduce((m, x) => m + (Number(x.reps) || 0), 0), 0);
  const lifted = vol > 0;
  return (
    <div className="card" style={{ padding: "14px 16px 16px", animation: "rise .34s cubic-bezier(.2,.8,.2,1) both", animationDelay: `${Math.min(idx * 0.04, 0.3)}s` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: tint(C.accent, 0.16), color: C.accent }}>
          <Icon name="dumbbell" size={22} weight={2} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t-headline" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.workoutName}</div>
          <div className="t-foot" style={{ color: C.dim, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span>{longDate(s.date)}{s.programName ? ` · ${s.programName}` : ""}</span>
            {tagged && <span className="tag" style={{ color: C.accent, background: tint(C.accent, 0.14) }}>Gym</span>}
          </div>
        </div>
        {s.feel ? <span style={{ fontSize: 24, flexShrink: 0 }} aria-label={`Felt ${s.feel} of 5`}>{FEELS[s.feel - 1]}</span> : null}
        {onDelete && (
          <button onClick={onDelete} className={armed ? "btn danger" : "close-btn"}
            style={armed ? { padding: "6px 12px", fontSize: 14, minHeight: 0, flexShrink: 0 } : { width: 32, height: 32, minHeight: 32 }}
            aria-label={armed ? "Tap again to delete this workout" : "Delete this workout"}>
            {armed ? "Delete" : <Icon name="trash" size={15} weight={2.2} />}
          </button>
        )}
      </div>

      <div className="num" style={{ fontSize: 40, fontWeight: 700, lineHeight: 1, color: C.accent, margin: "14px 0 2px" }}>
        {lifted ? Math.round(vol).toLocaleString() : sets}
        <span style={{ fontSize: 20, marginLeft: 3 }}>{lifted ? "KG" : sets === 1 ? "SET" : "SETS"}</span>
      </div>

      <MetricGrid cols={3} size={24} items={[
        { label: "Time", value: fmtClock(s.durMs || 0), color: C.yellow },
        lifted ? { label: "Sets", value: sets } : { label: "Reps", value: reps || "—" },
        { label: "Exercises", value: (s.exercises || []).length },
      ]} />

      <div>
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

      {(onShare || onCoach) && (
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          {onShare && (
            <button onClick={onShare} className="btn tinted" style={{ flex: 1, padding: "11px 0" }}>
              <Icon name="share" size={17} /> Share
            </button>
          )}
          {onCoach && (
            <button onClick={onCoach} disabled={coachBusy} className="btn" style={{ flex: 1.4, padding: "11px 0", whiteSpace: "nowrap" }}>
              <Icon name="sparkles" size={16} />
              {coachBusy ? "Reading…" : feedback ? "Ask again" : "Coach this workout"}
            </button>
          )}
        </div>
      )}
      {feedback && <div className="rise bubble them" style={{ marginTop: 12, maxWidth: "100%" }}>{feedback}</div>}
    </div>
  );
}
