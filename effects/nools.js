'use strict';
// NOOLS — rainbow animated NOOLS letters
// Port of nools_rainbow.py

const { hsvToRgb, hexToRgb, CHAR_H, CHAR_W, GLYPHS } = require('./font');

const name = 'nools';

const NOOLS_GLYPHS = {
  N: [0x7F,0x04,0x08,0x10,0x7F],
  O: [0x3E,0x41,0x41,0x41,0x3E],
  L: [0x7F,0x40,0x40,0x40,0x40],
  S: [0x26,0x49,0x49,0x49,0x32],
};
const LETTERS = ['N','O','O','L','S'];
const SCALE   = 2;
const GAP     = 2;
const SPEED   = 0.3; // hue cycles per second  (from SPEED=0.6 / 2)

function buildMask(W, H) {
  const charW  = CHAR_W * SCALE;
  const charH  = CHAR_H * SCALE;
  const totalW = LETTERS.length * charW + (LETTERS.length - 1) * GAP;
  const startX = Math.floor((W - totalW) / 2);
  const startY = Math.floor((H - charH) / 2);
  const mask   = new Uint8Array(H * W); // stores pixel x position for hue calc

  for (let li = 0; li < LETTERS.length; li++) {
    const cols = NOOLS_GLYPHS[LETTERS[li]];
    const lx   = startX + li * (charW + GAP);
    for (let cx = 0; cx < CHAR_W; cx++) {
      const col = cols[cx];
      for (let cy = 0; cy < CHAR_H; cy++) {
        if ((col >> cy) & 1) {
          for (let sy = 0; sy < SCALE; sy++) {
            for (let sx = 0; sx < SCALE; sx++) {
              const px = lx + cx * SCALE + sx;
              const py = startY + cy * SCALE + sy;
              if (px >= 0 && px < W && py >= 0 && py < H) {
                mask[py * W + px] = px + 1; // +1 so 0 means "off"
              }
            }
          }
        }
      }
    }
  }
  return { mask, startX, startY };
}

function init(W, H) {
  return { W, H, ...buildMask(W, H) };
}

function frame(state, t, dt, config) {
  const { W, H, mask } = state;
  const buf = new Uint8Array(H * W * 3);
  const useFixed = config && config.rainbow === false;
  const [cr, cg, cb] = useFixed ? hexToRgb(config.color || '#ff8800') : [0, 0, 0];
  for (let i = 0; i < H * W; i++) {
    const px = mask[i];
    if (px > 0) {
      let r, g, b;
      if (useFixed) {
        r = cr; g = cg; b = cb;
      } else {
        const hue = ((px - 1) / (W - 1) + t * SPEED) % 1;
        [r, g, b] = hsvToRgb(hue, 1, 1);
      }
      buf[i*3]   = r;
      buf[i*3+1] = g;
      buf[i*3+2] = b;
    }
  }
  return buf;
}

module.exports = { name, init, frame };
