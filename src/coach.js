// AI running coach. Sends a compact snapshot of the runner's training log to
// Groq's (OpenAI-compatible) chat API and returns plain-text coaching advice.
//
// There is no backend: the user pastes their own free Groq API key (stored in
// settings, on-device only) and the request goes straight from the browser to
// api.groq.com. Free, fast, and private to the user's device.
import { TOTAL } from "./data.js";

export const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
export const DEFAULT_MODEL = "llama-3.3-70b-versatile";
export const DEFAULT_GOAL = "Run as far as I can — build endurance and go well beyond 5K.";

const pace = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}/km` : "—");
const mins = (m) => (m ? `${Math.round(m)} min` : "—");

// Build a compact, model-friendly snapshot of everything the app knows about
// the runner: totals, consistency, weekly volume, and the most recent sessions.
export function buildSummary({ stats, weekly, history, goal, race }) {
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
        km: Number(km.toFixed(2)),
        min: min ? Number(min.toFixed(1)) : null,
        pace: p ? pace(p) : null,
        feel: h.e.feel || null, // 1 (rough) .. 5 (great)
        feedback: h.e.cal || null, // runner flagged this session: "easy" | "ok" | "hard"
        stitch: !!h.e.stitch,
        gps: !!h.e.tracked,
        elevGainM: h.e.elev || null,
        cadenceSpm: h.e.cadence || null,
      };
    });
  return {
    goal: goal || DEFAULT_GOAL,
    // the race target set on the Stats tab, with the app's own prediction, so
    // the coach argues with a number rather than inventing one
    raceGoal: race || null,
    planProgress: `${stats.done}/${TOTAL} plan sessions done`,
    totals: {
      kmLogged: Number(stats.kmLogged.toFixed(1)),
      runs: stats.runsLogged,
      timeOnFeet: mins(stats.minTotal),
      avgPace: pace(stats.avgPaceSec),
      bestPace: pace(stats.bestPaceSec),
      longestRunKm: stats.maxKm,
      fastestKm: pace(stats.bestSplitSec),
      bestClimbM: stats.bestElevM || 0,
      totalKcal: Math.round(stats.totalKcal || 0),
    },
    consistency: {
      currentStreak: stats.curStreak,
      bestStreak: stats.best,
      runsWithStitch: stats.stitches,
    },
    weeklyKm: weekly.map((w) => ({ week: w.label, logged: Number(w.value.toFixed(1)), planTarget: w.target })),
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

// One-tap follow-up questions shown as chips under the conversation.
export const QUICK_ASKS = [
  { label: "How's my pacing?", text: "How is my pacing across recent runs? Am I going out too fast or too slow?" },
  { label: "Ready for 5K?", text: "Based on my data, am I ready to run a continuous 5K? What's the gap?" },
  { label: "Run longer", text: "How do I build up to running longer distances without walking breaks?" },
  { label: "Stop stitches", text: "Why might I be getting side stitches, and how do I prevent them?" },
  { label: "Pre-run fuel", text: "What should I eat and drink before and after a run at my level?" },
  { label: "Plan beyond 5K", text: "Build me a simple week-by-week plan to progress beyond 5K toward running as far as I can." },
];

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

  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch { /* non-JSON error body */ }
    if (res.status === 401) throw new Error("That API key was rejected — double-check it.");
    if (res.status === 404) throw new Error(`Model "${model}" not found — try another Groq model.`);
    if (res.status === 429) throw new Error("Groq rate limit hit — wait a moment, then retry.");
    throw new Error(detail || `Coach request failed (${res.status}).`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("The coach sent back an empty reply — try again.");
  return text;
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

  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch { /* non-JSON error body */ }
    if (res.status === 401) throw new Error("That API key was rejected — double-check it.");
    if (res.status === 404) throw new Error(`Model "${model}" not found — try another Groq model.`);
    if (res.status === 429) throw new Error("Groq rate limit hit — wait a moment, then retry.");
    throw new Error(detail || `Plan request failed (${res.status}).`);
  }

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
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch { /* ignore */ }
    if (res.status === 401) throw new Error("That API key was rejected — double-check it.");
    if (res.status === 429) throw new Error("Groq rate limit hit — wait a moment, then retry.");
    throw new Error(detail || `Plan request failed (${res.status}).`);
  }
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
