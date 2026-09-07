// AI running coach. Sends a compact snapshot of the runner's training log to
// Groq's (OpenAI-compatible) chat API and returns plain-text coaching advice.
//
// There is no backend: the user pastes their own free Groq API key (stored in
// settings, on-device only) and the request goes straight from the browser to
// api.groq.com. Free, fast, and private to the user's device.
import { TOTAL } from "./data.js";
import { U, isMiles, fmtDistNum, paceToDisplay } from "./units.js";

export const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
export const DEFAULT_MODEL = "llama-3.3-70b-versatile";
export const DEFAULT_GOAL = "Run as far as I can — build endurance and go well beyond 5K.";

// A short menu beats a free-text box nobody can fill in: Groq model ids are not
// guessable, and a typo only surfaces as a 404 after the request. The box is
// still there for anyone who wants a model that isn't listed — Groq's free
// line-up changes, and this list will go stale.
export const MODELS = [
  { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", note: "Best answers · default" },
  { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B", note: "Fastest, simpler advice" },
  { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", note: "Strong reasoning" },
  { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B", note: "Quick reasoning" },
];

const pace = (s) => { const v = paceToDisplay(s); return v ? `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, "0")}/${U.short}` : "—"; };
const mins = (m) => (m ? `${Math.round(m)} min` : "—");

// Build a compact, model-friendly snapshot of everything the app knows about
// the runner: totals, consistency, weekly volume, and the most recent sessions.
export function buildSummary({ stats, weekly, history, goal, race, plan }) {
  const recent = history
    .filter((h) => parseFloat(h.e.km) > 0)
    .slice(0, 10)
    .map((h) => {
      const km = parseFloat(h.e.km) || 0;
      const min = parseFloat(h.e.min) || 0;
      const p = min && km ? (min * 60) / km : 0;
      return {
        date: h.e.date ? h.e.date.slice(0, 10) : null,
        session: `${h.title} — ${h.detail}`,
        distance: Number(fmtDistNum(km, 2)),
        min: min ? Number(min.toFixed(1)) : null,
        pace: p ? pace(p) : null,
        // Walks imported from a watch are sessions, not runs. Saying so stops
        // the coach averaging a 15:00/km stroll into "your pace has collapsed".
        activity: h.e.activity === "walk" ? "walk" : "run",
        feel: h.e.feel || null, // 1 (rough) .. 5 (great)
        feedback: h.e.cal || null, // runner flagged this session: "easy" | "ok" | "hard"
        stitch: !!h.e.stitch,
        gps: !!h.e.tracked,
        elevGainM: h.e.elev || null,
        cadenceSpm: h.e.cadence || null,
      };
    });
  const now = new Date();
  return {
    goal: goal || DEFAULT_GOAL,
    // Every distance below is in this unit, and the coach should answer in it
    // too — telling a miles runner to "add 2 km" is the wrong advice in the
    // wrong language.
    units: isMiles() ? "miles" : "kilometres",
    // Without this the coach cannot answer the most obvious question anyone
    // asks a coach — "what should I do today?" — and guesses at a session the
    // app already knows.
    today: {
      date: now.toISOString().slice(0, 10),
      weekday: now.toLocaleDateString("en-GB", { weekday: "long" }),
      session: plan?.today || null,
      isRestDay: plan?.today ? plan.today.type === "rest" : null,
      // A session's `day` is its slot in the plan week (MON..SUN as written in
      // the block), not the calendar weekday above — the runner may have
      // started the block on any day. Refer to sessions by name, not weekday.
      dayLabelsArePlanSlots: true,
    },
    upcomingSessions: plan?.upcoming || null,
    // the race target set on the Stats tab, with the app's own prediction, so
    // the coach argues with a number rather than inventing one
    raceGoal: race || null,
    planProgress: `${stats.done}/${TOTAL} plan sessions done`,
    totals: {
      distanceLogged: Number(fmtDistNum(stats.kmLogged, 1)),
      runs: stats.runsLogged,
      timeOnFeet: mins(stats.minTotal),
      avgPace: pace(stats.avgPaceSec),
      bestPace: pace(stats.bestPaceSec),
      longestRun: Number(fmtDistNum(stats.maxKm, 2)),
      fastestKm: pace(stats.bestSplitSec),
      bestClimbM: stats.bestElevM || 0, // always metres
      totalKcal: Math.round(stats.totalKcal || 0),
    },
    consistency: {
      currentStreak: stats.curStreak,
      bestStreak: stats.best,
      runsWithStitch: stats.stitches,
    },
    weeklyDistance: weekly.map((w) => ({ week: w.label, logged: Number(fmtDistNum(w.value, 1)), planTarget: Number(fmtDistNum(w.target, 1)) })),
    recentRuns: recent,
    // sessions the runner flagged as too easy / just right / too hard
    sessionFeedback: history
      .filter((h) => h.e.cal)
      .map((h) => ({ session: `${h.title}`, felt: h.e.cal })),
  };
}

// Coaching persona + ground rules. The runner's data snapshot is appended so the
// coach always answers from real numbers, across the whole conversation.
const PERSONA = [
  "You are an upbeat, expert running coach inside a '5K and beyond' phone app.",
  "Be specific and practical, grounded in the runner's data below — never generic.",
  "If the data is thin, say what to log next. Always steer toward the runner's goal.",
  "Use the runner's own distance unit (see `units` in the data) for every distance.",
  "",
  "Plain text only: no markdown headers, no ** bold **, no tables. Short paragraphs",
  "and '- ' bullet lines are fine. Keep normal replies under 160 words; only go",
  "longer when explicitly asked for a full plan (then use day-by-day '- ' bullets).",
].join("\n");

const systemFor = (summary) =>
  `${PERSONA}\n\nThe runner's current training data (JSON):\n${JSON.stringify(summary)}`;

// First-touch analysis prompt (used by the "Analyse my training" button).
export const ANALYSE_PROMPT =
  "Give me a short coaching read on how I'm doing: one warm opening sentence, " +
  "then 2-4 lines starting with '- ' on what to improve or watch (pacing, " +
  "consistency, weekly distance, recovery, stitches), then a final line starting " +
  "with 'Next: ' naming one concrete session for the coming days toward my goal.";

// One-tap follow-ups. These are built from the runner's actual situation rather
// than fixed: offering "why do I get stitches?" to someone who has never logged
// one, or "ready for 5K?" to someone who has run three, is the chip equivalent
// of generic advice.
export function quickAsks({ stats, race, raceDays, todaySession } = {}) {
  const asks = [];

  if (todaySession) {
    asks.push({
      label: todaySession.type === "rest" ? "Rest day — really?" : "Today's session",
      text: todaySession.type === "rest"
        ? `My plan says rest today (${todaySession.title}). Given how my last few runs went, should I actually rest, or do something light?`
        : `My plan today is "${todaySession.title} — ${todaySession.detail}". How should I run it, and what should I watch for?`,
    });
  }

  asks.push({ label: "How's my pacing?", text: "How is my pacing across recent runs? Am I going out too fast or too slow?" });

  if (race) {
    asks.push({
      label: `Ready for ${race}?`,
      text: raceDays != null && raceDays >= 0
        ? `My ${race} is ${raceDays} days away. Am I on track, and what should the next ${Math.min(4, Math.max(1, Math.ceil(raceDays / 7)))} weeks look like?`
        : `Am I ready for a ${race}? What's the gap between where I am and that distance?`,
    });
    if (raceDays != null && raceDays >= 0 && raceDays <= 21) {
      asks.push({ label: "Race week plan", text: `Walk me through the last ${Math.min(raceDays + 1, 10)} days before my ${race}: taper, sleep, food and race-morning routine.` });
    }
  } else {
    asks.push({ label: "Ready for 5K?", text: "Based on my data, am I ready to run a continuous 5K? What's the gap?" });
  }

  if (stats?.maxKm > 0) {
    asks.push({ label: "Go further", text: `My longest run is ${stats.maxKm} km. How do I extend that safely without wrecking my legs?` });
  } else {
    asks.push({ label: "Run longer", text: "How do I build up to running longer distances without walking breaks?" });
  }

  if (stats?.stitches > 0) {
    asks.push({ label: "Stop stitches", text: `I've logged a side stitch on ${stats.stitches} run${stats.stitches === 1 ? "" : "s"}. Why is it happening and how do I stop it?` });
  }
  if (stats?.curStreak === 0 && stats?.runsLogged > 0) {
    asks.push({ label: "Getting back", text: "I've fallen off my streak. How do I restart without going too hard and hating it?" });
  }
  if (stats?.bestPaceSec > 0) {
    asks.push({ label: "Get faster", text: "What kind of speed work should I be doing at my level, and how often?" });
  }

  asks.push({ label: "Pre-run fuel", text: "What should I eat and drink before and after a run at my level?" });
  asks.push({ label: "Niggles & recovery", text: "What should I do about sore legs between runs, and when is an ache a reason to stop?" });

  return asks;
}

// Send a message thread to Groq and return the assistant's reply text.
// `messages` is an array of { role: "user" | "assistant", content }.
// Throws a user-friendly Error on failure.
export async function askCoach({ apiKey, model, summary, messages, signal }) {
  let res;
  try {
    res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        temperature: 0.6,
        max_tokens: 700,
        messages: [{ role: "system", content: systemFor(summary) }, ...messages],
      }),
      signal,
    });
  } catch {
    throw new Error("Couldn't reach Groq — check your connection and try again.");
  }

  if (!res.ok) await explainFailure(res, model, "Coach request");

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("The coach sent back an empty reply — try again.");
  return text;
}

