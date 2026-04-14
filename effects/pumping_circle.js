'use strict';
// PUMPING CIRCLE — 3 pulsing coloured circles
// Port of pumping_circle.py — time-based

const { hsvToRgb, hexToRgb } = require('./font');

const name = 'pumping_circle';

const RADIUS_SPEED = 0.75 * 30; // px/s
const HUE_STEP_PS  = (1 / 360) * 30; // 1 degree/frame × 30fps → hue/s  (full cycle ≈ 12s)

function init(W, H) {
  const maxR = Math.min(W, H) / 2;
  const SEC  = Math.floor(W / 3);
  const balls = [
    { cx: Math.floor(SEC / 2),             cy: Math.floor(H / 2), hue: 0,       radius: 1,          growing: true },
    { cx: Math.floor(W / 2),               cy: Math.floor(H / 2), hue: 1/3,     radius: maxR / 2,   growing: false },
    { cx: Math.floor(SEC + SEC + SEC / 2), cy: Math.floor(H / 2), hue: 2/3,     radius: 1,          growing: true },
  ];
  return { W, H, maxR, balls };
}

function frame(state, t, dt, config) {
  const { W, H, maxR, balls } = state;
  const buf = new Uint8Array(H * W * 3);
  const useFixed = config && config.rainbow === false;
  const [cr, cg, cb] = useFixed ? hexToRgb(config.color || '#ff0080') : [0, 0, 0];

  for (const ball of balls) {
    const [r, g, b] = useFixed ? [cr, cg, cb] : hsvToRgb(ball.hue, 1, 1);
    const rad = Math.round(ball.radius);
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (dx*dx + dy*dy <= rad*rad) {
          const px = ball.cx + dx;
          const py = ball.cy + dy;
          if (px >= 0 && px < W && py >= 0 && py < H) {
            const idx = (py * W + px) * 3;
            buf[idx]   = r;
            buf[idx+1] = g;
            buf[idx+2] = b;
          }
        }
      }
    }
    // Update radius
    if (ball.growing) {
      ball.radius += RADIUS_SPEED * dt;
      if (ball.radius >= maxR) ball.growing = false;
    } else {
      ball.radius -= RADIUS_SPEED * dt;
      if (ball.radius <= 1) ball.growing = true;
    }
    // Update hue
    ball.hue = (ball.hue + HUE_STEP_PS * dt) % 1;
  }
  return buf;
}

module.exports = { name, init, frame };
