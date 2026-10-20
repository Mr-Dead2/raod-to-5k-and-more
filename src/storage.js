// Progress persistence. Replaces the artifact-only `window.storage` with
// localStorage so the app works as a real PWA on a phone/desktop.
// If you ever change the stored shape incompatibly, bump the suffix (v2 -> v3).
const KEY = "run5k:v2";
const LEGACY_KEYS = ["run5k:v1", "run5k"]; // older installs — migrated on first load

export function loadLog() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
    for (const k of LEGACY_KEYS) {
      const old = localStorage.getItem(k);
      if (old) {
        const log = JSON.parse(old);
        if (log && typeof log === "object") { localStorage.setItem(KEY, old); return log; }
      }
    }
    return {};
  } catch {
    return {};
  }
}

export function saveLog(log) {
  try {
    localStorage.setItem(KEY, JSON.stringify(log));
  } catch {
    /* storage full or blocked — fail silently like the original */
  }
}

// App settings (e.g. plan start date) kept separate from per-day progress.
const SETTINGS = "run5k:settings";

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS)) || {};
  } catch {
    return {};
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS, JSON.stringify(s)); } catch { /* ignore */ }
}

// The gym, kept apart from the run log because it isn't keyed by plan day:
// logged workouts as a list, and the one in progress, saved after every tick
// so a killed app or a dead battery mid-workout loses nothing.
const GYM = "run5k:gym:v1";
const GYM_ACTIVE = "run5k:gym:active";

export function loadGym() {
  try {
    const v = JSON.parse(localStorage.getItem(GYM));
    return Array.isArray(v) ? v.filter((s) => s && typeof s === "object" && s.id) : [];
  } catch {
    return [];
  }
}

export function saveGym(sessions) {
  try { localStorage.setItem(GYM, JSON.stringify(sessions)); } catch { /* ignore */ }
}

export function loadActiveWorkout() {
  try {
    const v = JSON.parse(localStorage.getItem(GYM_ACTIVE));
    return v && v.v === 1 && Array.isArray(v.items) && v.items.length ? v : null;
  } catch {
    return null;
  }
}

export function saveActiveWorkout(draft) {
  try {
    if (draft) localStorage.setItem(GYM_ACTIVE, JSON.stringify(draft));
    else localStorage.removeItem(GYM_ACTIVE);
  } catch { /* ignore */ }
}
