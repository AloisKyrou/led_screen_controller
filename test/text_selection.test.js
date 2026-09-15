'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const scrollText = require('../effects/scroll_text');
const staticText = require('../effects/static_text');

test('scroll text uses the explicitly selected entry without consuming the public queue', () => {
  const queued = { text: 'PUBLIC', color: '#ffffff', rainbow: false };
  const selected = { text: 'CHOISI', color: '#123456', rainbow: true };
  const shared = {
    scrollPool: [{ text: 'AUTRE', color: '#ffffff', rainbow: false }],
    publicQueue: [queued],
  };

  const state = scrollText.init(60, 15, {}, shared, { entry: selected });
  assert.equal(state.lastText, 'CHOISI');
  assert.equal(state.color, '#123456');
  assert.equal(state.rainbow, true);
  assert.deepEqual(shared.publicQueue, [queued]);
  shared.scrollPool[0] = { text: 'MODIFIÉ', color: '#000000', rainbow: false };
  scrollText.frame(state, 0, 0, {}, shared);
  assert.equal(state.lastText, 'CHOISI');
  assert.equal(state.color, '#123456');
});

test('static text uses the explicitly selected entry', () => {
  const selected = { text: 'CE MESSAGE', color: '#abcdef', rainbow: false };
  const shared = {
    staticPool: [{ text: 'AUTRE', color: '#ffffff', rainbow: true }],
  };

  const state = staticText.init(60, 15, {}, shared, { entry: selected });
  assert.equal(state.lastText, 'CE MESSAGE');
  assert.equal(state.color, '#abcdef');
  assert.equal(state.rainbow, false);
  shared.staticPool[0] = { text: 'MODIFIÉ', color: '#000000', rainbow: true };
  staticText.frame(state, 0, 0, {}, shared);
  assert.equal(state.lastText, 'CE MESSAGE');
  assert.equal(state.color, '#abcdef');
});
