import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { streamCoach, buildSummary, quickAsks, MODELS, DEFAULT_MODEL } from "../src/coach.js";
import { setUnit } from "../src/units.js";

const REPLY = "Nine sessions in.\n- Pacing is steady.\nNext: 5 km continuous.";

// Frames cut at deliberately awkward points — mid-JSON, mid-"data:", and
// between the two newlines that end a frame — because that is what a real
// network hands a reader.
const sseChunks = (text, cuts) => {
  const frames = text.split(/(?<=\s)/)
    .map((w) => `data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`)
    .join("") + "data: [DONE]\n\n";
  const out = [];
  let prev = 0;
  for (const c of [...cuts, frames.length].sort((a, b) => a - b)) {
    if (c > prev && c <= frames.length) { out.push(frames.slice(prev, c)); prev = c; }
  }
  return out;
};

const streamingResponse = (chunks) => ({
  ok: true,
  status: 200,
  body: {
    getReader() {
      let i = 0;
      const enc = new TextEncoder();
      return {
        async read() {
          if (i >= chunks.length) return { done: true };
          return { done: false, value: enc.encode(chunks[i++]) };
        },
        cancel: () => Promise.resolve(),
      };
    },
  },
  json: async () => ({}),
});

const ask = (over = {}) => ({
  apiKey: "gsk_test", model: "m", summary: {}, messages: [{ role: "user", content: "hi" }], ...over,
});

let originalFetch;
beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

describe("streamCoach", () => {
  it("reassembles a reply split across hostile chunk boundaries", async () => {
    globalThis.fetch = async () => streamingResponse(sseChunks(REPLY, [7, 23, 61, 62, 63, 140, 141, 300, 301]));
    const tokens = [];
    const text = await streamCoach({ ...ask(), onToken: (t) => tokens.push(t) });
    expect(text).toBe(REPLY);
    expect(tokens.length).toBeGreaterThan(5);
    expect(tokens.join("").trim()).toBe(REPLY);
  });

  it("survives a frame delivered one byte at a time", async () => {
    const whole = sseChunks("Hello there.", []).join("");
    globalThis.fetch = async () => streamingResponse([...whole]);
    expect(await streamCoach(ask())).toBe("Hello there.");
  });

  it("ignores keep-alive blanks and unparseable frames", async () => {
    globalThis.fetch = async () => streamingResponse([
      ": ping\n\n",
      `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n`,
      "data: {not json}\n\n",
      "data: [DONE]\n\n",
    ]);
    expect(await streamCoach(ask())).toBe("ok");
  });

  it("asks the endpoint to stream", async () => {
    let sent;
    globalThis.fetch = async (_url, opts) => { sent = JSON.parse(opts.body); return streamingResponse(sseChunks("hi", [])); };
    await streamCoach(ask());
    expect(sent.stream).toBe(true);
    expect(sent.messages[0].role).toBe("system");
  });

  it("says a key was rejected rather than returning nothing", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
    await expect(streamCoach(ask())).rejects.toThrow(/rejected/i);
  });

  it("names the model on a 404, so the fix is obvious", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    await expect(streamCoach(ask({ model: "made-up-model" }))).rejects.toThrow(/made-up-model/);
  });

  it("explains a rate limit and a server wobble", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
    await expect(streamCoach(ask())).rejects.toThrow(/rate limit/i);
    globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await expect(streamCoach(ask())).rejects.toThrow(/try again/i);
  });

  it("falls back to the non-streaming reply when there is no readable body", async () => {
    globalThis.fetch = async () => ({
      ok: true, status: 200, body: undefined,
      json: async () => ({ choices: [{ message: { content: "fallback reply" } }] }),
    });
    expect(await streamCoach(ask())).toBe("fallback reply");
  });

  it("treats an empty stream as an error, not an empty answer", async () => {
    globalThis.fetch = async () => streamingResponse(["data: [DONE]\n\n"]);
    await expect(streamCoach(ask())).rejects.toThrow(/empty/i);
  });

  it("lets an abort through untouched, so callers can keep the partial", async () => {
    globalThis.fetch = async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; };
    await expect(streamCoach(ask())).rejects.toThrow(/aborted/);
  });

  it("turns a network failure into something a runner can act on", async () => {
    globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
    await expect(streamCoach(ask())).rejects.toThrow(/connection/i);
  });
});

