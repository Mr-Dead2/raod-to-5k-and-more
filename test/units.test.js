import { describe, it, expect, afterEach } from "vitest";
import {
  U, UNITS, setUnit, isMiles, KM_PER_MILE,
  toDisplay, fromDisplay, paceToDisplay, speedToDisplay,
  fmtDist, fmtDistNum, fmtPace, fmtPaceUnit, fmtElev, fmtWeight, speedLabel, splitLabel,
} from "../src/units.js";

afterEach(() => setUnit("km"));

describe("setUnit", () => {
  it("switches and falls back to km for anything unknown", () => {
    expect(setUnit("mi")).toBe("mi");
    expect(isMiles()).toBe(true);
    expect(setUnit("furlongs")).toBe("km");
    expect(isMiles()).toBe(false);
    expect(U.short).toBe("km");
  });

  it("keeps the U object in step with the chosen unit", () => {
    setUnit("mi");
    expect(U).toMatchObject({ id: "mi", short: "mi" });
    expect(U.paceLabel).toMatch(/mile/);
  });

  it("offers exactly the two units the app supports", () => {
    expect(UNITS.map((u) => u.id)).toEqual(["km", "mi"]);
  });
});

describe("distance conversion", () => {
  it("is the identity in km", () => {
    expect(toDisplay(5)).toBe(5);
    expect(fromDisplay(5)).toBe(5);
  });

  it("converts to and from miles", () => {
    setUnit("mi");
    expect(toDisplay(KM_PER_MILE)).toBeCloseTo(1, 10);
    expect(fromDisplay(1)).toBeCloseTo(KM_PER_MILE, 10);
  });

  it("round-trips without drift, so editing a distance cannot corrupt it", () => {
    setUnit("mi");
    for (const km of [0.1, 3, 5, 12.4, 42.195]) {
      expect(fromDisplay(toDisplay(km))).toBeCloseTo(km, 9);
    }
  });

  it("treats junk as zero rather than NaN", () => {
    for (const v of [undefined, null, "", "abc", NaN]) {
      expect(toDisplay(v)).toBe(0);
      expect(fromDisplay(v)).toBe(0);
    }
  });

  it("accepts a numeric string, which is what an input gives you", () => {
    expect(toDisplay("5.25")).toBe(5.25);
    setUnit("mi");
    expect(fromDisplay("3.1")).toBeCloseTo(3.1 * KM_PER_MILE, 9);
  });
});

describe("pace conversion", () => {
  it("is the identity in km", () => {
    expect(paceToDisplay(300)).toBe(300);
  });

  it("makes a per-mile pace slower than the per-km one", () => {
    setUnit("mi");
    // 5:00/km is about 8:03/mile — a bigger number, because a mile is longer.
    expect(paceToDisplay(300)).toBeCloseTo(300 * KM_PER_MILE, 9);
    expect(fmtPace(300)).toBe("8:03");
  });

  it("formats m:ss and refuses to invent a pace", () => {
    expect(fmtPace(300)).toBe("5:00");
    expect(fmtPace(365)).toBe("6:05");
    expect(fmtPace(0)).toBeNull();
    expect(fmtPace(-5)).toBeNull();
    expect(fmtPace(undefined)).toBeNull();
  });

  it("labels pace with the unit, and shows a dash when there is none", () => {
    expect(fmtPaceUnit(300)).toBe("5:00 /km");
    setUnit("mi");
    expect(fmtPaceUnit(300)).toBe("8:03 /mi");
    expect(fmtPaceUnit(0)).toBe("—");
  });
});

describe("speed", () => {
  it("converts m/s to km/h and mph", () => {
    expect(speedToDisplay(10)).toBeCloseTo(36, 6);
    expect(speedLabel()).toBe("km/h");
    setUnit("mi");
    expect(speedToDisplay(10)).toBeCloseTo(22.369362920544, 6);
    expect(speedLabel()).toBe("mph");
  });

  it("returns zero for a stationary or bogus speed", () => {
    expect(speedToDisplay(0)).toBe(0);
    expect(speedToDisplay(undefined)).toBe(0);
  });
});

describe("formatting", () => {
  it("prints a distance with its unit", () => {
    expect(fmtDist(5)).toBe("5.00 km");
    expect(fmtDist(5, 1)).toBe("5.0 km");
    expect(fmtDistNum(5, 1)).toBe("5.0");
    setUnit("mi");
    expect(fmtDist(KM_PER_MILE, 2)).toBe("1.00 mi");
  });

  it("switches elevation to feet and weight to pounds on miles", () => {
    expect(fmtElev(63)).toBe("63 m");
    expect(fmtWeight(70)).toBe("70 kg");
    setUnit("mi");
    expect(fmtElev(63)).toBe("207 ft");
    expect(fmtWeight(70)).toBe("154 lb");
  });

  it("shows a zero climb in the right unit", () => {
    expect(fmtElev(0)).toBe("0 m");
    setUnit("mi");
    expect(fmtElev(0)).toBe("0 ft");
  });

  it("labels splits per kilometre in both units, because that is what was recorded", () => {
    // Mile splits cannot be derived from km splits without inventing times.
    expect(splitLabel(0)).toBe("1 km");
    setUnit("mi");
    expect(splitLabel(3)).toBe("4 km");
  });
});
