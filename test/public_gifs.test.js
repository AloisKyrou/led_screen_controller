'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Gif = require('../public/panel-gif');
const { validateUpload, createPublicGifFiles } = require('../lib/public-gifs');
const { createPublicMessageStore } = require('../lib/public-message-store');
const effect = require('../effects/public_messages');
const fixtures = require('./fixtures/public-gifs.json');
const fixture = name => Buffer.from(fixtures[name].base64, 'base64');
const pixel = (frame, x, y) => [...frame.subarray((y * 60 + x) * 3, (y * 60 + x) * 3 + 3)];
const black = () => new Uint8Array(2700);

test('decodes an external compressed GIF, including LZW code-width transitions', () => {
  const clip = Gif.decode(fixture('noise'));
  assert.equal(clip.totalDurationMs, 120);
  assert.equal(crypto.createHash('sha256').update(clip.frames[0]).digest('hex'), fixtures.noise.rgbHash);
});

test('external partial frames preserve transparency and disposal 2 and 3 on black', () => {
  const { frames, durations } = Gif.decode(fixture('disposal'));
  assert.deepEqual(durations, [100, 200, 300, 400]);
  assert.deepEqual(pixel(frames[1], 2, 2), [255, 0, 0]); // Transparent patch keeps preceding red.
  assert.deepEqual(pixel(frames[1], 3, 2), [0, 255, 0]);
  assert.deepEqual(pixel(frames[2], 3, 2), [0, 0, 0]); // Disposal 2 cleared only the patch.
  assert.deepEqual(pixel(frames[2], 20, 10), [0, 0, 255]);
  assert.deepEqual(pixel(frames[3], 20, 10), [255, 0, 0]); // Disposal 3 restored preceding red.
  assert.deepEqual(pixel(frames[3], 40, 5), [0, 255, 0]);
  assert.deepEqual(pixel(frames[3], 0, 0), [255, 0, 0]);
});

test('decodes all four GIF interlace passes', () => {
  const { frames } = Gif.decode(fixture('interlaced'));
  for (let y = 0; y < 15; y++) {
    assert.deepEqual(pixel(frames[0], 0, y), [y, y, y]);
    assert.deepEqual(pixel(frames[0], 59, y), [y, y, y]);
  }
});

test('editor export preserves colors and timings and stays within limits at 120 frames', () => {
  const frames = Gif.decode(fixture('noise')).frames;
  const data = Gif.encode(Array.from({ length: 120 }, () => frames[0]), Array(120).fill(120));
  assert.ok(data.length < Gif.limits.maxBytes);
  const result = Gif.decode(data);
  assert.equal(result.frames.length, 120);
  assert.equal(result.totalDurationMs, 14400);
  assert.deepEqual(result.frames[119], frames[0]);
});

test('rejects forged headers, dimensions, out-of-bounds patches and truncated blocks', () => {
  assert.throws(() => Gif.decode(Buffer.from('<svg></svg>')), /GIF/);
  const dimensions = fixture('noise'); dimensions[6] = 61;
  assert.throws(() => Gif.decode(dimensions), /61 × 15/);
  const patch = fixture('interlaced'); patch[62] = 1;
  assert.throws(() => Gif.decode(patch), /dépasse/);
  const valid = fixture('disposal');
  for (const length of [0, 6, 12, 20, valid.length - 2, valid.length - 1]) {
    assert.throws(() => Gif.decode(valid.subarray(0, length)), /GIF/);
  }
  assert.throws(() => Gif.decode(Buffer.concat([valid, Buffer.from('hidden data')])), /GIF/);
  assert.throws(() => Gif.decode(new Uint8Array(Gif.limits.maxBytes + 1)), /512 Ko/);
});

test('rejects corrupt compressed data instead of silently filling missing pixels', () => {
  const bytes = fixture('interlaced');
  const corrupted = Buffer.from(bytes);
  // This fixture has no GCE: descriptor ends at 71, LZW minimum at 71, block at 72.
  corrupted[71] = 12;
  assert.throws(() => Gif.decode(corrupted), /GIF/);
  const missingPixels = Buffer.from(bytes); missingPixels.fill(0, 73, missingPixels.length - 2);
  assert.throws(() => Gif.decode(missingPixels), /GIF/);
});

