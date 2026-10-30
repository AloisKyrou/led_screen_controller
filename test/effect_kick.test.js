'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../test-support/server');
test('per-effect overlay suppression preserves boost, persists, and leaves other effects unchanged', { timeout: 30000 }, async () => {
  let server = await startServer();
  const state = async () => (await server.request('/api/state', undefined, true)).json();
  try {
    await server.login();
    await server.request('/api/audio/settings', { enabled: true, source: 'demo' }, true);
    assert.equal((await server.request('/api/effects/audio_scope/config', { disableKick: 'true' }, true)).status, 400);
    assert.equal((await server.request('/api/effects/audio_kick_only/config', { disableKick: true }, true)).status, 400);
    await server.request('/api/effects/audio_scope/config', { disableKick: true }, true);
    await server.request('/api/effects/audio_scope/play', {}, true);
    await server.request('/api/audio/settings', { kickVisual: 'flash', kickBoostEnabled: false }, true);
    await server.request('/api/event', { type: 'kick' }, true);
    assert.equal((await state()).kickFlash, false);
    await server.request('/api/brightness', { value: 0.7 }, true);
    await server.request('/api/audio/settings', { kickBoostEnabled: true, kickReleaseMs: 1000 }, true);
    await server.request('/api/event', { type: 'kick' }, true);
    let current = await state();
    assert.equal(current.kickFlash, false);
    assert.ok(current.effectiveBrightness > 0.9);
    assert.equal(current.globalBrightness, 0.7);
    await server.request('/api/audio/settings', { kickVisual: 'brightness', kickBoostEnabled: false }, true);
    await server.request('/api/event', { type: 'kick' }, true);
    assert.ok((await state()).effectiveBrightness > 0.9);
    await server.request('/api/audio/settings', { kickVisual: 'flash' }, true);
    await server.request('/api/effects/audio_mirror/play', {}, true);
    await server.request('/api/event', { type: 'kick' }, true);
    assert.equal((await state()).kickFlash, true);
    // Entering a protected effect must also suppress an already-running flash.
    await server.request('/api/effects/audio_scope/play', {}, true);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal((await state()).kickFlash, false);
    const directory = server.directory;
    await server.stop(false); server = await startServer(directory); await server.login();
    assert.equal((await state()).effects.find(effect => effect.id === 'audio_scope').disableKick, true);
  } finally { await server.stop(); }
});
