// Small, dependency-free celebration helpers: haptic buzz + canvas confetti.

// Vibrate if the device/browser supports it (Android Chrome does; iOS ignores).
export function haptic(pattern = 12) {
  try { navigator.vibrate && navigator.vibrate(pattern); } catch { /* ignore */ }
}

// Fire a confetti burst from the bottom-centre of the screen. Self-cleaning.
export function confetti({ count = 90, spread = 1 } = {}) {
  if (typeof document === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const colors = ["#ccff33", "#43e0c4", "#ff6a3d", "#f1f3ee"];
  const canvas = document.createElement("canvas");
  Object.assign(canvas.style, {
    position: "fixed", inset: "0", width: "100%", height: "100%",
    pointerEvents: "none", zIndex: "9999",
  });
  document.body.appendChild(canvas);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.width = window.innerWidth * dpr;
  const H = canvas.height = window.innerHeight * dpr;
  const ctx = canvas.getContext("2d");

  const parts = Array.from({ length: count }, () => {
    const angle = (-Math.PI / 2) + (Math.random() - 0.5) * 1.6 * spread;
    const speed = (10 + Math.random() * 14) * dpr;
    return {
      x: W / 2 + (Math.random() - 0.5) * 60 * dpr,
      y: H * 0.92,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: (5 + Math.random() * 6) * dpr,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[(Math.random() * colors.length) | 0],
      life: 1,
    };
  });

  const gravity = 0.32 * dpr;
  const start = performance.now();
  function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, W, H);
    let alive = false;
    for (const p of parts) {
      p.vy += gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      if (t > 1400) p.life -= 0.04;
      if (p.life > 0 && p.y < H + 40 * dpr) {
        alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
    }
    if (alive && t < 2600) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}
