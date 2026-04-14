'use strict';
// SIMPLE SNAKE — autonomous pen on canvas with sparkle
// Port of simple_snake.py — time-based

const { hsvToRgb, hexToRgb } = require('./font');

const name = 'simple_snake';

const HUE_STEP_PS    = 1 / 360 * 30; // 1 degree/frame → hue/s
const MIN_SPEED      = 1.0 * 30;     // px/s
const MAX_SPEED      = 2.5 * 30;
const BOUNCE_CHAOS   = 0.5;          // radians jitter on bounce
const RESET_FULL     = true;
const SPARKLE_DELAY  = 3.0;          // seconds before sparkle activates
const SPARKLE_F_MIN  = 0.5;          // Hz
const SPARKLE_F_MAX  = 2.5;
const SPARKLE_DIM    = 0.15;         // min brightness at sine trough

function randVel() {
  const angle = Math.random() * 2 * Math.PI;
  const spd   = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);
  return [spd * Math.cos(angle), spd * Math.sin(angle)];
}

function jitterVel(vx, vy) {
  const spd   = Math.hypot(vx, vy);
  const angle = Math.atan2(vy, vx) + (Math.random() - 0.5) * 2 * BOUNCE_CHAOS;
  return [spd * Math.cos(angle), spd * Math.sin(angle)];
}

function init(W, H) {
  const total        = W * H;
  const buf          = new Uint8Array(H * W * 3);      // RGB canvas
  const paintTime    = new Float64Array(total).fill(-1); // -1 = not painted
  const sparkPhase   = new Float64Array(total);
  const sparkFreq    = new Float64Array(total).fill(1);

  const [vx, vy] = randVel();
  return {
    W, H, total, buf, paintTime, sparkPhase, sparkFreq,
    bx: (1 + Math.random() * (W - 2)),
    by: (1 + Math.random() * (H - 2)),
    vx, vy,
    hue: Math.random(),
    filled: 0,
  };
}

function frame(state, t, dt, config) {
  const { W, H, buf, paintTime, sparkPhase, sparkFreq } = state;
  const useFixed = config && config.rainbow === false;
  const [cr, cg, cb] = useFixed ? hexToRgb(config.color || '#00ffff') : hsvToRgb(state.hue, 1, 1);
  const [r, g, b] = [cr, cg, cb];

  // Move pen
  state.bx += state.vx * dt;
  state.by += state.vy * dt;

  if (state.bx < 0) {
    state.bx = 0; state.vx = Math.abs(state.vx);
    [state.vx, state.vy] = jitterVel(state.vx, state.vy); state.vx = Math.abs(state.vx);
  }
  if (state.bx >= W) {
    state.bx = W - 1; state.vx = -Math.abs(state.vx);
    [state.vx, state.vy] = jitterVel(state.vx, state.vy); state.vx = -Math.abs(state.vx);
  }
  if (state.by < 0) {
    state.by = 0; state.vy = Math.abs(state.vy);
    [state.vx, state.vy] = jitterVel(state.vx, state.vy); state.vy = Math.abs(state.vy);
  }
  if (state.by >= H) {
    state.by = H - 1; state.vy = -Math.abs(state.vy);
    [state.vx, state.vy] = jitterVel(state.vx, state.vy); state.vy = -Math.abs(state.vy);
  }

  const xi = Math.round(state.bx) | 0;
  const yi = Math.round(state.by) | 0;
  if (xi >= 0 && xi < W && yi >= 0 && yi < H) {
    const i = yi * W + xi;
    if (buf[i*3] === 0 && buf[i*3+1] === 0 && buf[i*3+2] === 0) {
      state.filled++;
      paintTime[i]  = t;
      sparkPhase[i] = Math.random() * 2 * Math.PI;
      sparkFreq[i]  = SPARKLE_F_MIN + Math.random() * (SPARKLE_F_MAX - SPARKLE_F_MIN);
    }
    buf[i*3]   = r;
    buf[i*3+1] = g;
    buf[i*3+2] = b;
  }
  state.hue = (state.hue + HUE_STEP_PS * dt) % 1;

  // Reset when full
  if (RESET_FULL && state.filled >= state.total) {
    buf.fill(0);
    paintTime.fill(-1);
    sparkPhase.fill(0);
    sparkFreq.fill(1);
    state.filled = 0;
    state.bx = 1 + Math.random() * (W - 2);
    state.by = 1 + Math.random() * (H - 2);
    [state.vx, state.vy] = randVel();
    state.hue = Math.random();
  }

  // Build output with sparkle applied
  const out = new Uint8Array(H * W * 3);
  for (let i = 0; i < H * W; i++) {
    let cr = buf[i*3], cg = buf[i*3+1], cb = buf[i*3+2];
    if ((cr || cg || cb) && paintTime[i] >= 0 && (t - paintTime[i]) >= SPARKLE_DELAY) {
      const s   = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * sparkFreq[i] + sparkPhase[i]);
      const dim = SPARKLE_DIM + (1 - SPARKLE_DIM) * s;
      cr = (cr * dim) | 0;
      cg = (cg * dim) | 0;
      cb = (cb * dim) | 0;
    }
    out[i*3]   = cr;
    out[i*3+1] = cg;
    out[i*3+2] = cb;
  }
  return out;
}

module.exports = { name, init, frame };
