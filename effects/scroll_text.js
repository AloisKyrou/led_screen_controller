'use strict';
// SCROLL TEXT — scrolls shared.scrollPool entry across the panel

const { buildTape, hexToRgb, hsvToRgb } = require('./font');

const name = 'scroll_text';

const SCROLL_SPEED = 30; // pixels per second

function init(W, H, config, shared, options) {
  const pool = (shared && shared.scrollPool) || [];
  const publicQueue = (shared && shared.publicQueue) || [];
  const selectedEntry = options && options.entry;
  const queuedEntry = !selectedEntry && publicQueue.length ? publicQueue.shift() : null;
  const entry = selectedEntry || queuedEntry || (pool.length ? pool[Math.floor(Math.random() * pool.length)] : null);
  if (shared && shared.onPublicQueueChange && queuedEntry) {
    shared.onPublicQueueChange();
  }
  const text    = (entry && entry.text)    || (shared && shared.scrollText)  || 'NOOLS';
  const color   = (entry && entry.color)   || (shared && shared.scrollColor) || '#ffffff';
  const rainbow = entry ? !!entry.rainbow : false;
  const { tape, tapeW, tapeH } = buildTape(text, H);
  return { W, H, tape, tapeW, tapeH, lastText: text, lockedEntry: !!selectedEntry, scrollX: 0, scrollAcc: 0, totalScrolled: 0, done: false, color, rainbow, hue: Math.random() };
}

function frame(state, t, dt, config, shared) {
  const { W, H } = state;

  // Live-update if there is exactly one pool entry (single-entry mode)
  const pool = (shared && shared.scrollPool) || [];
  if (!state.lockedEntry && pool.length === 1) {
    const text = pool[0].text || 'NOOLS';
    if (text !== state.lastText) {
      const { tape, tapeW, tapeH } = buildTape(text, H);
      state.tape = tape; state.tapeW = tapeW; state.tapeH = tapeH;
      state.lastText = text; state.scrollX = 0;
      state.totalScrolled = 0; state.done = false;
    }
    state.color   = pool[0].color   || '#ffffff';
    state.rainbow = !!pool[0].rainbow;
  }

  state.scrollAcc += ((config && config.speed) || SCROLL_SPEED) * dt;
  const steps = Math.floor(state.scrollAcc);
  state.scrollAcc -= steps;
  state.scrollX = (state.scrollX + steps) % (state.tapeW + W);
  // Track total pixels scrolled to know when one full pass is done
  if (!state.done) {
    state.totalScrolled += steps;
    if (state.totalScrolled >= state.tapeW + W) state.done = true;
  }

  let cr, cg, cb;
  if (state.rainbow) {
    state.hue = (state.hue + 0.15 * dt) % 1;
    [cr, cg, cb] = hsvToRgb(state.hue, 1, 1);
  } else {
    [cr, cg, cb] = hexToRgb(state.color);
  }

  const buf = new Uint8Array(H * W * 3);
  const offsetX = W - state.scrollX;
  const startY  = Math.floor((H - state.tapeH) / 2);

  for (let tc = 0; tc < state.tapeW; tc++) {
    const px = offsetX + tc;
    if (px < 0 || px >= W) continue;
    for (let tr = 0; tr < state.tapeH; tr++) {
      if (!state.tape[tr * state.tapeW + tc]) continue;
      const py = startY + tr;
      if (py < 0 || py >= H) continue;
      const idx = (py * W + px) * 3;
      buf[idx]   = cr;
      buf[idx+1] = cg;
      buf[idx+2] = cb;
    }
  }
  return buf;
}

module.exports = { name, init, frame };