describe("buildSummary", () => {
  const stats = {
    kmLogged: 27.04, runsLogged: 8, minTotal: 181, avgPaceSec: 400, bestPaceSec: 385,
    maxKm: 4.21, bestSplitSec: 338, bestElevM: 63, totalKcal: 1670,
    curStreak: 9, best: 9, stitches: 1, done: 9,
  };
  const weekly = [{ label: 1, value: 19.7, target: 20 }, { label: 2, value: 7.3, target: 18 }];
  const history = [
    { title: "4 km intervals", detail: "hard", e: { km: "4.21", min: "27", date: "2026-03-05T07:30:00Z", feel: 4, tracked: true } },
    { title: "Easy 2.5 km", detail: "easy", e: { km: "12.4", min: "148", date: "2026-03-04T07:30:00Z", activity: "walk" } },
  ];

  it("marks a walk as a walk, so the coach cannot average it into pace", () => {
    const s = buildSummary({ stats, weekly, history });
    expect(s.recentRuns.find((r) => r.distance === 12.4).activity).toBe("walk");
    expect(s.recentRuns.find((r) => r.distance === 4.21).activity).toBe("run");
  });

  it("names the unit every distance is in, so advice comes back in it", () => {
    expect(buildSummary({ stats, weekly, history }).units).toBe("kilometres");
    setUnit("mi");
    const s = buildSummary({ stats, weekly, history });
    expect(s.units).toBe("miles");
    // 4.21 km is about 2.62 miles — the summary must not hand over raw km
    // under a "miles" label.
    expect(s.recentRuns.find((r) => r.activity === "run").distance).toBeCloseTo(2.62, 1);
    setUnit("km");
  });

  it("carries today's session and what is coming, so 'what now?' is answerable", () => {
    const plan = {
      today: { week: 2, day: "WED", type: "rest", title: "Walk or rest", km: 0, done: false },
      upcoming: [{ week: 2, day: "WED", type: "rest", title: "Walk or rest", km: 0, done: false }],
    };
    const s = buildSummary({ stats, weekly, history, plan });
    expect(s.today.session.title).toBe("Walk or rest");
    expect(s.today.isRestDay).toBe(true);
    expect(s.upcomingSessions).toHaveLength(1);
    // The plan's day labels are block positions, not calendar weekdays — the
    // model has to be told, or it will talk about "your Wednesday run".
    expect(s.today.dayLabelsArePlanSlots).toBe(true);
  });

  it("works with no plan context at all", () => {
    const s = buildSummary({ stats, weekly, history });
    expect(s.today.session).toBeNull();
    expect(s.upcomingSessions).toBeNull();
  });

  it("passes through the numbers the coach argues from", () => {
    const s = buildSummary({ stats, weekly, history, goal: "Run a 10K" });
    expect(s.goal).toBe("Run a 10K");
    expect(s.totals.longestRun).toBe(4.21);
    expect(s.consistency.currentStreak).toBe(9);
    expect(s.weeklyDistance).toHaveLength(2);
  });

  it("survives an empty log", () => {
    const empty = { ...stats, kmLogged: 0, runsLogged: 0, minTotal: 0, avgPaceSec: 0, bestPaceSec: 0, maxKm: 0 };
    const s = buildSummary({ stats: empty, weekly: [], history: [] });
    expect(s.recentRuns).toEqual([]);
    expect(s.totals.distanceLogged).toBe(0);
  });
});

describe("quickAsks", () => {
  it("leads with today's session when there is one", () => {
    const asks = quickAsks({ stats: {}, todaySession: { type: "run", title: "5 km steady", detail: "smooth" } });
    expect(asks[0].label).toBe("Today's session");
    expect(asks[0].text).toContain("5 km steady");
  });

  it("questions a rest day rather than just naming it", () => {
    const asks = quickAsks({ stats: {}, todaySession: { type: "rest", title: "Walk or rest", detail: "" } });
    expect(asks[0].label).toMatch(/rest/i);
    expect(asks[0].text).toMatch(/rest|light/i);
  });

  it("offers race-specific asks only when a race is set", () => {
    const withRace = quickAsks({ stats: {}, race: "10K", raceDays: 12 }).map((a) => a.label);
    expect(withRace).toContain("Ready for 10K?");
    expect(withRace).toContain("Race week plan");

    const noRace = quickAsks({ stats: {} }).map((a) => a.label);
    expect(noRace).toContain("Ready for 5K?");
    expect(noRace).not.toContain("Race week plan");
  });

  it("drops the taper ask when the race is still far off", () => {
    const labels = quickAsks({ stats: {}, race: "10K", raceDays: 90 }).map((a) => a.label);
    expect(labels).not.toContain("Race week plan");
  });

  it("only mentions stitches to someone who gets them", () => {
    expect(quickAsks({ stats: { stitches: 2 } }).map((a) => a.label)).toContain("Stop stitches");
    expect(quickAsks({ stats: { stitches: 0 } }).map((a) => a.label)).not.toContain("Stop stitches");
  });

  it("offers a way back only after the streak has actually broken", () => {
    expect(quickAsks({ stats: { curStreak: 0, runsLogged: 6 } }).map((a) => a.label)).toContain("Getting back");
    expect(quickAsks({ stats: { curStreak: 4, runsLogged: 6 } }).map((a) => a.label)).not.toContain("Getting back");
    // A brand-new runner has not fallen off anything.
    expect(quickAsks({ stats: { curStreak: 0, runsLogged: 0 } }).map((a) => a.label)).not.toContain("Getting back");
  });

  it("quotes the runner's real longest run back at them", () => {
    const ask = quickAsks({ stats: { maxKm: 7.4 } }).find((a) => a.label === "Go further");
    expect(ask.text).toContain("7.4");
  });

  it("always returns something askable, even knowing nothing", () => {
    const asks = quickAsks();
    expect(asks.length).toBeGreaterThan(2);
    expect(asks.every((a) => a.label && a.text)).toBe(true);
  });
});

describe("MODELS", () => {
  it("offers the default as one of the choices", () => {
    expect(MODELS.map((m) => m.id)).toContain(DEFAULT_MODEL);
  });

  it("gives every model a name and a reason to pick it", () => {
    for (const m of MODELS) {
      expect(m.id).toBeTruthy();
      expect(m.name).toBeTruthy();
      expect(m.note).toBeTruthy();
    }
  });
});
