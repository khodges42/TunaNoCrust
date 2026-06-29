// dynoView.js
// Canvas-only graph renderer. It accepts a curve and a progress value, so the
// UI can animate a pull without coupling the graph to the sim formulas.

const HP_COLOR = "#5ef2c2";
const TQ_COLOR = "#82a8ff";
const GRID_COLOR = "rgba(255, 255, 255, 0.09)";
const TEXT_COLOR = "rgba(233, 242, 242, 0.78)";
const MUTED_COLOR = "rgba(155, 173, 173, 0.75)";

export function drawEmptyDyno(canvas) {
  drawDyno(canvas, [], 0, { title: "Awaiting pull" });
}

export function drawDyno(canvas, curve, progress = 1, options = {}) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  // Keep internal canvas resolution synced with CSS size for crisp lines.
  if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
  }

  ctx.save();
  ctx.scale(dpr, dpr);
  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);

  const padding = { top: 32, right: 34, bottom: 44, left: 54 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  ctx.fillStyle = "#070b0e";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = MUTED_COLOR;

  for (let i = 0; i <= 5; i += 1) {
    const y = padding.top + (plotH * i) / 5;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();

    const label = String(Math.round((1 - i / 5) * 600));
    ctx.fillText(label, 14, y + 4);
  }

  for (let i = 0; i <= 6; i += 1) {
    const x = padding.left + (plotW * i) / 6;
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, height - padding.bottom);
    ctx.stroke();

    const rpm = 2000 + i * 1000;
    ctx.fillText(`${rpm / 1000}k`, x - 10, height - 18);
  }

  ctx.fillStyle = TEXT_COLOR;
  ctx.font = "bold 13px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(options.title ?? "Dyno pull", padding.left, 20);

  ctx.fillStyle = HP_COLOR;
  ctx.fillText("WHP", width - 132, 20);
  ctx.fillStyle = TQ_COLOR;
  ctx.fillText("WTQ", width - 84, 20);

  if (!curve.length) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
    ctx.font = "bold 28px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText("READY", padding.left + 18, padding.top + plotH / 2);
    ctx.restore();
    return;
  }

  const visibleCount = Math.max(2, Math.floor(curve.length * progress));
  const visible = curve.slice(0, visibleCount);
  const minRpm = curve[0].rpm;
  const maxRpm = curve[curve.length - 1].rpm;
  const maxValue = Math.max(420, ...curve.map((point) => point.whp), ...curve.map((point) => point.torque)) * 1.1;

  const xFor = (rpm) => padding.left + ((rpm - minRpm) / (maxRpm - minRpm)) * plotW;
  const yFor = (value) => padding.top + (1 - value / maxValue) * plotH;

  drawLine(ctx, visible, xFor, yFor, "whp", HP_COLOR);
  drawLine(ctx, visible, xFor, yFor, "torque", TQ_COLOR);

  const current = visible[visible.length - 1];
  const x = xFor(current.rpm);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.26)";
  ctx.beginPath();
  ctx.moveTo(x, padding.top);
  ctx.lineTo(x, height - padding.bottom);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(`${current.rpm} rpm`, x + 8, padding.top + 16);

  ctx.restore();
}

function drawLine(ctx, points, xFor, yFor, key, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = xFor(point.rpm);
    const y = yFor(point[key]);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  const last = points[points.length - 1];
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(xFor(last.rpm), yFor(last[key]), 4, 0, Math.PI * 2);
  ctx.fill();
}
