// ---------------------------------------------------------------------------
// Share cards.
//
// One canvas renderer that turns anything worth bragging about — a run, a gym
// workout, the whole training block, a badge, a race prediction — into an image sized for
// the place it is going (a feed square, a 9:16 story, a wide link preview).
//
// Everything here is pure drawing plus a thin export layer; the picker UI lives
// in components/ShareSheet.jsx. Colours come from the live `C` tokens, so a
// card always matches the accent the user picked.
// ---------------------------------------------------------------------------
import { C, tint } from "./data.js";
import { isNative } from "./native.js";
import { SILHOUETTE, LIMBS, FRONT, BACK, FIGURE_W, FIGURE_H, FIGURE_GAP } from "./bodyShapes.js";

// Cards are laid out in these logical units and rendered at SCALE for crispness.
// 540×540 → 1080×1080, 540×960 → 1080×1920, 640×335 → 1280×670.
const SCALE = 2;

export const FORMATS = [
  { id: "square", name: "Square", w: 540, h: 540, hint: "Feed · WhatsApp" },
  { id: "story", name: "Story", w: 540, h: 960, hint: "Stories · Reels" },
  { id: "wide", name: "Wide", w: 640, h: 335, hint: "Link preview" },
];

export const STYLES = [
  { id: "bold", name: "Bold", hint: "Big number, stats underneath" },
  { id: "route", name: "Route", hint: "The map does the talking" },
  { id: "minimal", name: "Minimal", hint: "One number, nothing else" },
];

export const formatById = (id) => FORMATS.find((f) => f.id === id) || FORMATS[0];

// The app's own type: SF (Rounded for figures, as Fitness shares them) on
// Apple devices, the bundled Inter everywhere else.
const DISP = "ui-rounded, 'SF Pro Rounded', -apple-system, BlinkMacSystemFont, 'Inter Variable', system-ui, sans-serif";
const BODY = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter Variable', system-ui, sans-serif";

// --- formatting ------------------------------------------------------------

export const fmtPace = (s) =>
  s && isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : null;

export const fmtClock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, "0"), ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

