// Run summary share card: canvas-rendered image of a run's key stats and route.
// Redesigned with a modern high-end dark aesthetics, accent glows, gradient stats cards & badges.
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

function projectRoute(route, x, y, w, h) {
  const pad = 24;
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

  // Outer glow
  ctx.shadowColor = C.accent;
  ctx.shadowBlur = 12;

  let i = 0;
  while (i < route.length - 1) {
    const ph = route[i].phase;
    let j = i + 1;
    while (j < route.length && route[j].phase === ph) j++;
    ctx.strokeStyle = phaseColor(ph);
    ctx.lineWidth = 5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(route[i].x, route[i].y);
    for (let k = i + 1; k <= Math.min(j, route.length - 1); k++) ctx.lineTo(route[k].x, route[k].y);
    ctx.stroke();
    i = j;
  }

  // Reset shadow
  ctx.shadowBlur = 0;

  // Start dot
  const { x: sx, y: sy } = route[0];
  ctx.fillStyle = C.bg;
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(sx, sy, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // End dot
  const { x: ex, y: ey } = route[route.length - 1];
  ctx.fillStyle = C.accent;
  ctx.beginPath();
  ctx.arc(ex, ey, 7, 0, Math.PI * 2);
  ctx.fill();
}

function drawStatBox(ctx, label, value, unit, x, y, w, h, isHighlight) {
  ctx.fillStyle = isHighlight ? "#1e261d" : "#16181e";
  rr(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.strokeStyle = isHighlight ? C.accent : C.line;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = "800 10px 'Manrope', system-ui";
  ctx.fillStyle = isHighlight ? C.accent : C.dim;
  ctx.textBaseline = "top";
  ctx.fillText(label.toUpperCase(), x + 14, y + 12);

  ctx.font = "700 24px 'Space Grotesk', system-ui";
  ctx.fillStyle = C.text;
  ctx.fillText(value, x + 14, y + 28);

  if (unit) {
    const valW = ctx.measureText(value).width;
    ctx.font = "600 11px 'Space Grotesk', system-ui";
    ctx.fillStyle = C.dim;
    ctx.fillText(unit, x + 14 + valW + 4, y + 37);
  }
}

export async function generateRunCard(run) {
  await document.fonts.ready;

  const km = parseFloat(run.km) || 0;
  const hasRoute = run.route && run.route.length > 1;
  const W = 560;
  const ROUTE_H = hasRoute ? 250 : 0;
  const H = PAD + 44 + (hasRoute ? ROUTE_H + 20 : 10) + 110 + 74 + 60 + PAD;

  const canvas = document.createElement("canvas");
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  const ctx = canvas.getContext("2d");
  ctx.scale(DPR, DPR);

  // Background gradient
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, "#0b0c0f");
  bgGrad.addColorStop(1, "#14171d");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Header branding pill
  ctx.fillStyle = C.surface2;
  rr(ctx, PAD, PAD, 130, 30, 15);
  ctx.fill();

  ctx.font = "800 11px 'Space Grotesk', system-ui";
  ctx.fillStyle = C.accent;
  ctx.textBaseline = "middle";
  ctx.fillText("🏃 ROAD TO 5K", PAD + 14, PAD + 15);

  if (run.date) {
    const d = new Date(run.date);
    const dateStr = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    ctx.font = "600 12px 'Manrope', system-ui";
    ctx.fillStyle = C.dim;
    ctx.textAlign = "right";
    ctx.fillText(dateStr, W - PAD, PAD + 15);
    ctx.textAlign = "left";
  }

  let curY = PAD + 44;

  // Route map display
  if (hasRoute) {
    const routeX = PAD, routeW = W - PAD * 2;
    ctx.fillStyle = "#12141a";
    rr(ctx, routeX, curY, routeW, ROUTE_H, 16);
    ctx.fill();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.stroke();

    const projected = projectRoute(run.route, routeX, curY, routeW, ROUTE_H);
    drawRoute(ctx, projected);

    curY += ROUTE_H + 20;
  }

  // Hero KM Display
  ctx.fillStyle = C.surface;
  rr(ctx, PAD, curY, W - PAD * 2, 94, 18);
  ctx.fill();
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.font = "800 54px 'Space Grotesk', system-ui";
  ctx.fillStyle = C.accent;
  ctx.textBaseline = "top";
  ctx.fillText(km.toFixed(2), PAD + 20, curY + 14);
  const kmW = ctx.measureText(km.toFixed(2)).width;
  ctx.font = "700 16px 'Space Grotesk', system-ui";
  ctx.fillStyle = C.dim;
  ctx.fillText("KM WORKOUT DONE", PAD + 20 + kmW + 12, curY + 44);

  curY += 110;

  // Stats grid (3 columns)
  const colW = (W - PAD * 2 - 16) / 3;
  const avgPaceSec = km > 0 && run.min ? (run.min * 60) / km : 0;
  const timeStr = run.durMs ? fmtTime(run.durMs) : run.min ? fmtTime(run.min * 60000) : "--:--";

  drawStatBox(ctx, "DURATION", timeStr, null, PAD, curY, colW, 64, false);
  drawStatBox(ctx, "AVG PACE", avgPaceSec ? fmtPace(avgPaceSec) : "--:--", "/km", PAD + colW + 8, curY, colW, 64, true);
  drawStatBox(ctx, "CALORIES", run.kcal ? `${run.kcal}` : "--", "kcal", PAD + (colW + 8) * 2, curY, colW, 64, false);

  curY += 74;

  // Footer quote / tag
  ctx.font = "600 11px 'Manrope', system-ui";
  ctx.fillStyle = C.dim;
  ctx.fillText("Building speed & endurance daily • Tracked with Road to 5K", PAD, curY + 10);

  return canvas;
}

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

      const file = new File([blob], filename, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: "My Run" }); resolve(true); return; } catch { /* cancelled */ }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      resolve(true);
    }, "image/png");
  });
}
