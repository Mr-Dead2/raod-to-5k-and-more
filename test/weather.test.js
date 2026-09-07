import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  fetchWeather, describeCode, dressFor, runWarning, bestWindow, runAdvice, cacheUsable,
} from "../src/weather.js";
import { setUnit } from "../src/units.js";

const w = (over = {}) => ({
  at: Date.now(), tempUnit: "°C", windUnit: "km/h",
  temp: 12, feels: 11, humidity: 60, wind: 10, gusts: 15,
  precipitation: 0, code: 1, isDay: true, label: "Mostly clear", icon: "🌤️",
  hourly: [], ...over,
});

const hour = (over = {}) => ({ t: Date.now(), temp: 12, feels: 11, rainChance: 10, code: 1, wind: 10, ...over });

afterEach(() => setUnit("km"));

describe("describeCode", () => {
  it("names the conditions that change a run", () => {
    expect(describeCode(0)[0]).toBe("Clear");
    expect(describeCode(65)[0]).toMatch(/rain/i);
    expect(describeCode(95)[0]).toMatch(/thunder/i);
  });

  it("falls back rather than rendering undefined", () => {
    const [label, icon] = describeCode(4242);
    expect(label).toBe("—");
    expect(icon).toBeTruthy();
  });
});

describe("dressFor", () => {
  it("scales advice with what the body actually feels", () => {
    expect(dressFor(-10)).toMatch(/thermal|winter/i);
    expect(dressFor(0)).toMatch(/gloves/i);
    expect(dressFor(6)).toMatch(/long sleeves/i);
    expect(dressFor(18)).toMatch(/shorts/i);
    expect(dressFor(30)).toMatch(/hot/i);
  });

  it("reads Fahrenheit on the same scale, not a duplicated one", () => {
    // 86°F is 30°C — the same advice as the Celsius case above.
    expect(dressFor(86, "°F")).toBe(dressFor(30, "°C"));
    expect(dressFor(14, "°F")).toBe(dressFor(-10, "°C"));
  });

  it("says nothing without a reading", () => {
    expect(dressFor(undefined)).toBeNull();
    expect(dressFor(NaN)).toBeNull();
  });
});

describe("runWarning", () => {
  it("stays quiet when conditions are fine", () => {
    expect(runWarning(w())).toBeNull();
  });

  it("calls out the things that genuinely change a session", () => {
    expect(runWarning(w({ code: 95 }))).toMatch(/thunder/i);
    expect(runWarning(w({ feels: 30 }))).toMatch(/hot/i);
    expect(runWarning(w({ feels: -12 }))).toMatch(/ice|bitter/i);
    expect(runWarning(w({ code: 73 }))).toMatch(/snow/i);
    expect(runWarning(w({ code: 63 }))).toMatch(/wet/i);
  });

  it("tells you which way to run into the wind", () => {
    expect(runWarning(w({ wind: 40 }))).toMatch(/into it/i);
    expect(runWarning(w({ gusts: 60 }))).toMatch(/gusts/i);
  });

  it("uses mph thresholds when the reading is in mph", () => {
    // 25 mph is windy; 25 km/h is not.
    expect(runWarning(w({ wind: 25, gusts: 25, windUnit: "mph" }))).toMatch(/windy/i);
    expect(runWarning(w({ wind: 25, gusts: 25 }))).toBeNull();
  });

  it("puts the worst thing first", () => {
    // A thunderstorm in high wind should mention the storm, not the wind.
    expect(runWarning(w({ code: 95, wind: 50 }))).toMatch(/thunder/i);
  });

  it("says nothing without a reading", () => {
    expect(runWarning(null)).toBeNull();
  });
});

describe("bestWindow", () => {
  it("suggests a later hour when it is clearly better", () => {
    const best = bestWindow(w({ hourly: [
      hour({ rainChance: 90, wind: 30 }),
      hour({ rainChance: 80, wind: 25 }),
      hour({ rainChance: 5, wind: 8 }),
    ] }));
    expect(best).not.toBeNull();
    expect(best.rainChance).toBe(5);
  });

  it("stays quiet when now is already the best time", () => {
    expect(bestWindow(w({ hourly: [
      hour({ rainChance: 0, wind: 5 }),
      hour({ rainChance: 60, wind: 20 }),
    ] }))).toBeNull();
  });

  it("does not nag over a trivial improvement", () => {
    expect(bestWindow(w({ hourly: [hour({ rainChance: 20 }), hour({ rainChance: 15 })] }))).toBeNull();
  });

  it("needs a forecast to have an opinion", () => {
    expect(bestWindow(w({ hourly: [] }))).toBeNull();
    expect(bestWindow(w({ hourly: [hour()] }))).toBeNull();
    expect(bestWindow(null)).toBeNull();
  });
});