const fmtDate = (d) =>
  new Date(d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

// --- canvas primitives -----------------------------------------------------

function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

// A soft radial wash of colour — the still accent light behind the app's large titles.
function glow(ctx, x, y, r, color, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, tint(color, alpha));
  g.addColorStop(0.55, tint(color, alpha * 0.35));
  g.addColorStop(1, tint(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

const accentGradient = (ctx, x, y, w, h) => {
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, C.accent);
  g.addColorStop(1, C.accent2);
  return g;
};

function text(ctx, str, x, y, { font, color, align = "left", baseline = "alphabetic", letter = 0 }) {
  ctx.font = font;
  ctx.textAlign = letter ? "left" : align;
  ctx.textBaseline = baseline;
  ctx.fillStyle = color;
  if (!letter) { ctx.fillText(str, x, y); return ctx.measureText(str).width; }
  // Manual letter-spacing: canvas has no reliable cross-browser `letterSpacing`.
  const chars = [...String(str)];
  const total = chars.reduce((s, c) => s + ctx.measureText(c).width + letter, 0) - letter;
  let cx = align === "right" ? x - total : align === "center" ? x - total / 2 : x;
  for (const c of chars) { ctx.fillText(c, cx, y); cx += ctx.measureText(c).width + letter; }
  return total;
}

// Small uppercase label, the card equivalent of the app's <Label>.
const label = (ctx, str, x, y, color = C.dim, size = 10, align = "left") =>
  text(ctx, String(str).toUpperCase(), x, y, {
    font: `800 ${size}px ${BODY}`, color, align, baseline: "top", letter: size * 0.18,
  });

// The brand mark: rounded accent tile with the speed-lines chevron.
function drawMark(ctx, x, y, size) {
  ctx.save();
  rr(ctx, x, y, size, size, size * 0.32);
  ctx.fillStyle = accentGradient(ctx, x, y, size, size);
  ctx.shadowColor = tint(C.accent, 0.5);
  ctx.shadowBlur = size * 0.7;
  ctx.shadowOffsetY = size * 0.16;
  ctx.fill();
  ctx.restore();

  const u = size / 24;
  ctx.save();
  ctx.translate(x + size * 0.5 - 12 * u * 0.79, y + size * 0.5 - 12 * u * 0.79);
  ctx.scale(u * 0.79, u * 0.79);
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2.7;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(3, 8); ctx.lineTo(9, 8);
  ctx.moveTo(2, 13); ctx.lineTo(6, 13);
  ctx.moveTo(5, 18); ctx.lineTo(9, 18);
  ctx.moveTo(12, 5); ctx.lineTo(19, 12); ctx.lineTo(12, 19);
  ctx.stroke();
  ctx.restore();
}

// A glassy panel: the card surface used for stat blocks and the map well.
function panel(ctx, x, y, w, h, { r = 20, tone = 0.05, border = C.line, accented = false } = {}) {
  rr(ctx, x, y, w, h, r);
  if (accented) {
    const g = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
    g.addColorStop(0, tint(C.accent, 0.17));
    g.addColorStop(0.5, tint(C.accent2, 0.07));
    g.addColorStop(1, tint("#ffffff", 0.02));
    ctx.fillStyle = g;
  } else {
    const g = ctx.createLinearGradient(x, y, x + w * 0.3, y + h);
    g.addColorStop(0, tint("#ffffff", tone));
    g.addColorStop(1, tint("#ffffff", tone * 0.25));
    ctx.fillStyle = g;
  }
  ctx.fill();
  ctx.strokeStyle = accented ? tint(C.accent, 0.32) : border;
  ctx.lineWidth = 1;
  ctx.stroke();
  // hairline rim highlight along the top edge, matching .card in the app
  ctx.save();
  rr(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.strokeStyle = tint("#ffffff", accented ? 0.16 : 0.09);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x + r * 0.6, y + 0.7);
  ctx.lineTo(x + w - r * 0.6, y + 0.7);
  ctx.stroke();
  ctx.restore();
}

// A pill chip, returns its width so chips can be laid out in a row.
function chip(ctx, str, x, y, { h = 26, pad = 12, size = 11.5, color = C.dim, bg = tint("#ffffff", 0.055), border = C.line } = {}) {
  ctx.font = `700 ${size}px ${BODY}`;
  const w = ctx.measureText(str).width + pad * 2;
  rr(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.stroke(); }
  text(ctx, str, x + pad, y + h / 2 + 0.5, { font: `700 ${size}px ${BODY}`, color, baseline: "middle" });
  return w;
}

// Shorten a string with an ellipsis until it fits — names come from the user
// and the coach, and a card has no room for a second line.
function fit(ctx, str, font, maxW) {
  ctx.font = font;
  let s = String(str);
  if (ctx.measureText(s).width <= maxW) return s;
  while (s.length > 1 && ctx.measureText(`${s}\u2026`).width > maxW) s = s.slice(0, -1);
  return `${s.trimEnd()}\u2026`;
}

// The same for a tracked-out small-caps label, which label() spaces by hand.
function fitLabel(ctx, str, size, maxW) {
  const width = (t) => {
    ctx.font = `800 ${size}px ${BODY}`;
    const chars = [...t.toUpperCase()];
    return chars.reduce((w, c) => w + ctx.measureText(c).width, 0) + size * 0.18 * Math.max(0, chars.length - 1);
  };
  let s = String(str);
  if (width(s) <= maxW) return s;
  while (s.length > 1 && width(`${s}\u2026`) > maxW) s = s.slice(0, -1);
  return `${s.trimEnd()}\u2026`;
}

// --- the muscle map ----------------------------------------------------------

// The in-app muscle map, painted: the same shapes BodyMap draws as SVG
// (bodyShapes.js), so the card shows exactly what the app showed.
const MAP_RATIO = (FIGURE_W * 2 + FIGURE_GAP) / FIGURE_H;

function bodyShape(ctx, s) {
  ctx.save();
  if (s.rot) {
    const [a, px, py] = s.rot;
    ctx.translate(px, py);
    ctx.rotate((a * Math.PI) / 180);
    ctx.translate(-px, -py);
  }
  if (s.t === "ellipse") { ctx.beginPath(); ctx.ellipse(s.cx, s.cy, s.rx, s.ry, 0, 0, Math.PI * 2); ctx.fill(); }
  else if (s.t === "rect") { rr(ctx, s.x, s.y, s.w, s.h, s.r || 0); ctx.fill(); }
  else ctx.fill(new Path2D(s.d));
  ctx.restore();
}

// Front and back figures, `h` tall, from (x, y); returns the width used.
function drawBodyMap(ctx, muscles, x, y, h) {
  const primary = new Set(muscles.primary || []);
  const secondary = new Set(muscles.secondary || []);
  const k = h / FIGURE_H;
  const half = (view) => {
    ctx.fillStyle = C.surface2;
    LIMBS.forEach((s) => bodyShape(ctx, s));
    for (const [m, list] of Object.entries(view)) {
      const lit = primary.has(m);
      ctx.fillStyle = lit ? C.accent : secondary.has(m) ? tint(C.accent, 0.42) : C.surface3;
      ctx.shadowColor = lit ? tint(C.accent, 0.6) : "transparent";
      ctx.shadowBlur = lit ? 8 : 0;
      list.forEach((s) => bodyShape(ctx, s));
    }
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
  };
  [[FRONT, 0], [BACK, FIGURE_W + FIGURE_GAP]].forEach(([view, fx]) => {
    ctx.save();
    ctx.translate(x + fx * k, y);
    ctx.scale(k, k);
    ctx.fillStyle = C.surface2;
    SILHOUETTE.forEach((s) => bodyShape(ctx, s));
    half(view);
    ctx.translate(FIGURE_W, 0);
    ctx.scale(-1, 1);
    half(view);
    ctx.restore();
  });
  return h * MAP_RATIO;
}

// --- route drawing ---------------------------------------------------------

function projectRoute(route, x, y, w, h, pad) {
  const lats = route.map((p) => p[0]);
  const lngs = route.map((p) => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  // Longitude degrees shrink with latitude — without this the shape is skewed.
  const midLat = ((minLat + maxLat) / 2) * Math.PI / 180;
  const latR = (maxLat - minLat) || 1e-5;
  const lngR = ((maxLng - minLng) * Math.cos(midLat)) || 1e-5;
  const aw = Math.max(1, w - pad * 2), ah = Math.max(1, h - pad * 2);
  const scale = Math.min(aw / lngR, ah / latR);
  const sw = lngR * scale, sh = latR * scale;
  const ox = x + pad + (aw - sw) / 2;
  const oy = y + pad + (ah - sh) / 2;
  return route.map((p) => ({
    x: ox + (p[1] - minLng) * Math.cos(midLat) * scale,
    y: oy + sh - (p[0] - minLat) * scale,
  }));
}

function drawRoute(ctx, route, x, y, w, h, { pad = 26, width = 6, dots = true } = {}) {
  if (!route || route.length < 2) return;
  const pts = projectRoute(route, x, y, w, h, pad);

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  };

  // a wide, soft under-stroke reads as light spilling off the line
  trace();
  ctx.strokeStyle = tint(C.accent, 0.16);
  ctx.lineWidth = width * 3.2;
  ctx.stroke();

  trace();
  ctx.strokeStyle = accentGradient(ctx, x, y, w, h);
  ctx.lineWidth = width;
  ctx.shadowColor = tint(C.accent, 0.65);
  ctx.shadowBlur = width * 2.6;
  ctx.stroke();
  ctx.shadowBlur = 0;

  if (dots) {
    const s = pts[0], e = pts[pts.length - 1];
    ctx.fillStyle = "#000";
    ctx.strokeStyle = C.accent2;
    ctx.lineWidth = width * 0.55;
    ctx.beginPath(); ctx.arc(s.x, s.y, width * 1.25, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    ctx.shadowColor = tint(C.accent, 0.8);
    ctx.shadowBlur = width * 2.4;
    ctx.fillStyle = C.accent;
    ctx.beginPath(); ctx.arc(e.x, e.y, width * 1.45, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// Per-km splits as a small bar chart: fastest km is the tallest bar.
function drawSplits(ctx, splits, x, y, w, h) {
  const list = splits.slice(0, 14);
  if (!list.length) return;
  const fast = Math.min(...list), slow = Math.max(...list);
  const span = Math.max(1, slow - fast);
  const gap = Math.min(7, w / (list.length * 5));
  const bw = (w - gap * (list.length - 1)) / list.length;
  list.forEach((s, i) => {
    const norm = 1 - (s - fast) / span;          // fastest = 1
    const bh = Math.max(h * 0.22, h * (0.3 + norm * 0.7));
    const bx = x + i * (bw + gap);
    const by = y + h - bh;
    rr(ctx, bx, by, bw, bh, Math.min(bw / 2, 6));
    const g = ctx.createLinearGradient(bx, by, bx, by + bh);
    g.addColorStop(0, s === fast ? C.accent : tint(C.accent, 0.55));
    g.addColorStop(1, tint(C.accent2, 0.18));
    ctx.fillStyle = g;
    ctx.fill();
  });
  // ticks under the first, middle and last kilometre
  const marks = list.length > 3 ? [0, Math.floor(list.length / 2), list.length - 1] : list.map((_, i) => i);
  ctx.font = `700 9px ${BODY}`;
  ctx.fillStyle = C.dim2;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const i of new Set(marks)) ctx.fillText(`${i + 1}k`, x + i * (bw + gap) + bw / 2, y + h + 6);
  ctx.textAlign = "left";
}

// The app's progress ring, for the progress card.
function drawRing(ctx, cx, cy, r, pct, { width = 12 } = {}) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = width;
  ctx.strokeStyle = tint("#ffffff", 0.08);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, C.accent);
  g.addColorStop(1, C.accent2);
  ctx.strokeStyle = g;
  ctx.shadowColor = tint(C.accent, 0.55);
  ctx.shadowBlur = width;
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.001, Math.min(1, pct / 100)));
  ctx.stroke();
  ctx.restore();
}

// --- shared chrome ---------------------------------------------------------

function drawGround(ctx, W, H) {
  // True black, as the app is — with the accent bleeding in from the top, the
  // same still wash that sits behind every large title.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#0b0b0c");
  g.addColorStop(1, "#000000");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const big = Math.max(W, H);
  glow(ctx, W * 0.12, -H * 0.04, big * 0.66, C.accent, 0.17);
  glow(ctx, W * 1.02, H * 0.08, big * 0.48, C.accent2, 0.1);

  // a hairline inner frame keeps the card from bleeding into a dark feed
  ctx.strokeStyle = tint("#ffffff", 0.06);
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);
}

