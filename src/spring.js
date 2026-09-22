// ---------------------------------------------------------------------------
// Springs, the Apple way.
//
// Motion that a finger can touch has to be interruptible: grab it mid-flight
// and it must carry on from where it *is* on screen, at the speed it is going,
// towards wherever it is now told to go. A spring does that for free — a new
// target just changes the force, so the value and its velocity stay continuous.
// A CSS transition cannot: it restarts from its own idea of the start value.
//
// Parameters are Apple's designer-friendly pair rather than mass/stiffness:
//   damping  — 1 = critically damped (no overshoot), < 1 bounces. Keep 1 for
//              anything that simply moves; ~0.8 only after a flick or a throw.
//   response — seconds to (roughly) reach the target. Not a duration: a
//              spring has none, its settle time falls out of the physics.
// Mass is 1, stiffness = (2π / response)², damping = 4π·ζ / response.
//
// Dependency-free, like the rest of the app; nothing here touches React, so a
// spring can drive a DOM transform every frame without a single re-render.
// ---------------------------------------------------------------------------

export const reducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const coefficients = (damping, response) => {
  const r = Math.max(0.05, response);
  return { k: (2 * Math.PI / r) ** 2, c: (4 * Math.PI * damping) / r };
};

/**
 * createSpring({ value, damping, response, onUpdate(value, velocity), onRest })
 *   .to(target, { velocity?, damping?, response? })  animate, keeping momentum
 *   .set(value)            jump there (1:1 drag tracking) and stop animating
 *   .value / .velocity     the live, on-screen state — interrupt from these
 *   .stop()
 */
export function createSpring({ value = 0, damping = 1, response = 0.35, onUpdate, onRest } = {}) {
  let x = value, v = 0, target = value, raf = 0, last = 0;
  let { k, c } = coefficients(damping, response);

  const emit = () => onUpdate && onUpdate(x, v);
  const settle = () => { x = target; v = 0; raf = 0; emit(); onRest && onRest(x); };

  const frame = (now) => {
    // Clamp the step so a backgrounded tab doesn't come back and teleport.
    const dt = Math.min(0.064, Math.max(0, (now - last) / 1000));
    last = now;
    // Semi-implicit Euler in small fixed sub-steps: stable at any frame rate.
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      v += (-k * (x - target) - c * v) * h;
      x += v * h;
    }
    if (Math.abs(v) < 0.5 && Math.abs(x - target) < 0.05) { settle(); return; }
    emit();
    raf = requestAnimationFrame(frame);
  };

  return {
    to(next, opts = {}) {
      target = next;
      if (opts.velocity != null) v = opts.velocity;
      if (opts.damping != null || opts.response != null) {
        ({ k, c } = coefficients(opts.damping ?? damping, opts.response ?? response));
      }
      if (reducedMotion()) { cancelAnimationFrame(raf); settle(); return; }
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
    },
    set(next) {
      cancelAnimationFrame(raf); raf = 0;
      x = target = next; v = 0;
      emit();
    },
    stop() { cancelAnimationFrame(raf); raf = 0; },
    get value() { return x; },
    get velocity() { return v; },
    get target() { return target; },
  };
}

// Where a flick is *going*, not where it was let go: Apple's projection from
// the Designing Fluid Interfaces sample code (the scroll-view deceleration
// curve). Velocity in px/s; 0.998 feels like a normal scroll, 0.99 snappier.
export const project = (velocity, rate = 0.998) => ((velocity / 1000) * rate) / (1 - rate);

// Past a boundary, follow less and less — resistance, never a hard stop.
export const rubberband = (overshoot, dimension, constant = 0.55) =>
  (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));

// Release velocity from a short history of pointer samples, so the spring can
// carry on at exactly the speed the finger left at.
export function velocityTracker() {
  let samples = [];
  return {
    add(pos, t = performance.now()) {
      samples.push({ pos, t });
      while (samples.length > 2 && t - samples[0].t > 90) samples.shift();
    },
    velocity(now = performance.now()) {
      if (samples.length < 2) return 0;
      const a = samples[0], b = samples[samples.length - 1];
      // A finger that stopped before lifting has no speed left to hand over.
      if (now - b.t > 100) return 0;
      const dt = (b.t - a.t) / 1000;
      return dt > 0 ? (b.pos - a.pos) / dt : 0;
    },
    reset() { samples = []; },
  };
}
