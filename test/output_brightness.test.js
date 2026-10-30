'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scaleOutput } = require('../lib/output-brightness');
const fading = require('../effects/fading_pixel');
const { blendKickFlash } = require('../lib/kick-overlay');

test('brightness scales a separate output, preserving persistent RGB at every gain', () => {
  const source = Uint8Array.from([200, 100, 50, 255, 20, 0]);
  for (const gain of [0, 0.2, 0.7, 1]) {
    const before = source.slice();
    const output = scaleOutput(source, gain);
    assert.notEqual(output, source);
    assert.deepEqual([...output], [...before].map(v => Math.round(v * gain)));
    blendKickFlash(output, [255, 255, 255], 1, 0.5);
    assert.deepEqual(source, before);
  }
});

test('fading pixels retain the same lifetime at reduced and changing brightness', t => {
  t.mock.method(Math, 'random', () => 0); // Spawn only at pixel zero.
  const state = fading.init(60, 15);
  state.buf.set([255, 200, 100], 3); // Existing pixel untouched by spawning.
  for (let frame = 1; frame <= 14; frame++) {
    const raw = fading.frame(state, frame / 30, 1 / 30, { rainbow: false, color: '#ffffff' });
    const expected = [255, 200, 100].map(v => Math.max(0, v - frame * 20));
    assert.deepEqual([...raw.slice(3, 6)], expected);
    const gain = frame < 5 ? 0.2 : frame < 9 ? 0 : 1;
    const output = scaleOutput(raw, gain);
    assert.deepEqual([...output.slice(3, 6)], expected.map(v => Math.round(v * gain)));
    assert.deepEqual([...state.buf.slice(3, 6)], expected);
  }
});