function drawHeader(ctx, W, pad, y, { title, date, compact }) {
  const size = compact ? 26 : 32;
  drawMark(ctx, pad, y, size);
  // Wordmark sits on the upper half, the card's own title on the lower half —
  // both inside the mark's height, so the header is one optical block.
  text(ctx, "STRIDE", pad + size + 11, y + size * (title ? 0.42 : 0.5) + 1, {
    font: `800 ${compact ? 13 : 14.5}px ${DISP}`, color: C.text,
    baseline: title ? "alphabetic" : "middle", letter: 1.6,
  });
  if (title) {
    label(ctx, title, pad + size + 11, y + size * 0.56, C.dim, compact ? 8.5 : 9);
  }
  if (date) {
    text(ctx, date, W - pad, y + size * 0.5 + 1, {
      font: `600 ${compact ? 11.5 : 12.5}px ${BODY}`, color: C.dim, align: "right", baseline: "middle",
    });
  }
  return y + size;
}

function drawFooter(ctx, W, pad, y, note) {
  ctx.save();
  ctx.strokeStyle = tint("#ffffff", 0.07);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
  ctx.restore();
  label(ctx, note || "Tracked with Stride", pad, y + 13, C.dim2, 9.5);
  // three accent speed ticks on the right, echoing the mark
  const bx = W - pad;
  for (let i = 0; i < 3; i++) {
    const w = 16 - i * 4;
    rr(ctx, bx - w, y + 15 + i * 5, w, 2.5, 1.25);
    ctx.fillStyle = tint(C.accent, 0.75 - i * 0.22);
    ctx.fill();
  }
}

// A row of figures separated by hairlines — cleaner than a row of boxes.
function drawStatRow(ctx, cells, x, y, w, { size = 27, labelSize = 9.5, heroIndex = -1 } = {}) {
  const cw = w / cells.length;
  cells.forEach((cell, i) => {
    const cx = x + i * cw;
    if (i > 0) {
      ctx.strokeStyle = tint("#ffffff", 0.09);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, y + 4); ctx.lineTo(cx, y + size + 20); ctx.stroke();
    }
    const v = String(cell.value);
    ctx.font = `700 ${size}px ${DISP}`;
    const vw = ctx.measureText(v).width;
    const isHero = i === heroIndex;
    text(ctx, v, cx + 14, y, {
      font: `700 ${size}px ${DISP}`,
      color: isHero ? accentGradient(ctx, cx + 14, y, vw, size) : cell.color || C.text,
      baseline: "top",
    });
    if (cell.unit) {
      text(ctx, cell.unit, cx + 14 + vw + 4, y + size * 0.72, {
        font: `700 ${size * 0.4}px ${DISP}`, color: C.dim, baseline: "alphabetic",
      });
    }
    label(ctx, cell.label, cx + 14, y + size + 8, C.dim, labelSize);
  });
}

// --- card content ----------------------------------------------------------

// Everything a card can say about a run, derived once so every style agrees.
function runFacts(run) {
  const km = parseFloat(run.km) || 0;
  const durMs = run.durMs || (run.min ? run.min * 60000 : 0);
  const paceS = km > 0 && durMs > 0 ? durMs / 1000 / km : 0;
  const chips = [];
  if (run.elev > 0) chips.push(`▲ ${run.elev} m climb`);
  if (run.kcal > 0) chips.push(`${run.kcal} kcal`);
  if (run.hrAvg > 0) chips.push(`♥ ${run.hrAvg} avg bpm`);
  if (run.cadence > 0) chips.push(`${run.cadence} spm`);
  if (run.runKm > 0 && run.walkKm > 0) chips.push(`${run.runKm} run · ${run.walkKm} walk`);
  return { km, durMs, paceS, chips };
}

function cardTitle(spec) {
  if (spec.title) return spec.title;
  if (spec.kind === "achievement") return "Achievement unlocked";
  if (spec.kind === "progress") return "Training progress";
  if (spec.kind === "goal") return "Race goal";
  if (spec.kind === "gym") return "Workout complete";
  return "Run complete";
}

// --- the renderer ----------------------------------------------------------

/**
 * spec = {
 *   kind: "run" | "gym" | "progress" | "achievement" | "goal",
 *   format: "square" | "story" | "wide",
 *   style: "bold" | "route" | "minimal",
 *   data: {...},                 // shape depends on kind
 *   options: { route, splits, extras, date, note, muscles, lifts }
 * }
 */
export async function renderCard(spec) {
  await fontsReady();
  const fmt = formatById(spec.format);
  const style = spec.style || "bold";
  const W = fmt.w, H = fmt.h;

  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = "alphabetic";

  drawGround(ctx, W, H);

  const wide = fmt.id === "wide";
  const pad = wide ? 30 : 34;
  const opts = spec.options || {};
  const dateStr = opts.date === false ? null : fmtDate(spec.data.date || Date.now());

  const headerBottom = drawHeader(ctx, W, pad, pad, {
    title: cardTitle(spec), date: dateStr, compact: wide,
  });

  const footerY = H - pad - 26;
  const bodyTop = headerBottom + (wide ? 18 : 26);
  const bodyH = footerY - 16 - bodyTop;

  const draw = {
    run: drawRunBody,
    gym: drawGymBody,
    progress: drawProgressBody,
    achievement: drawAchievementBody,
    goal: drawGoalBody,
  }[spec.kind] || drawRunBody;

  draw(ctx, { W, H, pad, top: bodyTop, height: bodyH, style, fmt, spec, opts });

  drawFooter(ctx, W, pad, footerY, opts.note);

  return canvas;
}