// Turns a failed response into something the runner can act on. Shared by every
// call so one endpoint's error wording doesn't drift from another's.
async function explainFailure(res, model, what) {
  let detail = "";
  try { detail = (await res.json())?.error?.message || ""; } catch { /* non-JSON error body */ }
  if (res.status === 401) throw new Error("That API key was rejected — double-check it.");
  if (res.status === 404) throw new Error(`Model "${model}" not found — pick another one in Coach setup.`);
  if (res.status === 429) throw new Error("Groq rate limit hit — wait a moment, then retry.");
  if (res.status >= 500) throw new Error("Groq is having a moment — try again shortly.");
  throw new Error(detail || `${what} failed (${res.status}).`);
}

/**
 * Streaming version of askCoach: calls `onToken` with each chunk as it arrives
 * and resolves with the full text.
 *
 * Waiting in silence for a 700-token reply makes a fast model feel slow — the
 * words arriving is most of the difference between "thinking…" and a coach
 * talking to you. Aborting mid-stream is a normal outcome: the caller keeps
 * whatever arrived, so a stopped reply is still a reply.
 *
 * Falls back to the non-streaming path if the runtime has no readable body.
 */
export async function streamCoach({ apiKey, model, summary, messages, signal, onToken }) {
  let res;
  try {
    res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        temperature: 0.6,
        max_tokens: 900,
        stream: true,
        messages: [{ role: "system", content: systemFor(summary) }, ...messages],
      }),
      signal,
    });
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    throw new Error("Couldn't reach Groq — check your connection and try again.");
  }

  if (!res.ok) await explainFailure(res, model, "Coach request");
  if (!res.body?.getReader) return askCoach({ apiKey, model, summary, messages, signal });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", full = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line; a chunk can split one in half,
      // so only complete frames are consumed and the remainder stays buffered.
      const frames = buf.split("\n\n");
      buf = frames.pop() || "";
      for (const frame of frames) {
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let piece;
          try { piece = JSON.parse(payload); } catch { continue; }
          const delta = piece?.choices?.[0]?.delta?.content;
          if (delta) { full += delta; onToken?.(delta); }
        }
      }
    }
  } finally {
    // cancel() returns a promise, and on an errored stream (which is exactly
    // what an aborted request leaves behind) that promise rejects. try/catch
    // only catches synchronous throws, so without the .catch the abort escaped
    // as an unhandled rejection every time someone pressed Stop.
    try { reader.cancel()?.catch?.(() => {}); } catch { /* already closed */ }
  }

  const text = full.trim();
  if (!text) throw new Error("The coach sent back an empty reply — try again.");
  return text;
}