test('enforces actual duration and frame count on imported GIFs', () => {
  const bytes = fixture('disposal');
  const gce = bytes.indexOf(Buffer.from([0x21, 0xf9, 4]));
  bytes[gce + 4] = 0xff; bytes[gce + 5] = 0xff;
  assert.throws(() => Gif.decode(bytes), /15 secondes/);
  const data = Gif.encode(Array.from({ length: 120 }, black), Array(120).fill(20));
  // Editor format: 13-byte header + 19-byte loop extension, then full frames.
  const firstFrameLength = (data.length - 33) / 120;
  const extra = Buffer.concat([data.subarray(0, data.length - 1), data.subarray(32, 32 + firstFrameLength), Buffer.from([0x3b])]);
  assert.throws(() => Gif.decode(extra), /120 images/);
  assert.throws(() => Gif.encode([black(), black()], [10000, 10000]), /15 secondes/);
});

test('upload validates canonical base64 and ignores client-provided metadata', () => {
  const data = fixture('disposal').toString('base64');
  const { metadata } = validateUpload(data);
  assert.equal(metadata.frameCount, 4);
  assert.equal(metadata.durationMs, 1000);
  assert.throws(() => validateUpload(data + '\n'), /invalide/);
  assert.throws(() => validateUpload('!!!!'), /invalide/);
  assert.throws(() => validateUpload('A'.repeat(800000)), /512 Ko/);
});

test('GIF always requires approval, survives reload, and shares text queue/IP limits', () => {
  const gif = validateUpload(fixture('disposal').toString('base64')).metadata;
  const store = createPublicMessageStore({ mode: 'automatic' });
  const animation = store.submit({ text: 'Animation', gif, ipHash: 'ip', clientHash: 'client' });
  const text = store.submit({ text: 'Bonjour', ipHash: 'ip' });
  assert.equal(animation.status, 'pending');
  assert.equal(store.countActiveForIp('ip'), 2);
  assert.equal(store.hasApproved(), true);
  store.setMode('moderated'); store.setMode('automatic');
  assert.equal(store.getPublicStatus(animation.id, animation.receipt).status, 'pending');
  assert.equal(store.getPublicStatus(animation.id, 'not-the-receipt'), null);
  assert.equal(store.getPublicStatus(animation.id, animation.receipt).kind, 'gif');
  assert.equal(store.isRecentGifDuplicate(gif.hash, 'client', 5000), true);
  assert.equal(store.isRecentDuplicate('Animation', 'client', 5000), false);
  const restored = createPublicMessageStore(store.snapshot());
  assert.equal(restored.adminView().pending[0].gif.frameCount, 4);
  assert.equal('receipt' in restored.adminView().pending[0], false);
  restored.approve(animation.id);
  assert.equal(restored.takeNext().id, text.id);
  restored.complete(text.id);
  assert.equal(restored.takeNext().id, animation.id);
  restored.requeue(animation.id);
  assert.equal(createPublicMessageStore(restored.snapshot()).takeNext().id, animation.id);
});

test('public GIF playback finishes a full loop, preserves frames, and requeues interruptions', () => {
  const animation = Gif.decode(fixture('disposal')), calls = [];
  const shared = { publicMessages: {
    takeNext: () => ({ id: 'gif-id', kind: 'gif', animation }),
    complete: id => calls.push(['complete', id]), requeue: id => calls.push(['requeue', id]),
  } };
  const state = effect.init(60, 15, {}, shared);
  const output = effect.frame(state, 0, 0, {}, shared);
  output.fill(0);
  assert.deepEqual(pixel(animation.frames[0], 0, 0), [255, 0, 0]);
  assert.equal(state.done, false);
  effect.frame(state, .15, .15, {}, shared);
  assert.deepEqual(pixel(effect.frame(state, .15, 0, {}, shared), 3, 2), [0, 255, 0]);
  effect.stop(state, shared);
  assert.deepEqual(calls, [['requeue', 'gif-id']]);
  const finished = effect.init(60, 15, {}, shared);
  effect.frame(finished, 1.1, 1.1, {}, shared);
  assert.equal(finished.done, true);
  effect.stop(finished, shared); effect.stop(finished, shared);
  assert.deepEqual(calls[1], ['complete', 'gif-id']);
  assert.equal(calls.length, 2);
});

test('GIF files are stored separately and pruned only when no retained item references them', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nools-gif-files-'));
  try {
    const files = createPublicGifFiles(directory), upload = validateUpload(fixture('noise').toString('base64'));
    files.save(upload); files.save(upload);
    assert.deepEqual(files.read(upload.metadata), upload.bytes);
    files.prune([{ gif: upload.metadata }]);
    assert.equal(fs.readdirSync(directory).length, 1);
    files.prune([]);
    assert.equal(fs.readdirSync(directory).length, 0);
    assert.throws(() => files.read({ ...upload.metadata, hash: '../messages' }), /introuvable/);
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + 'nools-gif-files-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
