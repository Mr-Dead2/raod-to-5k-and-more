import { describe, it, expect } from "vitest";
import {
  EXERCISE_TYPES, exerciseKind, isRunLike, isWalkLike, exerciseName,
  workoutToEntry, chooseDayKey, planImport,
} from "../src/health.js";

const RUN = 56, TREADMILL = 57, WALK = 79, HIKE = 37, BIKE = 13;

const flat = Array.from({ length: 14 }, (_, i) => ({
  key: `w${Math.floor(i / 7) + 1}d${i % 7}`,
  d: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"][i % 7],
}));

const at = (dayOffset, hour = 8) => {
  const d = new Date("2026-03-02T00:00:00");   // a Monday
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
};

const workout = (over = {}) => ({
  id: "hc-1",
  exerciseType: RUN,
  startTime: at(0),
  endTime: at(0) + 30 * 60000,
  distanceM: 5000,
  ...over,
});

describe("exercise classification", () => {
  it("counts only foot-borne activity, and separates running from walking", () => {
    expect(isRunLike(RUN)).toBe(true);
    expect(isRunLike(TREADMILL)).toBe(true);
    expect(isWalkLike(WALK)).toBe(true);
    expect(isWalkLike(HIKE)).toBe(true);
    // A ride logged as "24 km" would wreck every pace figure.
    expect(isRunLike(BIKE)).toBe(false);
    expect(isWalkLike(BIKE)).toBe(false);
    expect(exerciseKind(BIKE)).toBeNull();
  });

  it("never treats a walk as a run", () => {
    expect(isRunLike(WALK)).toBe(false);
    expect(isRunLike(HIKE)).toBe(false);
  });

  it("has no opinion about a type it has never heard of", () => {
    expect(exerciseKind(9999)).toBeNull();
    expect(exerciseKind(undefined)).toBeNull();
  });

  it("every catalogued type declares a kind", () => {
    for (const [id, def] of Object.entries(EXERCISE_TYPES)) {
      expect(def, `type ${id}`).toHaveProperty("kind");
      expect([null, "run", "walk"]).toContain(def.kind);
    }
  });

  it("prefers the watch's own title over the generic name", () => {
    expect(exerciseName(RUN, "Morning jog")).toBe("Morning jog");
    expect(exerciseName(RUN, "")).toBe("Running");
    expect(exerciseName(9999, "")).toBe("Workout");
  });
});

describe("workoutToEntry", () => {
  it("maps distance and duration, and tags what it was", () => {
    const e = workoutToEntry(workout());
    expect(e.km).toBe(5);
    expect(e.min).toBe(30);
    expect(e.done).toBe(true);
    expect(e.imported).toBe(true);
    expect(e.activity).toBe("run");
    expect(e.hcId).toBe("hc-1");
  });

  it("tags a walk as a walk, so running stats can exclude it", () => {
    expect(workoutToEntry(workout({ exerciseType: WALK })).activity).toBe("walk");
  });

  it("leaves metrics the watch did not record absent, not zero", () => {
    const e = workoutToEntry(workout());
    for (const k of ["kcal", "hrAvg", "hrMax", "steps"]) {
      expect(e, `${k} should be absent`).not.toHaveProperty(k);
    }
  });

  it("carries the metrics it does have", () => {
    const e = workoutToEntry(workout({ kcal: 310.4, hrAvg: 151.6, hrMax: 172.2, steps: 6100 }));
    expect(e).toMatchObject({ kcal: 310, hrAvg: 152, hrMax: 172, steps: 6100 });
  });

  it("handles a workout with no distance", () => {
    expect(workoutToEntry(workout({ distanceM: 0 })).km).toBe(0);
  });
});

