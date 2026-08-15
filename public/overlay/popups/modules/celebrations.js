// public/overlay/popups/modules/celebrations.js

/* ---------------------------------------------------------
   Full-screen celebration effects for 1st / 2nd claims.

   One 1920x1080 canvas, appended to #overlay-root so it
   inherits the same scaling as the rest of the popups overlay
   (see scale.js). Drawn with requestAnimationFrame and torn
   down completely when finished — OBS keeps the page alive for
   the whole stream, so nothing may be left spinning.
--------------------------------------------------------- */

const STAGE_W = 1920;
const STAGE_H = 1080;

let canvas = null;
let ctx = null;
let rafId = null;
let particles = [];
let stopAt = 0;
let mode = null;

function ensureCanvas() {
  if (canvas && canvas.isConnected) return canvas;

  canvas = document.createElement("canvas");
  canvas.id = "celebration-canvas";
  canvas.width = STAGE_W;
  canvas.height = STAGE_H;

  const host =
    document.getElementById("overlay-root") || document.body;

  host.appendChild(canvas);
  ctx = canvas.getContext("2d");

  return canvas;
}

function teardown() {
  cancelAnimationFrame(rafId);
  rafId = null;
  particles = [];
  mode = null;

  if (canvas) {
    canvas.remove();
    canvas = null;
    ctx = null;
  }
}

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* ---------------------------------------------------------
   Confetti — 1st place

   Bright, wavering, shimmering. The shimmer comes from
   rotating each piece in 3D and scaling its width by the
   cosine of that angle, so it catches and loses the light as
   it tumbles, rather than being a flat coloured rectangle.
--------------------------------------------------------- */
const CONFETTI_COLORS = [
  "#ff3b6b", "#ffd23f", "#3ddc97", "#4cc9f0",
  "#b15cff", "#ff8f3f", "#ff5fd2", "#7dff5c"
];

function makeConfetti(seedFromTop = true) {
  return {
    x: rand(-40, STAGE_W + 40),
    y: seedFromTop ? rand(-STAGE_H * 0.4, -20) : rand(-60, STAGE_H),
    w: rand(9, 18),
    h: rand(14, 26),
    color: pick(CONFETTI_COLORS),
    vy: rand(90, 210),                 // px per second
    swayAmp: rand(20, 70),
    swayFreq: rand(0.6, 1.8),
    swayPhase: rand(0, Math.PI * 2),
    spin: rand(2, 7) * (Math.random() < 0.5 ? -1 : 1),
    angle: rand(0, Math.PI * 2),
    tilt: rand(0, Math.PI * 2)
  };
}

function drawConfetti(p, dt, elapsed) {
  p.y += p.vy * dt;
  p.angle += p.spin * dt;
  p.tilt += p.spin * 0.6 * dt;

  const sway = Math.sin(elapsed * p.swayFreq + p.swayPhase) * p.swayAmp;
  const x = p.x + sway;

  // Width oscillates with the tumble — this is the shimmer.
  const flip = Math.cos(p.tilt);
  const w = Math.max(1.5, Math.abs(p.w * flip));

  // Faces catching the light read brighter.
  const shine = 0.55 + 0.45 * Math.abs(flip);

  ctx.save();
  ctx.translate(x, p.y);
  ctx.rotate(p.angle);
  ctx.globalAlpha = shine;
  ctx.fillStyle = p.color;
  ctx.fillRect(-w / 2, -p.h / 2, w, p.h);

  // Specular highlight along the leading edge
  if (flip > 0.55) {
    ctx.globalAlpha = (flip - 0.55) * 1.6;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-w / 2, -p.h / 2, w * 0.35, p.h);
  }

  ctx.restore();

  if (p.y - p.h > STAGE_H) Object.assign(p, makeConfetti(true), { y: rand(-160, -20) });
}

