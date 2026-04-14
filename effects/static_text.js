'use strict';
// STATIC TEXT — centered text, stationary

const { buildAutoMask, hexToRgb, hsvToRgb } = require('./font');

const name = 'static_text';

function init(W, H, config, shared) {
  const pool = (shared && shared.staticPool) || [];
  const entry = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  const text    = (entry && entry.text)    || (shared && shared.staticText)  || 'NOOLS';
  const color   = (entry && entry.color)   || (shared && shared.staticColor) || '#ff8800';
  const rainbow = entry ? !!entry.rainbow : false;
  return { W, H, mask: buildAutoMask(text, W, H), lastText: text, color, rainbow, hue: Math.random() };
}

function frame(state, t, dt, config, shared) {
  const { W, H } = state;

  // Live-update if there is exactly one pool entry
  const pool = (shared && shared.staticPool) || [];
  if (pool.length === 1) {
    const text = pool[0].text || 'NOOLS';
    if (text !== state.lastText) {
      state.mask = buildAutoMask(text, W, H);
      state.lastText = text;
    }
    state.color   = pool[0].color   || '#ff8800';
    state.rainbow = !!pool[0].rainbow;
  }

  const buf = new Uint8Array(H * W * 3);
  if (state.rainbow) {
    state.hue = (state.hue + 0.1 * dt) % 1;
    for (let i = 0; i < H * W; i++) {
      if (state.mask[i]) {
        const x = i % W;
        const [r, g, b] = hsvToRgb((state.hue + x / W * 0.5) % 1, 1, 1);
        buf[i*3] = r; buf[i*3+1] = g; buf[i*3+2] = b;
      }
    }
  } else {
    const [r, g, b] = hexToRgb(state.color);
    for (let i = 0; i < H * W; i++) {
      if (state.mask[i]) { buf[i*3] = r; buf[i*3+1] = g; buf[i*3+2] = b; }
    }
  }
  return buf;
}

module.exports = { name, init, frame };