function drawRunBody(ctx, g) {
  const { W, pad, top, height, style, fmt, spec, opts } = g;
  const run = spec.data;
  const { km, durMs, paceS, chips } = runFacts(run);
  const inner = W - pad * 2;
  const hasRoute = opts.route !== false && Array.isArray(run.route) && run.route.length > 1;
  const hasSplits = opts.splits !== false && Array.isArray(run.splits) && run.splits.length > 1;
  const wide = fmt.id === "wide";

  // ---- MINIMAL: one enormous number and a single line of context ----
  if (style === "minimal") {
    const cy = top + height / 2;
    const size = wide ? 96 : fmt.id === "story" ? 150 : 128;
    ctx.font = `700 ${size}px ${DISP}`;
    const num = km.toFixed(2);
    const numW = ctx.measureText(num);
    text(ctx, num, W / 2, cy - size * 0.18, {
      font: `700 ${size}px ${DISP}`,
      color: accentGradient(ctx, W / 2 - numW.width / 2, cy - size, numW.width, size * 1.4),
      align: "center", baseline: "middle",
    });
    label(ctx, "kilometres", W / 2, cy + size * 0.36, C.dim, wide ? 11 : 13, "center");
    const line = [fmtClock(durMs), fmtPace(paceS) ? `${fmtPace(paceS)} /km` : null].filter(Boolean).join("   ·   ");
    if (line) {
      text(ctx, line, W / 2, cy + size * 0.36 + (wide ? 34 : 46), {
        font: `700 ${wide ? 16 : 20}px ${DISP}`, color: C.text, align: "center", baseline: "top",
      });
    }
    return;
  }

  // ---- WIDE: route on the left, figures on the right ----
  if (wide) {
    const mapW = hasRoute ? inner * 0.42 : 0;
    if (hasRoute) {
      panel(ctx, pad, top, mapW, height, { r: 18 });
      drawRoute(ctx, run.route, pad, top, mapW, height, { pad: 20, width: 5 });
    }
    const x = pad + (hasRoute ? mapW + 20 : 0);
    const w = W - pad - x;
    ctx.font = `700 76px ${DISP}`;
    const numW = ctx.measureText(km.toFixed(2)).width;
    text(ctx, km.toFixed(2), x, top - 4, {
      font: `700 76px ${DISP}`, color: accentGradient(ctx, x, top, numW, 76), baseline: "top",
    });
    text(ctx, "km", x + numW + 8, top + 48, { font: `700 22px ${DISP}`, color: C.dim, baseline: "alphabetic" });
    drawStatRow(ctx, [
      { label: "Time", value: fmtClock(durMs) },
      { label: "Pace", value: fmtPace(paceS) || "—", unit: fmtPace(paceS) ? "/km" : "" },
    ], x - 14, top + 92, w + 14, { size: 26 });
    return;
  }

  // ---- ROUTE / BOLD ----
  // Blocks are measured before anything is drawn, so the stack can be placed
  // in the space it actually has. Piling everything at the top left a dead
  // half on tall story cards and on any run without a route.
  const story = fmt.id === "story";
  const gap = story ? 22 : 16;
  // With a route the map is the star; without one the number is, so it grows
  // to fill whatever the rest of the card leaves — a bare run on a 9:16 story
  // otherwise floats in the middle of an empty frame.
  let heroSize = hasRoute ? (story ? 92 : 76) : (story ? 112 : 90);
  const statH = story ? 34 : 30;
  const statBoxH = statH + 46;
  const splitsH = story ? 82 : 60;

  const blocks = [];

  const drawHero = (y) => {
    ctx.font = `700 ${heroSize}px ${DISP}`;
    const numTxt = km.toFixed(2);
    const numW = ctx.measureText(numTxt).width;
    text(ctx, numTxt, pad, y, {
      font: `700 ${heroSize}px ${DISP}`,
      color: accentGradient(ctx, pad, y, numW, heroSize), baseline: "top",
    });
    text(ctx, "km", pad + numW + 10, y + heroSize * 0.63, {
      font: `700 ${heroSize * 0.28}px ${DISP}`, color: C.dim, baseline: "alphabetic",
    });
    if (run.title) {
      text(ctx, run.title, pad + numW + 10, y + heroSize * 0.63 + heroSize * 0.28,
        { font: `600 ${story ? 14 : 12.5}px ${BODY}`, color: C.dim2, baseline: "alphabetic" });
    }
  };

  const statCells = [
    { label: "Time", value: fmtClock(durMs) },
    { label: "Avg pace", value: fmtPace(paceS) || "—", unit: fmtPace(paceS) ? "/km" : "" },
  ];
  if (run.kcal > 0) statCells.push({ label: "Calories", value: String(run.kcal) });
  else if (run.elev > 0) statCells.push({ label: "Climb", value: `${run.elev}`, unit: "m" });

  const drawStats = (y) => {
    panel(ctx, pad, y, inner, statBoxH, { r: 18 });
    drawStatRow(ctx, statCells, pad, y + 16, inner, { size: statH });
  };

  const drawMap = (y, h) => {
    panel(ctx, pad, y, inner, h, { r: 22 });
    drawRoute(ctx, run.route, pad, y, inner, h, { pad: story ? 28 : 24, width: story ? 7 : 5.5 });
  };

  const drawSplitBlock = (y, h) => {
    label(ctx, "Kilometre splits", pad, y, C.dim, 9.5);
    const fastest = fmtPace(Math.min(...run.splits));
    if (fastest) label(ctx, `fastest ${fastest}`, W - pad, y, C.accent, 9.5, "right");
    drawSplits(ctx, run.splits, pad, y + 20, inner, h - 34);
  };

  const drawChips = (y) => {
    let cx = pad;
    for (const c of chips) {
      ctx.font = `700 11.5px ${BODY}`;
      const w = ctx.measureText(c).width + 24;
      if (cx + w > W - pad) break;
      chip(ctx, c, cx, y, { color: C.text });
      cx += w + 7;
    }
  };

  if (style === "route" && hasRoute) blocks.push({ key: "map", h: 0 });
  blocks.push({ key: "hero", h: heroSize + (run.title ? 6 : 0), draw: drawHero });
  blocks.push({ key: "stats", h: statBoxH, draw: drawStats });
  if (style === "bold" && hasRoute) blocks.push({ key: "map", h: 0 });
  if (hasSplits && (story || !hasRoute)) blocks.push({ key: "splits", h: 20 + splitsH + 14, min: 20 + 44 + 14, draw: drawSplitBlock });
  if (opts.extras !== false && chips.length) blocks.push({ key: "chips", h: 26, draw: drawChips });
  if (run.note) blocks.push({ key: "note", h: story ? 22 : 18, draw: (y) => text(ctx, `\u201C${run.note}\u201D`, pad, y, { font: `italic 600 ${story ? 15 : 13}px ${BODY}`, color: C.dim, baseline: "top" }) });

  const mapBlock = blocks.find((b) => b.key === "map");
  if (mapBlock) {
    mapBlock.h = Math.round(height * (style === "route" ? 0.5 : 0.36));
    mapBlock.min = 118;
    mapBlock.draw = drawMap;
  }

  if (!mapBlock) {
    // Without a map the number is the whole composition, so it grows into the
    // space the rest of the card leaves — a bare run on a 9:16 story otherwise
    // floats in the middle of an empty frame. It never outgrows the width:
    // the number plus its "km" has to fit, or the unit walks off the edge.
    const heroBlock = blocks.find((b) => b.key === "hero");
    const others = blocks.reduce((sum, b) => sum + b.h, 0) - heroBlock.h + gap * Math.max(0, blocks.length - 1);
    ctx.font = `700 100px ${DISP}`;
    const perPx = ctx.measureText(km.toFixed(2)).width / 100;
    const grown = Math.min(story ? 210 : 150, (inner - 66) / perPx, Math.max(heroSize, height - others - 24));
    heroBlock.h += grown - heroSize;
    heroSize = grown;
  }

  let gapNow = gap;
  const measure = () => blocks.reduce((sum, b) => sum + b.h, 0) + gapNow * Math.max(0, blocks.length - 1);

  const shrink = (key, min) => {
    const b = blocks.find((x) => x.key === key);
    if (!b) return;
    const over = measure() - height;
    if (over <= 0) return;
    const give = Math.min(over, b.h - min);
    if (give > 0) b.h -= give;
  };
  const drop = (key) => {
    const i = blocks.findIndex((x) => x.key === key);
    if (i >= 0 && measure() > height) blocks.splice(i, 1);
  };

  // A square card can genuinely not hold a map, a hero, stats, splits and a
  // chip row at once. Concede space in a fixed order — tighten first, then
  // give up the least important block — rather than letting the stack run off
  // the bottom edge and through the footer.
  if (measure() > height) gapNow = story ? 15 : 11;
  shrink("map", mapBlock ? mapBlock.min : 0);
  drop("note");
  drop("chips");
  shrink("splits", blocks.find((b) => b.key === "splits")?.min ?? 0);
  if (measure() > height) {
    const heroBlock = blocks.find((b) => b.key === "hero");
    const over = measure() - height;
    const give = Math.min(over, heroSize - 56);
    if (give > 0) { heroSize -= give; heroBlock.h -= give; }
  }
  drop("splits");

  // Whatever is left over after fitting goes to the map, then to centring.
  if (mapBlock && blocks.includes(mapBlock)) {
    const slack = height - measure();
    if (slack > 0) mapBlock.h += Math.min(slack, height * 0.62 - mapBlock.h);
  }

  let y = top + Math.max(0, (height - measure()) / 2);
  for (const b of blocks) {
    if (b.h > 0) b.draw(y, b.h);
    y += b.h + gapNow;
  }
}

