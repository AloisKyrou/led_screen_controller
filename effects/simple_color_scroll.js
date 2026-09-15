'use strict';
// SIMPLE COLOR SCROLL — rainbow columns scrolling left
// Port of simple_color_scroll.py — time-based

const { hsvToRgb, hexToRgb } = require('./font');

const name = 'simple_color_scroll';

const HUE_STEP_PS = 2 / 360; // 2 degrees/frame × 30fps → hue/s  (× dt each frame)
// Scroll 1 column per frame = 30 col/s
const SCROLL_SPEED = 30; // columns per second

function init(W, H) {
  // buf: Uint8Array(H * W * 3)
  const buf = new Uint8Array(H * W * 3);
  return { W, H, buf, hue: 0, scrollAcc: 0 };
}

function frame(state, t, dt, config) {
  const { W, H, buf } = state;
  const useFixed = config && config.rainbow === false;
  const [cr, cg, cb] = useFixed ? hexToRgb(config.color || '#00ff80') : [0, 0, 0];

  // Accumulate scroll — shift whole columns left
  state.scrollAcc += SCROLL_SPEED * dt;
  const shifts = Math.floor(state.scrollAcc);
  state.scrollAcc -= shifts;

  for (let s = 0; s < shifts; s++) {
    // Shift all columns left by 1
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W - 1; x++) {
        const dst = (y * W + x) * 3;
        const src = dst + 3;
        buf[dst]   = buf[src];
        buf[dst+1] = buf[src+1];
        buf[dst+2] = buf[src+2];
      }
    }
    // Fill rightmost column
    const [r, g, b] = useFixed ? [cr, cg, cb] : hsvToRgb(state.hue, 1, 1);
    for (let y = 0; y < H; y++) {
      const idx = (y * W + (W - 1)) * 3;
      buf[idx]   = r;
      buf[idx+1] = g;
      buf[idx+2] = b;
    }
    state.hue = (state.hue + HUE_STEP_PS) % 1;
  }
  return buf.slice(); // return a copy — buf is persistent state, must not be mutated by the server's brightness pass
}

module.exports = { name, init, frame };
