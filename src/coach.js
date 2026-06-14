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
export function buildSummary({ stats, weekly, history, goal }) {
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
        stitch: !!h.e.stitch,
        gps: !!h.e.tracked,
        elevGainM: h.e.elev || null,
      };
    });
  return {
    goal: goal || DEFAULT_GOAL,
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
  };
}

const SYSTEM_PROMPT = [
  "You are an upbeat, expert running coach reviewing a runner's training log",
  "from their phone app. Be specific and practical, never generic — base every",
  "point on the data you are given. If the data is thin, say what to log next.",
  "",
  "Write in plain text only: no markdown headers, no ** bold **, no tables.",
  "Structure the reply as:",
  "1) one warm sentence on how they're doing,",
  "2) 2-4 short lines each starting with '- ' on what to improve or watch",
  "   (pacing, consistency, weekly distance progression, recovery, stitches),",
  "3) a final line starting with 'Next: ' naming one concrete session or focus",
  "   for the coming days that moves them toward their stated goal.",
  "Keep the whole reply under 180 words. Encouraging, concrete, and honest.",
].join("\n");

// Call Groq and return the coaching text. Throws a user-friendly Error on failure.
export async function getCoaching({ apiKey, model, summary, signal }) {
  const user = [
    "Here is my running data as JSON. Coach me toward my goal:",
    "",
    JSON.stringify(summary, null, 2),
  ].join("\n");

  let res;
  try {
    res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        temperature: 0.6,
        max_tokens: 500,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
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
    throw new Error(detail || `Coach request failed (${res.status}).`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("The coach sent back an empty reply — try again.");
  return text;
}
