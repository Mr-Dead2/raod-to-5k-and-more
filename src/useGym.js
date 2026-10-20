// The gym's state: logged workouts, the chosen plan and the workout in
// progress. A hook rather than more App state so App only wires it up; the
// arithmetic lives in gym.js.
import { useMemo, useState } from "react";
import { loadSettings, saveSettings, loadGym, saveGym, loadActiveWorkout, saveActiveWorkout } from "./storage.js";
import { programById, normalizeGymPlan, sortSessions } from "./gym.js";

// Settings key `gymPlan`: { id, startedAt } for a ready-made plan, plus the
// whole `program` for one the coach wrote. A stored AI plan is re-validated on
// the way in, so a hand-edited or half-written one can't break the tab.
const resolve = (plan) => {
  if (!plan || !plan.id) return null;
  return plan.id === "custom" ? normalizeGymPlan(plan.program) : programById(plan.id);
};

export function useGym() {
  const [log, setLog] = useState(() => sortSessions(loadGym()));
  const [plan, setPlan] = useState(() => loadSettings().gymPlan || null);
  const [active, setActiveState] = useState(loadActiveWorkout);
  const program = useMemo(() => resolve(plan), [plan]);

  const persistPlan = (next) => {
    setPlan(next);
    saveSettings({ ...loadSettings(), gymPlan: next });
  };

  // Logged workouts stay where they are whichever plan is chosen; a plan only
  // decides what comes next and how far through it you are. A rewrite of the
  // current plan (`keepProgress`) keeps its start and its place in the rotation.
  const startPlan = (p, { keepProgress = false } = {}) => {
    const prev = keepProgress ? plan : null;
    persistPlan({
      id: p.id,
      startedAt: (prev && prev.startedAt) || new Date().toISOString(),
      ...(prev && (prev.basedOn || prev.id !== p.id) ? { basedOn: prev.basedOn || prev.id } : null),
      ...(p.custom ? { program: p } : null),
    });
  };
  const stopPlan = () => persistPlan(null);
  const restorePlan = (p) => { if (p && p.id) persistPlan(p); };

  const saveSession = (s) => setLog((prev) => {
    const next = sortSessions([s, ...prev.filter((x) => x.id !== s.id)]);
    saveGym(next);
    return next;
  });
  const deleteSession = (id) => setLog((prev) => {
    const next = prev.filter((x) => x.id !== id);
    saveGym(next);
    return next;
  });
  // Backup import: merge by id, the backup's copy wins — nothing is wiped.
  const mergeSessions = (list) => {
    const incoming = (Array.isArray(list) ? list : []).filter((s) => s && typeof s === "object" && s.id && Array.isArray(s.exercises));
    if (!incoming.length) return 0;
    setLog((prev) => {
      const byId = new Map(prev.map((s) => [s.id, s]));
      for (const s of incoming) byId.set(s.id, s);
      const next = sortSessions([...byId.values()]);
      saveGym(next);
      return next;
    });
    return incoming.length;
  };

  const setActive = (d) => { setActiveState(d); saveActiveWorkout(d); };

  return { log, plan, program, active, startPlan, stopPlan, restorePlan, saveSession, deleteSession, mergeSessions, setActive };
}