describe("chooseDayKey", () => {
  const startDate = "2026-03-02";

  it("puts a run on the calendar day it happened", () => {
    // Day 3 of the block → w1d3.
    expect(chooseDayKey(workout({ startTime: at(3) }), { flat, log: {}, startDate })).toBe("w1d3");
  });

  it("falls through to the first free day when that one is taken", () => {
    const log = { w1d3: { done: true } };
    expect(chooseDayKey(workout({ startTime: at(3) }), { flat, log, startDate })).toBe("w1d0");
  });

  it("does not stack a whole backlog onto one key", () => {
    const taken = new Set(["w1d0"]);
    expect(chooseDayKey(workout({ startTime: at(3) }), { flat, log: { w1d3: { done: true } }, startDate, taken }))
      .toBe("w1d1");
  });

  it("uses the first unfinished day when there is no start date", () => {
    expect(chooseDayKey(workout(), { flat, log: { w1d0: { done: true } }, startDate: "" })).toBe("w1d1");
  });

  it("ignores a run from before the block started", () => {
    expect(chooseDayKey(workout({ startTime: at(-5) }), { flat, log: {}, startDate })).toBe("w1d0");
  });

  it("returns null when the plan is full", () => {
    const log = Object.fromEntries(flat.map((f) => [f.key, { done: true }]));
    expect(chooseDayKey(workout(), { flat, log, startDate })).toBeNull();
  });
});

describe("planImport", () => {
  const base = { flat, log: {}, startDate: "2026-03-02" };

  it("imports runs and explains every skip", () => {
    const res = planImport([
      workout({ id: "a", exerciseType: RUN }),
      workout({ id: "b", exerciseType: BIKE, startTime: at(1), endTime: at(1) + 3600000 }),
    ], base);
    expect(res.ready.map((r) => r.w.id)).toEqual(["a"]);
    expect(res.skipped).toHaveLength(1);
    expect(res.skipped[0].w.id).toBe("b");
    expect(res.skipped[0].reason).toBeTruthy();
  });

  it("leaves walks out by default — the watch logs those on its own", () => {
    const res = planImport([workout({ exerciseType: WALK })], base);
    expect(res.ready).toHaveLength(0);
    expect(res.skipped[0].reason).toMatch(/walk/i);
  });

  it("takes walks when asked, and still labels them walks", () => {
    const res = planImport([workout({ exerciseType: WALK })], { ...base, includeWalks: true });
    expect(res.ready).toHaveLength(1);
    expect(res.ready[0].kind).toBe("walk");
    expect(res.ready[0].entry.activity).toBe("walk");
  });

  it("never imports the same workout twice", () => {
    const log = { w1d5: { hcId: "hc-dup", done: true } };
    const res = planImport([workout({ id: "hc-dup" })], { ...base, log });
    expect(res.ready).toHaveLength(0);
    expect(res.skipped[0].reason).toMatch(/already/i);
  });

  it("skips a run Stride tracked itself", () => {
    // Same outing seen twice: once by GPS, once via the watch.
    const log = { w1d0: { tracked: true, done: true, date: new Date(at(0) + 60000).toISOString() } };
    const res = planImport([workout()], { ...base, log });
    expect(res.ready).toHaveLength(0);
    expect(res.skipped[0].reason).toMatch(/stride|tracked/i);
  });

  it("keeps a genuinely separate run later the same day", () => {
    const log = { w1d0: { tracked: true, done: true, date: new Date(at(0)).toISOString() } };
    const res = planImport([workout({ id: "pm", startTime: at(0, 18), endTime: at(0, 18) + 1800000 })],
      { ...base, log });
    expect(res.ready).toHaveLength(1);
  });

  it("drops detection artefacts that are too short", () => {
    const res = planImport([
      workout({ id: "blip", startTime: at(2), endTime: at(2) + 60000, distanceM: 120 }),
    ], base);
    expect(res.ready).toHaveLength(0);
    expect(res.skipped).toHaveLength(1);
  });

  it("copes with an empty feed", () => {
    const res = planImport([], base);
    expect(res).toEqual({ ready: [], skipped: [] });
  });
});
