'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAutoMask, buildAutoMasks } = require('../effects/font');
const staticText = require('../effects/static_text');

const W = 60;
const H = 15;

function assertSafeMask(mask) {
  assert.equal(mask.length, W * H);
  assert.ok(mask.some(Boolean), 'mask should contain visible pixels');
  for (let y = 0; y < H; y++) {
    assert.equal(mask[y * W], 0, `left edge must stay clear on row ${y}`);
    assert.equal(mask[y * W + W - 1], 0, `right edge must stay clear on row ${y}`);
  }
}

test('short static text uses one page with clear panel edges', () => {
  const masks = buildAutoMasks('NOOLS', W, H);
  assert.equal(masks.length, 1);
  assertSafeMask(masks[0]);
});

test('two-line text is compacted instead of clipping edge letters', () => {
  const masks = buildAutoMasks('Hannah big couscous', W, H);
  assert.equal(masks.length, 1);
  assertSafeMask(masks[0]);
});

test('long static text is paginated and every page stays in bounds', () => {
  const masks = buildAutoMasks('UN MESSAGE BEAUCOUP PLUS LONG QUI DOIT RESTER ENTIEREMENT VISIBLE', W, H);
  assert.ok(masks.length > 1);
  masks.forEach(assertSafeMask);
  assert.deepEqual(buildAutoMask('UN MESSAGE BEAUCOUP PLUS LONG QUI DOIT RESTER ENTIEREMENT VISIBLE', W, H), masks[0]);
});

test('static text effect switches between generated pages', () => {
  const shared = {
    staticPool: [{ text: 'PREMIERE PAGE PUIS UNE DEUXIEME PAGE', color: '#ff8800', rainbow: false }],
  };
  const state = staticText.init(W, H, {}, shared);
  assert.ok(state.masks.length > 1);
  const first = staticText.frame(state, 0, 0, {}, shared);
  assert.equal(state.done, false);
  const second = staticText.frame(state, 2.6, 0, {}, shared);
  assert.notDeepEqual(first, second);
  staticText.frame(state, state.masks.length * 2.5 + 0.1, 0, {}, shared);
  assert.equal(state.done, true, 'scheduler may advance only after every page was visible');
});
