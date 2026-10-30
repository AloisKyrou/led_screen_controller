'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stepBall } = require('../lib/spectrum-ball');
const effect = require('../effects/audio_spectrum');

test('ball falls under gravity, bounces and travels between bars within panel bounds', () => {
  const state = { ball: { x: 12, y: 13, vx: 9, vy: 0 } }, levels = Array(15).fill(0.3);
  stepBall(state, levels, levels, 1 / 30, 60, 15);
  assert.ok(state.ball.vy < 0);
  let bounced = false, furthest = 0;
  for (let i = 0; i < 300; i++) {
    stepBall(state, levels, levels, 1 / 30, 60, 15, () => 0.5);
    bounced ||= state.ball.vy > 0;
    furthest = Math.max(furthest, state.ball.x);
    assert.ok(state.ball.x >= 0 && state.ball.x <= 59);
    assert.ok(state.ball.y >= 0 && state.ball.y <= 14);
  }
  assert.ok(bounced); assert.ok(furthest > 24);
});

test('a rising supporting bar launches the ball harder than a distant bar', () => {
  const previous = Array(15).fill(0.3);
  const launch = band => {
    const levels = [...previous]; levels[band] = 0.6;
    const state = { ball: { x: 10, y: 4.3, vx: 0, vy: -1 } };
    stepBall(state, previous, levels, 1 / 30, 60, 15, () => 0.5);
    return state.ball.vy;
  };
  assert.ok(launch(2) > launch(12));
});

test('ball makes occasional independent decisions and rebounds from the ceiling', () => {
  const levels = Array(15).fill(0.1);
  const state = { ball: { x: 30, y: 8, vx: 8, vy: 0, decisionIn: 0 } };
  stepBall(state, levels, levels, 1 / 30, 60, 15, () => 0.1);
  assert.ok(state.ball.vx < 0, 'can change direction while airborne');
  const velocity = state.ball.vx;
  stepBall(state, levels, levels, 1 / 30, 60, 15, () => { throw new Error('decision jitter'); });
  assert.equal(state.ball.vx, velocity);
  state.ball.y = 12.9; state.ball.vy = 30;
  stepBall(state, levels, levels, 1 / 30, 60, 15, () => 0.5);
  assert.ok(state.ball.vy < -15, 'ceiling returns a lively downward bounce');
  assert.ok(state.ball.y <= 13);
});

test('occasional big leaps vary the height on the same supporting bar', () => {
  const levels = Array(15).fill(0.3);
  const launch = random => {
    const state = { ball: { x: 10, y: 4.3, vx: 8, vy: -1 } };
    stepBall(state, levels, levels, 1 / 30, 60, 15, random);
    return state.ball.vy;
  };
  assert.ok(launch(() => 0.1) > launch(() => 0.5) * 1.4);
});

test('silence keeps a drifting four-pixel colour-changing square, resuming without respawn', () => {
  const state = effect.init(60, 15);
  let bands = Array(15).fill(0.4);
  const shared = { audio: { snapshot: () => ({ bands }) } };
  effect.frame(state, 0, 0.03, {}, shared);
  assert.ok(state.ball);
  const ball = state.ball;
  bands.fill(0);
  let pixels;
  for (let i = 0; i < 150; i++) pixels = effect.frame(state, i / 30, 1 / 30, {}, shared);
  assert.equal(state.ball, ball);
  assert.equal(ball.y, 0);
  assert.ok(Math.abs(Math.abs(ball.vx) - 2) < 0.01);
  state.ball.x = 10; state.partner.ball.x = 45; state.celebrateUntil = 0;
  pixels = effect.frame(state, 5, 0, {}, shared);
  const lit = [];
  for (let i = 0; i < pixels.length; i += 3) if (pixels[i] || pixels[i + 1] || pixels[i + 2]) lit.push(i / 3);
  assert.equal(lit.length, 8);
  assert.equal(lit[1] - lit[0], 1); assert.equal(lit[4] - lit[0], 60);
  assert.notDeepEqual(pixels.slice(lit[0] * 3, lit[0] * 3 + 3), pixels.slice(lit[2] * 3, lit[2] * 3 + 3));
  assert.ok(lit.every(index => index >= 13 * 60));
  const beforeX = ball.x;
  const later = effect.frame(state, 6, 1 / 30, {}, shared);
  assert.notDeepEqual(later, pixels);
  bands.fill(0.05);
  effect.frame(state, 6.03, 1 / 30, {}, shared);
  assert.equal(state.ball, ball);
  assert.ok(Math.abs(ball.x - beforeX) < 2); assert.ok(ball.y < 3);
  bands.fill(0);
  assert.ok(effect.frame(state, 8, 2, { ball: false }, shared).every(v => v === 0));
});

test('touching balls show ULTRA NOOL once, fade out, and keep moving underneath', () => {
  const state = effect.init(60, 15);
  const shared = { audio: { snapshot: () => ({ bands: Array(15).fill(0) }) } };
  state.ball = { x: 28, y: 0, vx: 2, vy: 0 };
  state.partner = { ball: { x: 30, y: 0, vx: -2, vy: 0 } };
  const pixels = effect.frame(state, 0, 0, {}, shared);
  assert.equal(state.celebrateUntil, 1.2);
  const { GLYPHS } = require('../effects/font');
  for (let c = 0; c < 10; c++) for (let x = 0; x < 5; x++) for (let y = 0; y < 7; y++) {
    const offset = (y * 60 + c * 6 + x) * 3;
    assert.equal(pixels.slice(offset, offset + 3).some(v => v > 0), Boolean(GLYPHS['ULTRA NOOL'[c]][x] & (1 << y)));
  }
  effect.frame(state, 0.1, 0.03, {}, shared);
  assert.ok(state.ball.x > 28); assert.ok(state.partner.ball.x < 30);
  assert.equal(state.celebrateUntil, 1.2, 'sustained contact does not extend the banner');
  const faded = effect.frame(state, 1.3, 0, {}, shared);
  assert.ok(faded.slice(0, 13 * 60 * 3).every(v => v === 0));
  effect.frame(state, 1.4, 0, { ball: false }, shared);
  assert.equal(state.partner, null); assert.equal(state.celebrateUntil, 0);
});
