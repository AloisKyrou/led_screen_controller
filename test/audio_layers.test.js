'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createKickOverlay, blendKickFlash } = require('../lib/kick-overlay');
const mirror = require('../effects/audio_mirror');

test('kick only returns to black after a flash mutates its background', () => {
  const effect = require('../effects/audio_kick_only');
  const state = effect.init(60, 15);
  const background = effect.frame(state);
  assert.equal(background.length, 2700);
  blendKickFlash(background, [255, 255, 255], 1, 0.04);
  assert.ok(background.some(value => value > 0));
  assert.ok(effect.frame(state).every(value => value === 0));
});

test('flash opacity blends the actual background at 0, 50 and 100 percent', () => {
  const base = Uint8Array.from([20, 80, 160]);
  assert.deepEqual(blendKickFlash(base.slice(), [200, 100, 0], 1, 0), base);
  assert.deepEqual([...blendKickFlash(base.slice(), [200, 100, 0], 1, 0.5)], [110, 90, 80]);
  assert.deepEqual([...blendKickFlash(base.slice(), [200, 100, 0], 1, 1)], [200, 100, 0]);
  assert.deepEqual([...blendKickFlash(base.slice(), [200, 100, 0], 0.5, 0.5)], [60, 65, 80]);
  assert.deepEqual([...blendKickFlash(base.slice(), [255, 255, 255], 1, 0.04)], [29, 87, 164]);
});

test('wave opacity preserves background at zero and interpolates even saturated pixels', () => {
  const base = new Uint8Array(2700).fill(120);
  const render = opacity => {
    const layer = createKickOverlay(60, 15);
    layer.trigger(0, { color: [255, 255, 255], brightness: 1, durationMs: 500, opacity });
    return layer.render(base, 0.02);
  };
  assert.deepEqual(render(0), base);
  const full = render(1), half = render(0.5);
  for (let i = 0; i < full.length; i++) assert.equal(half[i], Math.round((base[i] + full[i]) / 2));
});

test('shockwave adds light without changing its base and expires completely', () => {
  const overlay = createKickOverlay(60, 15);
  const base = new Uint8Array(2700).fill(20);
  overlay.trigger(0, { color: [255, 100, 0], brightness: 1, durationMs: 500 });
  const early = overlay.render(base, 0.02);
  const later = overlay.render(base, 0.3);
  assert.ok(early.some(v => v > 20));
  assert.notDeepEqual(early, later);
  assert.ok(early.every(v => v >= 20));
  assert.ok(base.every(v => v === 20));
  assert.deepEqual(overlay.render(base, 0.51), base);
  overlay.trigger(1, { color: [255, 255, 255], brightness: 1, durationMs: 500 });
  assert.deepEqual(overlay.render(base, 1.1, 0), base);
  overlay.clear();
  assert.deepEqual(overlay.render(base, 1.2), base);
});

test('mirror is symmetric on both axes and returns to black in silence', () => {
  const state = mirror.init(60, 15);
  let bands = Array.from({ length: 15 }, (_, i) => 1 - i / 16);
  const shared = { audio: { snapshot: () => ({ bands }) } };
  const pixels = mirror.frame(state, 0, 0.03, {}, shared);
  assert.equal(pixels.length, 2700);
  assert.ok(pixels.some(v => v > 0));
  const pixel = (x, y) => pixels.slice((y * 60 + x) * 3, (y * 60 + x) * 3 + 3);
  for (let y = 0; y < 15; y++) for (let x = 0; x < 60; x++) {
    assert.deepEqual(pixel(x, y), pixel(59 - x, y));
    assert.deepEqual(pixel(x, y), pixel(x, 14 - y));
  }
  bands = Array(15).fill(0);
  assert.ok(mirror.frame(state, 2, 2, {}, shared).every(v => v === 0));
});
