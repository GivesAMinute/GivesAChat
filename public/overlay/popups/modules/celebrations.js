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

/* ---------------------------------------------------------
   ⭐ THE TAPER.

   Effects used to recycle every particle forever and then cut
   out on a one second fade, which read as someone switching the
   confetti off rather than a celebration ending.

   Respawning now stops partway through, so the sky empties
   itself: pieces already falling continue, nothing new arrives
   above them, and the last few drift down alone. RESPAWN_FRACTION
   is where that cutoff sits — 0.45 leaves more than half the
   runtime as the thinning-out, which is the part worth watching.
--------------------------------------------------------- */
const RESPAWN_FRACTION = 0.45;

/* Velora gold, and the warmer gold beside it. Reserved for the
   large pieces so the size difference reads as deliberate rather
   than as random noise in the sizes. */
const GOLD = ["#e2af00", "#dcaf20"];

let canvas = null;
let ctx = null;
let rafId = null;

let particles = [];
let rockets = [];
let sparks = [];

let stopAt = 0;
let respawnUntil = 0;
let nextLaunchAt = 0;
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
  rockets = [];
  sparks = [];
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
  /* ---------------------------------------------------------
     One piece in four is a big gold one.

     Size and colour are decided together on purpose. A large
     piece in a random colour just looks like the sizes are
     inconsistent; large AND gold reads as a second kind of
     confetti mixed into the first.

     Big pieces also fall slower and sway wider — heavier card
     catches more air, and it keeps them on screen through the
     taper after the small stuff has landed.
  --------------------------------------------------------- */
  const big = Math.random() < 0.25;

  return {
    big,
    x: rand(-40, STAGE_W + 40),
    y: seedFromTop ? rand(-STAGE_H * 0.4, -20) : rand(-60, STAGE_H),
    w: big ? rand(22, 36) : rand(9, 18),
    h: big ? rand(30, 48) : rand(14, 26),
    color: big ? pick(GOLD) : pick(CONFETTI_COLORS),
    vy: big ? rand(70, 140) : rand(90, 210),
    swayAmp: big ? rand(45, 110) : rand(20, 70),
    swayFreq: big ? rand(0.4, 1.0) : rand(0.6, 1.8),
    swayPhase: rand(0, Math.PI * 2),
    spin: (big ? rand(1.2, 3.4) : rand(2, 7)) * (Math.random() < 0.5 ? -1 : 1),
    angle: rand(0, Math.PI * 2),
    tilt: rand(0, Math.PI * 2),
    dead: false
  };
}

function drawConfetti(p, dt, elapsed, mayRespawn) {
  if (p.dead) return;

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

  if (p.y - p.h > STAGE_H) {
    /* Past the cutoff a piece that lands simply stops existing,
       which is what thins the sky out. */
    if (mayRespawn) Object.assign(p, makeConfetti(true), { y: rand(-160, -20) });
    else p.dead = true;
  }
}

/* ---------------------------------------------------------
   Fireworks — 1st place, BEHIND the confetti.

   Drawn before the confetti in the same frame, which is the
   whole of the layering: one canvas, painter's order. A second
   canvas would have needed its own z-index and its own teardown
   for no gain.

   Rockets rise from below the frame, slow under gravity, and
   burst at a height chosen at launch. Sparks then fall with
   gravity and fade over their own lifetime, so a burst thins
   from the outside in rather than vanishing all at once.
--------------------------------------------------------- */
const FIREWORK_COLORS = [
  "#e2af00", "#dcaf20", "#ffd23f",     // gold, weighted by repetition
  "#e2af00", "#dcaf20",
  "#ff5fd2", "#4cc9f0", "#7dff5c", "#ff3b6b"
];

const SPARK_GRAVITY = 260;   // px/s², gentler than real so bursts hang

function launchRocket() {
  return {
    x: rand(240, STAGE_W - 240),
    y: STAGE_H + 20,
    vx: rand(-40, 40),
    vy: -rand(620, 880),
    burstY: rand(160, 520),
    color: pick(FIREWORK_COLORS),
    trail: []
  };
}

function burst(rocket) {
  const count = Math.round(rand(46, 78));
  const speed = rand(150, 320);

  for (let i = 0; i < count; i++) {
    /* Slight speed jitter per spark, so the shell is a soft
       sphere rather than a perfect ring. */
    const a = (i / count) * Math.PI * 2 + rand(-0.05, 0.05);
    const s = speed * rand(0.55, 1);

    sparks.push({
      x: rocket.x,
      y: rocket.y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      color: rocket.color,
      life: rand(1.1, 2.1),
      age: 0,
      size: rand(2, 4.5)
    });
  }
}

