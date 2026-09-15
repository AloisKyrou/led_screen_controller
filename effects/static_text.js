'use strict';
// STATIC TEXT — centered text, stationary

const { buildAutoMasks, hexToRgb, hsvToRgb } = require('./font');

const name = 'static_text';
const PAGE_DURATION = 2.5;

function init(W, H, config, shared, options) {
  const pool = (shared && shared.staticPool) || [];
  const selectedEntry = options && options.entry;
  const entry = selectedEntry || (pool.length ? pool[Math.floor(Math.random() * pool.length)] : null);
  const text    = (entry && entry.text)    || (shared && shared.staticText)  || 'NOOLS';
  const color   = (entry && entry.color)   || (shared && shared.staticColor) || '#ff8800';
  const rainbow = entry ? !!entry.rainbow : false;
  return { W, H, masks: buildAutoMasks(text, W, H), lastText: text, lockedEntry: !!selectedEntry, pageStart: 0, color, rainbow, hue: Math.random() };
}

function frame(state, t, dt, config, shared) {
  const { W, H } = state;

  // Live-update if there is exactly one pool entry
  const pool = (shared && shared.staticPool) || [];
  if (!state.lockedEntry && pool.length === 1) {
    const text = pool[0].text || 'NOOLS';
    if (text !== state.lastText) {
      state.masks = buildAutoMasks(text, W, H);
      state.lastText = text;
      state.pageStart = t;
    }
    state.color   = pool[0].color   || '#ff8800';
    state.rainbow = !!pool[0].rainbow;
  }

  const masks = state.masks && state.masks.length ? state.masks : [new Uint8Array(H * W)];
  const pageElapsed = Math.max(0, t - state.pageStart);
  state.done = pageElapsed >= masks.length * PAGE_DURATION;
  const mask = masks[Math.floor(pageElapsed / PAGE_DURATION) % masks.length];
  const buf = new Uint8Array(H * W * 3);
  if (state.rainbow) {
    state.hue = (state.hue + 0.1 * dt) % 1;
    for (let i = 0; i < H * W; i++) {
      if (mask[i]) {
        const x = i % W;
        const [r, g, b] = hsvToRgb((state.hue + x / W * 0.5) % 1, 1, 1);
        buf[i*3] = r; buf[i*3+1] = g; buf[i*3+2] = b;
      }
    }
  } else {
    const [r, g, b] = hexToRgb(state.color);
    for (let i = 0; i < H * W; i++) {
      if (mask[i]) { buf[i*3] = r; buf[i*3+1] = g; buf[i*3+2] = b; }
    }
  }
  return buf;
}

module.exports = { name, init, frame };
