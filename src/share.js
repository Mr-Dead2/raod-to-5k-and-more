// Run summary share card: canvas-rendered image of a run's key stats and route.
// Works on web (navigator.share with file / download fallback) and native Capacitor.
import { C } from "./data.js";
import { isNative } from "./native.js";

// Canvas viewport dimensions (drawn at 2× for crisp sharing)
const DPR = 2;
const PAD = 36;

const fmtPace = (s) => (s && isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : null);
const fmtTime = (ms) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, "0"), ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

// Rounded rectangle path helper (CanvasRenderingContext2D.roundRect isn't everywhere)
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// Normalize route [[lat,lng,phase?]] to pixel coordinates within a box.
// Latitude is flipped so north is up.
function projectRoute(route, x, y, w, h) {
  const pad = 16;
  const lats = route.map((p) => p[0]);
  const lngs = route.map((p) => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const latR = maxLat - minLat || 1e-5;
  const lngR = maxLng - minLng || 1e-5;
  const aw = w - pad * 2, ah = h - pad * 2;
  const scale = Math.min(aw / lngR, ah / latR);
  const sw = lngR * scale, sh = latR * scale;
  const ox = x + pad + (aw - sw) / 2;
  const oy = y + pad + (ah - sh) / 2;
  return route.map((p) => ({
    x: ox + (p[1] - minLng) * scale,
    y: oy + sh - (p[0] - minLat) * scale,
    phase: p[2] || null,
  }));
}

function drawRoute(ctx, route) {
  if (!route || route.length < 2) return;

  const phaseColor = (ph) => (ph === "w" ? C.easy : C.accent);

  // Segment by phase and draw each in its color
  let i = 0;
  while (i < route.length - 1) {
    const ph = route[i].phase;
    let j = i + 1;
    while (j < route.length && route[j].phase === ph) j++;
    ctx.strokeStyle = phaseColor(ph);
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(route[i].x, route[i].y);
    for (let k = i + 1; k <= Math.min(j, route.length - 1); k++) ctx.lineTo(route[k].x, route[k].y);
    ctx.stroke();
    i = j;
  }

  // Start dot (hollow)
  const { x: sx, y: sy } = route[0];
  ctx.fillStyle = C.bg;
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(sx, sy, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // End dot (solid)
  const { x: ex, y: ey } = route[route.length - 1];
  ctx.fillStyle = C.accent;
  ctx.beginPath();
  ctx.arc(ex, ey, 5, 0, Math.PI * 2);
  ctx.fill();
}

// Draw a labelled stat value at (x, y)
function stat(ctx, label, value, x, y, color) {
  ctx.font = "700 22px 'Space Grotesk', system-ui";
  ctx.fillStyle = color || C.text;
  ctx.textBaseline = "top";
  ctx.fillText(value, x, y);
  ctx.font = "700 9px 'Manrope', system-ui";
  ctx.fillStyle = C.dim;
  ctx.fillText(label, x, y + 28);
}

export async function generateRunCard(run) {
  await document.fonts.ready;

  const km = parseFloat(run.km) || 0;
  const hasRoute = run.route && run.route.length > 1;
  const W = 540;
  const ROUTE_H = hasRoute ? 230 : 0;
  const H = PAD + 18 + 12 + ROUTE_H + (ROUTE_H ? 20 : 4) + 88 + 42 + 12 + 1 + 14 + PAD;

  const canvas = document.createElement("canvas");
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  const ctx = canvas.getContext("2d");
  ctx.scale(DPR, DPR);

  // ── Background ──────────────────────────────────────────────────────────
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // ── Accent left bar ─────────────────────────────────────────────────────
  ctx.fillStyle = C.accent;
  ctx.fillRect(0, 0, 4, H);

  // ── Header ──────────────────────────────────────────────────────────────
  ctx.font = "800 13px 'Space Grotesk', system-ui";
  ctx.fillStyle = C.accent;
  ctx.textBaseline = "top";
  ctx.fillText("ROAD TO 5K", PAD, PAD);

  if (run.date) {
    const d = new Date(run.date);
    const dateStr = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    ctx.font = "600 11px 'Manrope', system-ui";
    ctx.fillStyle = C.dim;
    ctx.textAlign = "right";
    ctx.fillText(dateStr, W - PAD, PAD + 1);
    ctx.textAlign = "left";
  }

  let curY = PAD + 18 + 12;

  // ── Route map ────────────────────────────────────────────────────────────
  if (hasRoute) {
    const routeX = PAD, routeW = W - PAD * 2;
    ctx.fillStyle = C.surface;
    rr(ctx, routeX, curY, routeW, ROUTE_H, 14);
    ctx.fill();

    const projected = projectRoute(run.route, routeX, curY, routeW, ROUTE_H);
    drawRoute(ctx, projected);

    // Legend (top-right corner of map)
    const hasPhases = run.route.some((p) => p[2]);
    if (hasPhases) {
      const lx = routeX + routeW - 80, ly = curY + 10;
      ctx.fillStyle = "rgba(11,12,15,0.75)";
      rr(ctx, lx - 8, ly - 5, 76, 38, 6);
      ctx.fill();

      ctx.fillStyle = C.accent;
      ctx.fillRect(lx, ly + 4, 14, 3);
      ctx.font = "700 9px 'Space Grotesk', system-ui";
      ctx.fillStyle = C.accent;
      ctx.fillText("RUN", lx + 18, ly);

      ctx.fillStyle = C.easy;
      ctx.fillRect(lx, ly + 20, 14, 3);
      ctx.fillStyle = C.easy;
      ctx.fillText("WALK", lx + 18, ly + 16);
    }

    curY += ROUTE_H + 20;
  }

  // ── Big KM number ────────────────────────────────────────────────────────
  ctx.font = "700 72px 'Space Grotesk', system-ui";
  ctx.fillStyle = C.text;
  ctx.textBaseline = "top";
  ctx.fillText(km.toFixed(2), PAD, curY);
  const kmW = ctx.measureText(km.toFixed(2)).width;
  ctx.font = "700 13px 'Space Grotesk', system-ui";
  ctx.fillStyle = C.dim;
  ctx.fillText("KM", PAD + kmW + 7, curY + 52);

  curY += 88;

  // ── Stats row ────────────────────────────────────────────────────────────
  const avgPaceSec = km > 0 && run.min ? (run.min * 60) / km : 0;
  const colW = (W - PAD * 2) / 3;

  const timeStr = run.durMs ? fmtTime(run.durMs) : run.min ? fmtTime(run.min * 60000) : "--:--";
  stat(ctx, "TIME", timeStr, PAD, curY);
  stat(ctx, "AVG PACE", avgPaceSec ? fmtPace(avgPaceSec) + "/km" : "—", PAD + colW, curY);

  if (run.elev > 0) {
    stat(ctx, "ELEV GAIN", `+${run.elev} m`, PAD + colW * 2, curY);
  } else if (run.kcal > 0) {
    stat(ctx, "CALORIES", `${run.kcal}`, PAD + colW * 2, curY);
  }

  curY += 42;

  // ── Secondary row (kcal + run/walk breakdown) ────────────────────────────
  let cx = PAD;
  if (run.kcal > 0 && run.elev > 0) {
    stat(ctx, "CALORIES", `${run.kcal}`, cx, curY);
    cx += colW;
  }
  if (run.runKm > 0) {
    stat(ctx, "RUN", `${run.runKm} km`, cx, curY, C.accent);
    cx += colW;
  }
  if (run.walkKm > 0) {
    stat(ctx, "WALK", `${run.walkKm} km`, cx, curY, C.easy);
  }

  curY += 12;

  // ── Footer rule + branding ───────────────────────────────────────────────
  ctx.fillStyle = C.line;
  ctx.fillRect(PAD, curY, W - PAD * 2, 1);
  curY += 14;

  ctx.font = "600 10px 'Manrope', system-ui";
  ctx.fillStyle = C.surface2;
  ctx.fillStyle = "#3f4454";
  ctx.fillText("Road to 5K", PAD, curY);

  return canvas;
}

// Share or download the generated card. Returns true on success.
export async function shareRunCard(run) {
  const canvas = await generateRunCard(run);
  const dateTag = new Date(run.date || Date.now()).toISOString().slice(0, 10);
  const filename = `run-${dateTag}.png`;

  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => {
      if (!blob) { resolve(false); return; }

      if (isNative()) {
        try {
          const { Filesystem, Directory } = await import("@capacitor/filesystem");
          const { Share } = await import("@capacitor/share");
          const reader = new FileReader();
          reader.onload = async () => {
            const base64 = reader.result.split(",")[1];
            const { uri } = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
            await Share.share({ title: "My Run", files: [uri] });
            resolve(true);
          };
          reader.readAsDataURL(blob);
        } catch { resolve(false); }
        return;
      }

      // Try Web Share API with file
      const file = new File([blob], filename, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: "My Run" }); resolve(true); return; } catch { /* cancelled */ }
      }

      // Fallback: download the image
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      resolve(true);
    }, "image/png");
  });
}
