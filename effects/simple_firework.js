'use strict';
// SIMPLE FIREWORK — particle bursts
// Port of simple_firework.py — time-based

const { hsvToRgb, hexToRgb } = require('./font');

const name = 'simple_firework';

const MIN_PARTICLES   = 20;
const MAX_PARTICLES   = 56;
const BURST_DUR       = 20 / 30; // seconds (20 frames at 30fps)
const GRAVITY         = 0.12 * 30; // px/s²
const MIN_SPEED       = 1.5 * 30;  // px/s
const MAX_SPEED       = 3.5 * 30;
const MIN_SIMULTANEOUS = 1;
const MAX_SIMULTANEOUS = 3;

function newBurst(W, H) {
  const cx = ((W/5) + Math.random() * (4*W/5 - W/5)) | 0;
  const cy = ((H/5) + Math.random() * (4*H/5 - H/5)) | 0;
  const [r, g, b] = hsvToRgb(Math.random(), 1, 1);
  const n = (MIN_PARTICLES + Math.random() * (MAX_PARTICLES - MIN_PARTICLES)) | 0;
  const particles = [];
  for (let i = 0; i < n; i++) {
    const angle = 2 * Math.PI * i / n + (Math.random() - 0.5) * 0.4;
    const speed = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);
    particles.push({ ox: cx, oy: cy, vx: speed * Math.cos(angle), vy: -speed * Math.sin(angle) });
  }
  return { r, g, b, particles, born: -1 }; // born set on first use
}

function spawnRound(W, H) {
  const count = (MIN_SIMULTANEOUS + Math.random() * (MAX_SIMULTANEOUS - MIN_SIMULTANEOUS + 1)) | 0;
  return Array.from({ length: count }, () => newBurst(W, H));
}

function init(W, H) {
  return { W, H, active: spawnRound(W, H) };
}

function frame(state, t, dt, config) {
  const { W, H } = state;
  const buf = new Uint8Array(H * W * 3);
  const useFixed = config && config.rainbow === false;
  const [cr, cg, cb] = useFixed ? hexToRgb(config.color || '#ff4400') : [0, 0, 0];

  const stillAlive = [];
  for (const burst of state.active) {
    if (burst.born < 0) burst.born = t;
    const age  = t - burst.born;
    const brightness = Math.max(0, 1 - age / BURST_DUR);

    const r = useFixed ? (cr * brightness) | 0 : (burst.r * brightness) | 0;
    const g = useFixed ? (cg * brightness) | 0 : (burst.g * brightness) | 0;
    const b = useFixed ? (cb * brightness) | 0 : (burst.b * brightness) | 0;

    for (const p of burst.particles) {
      const px = Math.round(p.ox + p.vx * age);
      const py = Math.round(p.oy + p.vy * age + 0.5 * GRAVITY * age * age);
      if (px >= 0 && px < W && py >= 0 && py < H) {
        const idx = (py * W + px) * 3;
        buf[idx]   = r;
        buf[idx+1] = g;
        buf[idx+2] = b;
      }
    }
    if (age < BURST_DUR) stillAlive.push(burst);
  }

  state.active = stillAlive.length ? stillAlive : spawnRound(W, H);
  return buf;
}

module.exports = { name, init, frame };
