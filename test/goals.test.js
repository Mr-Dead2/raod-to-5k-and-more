import { describe, it, expect } from "vitest";
import {
  riegel, confidence, bestReference, predictAll, readiness, daysUntil, fmtDuration, raceById,
} from "../src/goals.js";

describe("riegel", () => {
  it("returns the same time for the same distance", () => {
    expect(riegel(1500, 5, 5)).toBeCloseTo(1500, 6);
  });

  it("scales up faster than linearly, because endurance decays", () => {
    // 25:00 for 5K → a 10K takes more than 50:00, not exactly double.
    const tenK = riegel(1500, 5, 10);
    expect(tenK).toBeGreaterThan(3000);
    expect(tenK).toBeLessThan(3200);
  });

  it("refuses nonsense rather than returning NaN", () => {
    for (const args of [[0, 5, 10], [1500, 0, 10], [1500, 5, 0], [-1, 5, 10], [NaN, 5, 10]]) {
      expect(riegel(...args)).toBe(0);
    }
  });
});

describe("confidence", () => {
  it("trusts a short extrapolation and doubts a long one", () => {
    expect(confidence(5, 5)).toBe("high");
    expect(confidence(5, 8)).toBe("high");
    expect(confidence(5, 10)).toBe("fair");
    expect(confidence(5, 42.195)).toBe("rough");
  });

  it("is more generous downward, but still bounded", () => {
    // Stepping down is safer than stepping up — the endurance is certainly
    // there — so 10K → 5K stays "high" where 5K → 10K is only "fair".
    expect(confidence(10, 5)).toBe("high");
    expect(confidence(5, 10)).toBe("fair");
    // But it must have a floor: a 1K predicted from a marathon is a guess,
    // not a fair estimate. This had no lower bound at all and graded every
    // downward extrapolation "fair", however absurd.
    expect(confidence(42.195, 1)).toBe("rough");
    expect(confidence(10, 1)).toBe("rough");
  });

  it("has no opinion without a reference", () => {
    expect(confidence(0, 10)).toBe("none");
  });
});

describe("bestReference", () => {
  it("picks the run with the best equivalent 5K, not the longest", () => {
    const ref = bestReference([
      { km: 10, sec: 4200 },  // 7:00/km
      { km: 5, sec: 1500 },   // 5:00/km — much better shape
    ]);
    expect(ref.km).toBe(5);
  });

  it("prefers the longer run when two are equally good", () => {
    // Same pace over 5 and 10 km: the 10 km extrapolates more honestly.
    const five = riegel(1, 1, 5) * 300;
    const ref = bestReference([
      { km: 5, sec: 5 * 300 },
      { km: 10, sec: riegel(5 * 300, 5, 10) },
    ]);
    expect(ref.km).toBe(10);
    expect(five).toBeGreaterThan(0);
  });

  it("ignores strolls, sprints and junk rows", () => {
    expect(bestReference([{ km: 0.5, sec: 200 }])).toBeNull();   // too short
    expect(bestReference([{ km: 5, sec: 30 }])).toBeNull();      // impossible
    expect(bestReference([{ km: "x", sec: "y" }])).toBeNull();
    expect(bestReference([])).toBeNull();
    expect(bestReference(null)).toBeNull();
  });
});

describe("predictAll", () => {
  it("covers the whole catalogue and grades each guess", () => {
    const rows = predictAll({ km: 5, sec: 1500 });
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.race.id)).toEqual(["1k", "5k", "10k", "half", "full"]);
    expect(rows.find((r) => r.race.id === "5k").confidence).toBe("high");
    expect(rows.find((r) => r.race.id === "full").confidence).toBe("rough");
    // Times must increase with distance.
    const secs = rows.map((r) => r.sec);
    expect([...secs].sort((a, b) => a - b)).toEqual(secs);
  });

  it("returns nothing without a reference performance", () => {
    expect(predictAll(null)).toEqual([]);
  });
});

describe("readiness", () => {
  it("wants the full distance up to 10K", () => {
    expect(readiness(10, 10)).toBe(100);
    expect(readiness(5, 10)).toBe(50);
  });

  it("wants 80% of anything longer", () => {
    // A half is 21.0975 km; 80% is ~16.9, so that should read as ready.
    expect(readiness(21.0975 * 0.8, 21.0975)).toBe(100);
    expect(readiness(21.0975 * 0.4, 21.0975)).toBe(50);
  });

  it("clamps rather than exceeding 100 or going negative", () => {
    expect(readiness(50, 5)).toBe(100);
    expect(readiness(-5, 5)).toBe(0);
    expect(readiness(undefined, 5)).toBe(0);
    expect(readiness(5, 0)).toBe(0);
  });
});

describe("daysUntil", () => {
  const iso = (offsetDays) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offsetDays);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  it("counts forward, backward and today", () => {
    expect(daysUntil(iso(0))).toBe(0);
    expect(daysUntil(iso(7))).toBe(7);
    expect(daysUntil(iso(-3))).toBe(-3);
  });

  it("has no answer for a missing or unparseable date", () => {
    expect(daysUntil("")).toBeNull();
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil("not-a-date")).toBeNull();
  });
});

describe("fmtDuration", () => {
  it("drops the hour until there is one", () => {
    expect(fmtDuration(59)).toBe("0:59");
    expect(fmtDuration(1500)).toBe("25:00");
    expect(fmtDuration(3600)).toBe("1:00:00");
    expect(fmtDuration(4055)).toBe("1:07:35");
  });

  it("shows a dash rather than 0:00 for no time", () => {
    expect(fmtDuration(0)).toBe("—");
    expect(fmtDuration(-5)).toBe("—");
  });
});

describe("raceById", () => {
  it("finds a race and returns null for an unknown id", () => {
    expect(raceById("10k").km).toBe(10);
    expect(raceById("ultra")).toBeNull();
  });
});
