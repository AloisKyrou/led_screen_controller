'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createKickEnvelope } = require('../lib/kick-envelope');
test('instant boost fades to baseline in 300 ms without changing baseline', () => {
  const env = createKickEnvelope();
  env.trigger(0, 0, 0.3);
  const brightness = t => 0.7 + 0.3 * env.value(t);
  assert.equal(brightness(0), 1);
  assert.equal(brightness(0.15), 0.85);
  assert.equal(brightness(0.3), 0.7);
  assert.equal(brightness(1), 0.7);
});
test('flash attack, hold, release and retrigger are continuous', () => {
  const env = createKickEnvelope();
  env.trigger(0, 0.2, 0.3, 0.1);
  assert.equal(env.value(0), 0);
  assert.equal(env.value(0.1), 0.5);
  assert.equal(env.value(0.25), 1);
  assert.ok(Math.abs(env.value(0.45) - 0.5) < 1e-9);
  const before = env.value(0.45);
  env.trigger(0.45, 0.2, 0.3, 0.1);
  assert.equal(env.value(0.45), before);
  assert.ok(env.value(0.55) > before);
  env.clear(); assert.equal(env.value(0.55), 0);
  env.trigger(1, 0, 0, 0.1);
  assert.equal(env.value(1), 1);
  assert.equal(env.value(1.2), 0);
});