// A gym workout: the weight moved is the number, the muscle map the picture,
// then time, sets and what was lifted. Like the run card, the blocks are
// measured first and space is conceded in a fixed order — tighten the gap,
// shrink the story's figure, show fewer exercises, drop the note, shrink the
// figure beside the number, drop the exercise list — and the new personal
// bests go last, because they are the brag.
function drawGymBody(ctx, g) {
  const { W, pad, top, height, fmt, spec, opts } = g;
  const d = spec.data;
  const inner = W - pad * 2;
  const wide = fmt.id === "wide";
  const story = fmt.id === "story";
  const muscles = d.muscles || { primary: [], secondary: [] };
  const showMap = opts.muscles !== false && (muscles.primary || []).length > 0;
  const lifts = opts.lifts !== false && Array.isArray(d.lifts) ? d.lifts : [];
  const bests = Array.isArray(d.bests) ? d.bests : [];
  const lifted = d.volume > 0;
  // A bodyweight session moved no measurable weight, so it leads with its sets.
  const heroVal = lifted ? Math.round(d.volume).toLocaleString() : String(d.sets || 0);
  const heroUnit = lifted ? "kg lifted" : d.sets === 1 ? "set done" : "sets done";
  const kicker = [d.title, d.plan].filter(Boolean).join(" \u00b7 ");
  const cells = [
    { label: "Time", value: fmtClock(d.durMs || 0), color: C.yellow },
    ...(lifted ? [{ label: "Sets", value: String(d.sets || 0) }] : []),
    { label: "Exercises", value: String(d.exercises || 0) },
    ...(!lifted && d.reps ? [{ label: "Reps", value: String(d.reps) }] : []),
  ];
  ctx.font = `700 100px ${DISP}`;
  const perPx = ctx.measureText(heroVal).width / 100;

  // ---- WIDE: the figure on the left, the figures on the right ----
  if (wide) {
    let x = pad;
    if (showMap) {
      const mh = height - 14;
      const mw = mh * MAP_RATIO;
      panel(ctx, pad, top, mw + 28, height, { r: 18 });
      drawBodyMap(ctx, muscles, pad + 14, top + 7, mh);
      x = pad + mw + 28 + 24;
    }
    const w = W - pad - x;
    label(ctx, fitLabel(ctx, kicker, 10, w), x, top + 2, C.accent, 10);
    const size = Math.min(66, (w - 4) / perPx);
    ctx.font = `700 ${size}px ${DISP}`;
    const nw = ctx.measureText(heroVal).width;
    text(ctx, heroVal, x, top + 20, { font: `700 ${size}px ${DISP}`, color: accentGradient(ctx, x, top + 20, nw, size), baseline: "top" });
    text(ctx, heroUnit, x, top + 24 + size, { font: `700 15px ${DISP}`, color: C.dim, baseline: "top" });
    drawStatRow(ctx, cells, x - 14, top + size + 58, w + 14, { size: 22 });
    return;
  }

  // ---- SQUARE / STORY ----
  const gap = story ? 20 : 14;
  const statH = story ? 32 : 26;
  const statBoxH = statH + 46;
  const rowH = story ? 34 : 25;
  const liftsH = (n) => 34 + n * rowH + 8;
  const sideMap = showMap && !story; // on a square the figure stands beside the number
  let sideMapH = sideMap ? 150 : 0;
  let heroSize = story ? 100 : 72;
  const heroTextH = () => 20 + heroSize + (story ? 30 : 24);
  const heroColW = () => inner - (sideMap ? sideMapH * MAP_RATIO + 14 : 0);
  heroSize = Math.min(heroSize, (heroColW() - 4) / perPx);
  const heroH = () => Math.max(heroTextH(), sideMapH);
  let rows = lifts.length;

  const drawHero = (y, h) => {
    const ty = y + (h - heroTextH()) / 2;
    const size = story ? 11 : 10;
    label(ctx, fitLabel(ctx, kicker, size, heroColW()), pad, ty, C.accent, size);
    ctx.font = `700 ${heroSize}px ${DISP}`;
    const nw = ctx.measureText(heroVal).width;
    text(ctx, heroVal, pad, ty + 20, {
      font: `700 ${heroSize}px ${DISP}`, color: accentGradient(ctx, pad, ty + 20, nw, heroSize), baseline: "top",
    });
    text(ctx, heroUnit, pad, ty + 24 + heroSize, { font: `700 ${story ? 19 : 15}px ${DISP}`, color: C.dim, baseline: "top" });
    if (sideMap) drawBodyMap(ctx, muscles, W - pad - sideMapH * MAP_RATIO, y + (h - sideMapH) / 2, sideMapH);
  };

  const drawMapBlock = (y, h) => {
    glow(ctx, W / 2, y + h / 2, h * 0.75, C.accent, 0.1);
    const mh = h - 18;
    const k = mh / FIGURE_H;
    const left = W / 2 - (mh * MAP_RATIO) / 2;
    drawBodyMap(ctx, muscles, left, y, mh);
    label(ctx, "Front", left + (FIGURE_W / 2) * k, y + h - 9, C.dim2, 8.5, "center");
    label(ctx, "Back", left + (FIGURE_W * 1.5 + FIGURE_GAP) * k, y + h - 9, C.dim2, 8.5, "center");
  };

  const drawStats = (y) => {
    panel(ctx, pad, y, inner, statBoxH, { r: 18, accented: true });
    drawStatRow(ctx, cells, pad, y + 16, inner, { size: statH });
  };

  const drawLifts = (y, h) => {
    panel(ctx, pad, y, inner, h, { r: 18 });
    label(ctx, "Exercises", pad + 16, y + 14, C.dim, 9.5);
    const hidden = lifts.length - rows;
    if (hidden > 0) label(ctx, `+${hidden} more`, W - pad - 16, y + 14, C.dim2, 9.5, "right");
    const nameFont = `600 ${story ? 15.5 : 13.5}px ${BODY}`;
    const setFont = `700 ${story ? 14.5 : 12.5}px ${DISP}`;
    lifts.slice(0, rows).forEach((l, i) => {
      const ry = y + 34 + i * rowH;
      if (i > 0) {
        ctx.strokeStyle = tint("#ffffff", 0.07);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad + 16, ry); ctx.lineTo(W - pad - 16, ry); ctx.stroke();
      }
      const sets = fit(ctx, l.text, setFont, inner * 0.5);
      const sw = ctx.measureText(sets).width;
      text(ctx, sets, W - pad - 16, ry + rowH / 2, { font: setFont, color: C.dim, align: "right", baseline: "middle" });
      text(ctx, fit(ctx, l.name, nameFont, inner - 32 - sw - 14), pad + 16, ry + rowH / 2, { font: nameFont, color: C.text, baseline: "middle" });
    });
  };

  const drawBests = (y) => {
    label(ctx, bests.length === 1 ? "New personal best" : "New personal bests", pad, y, C.yellow, 9.5);
    let cx = pad;
    for (const b of bests) {
      const font = `700 12px ${BODY}`;
      let str = `\u{1F3C6} ${b.name} \u00b7 ${b.label}`;
      ctx.font = font;
      if (ctx.measureText(str).width + 28 > W - pad - cx) {
        if (cx > pad) break;
        str = fit(ctx, str, font, W - pad - cx - 28);
      }
      const w = ctx.measureText(str).width + 28;
      chip(ctx, str, cx, y + 18, { h: 28, pad: 14, size: 12, color: C.text, bg: tint(C.yellow, 0.12), border: tint(C.yellow, 0.35) });
      cx += w + 7;
    }
  };

  const noteFont = `italic 600 ${story ? 15 : 13}px ${BODY}`;
  const drawNote = (y) => text(ctx, fit(ctx, `\u201C${d.note}\u201D`, noteFont, inner), pad, y, { font: noteFont, color: C.dim, baseline: "top" });

  const blocks = [{ key: "hero", h: heroH(), draw: drawHero }];
  if (showMap && story) blocks.push({ key: "map", h: 300, draw: drawMapBlock });
  blocks.push({ key: "stats", h: statBoxH, draw: drawStats });
  if (rows) blocks.push({ key: "lifts", h: liftsH(rows), draw: drawLifts });
  if (bests.length) blocks.push({ key: "bests", h: 46, draw: drawBests });
  if (d.note) blocks.push({ key: "note", h: story ? 22 : 18, draw: drawNote });

  let gapNow = gap;
  const block = (key) => blocks.find((b) => b.key === key);
  const measure = () => blocks.reduce((sum, b) => sum + b.h, 0) + gapNow * Math.max(0, blocks.length - 1);
  const shrink = (key, min) => {
    const b = block(key);
    const over = measure() - height;
    if (b && over > 0) b.h -= Math.max(0, Math.min(over, b.h - min));
  };
  const drop = (key) => {
    const i = blocks.findIndex((b) => b.key === key);
    if (i >= 0 && measure() > height) { blocks.splice(i, 1); if (key === "lifts") rows = 0; }
  };
  const setRows = (n) => { rows = n; const b = block("lifts"); if (b) b.h = liftsH(n); };

  if (measure() > height) gapNow = story ? 14 : 10;
  shrink("map", 240);
  while (measure() > height && rows > 4) setRows(rows - 1);
  shrink("map", 170);
  while (measure() > height && rows > 3) setRows(rows - 1);
  drop("note");
  while (measure() > height && rows > 2) setRows(rows - 1);
  if (measure() > height && sideMap) {
    const over = measure() - height;
    const give = Math.min(over, sideMapH - Math.max(heroTextH(), 104));
    if (give > 0) { sideMapH -= give; block("hero").h = heroH(); }
  }
  drop("lifts");
  drop("bests");

  // Room to spare goes to the story's figure (up to a point), then to centring.
  const mapBlock = block("map");
  if (mapBlock) {
    const slack = height - measure();
    if (slack > 0) mapBlock.h += Math.min(slack, 380 - mapBlock.h);
  }

  let y = top + Math.max(0, (height - measure()) / 2);
  for (const b of blocks) {
    if (b.h > 0) b.draw(y, b.h);
    y += b.h + gapNow;
  }
}

