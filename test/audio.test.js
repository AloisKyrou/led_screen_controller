'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createAnalyzer, createAudioInput, defaults, validateSettings, SIZE, RATE } = require('../lib/audio-input');
const effect = require('../effects/audio_spectrum');
const scope = require('../effects/audio_scope');

function tone(frequency, amplitude = 0.3, offset = 0) {
  return Float64Array.from({ length: SIZE }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * (i + offset) / RATE));
}

test('spectrum separates low and high tones, gates silence, and detects clipping', () => {
  const analyze = createAnalyzer();
  const bass = analyze(tone(80), defaults, 0);
  const high = analyze(tone(3000), defaults, 100);
  const strongest = values => values.indexOf(Math.max(...values));
  assert.ok(strongest(bass.bands) < strongest(high.bands));
  assert.equal(bass.waveform.length, 60);
  assert.ok(bass.waveform.some(value => value !== 0));
  assert.ok(bass.waveform.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
  const silent = analyze(new Float64Array(SIZE), defaults, 200);
  assert.ok(silent.bands.every(value => value === 0));
  assert.equal(silent.beat, false);
  assert.ok(silent.waveform.every(value => value === 0));
  assert.equal(analyze(tone(1000, 1), defaults, 300).clipping, true);
});

test('kick detector accepts bass onsets, suppresses steady tones and enforces refractory period', () => {
  const analyze = createAnalyzer();
  const settings = { ...defaults, kickIntervalMs: 250 };
  for (let i = 0; i < 10; i++) analyze(new Float64Array(SIZE), settings, i * 64);
  assert.equal(analyze(tone(80), settings, 640).beat, true);
  assert.equal(analyze(tone(80), settings, 704).beat, false);
  analyze(new Float64Array(SIZE), settings, 768);
  assert.equal(analyze(tone(80), settings, 832).beat, false);
  for (let i = 0; i < 10; i++) analyze(new Float64Array(SIZE), settings, 900 + i * 64);
  assert.equal(analyze(tone(80), settings, 1600).beat, true);
});

test('repeated bass kicks survive a loud treble track and thresholds below one reject steady bass', () => {
  for (const period of [0.5, 0.25, 0.2]) {
    const analyze = createAnalyzer();
    let beats = 0;
    for (let offset = 0; offset < RATE * 5; offset += 512) {
      const samples = Float64Array.from({ length: SIZE }, (_, i) => {
        const t = (offset + i) / RATE;
        const envelope = t < 1 ? 0 : Math.exp(-((t - 1) % period) * 45);
        return 0.35 * envelope * Math.sin(2 * Math.PI * 70 * t) + 0.4 * Math.sin(2 * Math.PI * 2000 * t);
      });
      if (analyze(samples, defaults, offset / RATE * 1000).beat) beats++;
    }
    assert.ok(beats >= Math.floor(4 / period) - 1, `${period}s: only ${beats} kicks`);
    assert.ok(beats <= Math.ceil(4 / period) + 1, `${period}s: duplicate kicks (${beats})`);
  }
  const analyze = createAnalyzer();
  let beats = 0;
  for (let i = 0; i < 150; i++) if (analyze(tone(80, 0.3, i * 512), { ...defaults, sensitivity: 0.5 }, i * 32).beat) beats++;
  assert.ok(beats <= 1, `steady bass triggered ${beats} times`);
  assert.equal(validateSettings({ sensitivity: 0.5 }).sensitivity, 0.5);
});

test('adaptive threshold follows changing bass levels and rejects steady sound', () => {
  const settings = { ...defaults, kickAdaptive: true };
  const analyze = createAnalyzer();
  const counts = [0, 0];
  for (let offset = 0; offset < RATE * 10; offset += 512) {
    const samples = Float64Array.from({ length: SIZE }, (_, i) => {
      const t = (offset + i) / RATE;
      const amplitude = t < 5 ? 0.12 : 0.5;
      return amplitude * Math.exp(-(t % 0.5) * 40) * Math.sin(2 * Math.PI * 70 * t) + 0.2 * Math.sin(2 * Math.PI * 2000 * t);
    });
    if (analyze(samples, settings, offset / RATE * 1000).beat) counts[offset < RATE * 5 ? 0 : 1]++;
  }
  for (const count of counts) assert.ok(count >= 8 && count <= 11, `adaptive pulses: ${counts}`);
  const steady = createAnalyzer(); let beats = 0;
  for (let i = 0; i < 150; i++) if (steady(tone(80, 0.3, i * 512), settings, i * 32).beat) beats++;
  assert.ok(beats <= 1);
});

test('capture handles fragmented PCM, disconnects, shutdown and invalid settings', () => {
  let child;
  const input = createAudioInput({ ...defaults, enabled: true }, () => {}, { spawn(command, args, options) {
    assert.equal(command, 'arecord'); assert.equal(options.shell, undefined);
    assert.ok(args.includes('S16_LE'));
    child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { child.killed = true; };
    return child;
  } });
  try {
    const bytes = Buffer.alloc(SIZE * 2);
    tone(80).forEach((value, i) => bytes.writeInt16LE(Math.round(value * 32767), i * 2));
    child.stdout.emit('data', bytes.subarray(0, 13));
    assert.equal(input.snapshot().status, 'starting');
    child.stdout.emit('data', bytes.subarray(13));
    assert.equal(input.snapshot().status, 'listening');
    assert.ok(input.snapshot().rms > 0);
    // A further half-window already updates the analysis (32 ms hop).
    child.stdout.emit('data', Buffer.alloc(SIZE));
    assert.ok(input.snapshot().rms < 0.42);
    child.emit('close');
    assert.equal(input.snapshot().status, 'error');
    assert.ok(input.snapshot().bands.every(value => value === 0));
    assert.equal(child.killed, true);
    assert.throws(() => validateSettings({ gain: NaN }));
    assert.throws(() => validateSettings({ device: 'default; touch /tmp/a' }));
  } finally { input.stop(); }
  assert.equal(input.snapshot().status, 'disabled');
});

test('oscilloscope draws connected green traces, then fades out on disconnect', () => {
  const state = scope.init(60, 15);
  let audio = { status: 'listening', rms: 0.5, waveform: Array.from({ length: 60 }, (_, x) => Math.sin(x / 4)) };
  const shared = { audio: { snapshot: () => audio } };
  const frame = scope.frame(state, 0, 0.033, {}, shared);
  assert.equal(frame.length, 2700);
  assert.ok(frame.some(value => value > 0));
  for (let i = 0; i < frame.length; i += 3) assert.ok(frame[i + 1] >= frame[i]);
  audio = { status: 'error', rms: 0, waveform: [] };
  assert.ok(scope.frame(state, 2, 2, {}, shared).every(value => value === 0));
});

test('scope suppresses a subpixel centre line and visual sensitivity expands small movements', () => {
  let wave = Array(60).fill(0.01);
  const shared = { audio: { snapshot: () => ({ status: 'listening', rms: 0.1, waveform: wave, detection: { audible: true } }) } };
  assert.ok(scope.frame(scope.init(60, 15), 0, 0.03, { reactivity: 2 }, shared).every(v => v === 0));
  wave = Array.from({ length: 60 }, (_, i) => Math.sin(i / 5) * 0.06);
  const quiet = scope.frame(scope.init(60, 15), 0, 0.03, { reactivity: 1 }, shared);
  const boosted = scope.frame(scope.init(60, 15), 0, 0.03, { reactivity: 4 }, shared);
  const occupiedRows = pixels => Array.from({ length: 15 }, (_, y) => pixels.slice(y * 180, (y + 1) * 180).some(v => v > 0)).filter(Boolean).length;
  assert.ok(quiet.some(v => v > 0), 'ordinary low-level audio is visible at x1');
  assert.ok(occupiedRows(boosted) > occupiedRows(quiet));
  assert.ok(boosted.some(v => v > 0));
  // Zero crossings stay dimmer than the moving parts of the trace.
  assert.ok(boosted.slice(7 * 60 * 3, 8 * 60 * 3).every(v => v <= 77));
  const normal = scope.frame(scope.init(60, 15), 0, 0.03, {}, shared);
  assert.ok(occupiedRows(normal) >= 5, 'default gain spans several rows');
  wave = Array.from({ length: 60 }, (_, i) => Math.sin(i / 5) * 0.001);
  assert.ok(scope.frame(scope.init(60, 15), 0, 0.03, {}, shared).every(v => v === 0));
});

test('retro visual produces bounded RGB bars and decays to black when input stops', () => {
  const state = effect.init(60, 15);
  let bands = Array(15).fill(1);
  const shared = { audio: { snapshot: () => ({ bands }) } };
  const frame = effect.frame(state, 0, 0.03, { ball: false }, shared);
  assert.equal(frame.length, 2700);
  assert.deepEqual([...frame.slice(0, 3)], [170, 190, 160]);
  assert.deepEqual([...frame.slice(9, 12)], [0, 0, 0]);
  bands = Array(15).fill(0);
  assert.ok(effect.frame(state, 4, 4, { ball: false }, shared).every(value => value === 0));
});
