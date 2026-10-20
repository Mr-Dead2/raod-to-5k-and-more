// ---------------------------------------------------------------------------
// Pieces shared by the Gym tab and the workout player: how an exercise is
// explained, how one is listed, and the sheet that says everything about one.
// Module scope, like every other component that might wrap an input.
// ---------------------------------------------------------------------------
import React from "react";
import { C, tint } from "../data.js";
import { Icon, IconBadge, Cell, Group } from "./ui.jsx";
import { Sheet } from "./Sheet.jsx";
import { BodyMap } from "./BodyMap.jsx";
import {
  EXERCISES, EQUIPMENT, MUSCLES, groupOf, muscleNames, targetLabel, restLabel,
  lastPerformance, personalBests, setsText, setLabel,
} from "../gym.js";

export const groupColor = (ex) => C[groupOf(ex).color] || C.accent;
export const equipIcon = (ex) => (EQUIPMENT[ex && ex.equip] || EQUIPMENT.bodyweight).icon;

export const shortDate = (iso) => (iso
  ? new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
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
