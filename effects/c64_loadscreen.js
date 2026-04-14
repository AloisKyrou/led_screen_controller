'use strict';
// C64 LOADSCREEN — random coloured horizontal scan lines that fade
// Port of c64_loadscreen.py — time-based

const { hexToRgb } = require('./font');

const name = 'c64_loadscreen';

const LINES_PER_FRAME = 3;
const FADE            = 30; // per channel per frame at 30fps

function init(W, H) {
  return { W, H, buf: new Uint8Array(H * W * 3) };
}

function frame(state, t, dt, config) {
  const { W, H, buf } = state;

  // Fade
  for (let i = 0; i < buf.length; i++) {
    buf[i] = Math.max(0, buf[i] - FADE);
  }
  // New scan lines — random or fixed color
  const useFixed = config && config.rainbow === false;
  const [cr, cg, cb] = useFixed ? hexToRgb(config.color || '#ff8800') : [0, 0, 0];
  for (let n = 0; n < LINES_PER_FRAME; n++) {
    const y = (Math.random() * H) | 0;
    const r = useFixed ? cr : (Math.random() * 256) | 0;
    const g = useFixed ? cg : (Math.random() * 256) | 0;
    const b = useFixed ? cb : (Math.random() * 256) | 0;
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 3;
      buf[idx]   = r;
      buf[idx+1] = g;
      buf[idx+2] = b;
    }
  }
  return buf;
}

module.exports = { name, init, frame };
