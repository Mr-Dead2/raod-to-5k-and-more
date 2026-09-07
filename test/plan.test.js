import { describe, it, expect } from "vitest";
import {
  normalizeWeeks, weeksFromModelJson, maxWeekN, extendPlan, planSplit, adaptedPlan,
} from "../src/plan.js";
import { DEFAULT_WEEKS } from "../src/data.js";

const week = (days) => ({ label: "Test week", days });
const day = (over = {}) => ({ d: "MON", type: "run", title: "5 km", detail: "Steady", km: 5, ...over });

describe("normalizeWeeks", () => {
  it("labels days by their slot, not by whatever the model claimed", () => {
    // A reply with repeated or reordered labels must still render as a week.
    const [w] = normalizeWeeks([week([
      day({ d: "SUN" }), day({ d: "SUN" }), day({ d: "MON" }),
      day(), day(), day(), day(),
    ])]);
    expect(w.days.map((d) => d.d)).toEqual(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);
  });

  it("always produces seven days, padding short weeks with rest", () => {
    const [w] = normalizeWeeks([week([day(), day()])]);
    expect(w.days).toHaveLength(7);
    expect(w.days.slice(2).every((d) => d.type === "rest" && d.km === 0)).toBe(true);
    expect(w.days.map((d) => d.d)).toEqual(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);
  });

  it("truncates a week the model padded out", () => {
    const [w] = normalizeWeeks([week(Array.from({ length: 12 }, () => day()))]);
    expect(w.days).toHaveLength(7);
  });

  it("caps the block so a runaway reply cannot bloat the plan", () => {
    const many = Array.from({ length: 40 }, () => week([day()]));
    expect(normalizeWeeks(many)).toHaveLength(8);
    expect(normalizeWeeks(many, 1, 3)).toHaveLength(3);
  });

  it("numbers weeks sequentially from the given start", () => {
    expect(normalizeWeeks([week([]), week([])], 5).map((w) => w.n)).toEqual([5, 6]);
  });

  it("coerces a hostile day into something the app can render", () => {
    const [w] = normalizeWeeks([week([{ d: "funday", type: "sprint", km: -4, title: "", detail: 42 }])]);
    const d = w.days[0];
    expect(d.d).toBe("MON");                 // unknown day → its slot
    expect(["run", "easy", "rest"]).toContain(d.type);
    expect(d.km).toBe(0);                    // negative distance clamped
    expect(typeof d.title).toBe("string");
    expect(d.title.length).toBeGreaterThan(0);
    expect(typeof d.detail).toBe("string");
  });

  it("clamps an absurd distance instead of trusting it", () => {
    const [w] = normalizeWeeks([week([day({ km: 5000 })])]);
    expect(w.days[0].km).toBe(60);
  });

  it("infers the type from distance when it is missing", () => {
    const [w] = normalizeWeeks([week([{ d: "MON", km: 8 }, { d: "TUE", km: 0 }])]);
    expect(w.days[0].type).toBe("run");
    expect(w.days[1].type).toBe("rest");
  });

  it("returns nothing for a non-array", () => {
    expect(normalizeWeeks(null)).toEqual([]);
    expect(normalizeWeeks("weeks")).toEqual([]);
    expect(normalizeWeeks(undefined)).toEqual([]);
  });

  it("keeps titles and details short enough to render", () => {
    const [w] = normalizeWeeks([week([day({ title: "x".repeat(500), detail: "y".repeat(500) })])]);
    expect(w.days[0].title.length).toBeLessThanOrEqual(60);
    expect(w.days[0].detail.length).toBeLessThanOrEqual(120);
  });
});

describe("weeksFromModelJson", () => {
  it("accepts the shapes a model actually returns", () => {
    expect(weeksFromModelJson([1, 2])).toEqual([1, 2]);
    expect(weeksFromModelJson({ weeks: [1] })).toEqual([1]);
    expect(weeksFromModelJson({ plan: [2] })).toEqual([2]);
    expect(weeksFromModelJson({ nope: [3] })).toEqual([]);
    expect(weeksFromModelJson(null)).toEqual([]);
  });
});

