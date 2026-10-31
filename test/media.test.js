'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const media = require('../effects/media');

function encoded(values) {
  return Buffer.from(values).toString('base64');
}

test('media AUTO uses relative weights and ignores disabled entries', t => {
  const shared = { mediaLibrary: { entries: [
    { id: 'a', weight: 1, frames: [encoded([1,0,0])] },
    { id: 'b', weight: 4, frames: [encoded([0,1,0])] },
    { id: 'off', weight: 10, enabled: false, frames: [encoded([0,0,1])] },
  ] } };
  let draw = 0;
  t.mock.method(Math, 'random', () => draw);
  const counts = { a: 0, b: 0 };
  for (let i = 0; i < 100; i++) { draw = (i + 0.5) / 100; counts[media.init(1, 1, {}, shared).mediaId]++; }
  assert.deepEqual(counts, { a: 20, b: 80 });
  assert.equal(media.init(1, 1, {}, shared, { mediaId: 'a' }).mediaId, 'a');
});

test('AUTO excludes unselected media but explicit playback still works', () => {
  const shared = { mediaLibrary: { entries: [
    { id: 'off', enabled: false, version: 1, frames: [encoded([255, 0, 0])] },
    { id: 'on', enabled: true, version: 2, frames: [encoded([0, 255, 0])] },
  ] } };
  for (let i = 0; i < 50; i++) assert.equal(media.init(1, 1, {}, shared).mediaId, 'on');
  assert.equal(media.init(1, 1, {}, shared, { mediaId: 'off' }).mediaId, 'off');
  shared.mediaLibrary.entries[1].enabled = false;
  const state = media.init(1, 1, {}, shared);
  assert.equal(state.mediaId, null);
  assert.deepEqual([...media.frame(state, 0, 0, {}, shared)], [0, 0, 0]);
});

test('media selection is validated, authenticated and survives restart', { timeout: 30000 }, async () => {
  const { startServer } = require('../test-support/server');
  let server = await startServer();
  try {
    assert.equal((await server.request('/api/media/unknown/enabled', { enabled: false })).status, 401);
    await server.login();
    const created = await (await server.request('/api/media', { name: 'selection', frames: [encoded(new Array(2700).fill(10))], durations: [100] }, true)).json();
    const id = created.media.id;
    assert.equal((await server.request(`/api/media/${id}/weight`, { weight: 0 }, true)).status, 400);
    assert.equal((await server.request(`/api/media/${id}/weight`, { weight: 4 }, true)).status, 200);
    await server.request('/api/effects/media/config', { freq: 100 }, true);
    assert.equal(created.media.enabled, true);
    assert.equal((await server.request(`/api/media/${id}/enabled`, { enabled: 'false' }, true)).status, 400);
    const off = await (await server.request(`/api/media/${id}/enabled`, { enabled: false }, true)).json();
    assert.equal(off.library.find(item => item.id === id).enabled, false);
    const directory = server.directory;
    await server.stop(false); server = await startServer(directory); await server.login();
    const state = await (await server.request('/api/state', undefined, true)).json();
    assert.equal(state.shared.media.find(item => item.id === id).weight, 4);
    assert.equal(state.effects.find(item => item.id === 'media').freq, 100);
    assert.equal(state.shared.media.find(item => item.id === id).enabled, false);
    assert.equal((await server.request(`/api/media/${id}/play`, {}, true)).status, 200);
    const on = await (await server.request(`/api/media/${id}/enabled`, { enabled: true }, true)).json();
    assert.equal(on.library.find(item => item.id === id).enabled, true);
  } finally { await server.stop(); }
});

test('media effect displays a static RGB frame', () => {
  const shared = {
    mediaLibrary: { entries: [
      { id: 'first', version: 1, frames: [encoded([1, 2, 3, 4, 5, 6])], durations: [1000] },
    ] },
  };
  const state = media.init(2, 1, {}, shared, { mediaId: 'first' });
  assert.deepEqual([...media.frame(state, 0, 0.5, {}, shared)], [1, 2, 3, 4, 5, 6]);
});

test('media effect advances animated frames using their delays', () => {
  const shared = {
    mediaLibrary: { entries: [{
      id: 'animated',
      version: 2,
      frames: [encoded([255, 0, 0]), encoded([0, 255, 0])],
      durations: [100, 200],
    }] },
  };
  const state = media.init(1, 1, {}, shared, { mediaId: 'animated' });
  assert.deepEqual([...media.frame(state, 0, 0.05, {}, shared)], [255, 0, 0]);
  assert.deepEqual([...media.frame(state, 0.11, 0.06, {}, shared)], [0, 255, 0]);
  assert.deepEqual([...media.frame(state, 0.32, 0.21, {}, shared)], [255, 0, 0]);
});

test('media effect reloads a newly uploaded clip', () => {
  const shared = {
    mediaLibrary: { entries: [
      { id: 'replace-me', version: 3, frames: [encoded([10, 20, 30])], durations: [1000] },
    ] },
  };
  const state = media.init(1, 1, {}, shared, { mediaId: 'replace-me' });
  shared.mediaLibrary.entries[0] = { id: 'replace-me', version: 4, frames: [encoded([40, 50, 60])], durations: [1000] };
  assert.deepEqual([...media.frame(state, 0, 0, {}, shared)], [40, 50, 60]);
});

test('media effect selects one exact entry from the library', () => {
  const shared = { mediaLibrary: { entries: [
    { id: 'red', version: 5, frames: [encoded([255, 0, 0])], durations: [1000] },
    { id: 'blue', version: 6, frames: [encoded([0, 0, 255])], durations: [1000] },
  ] } };
  const state = media.init(1, 1, {}, shared, { mediaId: 'blue' });
  assert.deepEqual([...media.frame(state, 0, 0, {}, shared)], [0, 0, 255]);
});
