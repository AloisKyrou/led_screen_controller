'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../test-support/server');
test('effect Bright bumps independently of global kick routing and restores its baseline', { timeout: 30000 }, async () => {
  let server = await startServer();
  const state = async () => (await server.request('/api/state', undefined, true)).json();
  try {
    await server.login();
    await server.request('/api/effects/pumping_circle/config', { brightness: 0.25, kickBrightnessBump: true, disableKick: true }, true);
    await server.request('/api/effects/pumping_circle/play', {}, true);
    await server.request('/api/brightness', { value: 0.7 }, true);
    await server.request('/api/audio/settings', { kickEnabled: false, kickVisual: 'flash', kickBoostEnabled: false, kickAttackMs: 0, kickReleaseMs: 1000 }, true);
    await server.request('/api/event', { type: 'kick' }, true);
    let live = await state();
    assert.ok(live.effectiveEffectBrightness > 0.9);
    assert.equal(live.effectiveBrightness, 0.7);
    assert.equal(live.kickFlash, false);
    assert.equal(live.effects.find(e => e.id === 'pumping_circle').brightness, 0.25);
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal((await state()).effectiveEffectBrightness, 0.25);
    // Audio can trigger this local bump without enabling the global flash.
    await server.request('/api/audio/settings', { enabled: true, source: 'demo' }, true);
    let bumped = false;
    for (let i = 0; i < 35; i++) {
      live = await state(); bumped ||= live.effectiveEffectBrightness > 0.5;
      assert.equal(live.kickFlash, false);
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    assert.equal(bumped, true);
    await server.request('/api/effects/pumping_circle/config', { kickBrightnessBump: false }, true);
    assert.equal((await state()).effectiveEffectBrightness, 0.25);
    await server.request('/api/effects/pumping_circle/config', { kickBrightnessBump: true }, true);
    await server.request('/api/event', { type: 'kick' }, true);
    await server.request('/api/effects/fading_pixel/config', { brightness: 0.4 }, true);
    await server.request('/api/effects/fading_pixel/play', {}, true);
    assert.equal((await state()).effectiveEffectBrightness, 0.4);
    const directory = server.directory;
    await server.stop(false); server = await startServer(directory); await server.login();
    assert.equal((await state()).effects.find(e => e.id === 'pumping_circle').kickBrightnessBump, true);
  } finally { await server.stop(); }
});
