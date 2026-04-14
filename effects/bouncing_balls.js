'use strict';
// BOUNCING BALLS — 20 coloured balls with physics
// Port of bouncing_balls.py — time-based

const { hexToRgb } = require('./font');

const name = 'bouncing_balls';

const BALLS   = 20;
const GRAVITY = 160;  // px/s²  — medium weight
const BOUNCE  = 0.60; // energy kept per bounce
const RADIUS  = 1;
const X_VEL   = 0.9 * 30;  // px/s

function spawn(from_right) {
  const off = (Math.random() * 16) | 0;
  const W   = 60; // will be overwritten by init ref, but default for spawn helper
  return { from_right, off };
}

function spawnBall(W, H, from_right) {
  if (from_right === undefined) from_right = Math.random() < 0.5;
  const off = Math.random() * 16;
  const bx  = from_right ? (W + RADIUS + off) : (-RADIUS - off);
  const vx  = from_right ? -((0.4 + Math.random() * (X_VEL/30 - 0.4)) * 30) : ((0.4 + Math.random() * (X_VEL/30 - 0.4)) * 30);
  return {
    x: bx, y: -RADIUS - off, vx, vy: 0.2 * 30,
    r: (50 + Math.random() * 205) | 0,
    g: (50 + Math.random() * 205) | 0,
    b: (50 + Math.random() * 205) | 0,
    from_right,
  };
}

function init(W, H) {
  const balls = [];
  for (let i = 0; i < BALLS; i++) balls.push(spawnBall(W, H, i % 2 === 0));
  return { W, H, balls };
}

function frame(state, t, dt, config) {
  const { W, H, balls } = state;
  const buf = new Uint8Array(H * W * 3);
  const useFixed = config && config.rainbow === false;
  const [cr, cg, cb] = useFixed ? hexToRgb(config.color || '#00aaff') : [0, 0, 0];

  for (const ball of balls) {
    const r = useFixed ? cr : ball.r;
    const g = useFixed ? cg : ball.g;
    const b = useFixed ? cb : ball.b;
    // Draw circle
    for (let dy = -RADIUS; dy <= RADIUS; dy++) {
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        if (dx*dx + dy*dy <= RADIUS*RADIUS) {
          const px = Math.round(ball.x) + dx;
          const py = Math.round(ball.y) + dy;
          if (px >= 0 && px < W && py >= 0 && py < H) {
            const idx = (py * W + px) * 3;
            buf[idx]   = r;
            buf[idx+1] = g;
            buf[idx+2] = b;
          }
        }
      }
    }
    // Physics
    ball.x  += ball.vx * dt;
    ball.y  += ball.vy * dt;
    ball.vy += GRAVITY * dt;

    if (ball.y + RADIUS >= H - 1) {
      ball.y  = H - 1 - RADIUS;
      ball.vy *= -BOUNCE;
    }
    // Respawn if out of bounds horizontally
    if (ball.x - RADIUS > W + 1 && ball.vx > 0) {
      Object.assign(ball, spawnBall(W, H, true));
    } else if (ball.x + RADIUS < 0 && ball.vx < 0) {
      Object.assign(ball, spawnBall(W, H, false));
    }
  }
  return buf;
}

module.exports = { name, init, frame };
