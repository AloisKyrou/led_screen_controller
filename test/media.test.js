'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const media = require('../effects/media');

function encoded(values) {
  return Buffer.from(values).toString('base64');
}

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
