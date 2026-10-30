'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../test-support/server');
test('disabling audio stops playback, filters AUTO and rejects manual audio playback', { timeout: 30000 }, async () => {
  const server = await startServer();
  try {
    await server.login();
    const state = async () => (await server.request('/api/state', undefined, true)).json();
    const initial = await state();
    assert.equal(initial.currentEffectId.startsWith('audio_'), false);
    for (const effect of initial.effects.filter(e => e.id.startsWith('audio_'))) {
      assert.equal(effect.available, false);
      assert.equal((await server.request(`/api/effects/${effect.id}/play`, {}, true)).status, 409);
    }
    await server.request('/api/audio/settings', { enabled: true, source: 'demo' }, true);
    await server.request('/api/effects/audio_spectrum/config', { enabled: true }, true);
    assert.equal((await server.request('/api/effects/audio_spectrum/play', {}, true)).status, 200);
    await server.request('/api/audio/settings', { enabled: false }, true);
    let current = await state();
    assert.equal(current.audio.status, 'disabled');
    assert.equal(current.currentEffectId.startsWith('audio_'), false);
    assert.equal(current.effects.find(e => e.id === 'audio_spectrum').enabled, true);
    // Even when all non-audio effects are deselected, fallback must not use audio.
    for (const effect of current.effects.filter(e => !e.id.startsWith('audio_'))) {
      await server.request(`/api/effects/${effect.id}/config`, { enabled: false }, true);
    }
    await server.request('/api/audio/settings', { enabled: true }, true);
    await server.request('/api/effects/audio_kick_only/play', {}, true);
    await server.request('/api/audio/settings', { enabled: false }, true);
    current = await state();
    assert.equal(current.currentEffectId.startsWith('audio_'), false);
    assert.equal(current.audio.settings.enabled, false);
    const sceneId = current.selectedSceneId;
    await server.request('/api/scene', { id: sceneId, loop: true, cues: [
      { effectId: 'audio_scope', duration: 1 }, { effectId: 'pumping_circle', duration: 1 },
    ] }, true);
    await server.request('/api/scene/play', {}, true);
    assert.equal((await state()).currentEffectId, 'pumping_circle');
    await server.request('/api/scene/next', {}, true);
    assert.equal((await state()).currentEffectId, 'pumping_circle');
    await server.request('/api/scene/stop', {}, true);
    await server.request('/api/scene', { id: sceneId, loop: true, cues: [{ effectId: 'audio_scope', duration: 1 }] }, true);
    await server.request('/api/scene/play', {}, true);
    assert.equal((await state()).scenePlayback.active, false);
  } finally { await server.stop(); }
});
