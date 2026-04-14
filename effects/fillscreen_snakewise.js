'use strict';
// FILLSCREEN SNAKEWISE — fills screen with coloured blocks in snake order
// Port of fillscreen_snakewise.py

const name = 'fillscreen_snakewise';

const RECT_W  = 2;
const RECT_H  = 2;
const COLORS  = [
  [255,0,0],[0,255,0],[0,0,255],
  [255,255,0],[0,255,255],[255,0,255],
];

function buildOrder(W, H) {
  const colsPerRow = Math.ceil(W / RECT_W);
  const rowsTotal  = Math.ceil(H / RECT_H);
  const order = [];
  for (let ry = 0; ry < rowsTotal; ry++) {
    const colRange = ry % 2 === 0
      ? Array.from({ length: colsPerRow }, (_, i) => i)
      : Array.from({ length: colsPerRow }, (_, i) => colsPerRow - 1 - i);
    for (const cx of colRange) order.push([cx * RECT_W, ry * RECT_H]);
  }
  return order;
}

function init(W, H) {
  return {
    W, H,
    order: buildOrder(W, H),
    buf: new Uint8Array(H * W * 3),
    step: 0,
    colorIdx: 0,
  };
}

function frame(state, t, dt) {
  const { W, H, order, buf } = state;
  const [bx, by] = order[state.step % order.length];
  const [r, g, b] = COLORS[state.colorIdx % COLORS.length];

  for (let dy = 0; dy < RECT_H; dy++) {
    for (let dx = 0; dx < RECT_W; dx++) {
      const px = bx + dx;
      const py = by + dy;
      if (px < W && py < H) {
        const idx = (py * W + px) * 3;
        buf[idx]   = r;
        buf[idx+1] = g;
        buf[idx+2] = b;
      }
    }
  }
  state.step++;
  if (state.step % order.length === 0) {
    state.colorIdx++;
    buf.fill(0);
  }
  return buf;
}

module.exports = { name, init, frame };