function drawRockets(dt) {
  for (const r of rockets) {
    r.vy += SPARK_GRAVITY * 0.55 * dt;
    r.x += r.vx * dt;
    r.y += r.vy * dt;

    r.trail.push({ x: r.x, y: r.y });
    if (r.trail.length > 9) r.trail.shift();

    ctx.save();
    for (let i = 0; i < r.trail.length; i++) {
      const t = r.trail[i];
      ctx.globalAlpha = (i / r.trail.length) * 0.75;
      ctx.fillStyle = r.color;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Burst at its chosen height, or as it runs out of climb.
    if (r.y <= r.burstY || r.vy >= -40) {
      burst(r);
      r.spent = true;
    }
  }

  rockets = rockets.filter((r) => !r.spent && r.y < STAGE_H + 120);
}

function drawSparks(dt) {
  for (const s of sparks) {
    s.age += dt;
    s.vy += SPARK_GRAVITY * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;

    const remaining = 1 - s.age / s.life;
    if (remaining <= 0) continue;

    ctx.save();
    ctx.globalAlpha = Math.max(0, remaining) * 0.95;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.size * remaining, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  sparks = sparks.filter((s) => s.age < s.life && s.y < STAGE_H + 60);
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
  /* ---------------------------------------------------------
     Three sizes, and the largest are gold.

     Tying the gold to the biggest balloons means the eye is
     drawn to them rather than to whichever happened to be
     nearest. They also rise slowest — a big balloon that raced
     past would undo the point of making it big.
  --------------------------------------------------------- */
  const roll = Math.random();
  const large = roll < 0.28;
  const medium = !large && roll < 0.62;

  const r = large ? rand(72, 104) : medium ? rand(46, 68) : rand(28, 44);

  const [body, highlight] = large
    ? [pick(GOLD), "#fff0b8"]
    : pick(BALLOON_COLORS);

  return {
    x: rand(60, STAGE_W - 60),
    y: seedBelow ? rand(STAGE_H + 40, STAGE_H + 900) : rand(0, STAGE_H),
    r,
    body,
    highlight,
    shimmer: large,
    vy: large ? rand(38, 62) : medium ? rand(52, 84) : rand(66, 104),
    swayAmp: rand(14, 46),
    swayFreq: rand(0.4, 1.1),
    swayPhase: rand(0, Math.PI * 2),
    stringLen: r * rand(1.4, 2.1),
    dead: false
  };
}

function drawBalloon(p, dt, elapsed, mayRespawn) {
  if (p.dead) return;

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

  /* ---------------------------------------------------------
     Shimmer, on the gold ones only.

     A soft band travelling across the body, clipped to the
     balloon so it cannot spill past the edge. Its angle comes
     from elapsed time rather than a CSS animation, so it stays
     in step with the sway on the same clock.
  --------------------------------------------------------- */
  if (p.shimmer) {
    const t = (elapsed * 0.55 + p.swayPhase) % 1;
    const bandX = (t * 2.6 - 1.3) * p.r;

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, p.r * 0.82, p.r, 0, 0, Math.PI * 2);
    ctx.clip();

    const g = ctx.createLinearGradient(
      bandX - p.r * 0.45, -p.r,
      bandX + p.r * 0.45, p.r
    );
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, "rgba(255,255,255,0.42)");
    g.addColorStop(1, "rgba(255,255,255,0)");

    ctx.fillStyle = g;
    ctx.fillRect(-p.r, -p.r * 1.1, p.r * 2, p.r * 2.2);
    ctx.restore();
  }

  // Highlight
  ctx.beginPath();
  ctx.ellipse(-p.r * 0.28, -p.r * 0.34, p.r * 0.2, p.r * 0.3, -0.4, 0, Math.PI * 2);
  ctx.fillStyle = p.highlight;
  ctx.globalAlpha = 0.85;
  ctx.fill();

  ctx.restore();

  if (p.y + p.r * 1.4 + p.stringLen < -40) {
    if (mayRespawn) Object.assign(p, makeBalloon(true));
    else p.dead = true;
  }
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
  rockets = [];
  sparks = [];

  const now0 = performance.now();
  stopAt = now0 + durationMs;
  respawnUntil = now0 + durationMs * RESPAWN_FRACTION;
  nextLaunchAt = now0 + 250;

  let last = now0;
  const began = now0;

  const frame = (now) => {
    const dt = Math.min((now - last) / 1000, 0.05);   // clamp after a stall
    last = now;
    const elapsed = (now - began) / 1000;
    const mayRespawn = now < respawnUntil;

    ctx.clearRect(0, 0, STAGE_W, STAGE_H);

    /* Only the last half second fades. The taper has already
       thinned things out by then, so this catches whatever is
       still mid-air rather than cutting a full sky. */
    const remaining = stopAt - now;
    const fade = remaining < 500 ? Math.max(0, remaining / 500) : 1;

    if (mode === "confetti") {
      /* ⭐ Fireworks first — painter's order IS the layering. */
      if (now >= nextLaunchAt && mayRespawn) {
        rockets.push(launchRocket());
        nextLaunchAt = now + rand(520, 1150);
      }

      ctx.globalAlpha = fade;
      drawRockets(dt);
      drawSparks(dt);

      for (const p of particles) {
        ctx.globalAlpha = fade;
        drawConfetti(p, dt, elapsed, mayRespawn);
      }
    } else {
      for (const p of particles) {
        ctx.globalAlpha = fade;
        drawBalloon(p, dt, elapsed, mayRespawn);
      }
    }

    if (now >= stopAt) {
      teardown();
      return;
    }

    rafId = requestAnimationFrame(frame);
  };

  rafId = requestAnimationFrame(frame);
}

export function runConfetti(durationMs = 22000) {
  start("confetti", durationMs, () =>
    Array.from({ length: 150 }, (_, i) => makeConfetti(i > 40))
  );
}

export function runBalloons(durationMs = 22000) {
  /* Fewer than before on purpose. The ask was to see individual
     balloons, and thirty-four at once was a wall of them. */
  start("balloons", durationMs, () =>
    Array.from({ length: 22 }, (_, i) => makeBalloon(i > 5))
  );
}

export function stopCelebrations() {
  teardown();
}
