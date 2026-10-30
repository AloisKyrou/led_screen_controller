'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
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
