'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
test('chaos letters gather into a stationary sparkling NOOLS then disperse', t => {
  t.mock.method(Math, 'random', () => 0.5);
  const effect = require('../effects/nol_chaos');
  const state = effect.init(60, 15);
  state.nextFormation = 0;
  const config = { speed: 30, rainbow: false, color: '#ff0000' };
  const frame = () => effect.frame(state, state.clock, 0.1, config);
  frame();
  assert.equal(state.formation.letters.map(s => s.text).join(''), 'NOOLS');
  for (let i = 0; i < 12; i++) frame();
  const first = frame(), second = frame();
  const mask = pixels => Array.from(pixels, v => v > 0);
  assert.deepEqual(mask(first), mask(second), 'word does not move while sparkling');
  assert.notDeepEqual(first, second, 'brightness scintillates');
  const { GLYPHS } = require('../effects/font');
  const expected = new Uint8Array(60 * 15 * 3);
  for (const letter of state.formation.letters) for (let x = 0; x < 5; x++) for (let y = 0; y < 7; y++) {
    if (GLYPHS[letter.text][x] & (1 << y)) expected[((letter.ty + y - 3) * 60 + letter.tx + x - 2) * 3] = 1;
  }
  assert.deepEqual(mask(first), mask(expected), 'the complete NOOLS is readable');
  for (let i = 0; i < 20; i++) frame();
  assert.equal(state.formation, null);
  assert.ok(state.nextFormation > state.clock + 3);
  assert.ok(state.sprites.length >= 5);
});
for (const name of ['pharmacy_tunnel', 'nool_scatter', 'nol_chaos']) {
  const effect = require('../effects/' + name);
  test(name + ' animates bounded frames and honours fixed colour', () => {
    const state = effect.init(60, 15);
    const frames = new Set();
    let visible = 0;
    for (let i = 0; i < 300; i++) {
      const frame = effect.frame(state, i / 30, 1 / 30, { rainbow: false, color: '#ff0000', speed: 30 });
      assert.ok(frame instanceof Uint8Array); assert.equal(frame.length, 2700);
      assert.ok(frame.every((v, index) => index % 3 === 0 || v === 0));
      if (frame.some(v => v > 0)) visible++;
      frames.add(Buffer.from(frame).toString('base64'));
      if (state.sprites) assert.ok(state.sprites.length <= (name === 'nol_chaos' ? 24 : 9));
    }
    assert.ok(visible > 280);
    assert.ok(frames.size > 50);
  });
}
test('scattered NOOL uses intact one-pixel-stroke glyphs before rotation', () => {
  const effect = require('../effects/nool_scatter');
  const state = effect.init(60, 15);
  state.spawn = 10;
  state.sprites = [{ text: 'NOOL', width: 23, x: 20, y: 7, born: 0, life: 2, hue: 0 }];
  const frame = effect.frame(state, 0, 0, { rainbow: false, color: '#ff0000' });
  const { GLYPHS } = require('../effects/font');
  for (let c = 0; c < 4; c++) for (let x = 0; x < 5; x++) for (let y = 0; y < 7; y++) {
    assert.equal(frame[((y + 4) * 60 + 9 + c * 6 + x) * 3] > 0, Boolean(GLYPHS['NOOL'[c]][x] & (1 << y)));
  }
});