describe("runAdvice", () => {
  it("bundles what to wear with anything worth warning about", () => {
    const a = runAdvice(w({ feels: 3, wind: 45 }));
    expect(a.dress).toBeTruthy();
    expect(a.warning).toMatch(/wind/i);
  });

  it("returns nothing at all without a reading", () => {
    expect(runAdvice(null)).toBeNull();
  });
});

describe("fetchWeather", () => {
  let calls;
  beforeEach(() => { calls = []; });

  const okResponse = (over = {}) => ({
    ok: true,
    json: async () => ({
      current: {
        temperature_2m: 11.6, apparent_temperature: 9.4, relative_humidity_2m: 71,
        precipitation: 0, weather_code: 3, wind_speed_10m: 14.2, wind_gusts_10m: 28.9, is_day: 1,
      },
      hourly: {
        time: [new Date(Date.now() + 3600000).toISOString()],
        temperature_2m: [12], apparent_temperature: [10],
        precipitation_probability: [40], weather_code: [61], wind_speed_10m: [16],
      },
      ...over,
    }),
  });

  it("reads the current conditions into the shape the UI wants", async () => {
    const out = await fetchWeather({ lat: 56.95, lon: 24.1, fetchImpl: async (u) => { calls.push(u); return okResponse(); } });
    expect(out).toMatchObject({ temp: 12, feels: 9, humidity: 71, wind: 14, gusts: 29, code: 3 });
    expect(out.label).toBe("Overcast");
    expect(out.hourly).toHaveLength(1);
    expect(out.hourly[0].rainChance).toBe(40);
  });

  it("rounds the coordinates before they leave the device", async () => {
    await fetchWeather({ lat: 56.9496123456, lon: 24.1051987654, fetchImpl: async (u) => { calls.push(u); return okResponse(); } });
    const url = new URL(calls[0]);
    expect(url.searchParams.get("latitude")).toBe("56.95");
    expect(url.searchParams.get("longitude")).toBe("24.11");
    // and nothing else identifying goes with it
    expect([...url.searchParams.keys()]).not.toContain("apikey");
  });

  it("asks for the runner's own units", async () => {
    await fetchWeather({ lat: 1, lon: 1, fetchImpl: async (u) => { calls.push(u); return okResponse(); } });
    expect(new URL(calls[0]).searchParams.get("temperature_unit")).toBe("celsius");
    setUnit("mi");
    await fetchWeather({ lat: 1, lon: 1, fetchImpl: async (u) => { calls.push(u); return okResponse(); } });
    const url = new URL(calls[1]);
    expect(url.searchParams.get("temperature_unit")).toBe("fahrenheit");
    expect(url.searchParams.get("wind_speed_unit")).toBe("mph");
  });

  it("returns null rather than throwing, whatever goes wrong", async () => {
    expect(await fetchWeather({ lat: 1, lon: 1, fetchImpl: async () => { throw new Error("offline"); } })).toBeNull();
    expect(await fetchWeather({ lat: 1, lon: 1, fetchImpl: async () => ({ ok: false }) })).toBeNull();
    expect(await fetchWeather({ lat: 1, lon: 1, fetchImpl: async () => ({ ok: true, json: async () => { throw new Error("bad json"); } }) })).toBeNull();
    expect(await fetchWeather({ lat: 1, lon: 1, fetchImpl: async () => ({ ok: true, json: async () => ({}) }) })).toBeNull();
  });

  it("will not call out without a position", async () => {
    let called = false;
    expect(await fetchWeather({ lat: undefined, lon: 1, fetchImpl: async () => { called = true; return okResponse(); } })).toBeNull();
    expect(called).toBe(false);
  });
});

describe("cacheUsable", () => {
  const now = 1_700_000_000_000;
  const cached = { w: { at: now }, lat: 56.95, lon: 24.1 };

  it("reuses a recent reading from the same place", () => {
    expect(cacheUsable(cached, 56.95, 24.1, now + 60000)).toBe(true);
  });

  it("expires after half an hour", () => {
    expect(cacheUsable(cached, 56.95, 24.1, now + 31 * 60000)).toBe(false);
  });

  it("refetches once you have travelled somewhere else", () => {
    expect(cacheUsable(cached, 57.4, 24.1, now + 60000)).toBe(false);
  });

  it("still serves a cached reading when the position is unknown", () => {
    expect(cacheUsable(cached, undefined, undefined, now + 60000)).toBe(true);
  });

  it("has nothing to offer when the cache is empty", () => {
    expect(cacheUsable(null, 1, 1, now)).toBe(false);
    expect(cacheUsable({}, 1, 1, now)).toBe(false);
  });
});