// Cheapest possible round trip that proves a key works, so "is my key right?"
// gets answered at setup rather than by a failed first question.
export async function validateKey({ apiKey, model, signal }) {
  if (!apiKey?.trim()) return { ok: false, error: "Paste your key first." };
  let res;
  try {
    res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey.trim()}` },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
      signal,
    });
  } catch {
    return { ok: false, error: "Couldn't reach Groq — check your connection." };
  }
  if (res.ok) return { ok: true };
  try { await explainFailure(res, model, "Key check"); } catch (e) { return { ok: false, error: e.message }; }
  return { ok: false, error: "Key check failed." };
}

const PLAN_SYSTEM = [
  "You are an expert running coach generating the runner's NEXT training block as",
  "strict JSON. Use their data and goal to progress them beyond what they've",
  "already achieved — build distance/endurance and speed sensibly, never a big jump.",
  "",
  "Return ONLY a JSON object of this exact shape (no prose, no markdown):",
  '{ "weeks": [ { "label": "short theme", "days": [',
  '  { "d": "MON", "type": "run|easy|rest", "title": "e.g. 6 km tempo", "detail": "how to run it", "km": 6 }',
  "] } ] }",
  "",
  "Rules: 3 or 4 weeks; EXACTLY 7 days per week in MON..SUN order; each day type is",
  "'run' (key/quality sessions), 'easy' (recovery) or 'rest'; km is a number (0 for",
  "rest). Include a weekly long run that grows, 1-2 quality sessions (tempo or",
  "intervals), easy days and 2 rest days per week. Progressive overload week to week",
  "with a lighter final week. Keep titles/detail short and concrete.",
].join("\n");

// Ask Groq (JSON mode) for a new training block. Returns the parsed object
// (validate/normalize it with src/plan.js before applying). Throws on failure.
export async function generatePlanBlock({ apiKey, model, summary, signal }) {
  const user = [
    "Generate my next training block as JSON, progressing beyond my current results.",
    "My data:",
    JSON.stringify(summary),
  ].join("\n");

  let res;
  try {
    res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        temperature: 0.5,
        max_tokens: 1800,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: PLAN_SYSTEM },
          { role: "user", content: user },
        ],
      }),
      signal,
    });
  } catch {
    throw new Error("Couldn't reach Groq — check your connection and try again.");
  }

  if (!res.ok) await explainFailure(res, model, "Plan request");

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("The coach sent back an empty plan — try again.");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Couldn't read the generated plan — try again.");
  }
}

const ADAPT_SYSTEM = [
  "You are an expert running coach RE-TUNING the runner's upcoming (not-yet-done)",
  "training weeks based on their results and per-session feedback. Return strict JSON.",
  "",
  "Make sessions EASIER (less distance/intensity, more recovery) where they flagged",
  "'too hard', and HARDER (more distance/quality) where they flagged 'too easy'.",
  "Keep changes sensible and progressive — no big jumps.",
  "",
  "Return ONLY this JSON shape (no prose): same NUMBER of weeks you were given,",
  "EXACTLY 7 days per week in MON..SUN order:",
  '{ "weeks": [ { "label": "short theme", "days": [',
  '  { "d": "MON", "type": "run|easy|rest", "title": "e.g. 6 km tempo", "detail": "how to run it", "km": 6 } ] } ] }',
].join("\n");

// Re-tune the given upcoming weeks from feedback. Returns parsed JSON; validate
// with src/plan.js (adaptedPlan) before applying. Throws on failure.
export async function adaptPlanBlock({ apiKey, model, summary, weeks, signal }) {
  const user = [
    "Adjust these upcoming weeks based on my results and feedback. Keep the same",
    "number of weeks and 7 days each. Upcoming weeks:",
    JSON.stringify({ weeks }),
    "My data (note any per-session feedback of too easy / too hard):",
    JSON.stringify(summary),
  ].join("\n");

  let res;
  try {
    res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        temperature: 0.5,
        max_tokens: 1800,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: ADAPT_SYSTEM },
          { role: "user", content: user },
        ],
      }),
      signal,
    });
  } catch {
    throw new Error("Couldn't reach Groq — check your connection and try again.");
  }
  if (!res.ok) await explainFailure(res, model, "Plan request");
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("The coach sent back an empty plan — try again.");
  try { return JSON.parse(text); } catch { throw new Error("Couldn't read the adjusted plan — try again."); }
}

// Quick, specific feedback on a single run (reuses the chat path so the overall
// data summary stays in context). Returns plain text.
export function coachRun({ apiKey, model, summary, run, signal }) {
  const messages = [{
    role: "user",
    content: [
      "Give quick, specific feedback on THIS one run: 2-3 short lines starting with",
      "'- ' (pace, splits, effort, what it shows), then a final 'Next: ' line with one",
      "tip. Under 110 words, plain text. The run:",
      JSON.stringify(run),
    ].join("\n"),
  }];
  return askCoach({ apiKey, model, summary, messages, signal });
}