describe("extendPlan", () => {
  it("appends with continued numbering, so progress keys stay unique", () => {
    const out = extendPlan(DEFAULT_WEEKS, { weeks: [week([day()]), week([day()])] });
    expect(out).toHaveLength(DEFAULT_WEEKS.length + 2);
    expect(out.map((w) => w.n)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("leaves the existing weeks untouched", () => {
    const out = extendPlan(DEFAULT_WEEKS, { weeks: [week([day()])] });
    expect(out.slice(0, DEFAULT_WEEKS.length)).toEqual(DEFAULT_WEEKS);
  });

  it("falls back to the default plan when given nothing to extend", () => {
    expect(extendPlan([], { weeks: [week([day()])] })).toHaveLength(DEFAULT_WEEKS.length + 1);
  });

  it("returns null rather than a broken plan when the reply is unusable", () => {
    expect(extendPlan(DEFAULT_WEEKS, { weeks: [] })).toBeNull();
    expect(extendPlan(DEFAULT_WEEKS, "sorry, I can't do that")).toBeNull();
  });
});

describe("maxWeekN", () => {
  it("finds the highest week number, and copes with missing ones", () => {
    expect(maxWeekN([{ n: 2 }, { n: 7 }, { n: 5 }])).toBe(7);
    expect(maxWeekN([{}, { n: 3 }])).toBe(3);
    expect(maxWeekN([])).toBe(0);
  });
});

describe("planSplit", () => {
  const weeks = [1, 2, 3, 4].map((n) => ({ n, days: Array.from({ length: 7 }, () => day()) }));

  it("locks every week up to and including the last one started", () => {
    const { locked, future } = planSplit(weeks, { w2d3: { done: true } });
    expect(locked.map((w) => w.n)).toEqual([1, 2]);
    expect(future.map((w) => w.n)).toEqual([3, 4]);
  });

  it("treats an untouched plan as all future", () => {
    const { locked, future } = planSplit(weeks, {});
    expect(locked).toHaveLength(0);
    expect(future).toHaveLength(4);
  });

  it("leaves nothing to adapt once the last week is started", () => {
    const { future } = planSplit(weeks, { w4d0: { done: true } });
    expect(future).toHaveLength(0);
  });

  it("ignores a logged-but-not-done day", () => {
    // Typing a distance without ticking the day should not lock the week.
    const { locked } = planSplit(weeks, { w2d3: { km: 5 } });
    expect(locked).toHaveLength(0);
  });
});

describe("adaptedPlan", () => {
  const weeks = [1, 2, 3].map((n) => ({ n, label: `W${n}`, days: Array.from({ length: 7 }, () => day()) }));

  it("rewrites only the weeks not yet started", () => {
    const res = adaptedPlan(weeks, { w1d0: { done: true } }, { weeks: [week([day({ km: 9 })])] });
    expect(res.fromIdx).toBe(1);
    expect(res.weeks[0]).toEqual(weeks[0]);          // started week untouched
    expect(res.weeks).toHaveLength(2);               // W1 kept + one adjusted
    expect(res.weeks[1].n).toBe(2);                  // numbering continues
    expect(res.weeks[1].days[0].km).toBe(9);
  });

  it("numbers a fully-rewritten plan from week 1", () => {
    const res = adaptedPlan(weeks, {}, { weeks: [week([day()])] });
    expect(res.fromIdx).toBe(0);
    expect(res.weeks[0].n).toBe(1);
  });

  it("refuses when there is nothing left to adapt", () => {
    expect(adaptedPlan(weeks, { w3d0: { done: true } }, { weeks: [week([day()])] })).toBeNull();
  });

  it("refuses an unusable reply rather than wiping the future", () => {
    expect(adaptedPlan(weeks, {}, { weeks: [] })).toBeNull();
    expect(adaptedPlan(weeks, {}, null)).toBeNull();
  });
});