function drawProgressBody(ctx, g) {
  const { W, pad, top, height, fmt, spec } = g;
  const d = spec.data;
  const inner = W - pad * 2;
  const wide = fmt.id === "wide";
  const story = fmt.id === "story";

  const ringR = wide ? 46 : story ? 80 : 62;

  const drawRingBlock = (y) => {
    const cx = wide ? pad + ringR + 6 : W / 2;
    const cy = y + ringR;
    drawRing(ctx, cx, cy, ringR, d.pct, { width: ringR * 0.2 });
    const pf = ringR * 0.58;
    ctx.font = `700 ${pf}px ${DISP}`;
    const pctTxt = `${Math.round(d.pct)}%`;
    const pw = ctx.measureText(pctTxt).width;
    text(ctx, pctTxt, cx, cy - ringR * 0.17, {
      font: `700 ${pf}px ${DISP}`,
      color: accentGradient(ctx, cx - pw / 2, cy - ringR, pw, ringR),
      align: "center", baseline: "middle",
    });
    label(ctx, `${d.done}/${d.total} days`, cx, cy + ringR * 0.28, C.dim, ringR * 0.13, "center");
  };

  if (wide) {
    drawRingBlock(top);
    const x = pad + ringR * 2 + 26;
    text(ctx, d.headline || "Training block", x, top + 6, { font: `700 24px ${DISP}`, color: C.text, baseline: "top" });
    drawStatRow(ctx, [
      { label: "Distance", value: d.km.toFixed(1), unit: "km" },
      { label: "Runs", value: String(d.runs) },
      { label: "Streak", value: `${d.streak}`, unit: "d" },
    ], x - 14, top + 44, W - pad - x + 14, { size: 26, heroIndex: 0 });
    return;
  }

  const gap = story ? 22 : 16;
  const statH = story ? 32 : 28;
  const statBoxH = statH + 46;
  const headlineH = story ? 32 : 27;

  const cells1 = [
    { label: "Distance", value: d.km.toFixed(1), unit: "km" },
    { label: "Runs", value: String(d.runs) },
    { label: "Streak", value: String(d.streak), unit: "d" },
  ];
  const cells2 = [
    { label: "Avg pace", value: d.pace || "—", unit: d.pace ? "/km" : "" },
    { label: "Longest", value: d.longest ? d.longest.toFixed(1) : "—", unit: d.longest ? "km" : "" },
    { label: "Time", value: d.time || "—" },
  ];

  const hasBars = Array.isArray(d.weekly) && d.weekly.length > 0;

  const drawBars = (y, h) => {
    label(ctx, "Kilometres per week", pad, y, C.dim, 9.5);
    const chartY = y + 20, chartH = h - 20 - 16;
    const max = Math.max(1, ...d.weekly.map((w) => Math.max(w.value, w.target || 0)));
    const bgap = 10;
    const bw = (inner - bgap * (d.weekly.length - 1)) / d.weekly.length;
    d.weekly.forEach((w, i) => {
      const bx = pad + i * (bw + bgap);
      const th = (Math.max(0, w.target || 0) / max) * chartH;
      const vh = (Math.max(0, w.value) / max) * chartH;
      rr(ctx, bx, chartY + chartH - th, bw, Math.max(2, th), 8);
      ctx.fillStyle = tint("#ffffff", 0.07);
      ctx.fill();
      if (vh > 1) {
        rr(ctx, bx, chartY + chartH - vh, bw, vh, 8);
        const gr = ctx.createLinearGradient(bx, chartY + chartH - vh, bx, chartY + chartH);
        gr.addColorStop(0, C.accent);
        gr.addColorStop(1, tint(C.accent2, 0.3));
        ctx.fillStyle = gr;
        ctx.fill();
      }
      ctx.font = `700 9px ${BODY}`;
      ctx.fillStyle = C.dim2;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(`W${w.week ?? i + 1}`, bx + bw / 2, chartY + chartH + 6);
      ctx.textAlign = "left";
    });
  };

  const blocks = [
    { h: ringR * 2, draw: drawRingBlock },
    { h: headlineH, draw: (y) => text(ctx, d.headline || "Training block", W / 2, y, { font: `700 ${story ? 26 : 22}px ${DISP}`, color: C.text, align: "center", baseline: "top" }) },
    { h: statBoxH, draw: (y) => { panel(ctx, pad, y, inner, statBoxH, { r: 18, accented: true }); drawStatRow(ctx, cells1, pad, y + 16, inner, { size: statH, heroIndex: 0 }); } },
    { h: statBoxH, draw: (y) => { panel(ctx, pad, y, inner, statBoxH, { r: 18 }); drawStatRow(ctx, cells2, pad, y + 16, inner, { size: statH }); } },
  ];
  if (hasBars) blocks.push({ key: "bars", h: 0, flex: true, draw: drawBars });

  const gaps = gap * (blocks.length - 1);
  const fixed = blocks.reduce((sum, b) => sum + b.h, 0);
  const barBlock = blocks.find((b) => b.key === "bars");
  if (barBlock) {
    // The chart takes whatever is left, so a story card fills its height
    // instead of stacking everything against the top edge.
    barBlock.h = Math.max(0, Math.min(story ? 260 : 120, height - fixed - gaps));
    if (barBlock.h < 60) barBlock.h = 0;
  }

  const total = blocks.reduce((sum, b) => sum + b.h, 0) + gaps;
  let y = top + Math.max(0, (height - total) / 2);
  for (const b of blocks) {
    if (b.h > 0) b.draw(y, b.h);
    y += b.h + gap;
  }
}

