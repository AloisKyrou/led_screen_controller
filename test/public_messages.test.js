'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPublicMessageStore } = require('../lib/public-message-store');
const publicMessagesEffect = require('../effects/public_messages');

test('a played contribution can be dismissed from the display queue', () => {
  const store = createPublicMessageStore({});
  const item = store.submit({ text: 'Terminé' });
  store.takeNext();
  assert.equal(store.reject(item.id), null);
  store.complete(item.id);
  assert.equal(store.reject(item.id).status, 'rejected');
  assert.equal(store.replay(item.id), null);
  const restored = createPublicMessageStore(store.snapshot());
  assert.equal(restored.adminView().history[0].status, 'rejected');
});

test('replaying retains the receipt, joins the end of the queue and respects capacity', () => {
  let time = 1000;
  const store = createPublicMessageStore({}, { now: () => time++, maxActive: 1 });
  const first = store.submit({ text: 'Encore' });
  store.takeNext();
  store.complete(first.id);
  const next = store.submit({ text: 'Suivant' });
  assert.equal(store.replay(first.id), null);
  store.takeNext();
  store.complete(next.id);
  assert.ok(store.replay(first.id));
  assert.equal(store.replay(first.id), null);
  assert.equal(store.getPublicStatus(first.id, first.receipt).status, 'approved');
  const restored = createPublicMessageStore(store.snapshot());
  assert.equal(restored.takeNext().id, first.id);
});

test('automatic messages enter the FIFO display queue and expose their position', () => {
  let time = 1000;
  const store = createPublicMessageStore({}, { now: () => time, maxActive: 10 });
  const first = store.submit({ text: 'PREMIER', color: '#ABCDEF', clientHash: 'a' });
  time += 1;
  const second = store.submit({ text: 'SECOND', rainbow: true, clientHash: 'b' });

  assert.equal(first.status, 'approved');
  assert.equal(store.getPublicStatus(first.id, first.receipt).position, 1);
  assert.equal(store.getPublicStatus(second.id, second.receipt).position, 2);

  const playing = store.takeNext();
  assert.equal(playing.id, first.id);
  assert.equal(store.getPublicStatus(first.id, first.receipt).status, 'playing');
  assert.equal(store.getPublicStatus(second.id, second.receipt).position, 1);

  store.complete(first.id);
  assert.equal(store.getPublicStatus(first.id, first.receipt).status, 'displayed');
  assert.equal(store.getPublicStatus(first.id, 'wrong-receipt'), null);
});

test('moderated messages wait for approval and switching to automatic approves pending items', () => {
  let time = 2000;
  const store = createPublicMessageStore({ mode: 'moderated', items: [] }, { now: () => time });
  const first = store.submit({ text: 'A VALIDER', clientHash: 'a' });
  time += 1;
  const second = store.submit({ text: 'A REFUSER', clientHash: 'b' });

  assert.equal(first.status, 'pending');
  assert.equal(store.getPublicStatus(second.id, second.receipt).pendingPosition, 2);
  assert.equal(store.approve(first.id).status, 'approved');
  assert.equal(store.reject(second.id).status, 'rejected');

  time += 1;
  const third = store.submit({ text: 'EN ATTENTE', clientHash: 'c' });
  const result = store.setMode('automatic');
  assert.equal(result.approved, 1);
  assert.equal(store.getPublicStatus(third.id, third.receipt).status, 'approved');
});

test('a message interrupted while playing is returned to the front of the queue', () => {
  let time = 3000;
  const store = createPublicMessageStore({}, { now: () => time });
  const first = store.submit({ text: 'REJOUER', clientHash: 'a' });
  time += 1;
  const second = store.submit({ text: 'ENSUITE', clientHash: 'b' });

  store.takeNext();
  store.requeue(first.id);
  assert.equal(store.takeNext().id, first.id);
  assert.equal(store.getPublicStatus(second.id, second.receipt).position, 1);
});

test('the public message effect completes one item and requeues an interrupted item', () => {
  const events = [];
  const shared = {
    scrollPool: [{ text: 'NORMAL', color: '#ffffff', rainbow: false }],
    publicMessages: {
      takeNext: () => ({ id: 'message-1', text: 'PUBLIC', color: '#123456', rainbow: false }),
      complete: id => events.push(['complete', id]),
      requeue: id => events.push(['requeue', id]),
    },
  };

  const interrupted = publicMessagesEffect.init(60, 15, { speed: 30 }, shared);
  publicMessagesEffect.stop(interrupted, shared);
  assert.deepEqual(events, [['requeue', 'message-1']]);

  events.length = 0;
  const completed = publicMessagesEffect.init(60, 15, { speed: 30 }, shared);
  publicMessagesEffect.frame(completed, 10, 10, { speed: 30 }, shared);
  assert.equal(completed.done, true);
  assert.deepEqual(events, []);
  publicMessagesEffect.stop(completed, shared);
  assert.deepEqual(events, [['complete', 'message-1']]);
});

test('legacy publicQueue entries migrate as approved messages', () => {
  const store = createPublicMessageStore({}, {
    now: () => 4000,
    legacyQueue: [{ text: 'ANCIEN', color: '#ffffff', rainbow: false }],
  });
  assert.equal(store.adminView().queue.length, 1);
  assert.equal(store.adminView().queue[0].text, 'ANCIEN');
});

test('per-IP message limit is validated, persisted and counts active messages', () => {
  const store = createPublicMessageStore({}, {
    now: () => 5000,
    defaultMaxMessagesPerIp: 3,
  });
  assert.equal(store.getSettings().maxMessagesPerIp, 3);
  assert.equal(store.setSettings({ maxMessagesPerIp: 8 }).maxMessagesPerIp, 8);
  assert.equal(store.setSettings({ maxMessagesPerIp: 0 }), null);

  store.submit({ text: 'UN', clientHash: 'a', ipHash: 'same-ip' });
  store.submit({ text: 'DEUX', clientHash: 'b', ipHash: 'same-ip' });
  store.submit({ text: 'AUTRE', clientHash: 'c', ipHash: 'other-ip' });
  assert.equal(store.countActiveForIp('same-ip'), 2);
  assert.equal(store.countActiveForIp('other-ip'), 1);

  const restored = createPublicMessageStore(store.snapshot(), {
    defaultMaxMessagesPerIp: 3,
  });
  assert.equal(restored.getSettings().maxMessagesPerIp, 8);
});
