// Progress persistence. Replaces the artifact-only `window.storage` with
// localStorage so the app works as a real PWA on a phone/desktop.
// If you ever change the stored shape incompatibly, bump the suffix (v2 -> v3).
const KEY = "run5k:v2";

export function loadLog() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
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
