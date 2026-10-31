'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { NAMES, makeEffect, render } = require('../lib/halloween');
test('groove pumpkins retain green stems and triangular eyes at rest', () => {
  const pixels = render('pumpkin_groove', 60, 15, 0, [0,0,0], 0);
  for (const cx of [10, 30, 50]) {
    const rgb = (x,y) => [...pixels.slice((y * 60 + x) * 3, (y * 60 + x) * 3 + 3)];
    assert.deepEqual(rgb(cx, 1), [40,255,20]);
    for (const sign of [-1,1]) {
      assert.deepEqual(rgb(cx + sign * 3, 5), [0,0,0]);
      for (let dx = -1; dx <= 1; dx++) assert.deepEqual(rgb(cx + sign * 3 + dx, 6), [0,0,0]);
    }
    assert.ok(rgb(cx - 7, 7)[0] > 0);
    assert.ok(rgb(cx + 7, 7)[0] > 0);
  }
});
test('jump pumpkin stays visible and rotates in silence; only kick controls zoom', () => {
  const idle = render('pumpkin_jump', 60, 15, 0, [0,0,0], 0);
  const moving = render('pumpkin_jump', 60, 15, 2, [0,0,0], 0);
  assert.ok(idle.some(v => v > 0)); assert.notDeepEqual(idle, moving);
  assert.deepEqual(idle, render('pumpkin_jump', 60, 15, 0, [1,1,1], 0));
  const lit = buf => buf.reduce((n,v,i) => n + (i % 3 === 0 && v > 0 ? 1 : 0), 0);
  assert.ok(lit(render('pumpkin_jump', 60, 15, 0, [0,0,0], 1)) > lit(idle) * 2);
});
test('skull fills the height proportionally and retains two 2x2 eye sockets', () => {
  for (const pulse of [0, 1]) {
    const pixels = render('skeleton', 60, 15, 0, [0,0,0], pulse);
    for (let y = 0; y < 15; y++) assert.ok(pixels.slice((y * 60 + 22) * 3, (y * 60 + 39) * 3).some(v => v > 0));
    assert.equal(pixels[(5 * 60 + 21) * 3], 0);
    assert.equal(pixels[(5 * 60 + 39) * 3], 0);
    for (const x of [26, 34]) {
      for (let yy = 6; yy < 8; yy++) for (let xx = x; xx < x + 2; xx++) assert.equal(pixels[(yy * 60 + xx) * 3], 0);
      assert.ok(pixels[(6 * 60 + x - 1) * 3] > 0);
      assert.ok(pixels[(6 * 60 + x + 2) * 3] > 0);
    }
  }
});
for (const name of NAMES) test(name + ' animates, reacts to audio, and bounds particle state', () => {
  const effect = makeEffect(name), state = effect.init(60, 15);
  let audio = { bands: Array(15).fill(0), beatCount: 0 };
  const shared = { audio: { snapshot: () => audio } };
  let previous; let changed = 0;
  for (let i = 0; i < 240; i++) {
    audio = { bands: Array(15).fill(i % 30 < 8 ? 0.9 : 0.1), beatCount: Math.floor(i / 15) };
    const pixels = effect.frame(state, i / 30, 1 / 30, {}, shared);
    assert.equal(pixels.length, 2700); assert.ok(pixels instanceof Uint8Array);
    if (previous && !Buffer.from(previous).equals(Buffer.from(pixels))) changed++;
    previous = pixels;
    assert.ok(state.particles.length <= 35);
  }
  assert.ok(changed > 20);
  assert.ok(!Buffer.from(render(name, 60, 15, 1, [0,0,0], 0)).equals(Buffer.from(render(name, 60, 15, 1, [1,1,1], 0.5))), 'audio must change the drawing');
});

test('Halloween effects register as audio-only, default AUTO off and overlays off', { timeout: 20000 }, async () => {
  const { startServer } = require('../test-support/server');
  const server = await startServer();
  try {
    await server.login();
    const { validateUpload } = require('../lib/public-gifs');
    for (const file of ['pumpkin', 'ghosts', 'hands', 'bat', 'drip', 'eyes', 'spiders', 'cauldron']) {
      const response = await server.request(`/halloween-gifs/${file}.gif`, undefined, true);
      assert.equal(response.status, 200);
      validateUpload(Buffer.from(await response.arrayBuffer()).toString('base64'));
    }
    const state = await (await server.request('/api/state', undefined, true)).json();
    for (const name of NAMES) {
      const id = 'audio_' + name, effect = state.effects.find(e => e.id === id);
      if (['cauldron', 'monster_mouth', 'watching_eyes'].includes(name)) {
        assert.equal(effect, undefined);
        assert.equal((await server.request(`/api/effects/${id}/play`, {}, true)).status, 409);
        continue;
      }
      assert.equal(effect.enabled, false); assert.equal(effect.disableKick, true); assert.equal(effect.available, false);
      assert.equal((await server.request(`/api/effects/${id}/play`, {}, true)).status, 409);
      assert.equal((await server.request(`/api/effects/${id}/config`, { reactivity: 2 }, true)).status, 200);
    }
    await server.request('/api/audio/settings', { enabled: true, source: 'demo' }, true);
    for (const name of NAMES) assert.equal((await server.request(`/api/effects/audio_${name}/play`, {}, true)).status,
      ['cauldron', 'monster_mouth', 'watching_eyes'].includes(name) ? 409 : 200);
  } finally { await server.stop(); }
});