/* ---------------------------------------------------------
   Balloons — 2nd place

   Bright and cheerful, rising with a gentle sway, each with a
   highlight and a curling string.
--------------------------------------------------------- */
const BALLOON_COLORS = [
  ["#ff4d6d", "#ff8fa3"], ["#ffd23f", "#ffe89b"],
  ["#3ddc97", "#9bf6cd"], ["#4cc9f0", "#a8e8fb"],
  ["#b15cff", "#d8b0ff"], ["#ff8f3f", "#ffc397"]
];

function makeBalloon(seedBelow = true) {
  const [body, highlight] = pick(BALLOON_COLORS);
  const r = rand(26, 52);

  return {
    x: rand(40, STAGE_W - 40),
    y: seedBelow ? rand(STAGE_H + 40, STAGE_H + 700) : rand(0, STAGE_H),
    r,
    body,
    highlight,
    vy: rand(70, 150),
    swayAmp: rand(14, 42),
    swayFreq: rand(0.4, 1.1),
    swayPhase: rand(0, Math.PI * 2),
    stringLen: rand(40, 80)
  };
}

function drawBalloon(p, dt, elapsed) {
  p.y -= p.vy * dt;

  const sway = Math.sin(elapsed * p.swayFreq + p.swayPhase) * p.swayAmp;
  const x = p.x + sway;
  const tilt = Math.cos(elapsed * p.swayFreq + p.swayPhase) * 0.16;

  ctx.save();
  ctx.translate(x, p.y);
  ctx.rotate(tilt);

  // String
  ctx.beginPath();
  ctx.moveTo(0, p.r * 1.15);
  ctx.quadraticCurveTo(
    p.r * 0.4, p.r * 1.15 + p.stringLen * 0.5,
    0, p.r * 1.15 + p.stringLen
  );
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Body
  ctx.beginPath();
  ctx.ellipse(0, 0, p.r * 0.82, p.r, 0, 0, Math.PI * 2);
  ctx.fillStyle = p.body;
  ctx.fill();

  // Knot
  ctx.beginPath();
  ctx.moveTo(-4, p.r * 1.02);
  ctx.lineTo(4, p.r * 1.02);
  ctx.lineTo(0, p.r * 1.22);
  ctx.closePath();
  ctx.fillStyle = p.body;
  ctx.fill();

  // Highlight
  ctx.beginPath();
  ctx.ellipse(-p.r * 0.28, -p.r * 0.34, p.r * 0.2, p.r * 0.3, -0.4, 0, Math.PI * 2);
  ctx.fillStyle = p.highlight;
  ctx.globalAlpha = 0.85;
  ctx.fill();

  ctx.restore();

  if (p.y + p.r * 1.4 < -40) Object.assign(p, makeBalloon(true));
}

/* ---------------------------------------------------------
   Loop
--------------------------------------------------------- */
function start(kind, durationMs, buildParticles) {
  // A second claim mid-effect replaces the first rather than
  // stacking two animation loops.
  if (rafId) teardown();

  ensureCanvas();
  mode = kind;
  particles = buildParticles();
  stopAt = performance.now() + durationMs;

  let last = performance.now();
  const began = last;

  const frame = (now) => {
    const dt = Math.min((now - last) / 1000, 0.05);   // clamp after a stall
    last = now;
    const elapsed = (now - began) / 1000;

    ctx.clearRect(0, 0, STAGE_W, STAGE_H);

    // Fade out over the final second
    const remaining = stopAt - now;
    ctx.globalAlpha = remaining < 1000 ? Math.max(0, remaining / 1000) : 1;

    for (const p of particles) {
      if (mode === "confetti") drawConfetti(p, dt, elapsed);
      else drawBalloon(p, dt, elapsed);
    }

    if (now >= stopAt) {
      teardown();
      return;
    }

    rafId = requestAnimationFrame(frame);
  };

  rafId = requestAnimationFrame(frame);
}

export function runConfetti(durationMs = 15000) {
  start("confetti", durationMs, () =>
    Array.from({ length: 160 }, (_, i) => makeConfetti(i > 40))
  );
}

export function runBalloons(durationMs = 15000) {
  start("balloons", durationMs, () =>
    Array.from({ length: 34 }, (_, i) => makeBalloon(i > 8))
  );
}

export function stopCelebrations() {
  teardown();
}
