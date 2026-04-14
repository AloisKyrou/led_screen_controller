'use strict';
// FADING PIXEL — random bright pixels that fade out
// Port of fading_pixel.py

const { hexToRgb } = require('./font');

const name = 'fading_pixel';

const PIXEL_COUNT = 40;
const FADE        = 20;  // per channel per frame at 30fps

function init(W, H) {
  return {
    W, H,
    buf: new Uint8Array(H * W * 3), // RGB canvas
  };
}

function frame(state, t, dt, config) {
  const { W, H, buf } = state;
  // Fade existing pixels
  for (let i = 0; i < buf.length; i++) {
    buf[i] = Math.max(0, buf[i] - FADE);
  }
  // Spawn new pixels — random or fixed color
  const useFixed = config && config.rainbow === false;
  const [cr, cg, cb] = useFixed ? hexToRgb(config.color || '#ffffff') : [0, 0, 0];
  for (let n = 0; n < PIXEL_COUNT; n++) {
    const x = (Math.random() * W) | 0;
    const y = (Math.random() * H) | 0;
    const idx = (y * W + x) * 3;
    buf[idx]   = useFixed ? cr : (Math.random() * 256) | 0;
    buf[idx+1] = useFixed ? cg : (Math.random() * 256) | 0;
    buf[idx+2] = useFixed ? cb : (Math.random() * 256) | 0;
  }
  return buf;
}

module.exports = { name, init, frame };
