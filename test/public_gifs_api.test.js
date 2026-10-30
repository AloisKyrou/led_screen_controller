'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer } = require('../test-support/server');
const fixtures = require('./fixtures/public-gifs.json');

test('public GIF HTTP flow: validation, protected review, approval, playback, persistence and shared limits', { timeout: 30000 }, async () => {
  let server = await startServer();
  try {
    const bytes = Buffer.from(fixtures.disposal.base64, 'base64');
    const clientId = 'integration-browser-1234';
    const payload = { gif: fixtures.disposal.base64, name: '<b>Test</b>', clientId,
      width: 1, frameCount: 1, status: 'approved', frames: ['untrusted'] };
    for (const asset of ['/message', '/panel-gif.js', '/gif-editor.js', '/gif-editor.css', '/message.js']) {
      assert.equal((await server.request(asset)).status, 200, asset);
    }
    const config = await (await server.request('/api/public/messages/config')).json();
    assert.equal(config.gif.requiresApproval, true);
    assert.equal(config.gif.width, 60);
    const corrupt = Buffer.from(bytes); corrupt[6] = 61;
    for (const gif of ['ZmFrZQ==', corrupt.toString('base64'), bytes.subarray(0, 20).toString('base64')]) {
      const response = await server.request('/api/public/gif', { ...payload, gif });
      assert.equal(response.status, 400);
      assert.ok((await response.json()).error);
    }
    const oversized = await server.request('/api/public/gif', { gif: 'A'.repeat(1100000) });
    assert.equal(oversized.status, 413);
    assert.match(oversized.headers.get('content-type'), /json/);
    const submitted = await server.request('/api/public/gif', payload);
    assert.equal(submitted.status, 201);
    const item = await submitted.json();
    assert.equal(item.status, 'pending'); assert.equal(item.kind, 'gif');
    const statusRoute = `/api/public/messages/${item.id}/status?receipt=${item.receipt}`;
    assert.equal((await server.request(`/api/public/messages/${item.id}/status?receipt=wrong`)).status, 404);
    assert.equal((await (await server.request(statusRoute)).json()).status, 'pending');
    assert.equal((await server.request(`/api/public-messages/${item.id}/gif`)).status, 401);
    assert.equal((await server.request(`/api/public-messages/${item.id}/approve`, {})).status, 401);
    assert.equal((await server.request(`/api/public-messages/${item.id}/replay`, {})).status, 401);
    assert.equal((await server.request(`/api/public-messages/${item.id}/save-media`, {})).status, 401);
    assert.equal((await server.request('/api/public/gif', payload)).status, 409);
    await server.login();
    assert.equal((await server.request(`/api/public-messages/${item.id}/save-media`, {}, true)).status, 409);
    assert.equal((await server.request(`/api/public-messages/${item.id}/replay`, {}, true)).status, 409);
    const view = (await (await server.request('/api/state', undefined, true)).json()).publicMessages;
    assert.equal(view.pending[0].gif.frameCount, 4);
    assert.equal(view.pending[0].gif.durationMs, 1000);
    assert.equal('frames' in view.pending[0], false);
    assert.equal('receipt' in view.pending[0], false);
    const raw = await server.request(`/api/public-messages/${item.id}/gif?download=1`, undefined, true);
    assert.match(raw.headers.get('content-type'), /image\/gif/);
    assert.match(raw.headers.get('content-disposition'), /attachment/);
    assert.deepEqual(Buffer.from(await raw.arrayBuffer()), bytes);
    const metadata = view.pending[0].gif;
    assert.equal((await server.request(`/public-gifs/${metadata.hash}.gif`)).status, 404);
    assert.equal((await server.request('/api/public-messages/mode', { mode: 'automatic' }, true)).status, 200);
    assert.equal((await (await server.request(statusRoute)).json()).status, 'pending');
    await server.request('/api/public-messages/settings', { maxMessagesPerIp: 1 }, true);
    assert.equal((await server.request('/api/public/message', { text: 'Hello', clientId: 'different-browser-1234' })).status, 429);
    assert.equal((await server.request('/api/public/gif', { ...payload, clientId: 'different-browser-1234' })).status, 429);
    await server.request('/api/public-messages/settings', { maxMessagesPerIp: 100 }, true);
    const saved = JSON.parse(fs.readFileSync(path.join(server.directory, 'messages.json')));
    assert.equal(saved.items[0].gif.hash, metadata.hash);
    assert.ok(fs.statSync(path.join(server.directory, 'messages.json')).size < 10000);
    const directory = server.directory;
    await server.stop(false);
    server = await startServer(directory);
    await server.login();
    assert.equal((await (await server.request(statusRoute)).json()).status, 'pending');
    const gifPath = path.join(directory, 'public-gifs', metadata.hash + '.gif');
    fs.unlinkSync(gifPath);
    assert.equal((await server.request(`/api/public-messages/${item.id}/approve`, {}, true)).status, 409);
    fs.writeFileSync(gifPath, bytes);
    assert.equal((await server.request(`/api/public-messages/${item.id}/approve`, {}, true)).status, 200);
    assert.equal((await (await server.request(statusRoute)).json()).status, 'approved');
    assert.equal((await server.request('/api/public-messages/next', {}, true)).status, 200);
    assert.equal((await (await server.request(statusRoute)).json()).status, 'playing');
    // A manual interruption restores the entry instead of losing it.
    await server.request('/api/next', {}, true);
    assert.equal((await (await server.request(statusRoute)).json()).status, 'approved');
    await server.request('/api/public-messages/next', {}, true);
    await new Promise(resolve => setTimeout(resolve, 1250));
    assert.equal((await (await server.request(statusRoute)).json()).status, 'displayed');
    const playedState = await (await server.request('/api/state', undefined, true)).json();
    assert.equal(playedState.publicMessages.history.find(entry => entry.id === item.id).status, 'displayed');
    const promoted = await server.request(`/api/public-messages/${item.id}/save-media`, {}, true);
    assert.equal(promoted.status, 201);
    const libraryItem = (await promoted.json()).media;
    const duplicateSave = await server.request(`/api/public-messages/${item.id}/save-media`, {}, true);
    assert.equal(duplicateSave.status, 200);
    assert.equal((await duplicateSave.json()).library.length, 1);
    const libraryOnDisk = JSON.parse(fs.readFileSync(path.join(directory, 'media.json')));
    const decoded = require('../public/panel-gif').decode(bytes);
    assert.deepEqual(libraryOnDisk.entries[0].durations, decoded.durations);
    assert.deepEqual(libraryOnDisk.entries[0].frames, decoded.frames.map(frame => Buffer.from(frame).toString('base64')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'effects.json'))).media.enabled, true);
    assert.equal((await server.request(`/api/public-messages/${item.id}/replay`, {}, true)).status, 200);
    assert.equal((await server.request(`/api/public-messages/${item.id}/replay`, {}, true)).status, 409);
    assert.equal((await (await server.request(statusRoute)).json()).status, 'approved');
    await server.stop(false);
    server = await startServer(directory);
    await server.login();
    assert.equal((await server.request(`/api/public-messages/${item.id}/save-media`, {}, true)).status, 200);
    fs.unlinkSync(gifPath);
    // The permanent library is independent of public history and its GIF files.
    assert.equal((await server.request(`/api/media/${libraryItem.id}/play`, {}, true)).status, 200);
    fs.writeFileSync(gifPath, bytes);
    const rejected = await (await server.request('/api/public/gif', { ...payload, clientId: 'rejected-browser-1234' })).json();
    assert.equal((await server.request(`/api/public-messages/${rejected.id}/reject`, {}, true)).status, 200);
    assert.equal((await (await server.request(`/api/public/messages/${rejected.id}/status?receipt=${rejected.receipt}`)).json()).status, 'rejected');
  } finally { await server.stop(); }
});
