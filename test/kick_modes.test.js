'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../test-support/server');
test('kick visuals temporarily override disabled kicks and restore saved settings on exit', { timeout: 30000 }, async () => {
  const server = await startServer();
  try {
    await server.login();
    await server.request('/api/audio/settings', { enabled: true, source: 'demo', kickEnabled: false, kickVisual: 'brightness', kickAdaptive: true }, true);
    await server.request('/api/effects/audio_kick_only/play', {}, true);
    let flashSeen = false;
    for (let i = 0; i < 35; i++) {
      const state = await (await server.request('/api/state', undefined, true)).json();
      flashSeen ||= state.kickFlash;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    assert.equal(flashSeen, true);
    let audio = await (await server.request('/api/audio/state', undefined, true)).json();
    assert.equal(audio.settings.kickEnabled, false);
    assert.equal(audio.settings.kickVisual, 'brightness');
    assert.equal(audio.kickAppearance.visual, 'flash');
    assert.equal(audio.detection.sensitivityMultiplier, 2);
    assert.equal((await server.request('/api/effects/audio_kick_only/config', { kickSensitivity: 9 }, true)).status, 400);
    assert.equal((await server.request('/api/effects/audio_scope/config', { kickSensitivity: 2 }, true)).status, 400);
    await server.request('/api/effects/audio_kick_only/config', { kickSensitivity: 3 }, true);
    await new Promise(resolve => setTimeout(resolve, 100));
    audio = await (await server.request('/api/audio/state', undefined, true)).json();
    assert.equal(audio.detection.sensitivityMultiplier, 3);
    await server.request('/api/effects/audio_kick_shockwave/play', {}, true);
    await new Promise(resolve => setTimeout(resolve, 100));
    audio = await (await server.request('/api/audio/state', undefined, true)).json();
    assert.equal(audio.kickAppearance.visual, 'shockwave');
    assert.equal(audio.kickAppearance.temporaryOverride, true);
    assert.equal(audio.detection.sensitivityMultiplier, 2);
    await server.request('/api/effects/audio_spectrum/play', {}, true);
    await new Promise(resolve => setTimeout(resolve, 700));
    audio = await (await server.request('/api/audio/state', undefined, true)).json();
    assert.equal(audio.kickAppearance.visual, 'brightness');
    assert.equal(audio.kickAppearance.temporaryOverride, false);
    assert.equal(audio.settings.kickEnabled, false);
    assert.equal(audio.detection.sensitivityMultiplier, 1);
    assert.equal((await (await server.request('/api/state', undefined, true)).json()).kickFlash, false);
  } finally { await server.stop(); }
});
