'use strict';
// FETE TROUBLE — "FETE" top half, "TROUBLE" bottom half, rainbow columns
// Port of fete_trouble.py Script TOP

const { hsvToRgb, hexToRgb } = require('./font');

const name = 'fete_trouble';

const SPEED = 0.3; // hue cycles/sec (SPEED=0.01 per frame × 30fps / 1)

// 5×7 string bitmaps matching fete_trouble.py
const FONT_5x7 = {
  F: ['11111','10000','10000','11110','10000','10000','10000'],
  E: ['11111','10000','10000','11110','10000','10000','11111'],
  T: ['11111','00100','00100','00100','00100','00100','00100'],
  R: ['11110','10001','10001','11110','10100','10010','10001'],
  O: ['01110','10001','10001','10001','10001','10001','01110'],
  U: ['10001','10001','10001','10001','10001','10001','01110'],
  B: ['11110','10001','10001','11110','10001','10001','11110'],
  L: ['10000','10000','10000','10000','10000','10000','11111'],
};

function buildMask(W, H) {
  const mask = new Uint8Array(H * W);      // stores px+1 for hue lookup
  function renderWord(word, y0, scale, spacing) {
    const charW = 5 * scale;
    const total = word.length * charW + (word.length - 1) * spacing;
    let x = Math.floor((W - total) / 2);
    for (const ch of word) {
      const g = FONT_5x7[ch];
      for (let gy = 0; gy < 7; gy++) {
        for (let gx = 0; gx < 5; gx++) {
          if (g[gy][gx] === '1') {
            for (let sy = 0; sy < scale; sy++) {
              for (let sx = 0; sx < scale; sx++) {
                const px = x + gx * scale + sx;
                const py = y0 + gy * scale + sy;
                if (px >= 0 && px < W && py >= 0 && py < H) {
                  mask[py * W + px] = px + 1;
                }
              }
            }
          }
        }
      }
      x += charW + spacing;
    }
  }
  renderWord('FETE',    0, 1, 1);
  renderWord('TROUBLE', 8, 1, 1);
  return mask;
}

function init(W, H) {
  return { W, H, mask: buildMask(W, H) };
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
