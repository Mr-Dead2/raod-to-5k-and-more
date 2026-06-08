// Audio feedback for the run tracker: spoken cues (Web Speech) + beeps (Web Audio).
// Both are best-effort and silent if unsupported.

let actx;
function ctx() {
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); } catch { /* ignore */ }
  return actx;
}

// Unlock audio inside a user gesture (call from the Start button).
export function primeAudio() {
  const c = ctx();
  if (c && c.state === "suspended") c.resume().catch(() => {});
}

export function beep(freq = 880, ms = 160, vol = 0.18) {
  const c = ctx();
  if (!c) return;
  try {
    const o = c.createOscillator(), g = c.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.value = vol;
    o.connect(g); g.connect(c.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + ms / 1000);
    o.stop(c.currentTime + ms / 1000);
  } catch { /* ignore */ }
}

export function speak(text) {
  try {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1; u.pitch = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

// Turn seconds-per-km into a spoken phrase, e.g. "6 minutes 5 seconds".
export function paceWords(secPerKm) {
  if (!secPerKm || !isFinite(secPerKm)) return "";
  const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
  return `${m} minute${m === 1 ? "" : "s"}${s ? ` ${s} second${s === 1 ? "" : "s"}` : ""}`;
}