function drawAchievementBody(ctx, g) {
  const { W, pad, top, height, fmt, spec } = g;
  const d = spec.data;
  const wide = fmt.id === "wide";
  const inner = W - pad * 2;

  if (wide) {
    const s = 96;
    panel(ctx, pad, top + (height - s) / 2, s, s, { r: 26, accented: true });
    ctx.font = `${s * 0.5}px ${BODY}`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(d.icon || "🏅", pad + s / 2, top + height / 2 + 3);
    ctx.textAlign = "left";
    const x = pad + s + 24;
    label(ctx, "Achievement unlocked", x, top + height / 2 - 42, C.accent, 10);
    text(ctx, d.title, x, top + height / 2 - 22, { font: `700 32px ${DISP}`, color: C.text, baseline: "top" });
    text(ctx, d.desc || "", x, top + height / 2 + 20, { font: `600 14px ${BODY}`, color: C.dim, baseline: "top" });
    return;
  }

  const story = fmt.id === "story";
  const cy = top + height * (story ? 0.42 : 0.44);
  const s = story ? 190 : 150;

  glow(ctx, W / 2, cy, s * 1.1, C.accent, 0.3);
  panel(ctx, W / 2 - s / 2, cy - s / 2, s, s, { r: s * 0.3, accented: true });
  ctx.font = `${s * 0.46}px ${BODY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(d.icon || "🏅", W / 2, cy + s * 0.03);
  ctx.textAlign = "left";

  let y = cy + s / 2 + (story ? 44 : 34);
  label(ctx, "Unlocked", W / 2, y, C.accent, 10.5, "center");
  y += 24;
  text(ctx, d.title, W / 2, y, {
    font: `700 ${story ? 40 : 32}px ${DISP}`, color: C.text, align: "center", baseline: "top",
  });
  y += story ? 52 : 42;
  if (d.desc) {
    text(ctx, d.desc, W / 2, y, {
      font: `600 ${story ? 16 : 14}px ${BODY}`, color: C.dim, align: "center", baseline: "top",
    });
    y += story ? 34 : 28;
  }
  if (d.count && d.of) {
    const str = `${d.count} of ${d.of} badges earned`;
    ctx.font = `700 12px ${BODY}`;
    const w = ctx.measureText(str).width + 32;
    chip(ctx, str, W / 2 - w / 2, y + 6, {
      color: C.text, bg: tint(C.accent, 0.12), border: tint(C.accent, 0.35), h: 30, size: 12, pad: 16,
    });
  }
  void inner;
}

function drawGoalBody(ctx, g) {
  const { W, pad, top, height, fmt, spec } = g;
  const d = spec.data;
  const inner = W - pad * 2;
  const wide = fmt.id === "wide";
  const story = fmt.id === "story";
  let y = top + (wide ? 0 : height * 0.04);

  label(ctx, d.raceName || "Next race", pad, y, C.accent, wide ? 10 : 11);
  y += wide ? 22 : 26;

  const size = wide ? 74 : story ? 108 : 88;
  const timeTxt = d.time || "—";
  ctx.font = `700 ${size}px ${DISP}`;
  const tw = ctx.measureText(timeTxt).width;
  text(ctx, timeTxt, pad, y, {
    font: `700 ${size}px ${DISP}`, color: accentGradient(ctx, pad, y, tw, size), baseline: "top",
  });
  y += size + 6;
  text(ctx, d.sub || "predicted finish", pad, y, {
    font: `600 ${wide ? 13 : 15}px ${BODY}`, color: C.dim, baseline: "top",
  });
  y += wide ? 30 : story ? 48 : 38;

  if (wide) return;

  const cells = [
    { label: "Distance", value: d.distance || "—" },
    ...(d.days != null ? [{ label: "Days to go", value: String(d.days) }] : []),
    { label: "Ready", value: `${Math.round(d.readiness || 0)}`, unit: "%" },
  ];
  const statH = story ? 32 : 28;
  panel(ctx, pad, y, inner, statH + 46, { r: 18, accented: true });
  drawStatRow(ctx, cells, pad, y + 16, inner, { size: statH });
  y += statH + 46 + (story ? 26 : 20);

  // readiness bar
  label(ctx, "Distance readiness", pad, y, C.dim, 9.5);
  y += 20;
  const bh = 12;
  rr(ctx, pad, y, inner, bh, bh / 2);
  ctx.fillStyle = tint("#ffffff", 0.07);
  ctx.fill();
  const fw = Math.max(bh, inner * Math.min(1, (d.readiness || 0) / 100));
  rr(ctx, pad, y, fw, bh, bh / 2);
  ctx.fillStyle = accentGradient(ctx, pad, y, fw, bh);
  ctx.fill();
  y += bh + 22;

  if (d.note) {
    text(ctx, d.note, pad, y, {
      font: `600 ${story ? 15 : 13}px ${BODY}`, color: C.dim, baseline: "top",
    });
  }
}

// --- text summaries --------------------------------------------------------

// Every card also has a plain-text form, for places an image can't go.
export function cardText(spec) {
  const d = spec.data || {};
  if (spec.kind === "run") {
    const { km, durMs, paceS } = runFacts(d);
    const bits = [`🏃 ${km.toFixed(2)} km in ${fmtClock(durMs)}`];
    if (fmtPace(paceS)) bits.push(`${fmtPace(paceS)} /km`);
    if (d.elev > 0) bits.push(`+${d.elev} m`);
    if (d.kcal > 0) bits.push(`${d.kcal} kcal`);
    return `${bits.join(" · ")}\nTracked with Stride`;
  }
  if (spec.kind === "gym") {
    const head = d.volume > 0 ? `${Math.round(d.volume).toLocaleString()} kg lifted` : `${d.sets} set${d.sets === 1 ? "" : "s"}`;
    const lines = [`🏋️ ${d.title}: ${head} in ${fmtClock(d.durMs || 0)}`];
    if (Array.isArray(d.bests) && d.bests.length) lines.push(`New best: ${d.bests.map((b) => `${b.name} ${b.label}`).join(", ")}`);
    lines.push("Trained with Stride");
    return lines.join("\n");
  }
  if (spec.kind === "progress") {
    return `🏃 ${d.km.toFixed(1)} km logged over ${d.runs} run${d.runs === 1 ? "" : "s"} — ${d.done}/${d.total} sessions done (${Math.round(d.pct)}%).${d.streak ? ` ${d.streak}-day streak.` : ""}\nTracked with Stride`;
  }
  if (spec.kind === "achievement") {
    return `${d.icon || "🏅"} Unlocked “${d.title}” in Stride — ${d.desc || ""}`.trim();
  }
  if (spec.kind === "goal") {
    return `🎯 ${d.raceName}: on track for ${d.time}${d.days != null ? ` · ${d.days} days to go` : ""}.\nTracked with Stride`;
  }
  return "Tracked with Stride";
}

// --- export ----------------------------------------------------------------

export const canvasBlob = (canvas) =>
  new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));

const fileName = (spec) => {
  const tag = new Date(spec?.data?.date || Date.now()).toISOString().slice(0, 10);
  return `stride-${spec?.kind || "card"}-${tag}.png`;
};

// Native needs a file on disk to hand to the share sheet; the web can pass a
// File straight to navigator.share and falls back to a download.
export async function shareBlob(blob, name, textBody) {
  if (isNative()) {
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const { Share } = await import("@capacitor/share");
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1]);
        r.onerror = rej;
        r.readAsDataURL(blob);
      });
      const { uri } = await Filesystem.writeFile({ path: name, data: base64, directory: Directory.Cache });
      await Share.share({ title: "Stride", text: textBody, files: [uri] });
      return "shared";
    } catch (e) {
      return String(e && e.message || e).toLowerCase().includes("cancel") ? "cancelled" : "error";
    }
  }

  const file = new File([blob], name, { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Stride", text: textBody });
      return "shared";
    } catch (e) {
      // A cancelled share sheet is a normal outcome, not a failure to report.
      if (e && (e.name === "AbortError" || /abort|cancel/i.test(e.message || ""))) return "cancelled";
    }
  }
  return downloadBlob(blob, name);
}

export function downloadBlob(blob, name) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return "saved";
  } catch { return "error"; }
}

// Clipboard images are Chrome/Safari-only and need a user gesture; callers
// treat "error" as "offer save instead".
export async function copyBlob(blob) {
  try {
    if (!navigator.clipboard || typeof ClipboardItem === "undefined") return "error";
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return "copied";
  } catch { return "error"; }
}

export async function copyText(str) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(str); return "copied"; }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = str;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    return "copied";
  } catch { return "error"; }
}

// Render + share in one step. Used by the sheet and by any caller that just
// wants the default card without opening the picker.
export async function shareCard(spec) {
  const canvas = await renderCard(spec);
  const blob = await canvasBlob(canvas);
  if (!blob) return "error";
  return shareBlob(blob, fileName(spec), cardText(spec));
}

export async function saveCard(spec) {
  const canvas = await renderCard(spec);
  const blob = await canvasBlob(canvas);
  if (!blob) return "error";
  return downloadBlob(blob, fileName(spec));
}

export const cardFileName = fileName;

// Fonts must be loaded before the first measureText or the layout is computed
// against a fallback face. Cheap after the first call.
export const fontsReady = () =>
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).catch(() => {});
