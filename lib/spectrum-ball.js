'use strict';

function stepBall(state, previous, levels, dt, W, H, random = Math.random) {
  const quiet = !levels.some(value => value > 0.015);
  // x/y describe the square's lower-left corner in bottom-up coordinates.
  const ball = state.ball || (state.ball = { x: W * 0.2, y: 0, vx: 2, vy: 0 });
  const elapsed = Math.min(0.1, Math.max(0, dt));
  if (!elapsed) return;
  // Decisions have a lifetime: no frame-by-frame random jitter.
  ball.decisionIn = (ball.decisionIn ?? 0.8) - elapsed;
  if (!quiet && ball.decisionIn <= 0) {
    const direction = random() < 0.3 ? -Math.sign(ball.vx || 1) : Math.sign(ball.vx || 1);
    ball.vx = direction * (6 + random() * 14);
    ball.decisionIn = 0.7 + random() * 1.8;
  }
  if (quiet) ball.decisionIn = Math.max(0.3, ball.decisionIn);
  const steps = Math.ceil(elapsed * 120), step = elapsed / steps;
  const scale = Math.max(1, H - 3);
  const bandAt = x => Math.max(0, Math.min(14, Math.floor(x * 15 / W)));
  const surface = (band, fraction) => quiet ? 0 : (previous[band] + (levels[band] - previous[band]) * fraction) * scale + 0.7;
  for (let i = 0; i < steps; i++) {
    ball.bounceCooldown = Math.max(0, (ball.bounceCooldown || 0) - step);
    const oldX = ball.x, oldY = ball.y, oldBand = bandAt(oldX);
    if (quiet) ball.vx += (Math.sign(ball.vx || 1) * 2 - ball.vx) * (1 - Math.exp(-step * 6));
    ball.vy -= 42 * step;
    ball.x += ball.vx * step;
    ball.y += ball.vy * step;
    if (ball.x < 0 || ball.x > W - 2) {
      ball.x = Math.max(0, Math.min(W - 2, ball.x)); ball.vx *= -1;
    }
    let band = bandAt(ball.x);
    let top = surface(band, (i + 1) / steps);
    // A taller neighbour is a wall, not a teleport to its top.
    if (band !== oldBand && oldY < top - 0.2) {
      ball.x = oldX; ball.vx *= -1; band = oldBand; top = surface(band, (i + 1) / steps);
    }
    const rise = Math.max(0, Math.min(60, (levels[band] - previous[band]) * scale / elapsed));
    if (ball.y <= top && (ball.vy <= 0 || rise > ball.vy)) {
      ball.y = top;
      if (quiet) ball.vy = 0;
      else if (ball.bounceCooldown <= 0) {
        // Most hops are small; occasional energetic leaps break the rhythm.
        const leap = random() < 0.18 ? 1.65 : 0.8 + random() * 0.5;
        ball.vy = Math.min(34, (5 + levels[band] * 5 + Math.abs(ball.vy) * 0.4 + rise * 0.3) * leap);
        const direction = random() < 0.22 ? -Math.sign(ball.vx || 1) : Math.sign(ball.vx || 1);
        ball.vx = direction * (6 + random() * 8 + levels[band] * 5 + rise * 0.06);
        ball.bounceCooldown = 0.12;
      } else ball.vy = Math.max(0, ball.vy);
    }
    if (ball.y > H - 2) { ball.y = H - 2; ball.vy = -Math.abs(ball.vy) * 0.72; }
  }
}

module.exports = { stepBall };
