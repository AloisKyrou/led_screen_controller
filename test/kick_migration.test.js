'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('../test-support/server');

test('unified kick migrates linked and custom legacy colours without losing opacity or device', { timeout: 30000 }, async () => {
  let server = await startServer();
  const directory = server.directory;
  try {
    await server.stop(false);
    const configPath = path.join(directory, 'effects.json');
    const config = JSON.parse(fs.readFileSync(configPath));
    config._kick = { color: '#cc00ff', brightness: 0.6, rainbow: true };
    fs.writeFileSync(configPath, JSON.stringify(config));
    fs.writeFileSync(path.join(directory, 'audio.json'), JSON.stringify({ enabled: false, device: 'plughw:CARD=Headset,DEV=0', kickUsePanel: true, kickOpacity: 0.4, kickVisual: 'shockwave' }));
    server = await startServer(directory); await server.login();
    let audio = await (await server.request('/api/audio/state', undefined, true)).json();
    assert.equal(audio.kickAppearance.color, '#cc00ff');
    assert.equal(audio.kickAppearance.rainbow, true);
    assert.equal(audio.kickAppearance.opacity, 0.4);
    assert.equal(audio.settings.device, 'plughw:CARD=Headset,DEV=0');
    await server.request('/api/audio/settings', { kickColor: '#00aaff', kickRainbow: false }, true);
    const saved = JSON.parse(fs.readFileSync(path.join(directory, 'audio.json')));
    assert.equal(saved.kickUnified, true); assert.equal('kickUsePanel' in saved, false);
    await server.stop(false); server = await startServer(directory); await server.login();
    audio = await (await server.request('/api/audio/state', undefined, true)).json();
    assert.equal(audio.kickAppearance.color, '#00aaff');
    await server.stop(false);
    fs.writeFileSync(path.join(directory, 'audio.json'), JSON.stringify({ kickUsePanel: false, kickColor: '#ffaa00', kickBrightness: 0.8 }));
    server = await startServer(directory); await server.login();
    audio = await (await server.request('/api/audio/state', undefined, true)).json();
    assert.equal(audio.kickAppearance.color, '#ffaa00');
    assert.equal(audio.kickAppearance.brightness, 0.8);
    assert.equal(audio.kickAppearance.rainbow, false);
  } finally { await server.stop(); }
});
