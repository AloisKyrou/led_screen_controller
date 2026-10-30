'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const effect = require('../effects/audio_pumping_circle');

function render(bands, gain = 1) {
  return effect.frame(effect.init(60, 15), 0, 1, { reactivity: gain }, { audio: { snapshot: () => ({ bands }) } });
}

test('modest audio pulses expand and contract by several radius pixels', () => {
  const state = effect.init(60, 15);
  const bands = Array(15).fill(0);
  const shared = { audio: { snapshot: () => ({ bands }) } };
  const advance = (level, frames) => {
    bands.fill(level, 0, 5);
    for (let i = 0; i < frames; i++) effect.frame(state, i / 30, 1 / 30, {}, shared);
    return state.levels[0] * 7;
  };
  advance(0.04, 90);
  const peak = advance(0.15, 3);
  const valley = advance(0.04, 8);
  assert.ok(peak > 5, `peak radius ${peak}`);
  assert.ok(peak - valley > 3, `radius excursion ${peak - valley}`);
  assert.equal(state.levels[1], 0);
  assert.equal(state.levels[2], 0);
  advance(0.005, 300);
  assert.ok(state.levels[0] < 0.025, 'auto-ranging does not amplify near-silence');
});

test('bass, mids and highs animate only the corresponding circle', () => {
  for (let group = 0; group < 3; group++) {
    const bands = Array.from({ length: 15 }, (_, i) => Math.floor(i / 5) === group ? 1 : 0);
    const pixels = render(bands);
    assert.equal(pixels.length, 2700);
    assert.ok(pixels.some(v => v > 0));
    for (let y = 0; y < 15; y++) for (let x = 0; x < 60; x++) {
      if (Math.floor(x / 20) !== group) assert.ok(pixels.slice((y * 60 + x) * 3, (y * 60 + x) * 3 + 3).every(v => v === 0));
    }
  }
});

test('sensitivity enlarges circles; silence fades to black; fixed colour is respected', () => {
  const bands = Array(15).fill(0.2);
  const lit = pixels => pixels.reduce((count, value, i) => count + (i % 3 === 0 && (value || pixels[i + 1] || pixels[i + 2]) ? 1 : 0), 0);
  assert.ok(lit(render(bands, 4)) > lit(render(bands)));
  const state = effect.init(60, 15);
  const shared = { audio: { snapshot: () => ({ bands }) } };
  const pixels = effect.frame(state, 0, 1, { rainbow: false, color: '#ff0000' }, shared);
  assert.ok(pixels.every((value, i) => i % 3 === 0 || value === 0));
  bands.fill(0);
  assert.ok(effect.frame(state, 1, 2, {}, shared).every(v => v === 0));
});
