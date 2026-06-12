// Achievement/badge definitions. Each `test(ctx)` receives a snapshot of the
// user's progress (computed in App) and returns true when the badge is earned.
export const ACHIEVEMENTS = [
  { id: "first", icon: "🥾", title: "First Steps", desc: "Complete your first session", test: (c) => c.done >= 1 },
  { id: "fivek", icon: "🏅", title: "5K Logged", desc: "Log a run of 5 km or more", test: (c) => c.maxKm >= 5 },
  { id: "week", icon: "🔥", title: "Week Warrior", desc: "Finish every day in a week", test: (c) => c.fullWeeks >= 1 },
  { id: "half", icon: "⛰️", title: "Halfway There", desc: "Complete 14 sessions", test: (c) => c.done >= 14 },
  { id: "stitch", icon: "🛡️", title: "Stitch Slayer", desc: "3 logged runs with no side stitch", test: (c) => c.stitchlessRuns >= 3 },
  { id: "speed", icon: "⚡", title: "Speedster", desc: "Run faster than 6:00 / km", test: (c) => c.bestPaceSec > 0 && c.bestPaceSec < 360 },
  { id: "twenty", icon: "🛣️", title: "20 KM Club", desc: "Log 20 km in total", test: (c) => c.kmLogged >= 20 },
  { id: "early", icon: "🌅", title: "Early Bird", desc: "Finish a session before 8 am", test: (c) => c.earlyRuns >= 1 },
  { id: "owl", icon: "🦉", title: "Night Owl", desc: "Finish a session after 9 pm", test: (c) => c.lateRuns >= 1 },
  { id: "streak7", icon: "⛓️", title: "Unbroken", desc: "Hit a 7-day streak", test: (c) => c.best >= 7 },
  { id: "marathon", icon: "🗺️", title: "Marathon Month", desc: "Log 42.2 km in total", test: (c) => c.kmLogged >= 42.2 },
  { id: "complete", icon: "🎖️", title: "Mission Complete", desc: "Finish the whole 4-week plan", test: (c) => c.done >= 28 },
];

// Returns the set of unlocked achievement ids for a given context.
export function unlockedIds(ctx) {
  const set = new Set();
  for (const a of ACHIEVEMENTS) {
    try { if (a.test(ctx)) set.add(a.id); } catch { /* ignore */ }
  }
  return set;
}
