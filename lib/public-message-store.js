'use strict';

const crypto = require('crypto');
const { validMetadata } = require('./public-gifs');

const MODES = new Set(['automatic', 'moderated']);
const STATUSES = new Set(['pending', 'approved', 'playing', 'displayed', 'rejected']);
const ACTIVE_STATUSES = new Set(['pending', 'approved', 'playing']);

function validColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value.toLowerCase() : '#ffffff';
}

function timestamp(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function integerInRange(value, fallback, minimum = 1, maximum = 100) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum
    ? number
    : fallback;
}

function timingSafeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function publicItem(item) {
  return {
    id: item.id,
    kind: item.kind || 'text',
    ...(item.gif ? { gif: { ...item.gif } } : {}),
    text: item.text,
    color: item.color,
    rainbow: item.rainbow,
    status: item.status,
    createdAt: item.createdAt,
    approvedAt: item.approvedAt,
    playingAt: item.playingAt,
    displayedAt: item.displayedAt,
    rejectedAt: item.rejectedAt,
  };
}

function normalizeItem(value, now) {
  if (!value || typeof value !== 'object' || typeof value.text !== 'string') return null;
  const text = value.text.trim();
  if (!text) return null;
  const kind = value.kind === 'gif' ? 'gif' : 'text';
  if (kind === 'gif' && !validMetadata(value.gif)) return null;
  let status = STATUSES.has(value.status) ? value.status : kind === 'gif' ? 'pending' : 'approved';
  if (status === 'playing') status = 'approved';
  const createdAt = timestamp(value.createdAt, now);
  return {
    id: typeof value.id === 'string' && value.id ? value.id : crypto.randomUUID(),
    receipt: typeof value.receipt === 'string' && value.receipt
      ? value.receipt
      : crypto.randomBytes(18).toString('base64url'),
    clientHash: typeof value.clientHash === 'string' ? value.clientHash : '',
    ipHash: typeof value.ipHash === 'string' ? value.ipHash : '',
    text: text.slice(0, 80),
    kind,
    ...(kind === 'gif' ? { gif: { ...value.gif } } : {}),
    color: validColor(value.color),
    rainbow: !!value.rainbow,
    status,
    createdAt,
    approvedAt: status === 'approved'
      ? timestamp(value.approvedAt, createdAt)
      : timestamp(value.approvedAt),
    playingAt: null,
    displayedAt: timestamp(value.displayedAt),
    rejectedAt: timestamp(value.rejectedAt),
  };
}

function createPublicMessageStore(rawValue, options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const maxActive = Number(options.maxActive) || 50;
  const maxHistory = Number(options.maxHistory) || 100;
  const source = rawValue && typeof rawValue === 'object' ? rawValue : {};
  const mode = MODES.has(source.mode) ? source.mode : 'automatic';
  const defaultMaxMessagesPerIp = integerInRange(options.defaultMaxMessagesPerIp, 3);
  const settings = {
    maxMessagesPerIp: integerInRange(
      source.settings && source.settings.maxMessagesPerIp,
      defaultMaxMessagesPerIp
    ),
  };
  const items = (Array.isArray(source.items) ? source.items : [])
    .map(value => normalizeItem(value, now()))
    .filter(Boolean);

  if (!items.length && Array.isArray(options.legacyQueue)) {
    options.legacyQueue.slice(0, maxActive).forEach(value => {
      const normalized = normalizeItem({ ...value, status: 'approved' }, now());
      if (normalized) items.push(normalized);
    });
  }

  const data = { version: 2, mode, settings, items };

  function ordered(status) {
    return data.items
      .filter(item => item.status === status)
      .sort((left, right) => {
        const leftOrder = status === 'approved' ? left.approvedAt || left.createdAt : left.createdAt;
        const rightOrder = status === 'approved' ? right.approvedAt || right.createdAt : right.createdAt;
        return leftOrder - rightOrder;
      });
  }

  function find(id) {
    return data.items.find(item => item.id === id) || null;
  }

  function prune() {
    const active = data.items.filter(item => ACTIVE_STATUSES.has(item.status));
    const history = data.items
      .filter(item => !ACTIVE_STATUSES.has(item.status))
      .sort((left, right) => {
        const leftTime = left.displayedAt || left.rejectedAt || left.createdAt;
        const rightTime = right.displayedAt || right.rejectedAt || right.createdAt;
        return rightTime - leftTime;
      })
      .slice(0, maxHistory);
    data.items = [...active, ...history];
  }

  function queuePosition(id) {
    const index = ordered('approved').findIndex(item => item.id === id);
    return index < 0 ? null : index + 1;
  }

  function pendingPosition(id) {
    const index = ordered('pending').findIndex(item => item.id === id);
    return index < 0 ? null : index + 1;
  }

  function snapshot() {
    prune();
    return JSON.parse(JSON.stringify(data));
  }

  function counts() {
    return {
      pending: ordered('pending').length,
      approved: ordered('approved').length,
      playing: ordered('playing').length,
      active: data.items.filter(item => ACTIVE_STATUSES.has(item.status)).length,
    };
  }

  function submit({ text, color, rainbow, clientHash, ipHash, gif }) {
    if (counts().active >= maxActive) return null;
    if (gif && !validMetadata(gif)) return null;
    const createdAt = now();
    const status = gif || data.mode === 'moderated' ? 'pending' : 'approved';
    const item = {
      id: crypto.randomUUID(),
      receipt: crypto.randomBytes(18).toString('base64url'),
      clientHash: String(clientHash || ''),
      ipHash: String(ipHash || ''),
      text: String(text).slice(0, 80),
      kind: gif ? 'gif' : 'text',
      ...(gif ? { gif: { ...gif } } : {}),
      color: validColor(color),
      rainbow: !!rainbow,
      status,
      createdAt,
      approvedAt: status === 'approved' ? createdAt : null,
      playingAt: null,
      displayedAt: null,
      rejectedAt: null,
    };
    data.items.push(item);
    return { ...item };
  }

  function setMode(value) {
    if (!MODES.has(value)) return null;
    data.mode = value;
    let approved = 0;
    if (value === 'automatic') {
      const approvedAt = now();
      ordered('pending').forEach(item => {
        if (item.kind === 'gif') return;
        item.status = 'approved';
        item.approvedAt = approvedAt;
        approved += 1;
      });
    }
    return { mode: data.mode, approved };
  }

  function approve(id) {
    const item = find(id);
    if (!item || item.status !== 'pending') return null;
    item.status = 'approved';
    item.approvedAt = now();
    return { ...item };
  }

  function reject(id) {
    const item = find(id);
    if (!item || !['pending', 'approved', 'displayed'].includes(item.status)) return null;
    item.status = 'rejected';
    item.rejectedAt = now();
    prune();
    return { ...item };
  }

  function remove(id) {
    const index = data.items.findIndex(item => item.id === id && item.status !== 'playing');
    if (index < 0) return false;
    data.items.splice(index, 1);
    return true;
  }

  function takeNext() {
    const alreadyPlaying = ordered('playing')[0];
    if (alreadyPlaying) return { ...alreadyPlaying };
    const item = ordered('approved')[0];
    if (!item) return null;
    item.status = 'playing';
    item.playingAt = now();
    return { ...item };
  }

  function complete(id) {
    const item = find(id);
    if (!item || item.status !== 'playing') return null;
    item.status = 'displayed';
    item.displayedAt = now();
    prune();
    return { ...item };
  }

  function requeue(id) {
    const item = find(id);
    if (!item || item.status !== 'playing') return null;
    item.status = 'approved';
    item.playingAt = null;
    item.approvedAt = item.approvedAt || now();
    return { ...item };
  }

  function replay(id) {
    const item = find(id);
    if (!item || item.status !== 'displayed' || counts().active >= maxActive) return null;
    item.status = 'approved';
    item.approvedAt = now();
    item.playingAt = null;
    return { ...item };
  }

  function countActiveForClient(clientHash) {
    return data.items.filter(item =>
      item.clientHash === clientHash && ACTIVE_STATUSES.has(item.status)
    ).length;
  }

  function countActiveForIp(ipHash) {
    return data.items.filter(item =>
      item.ipHash === ipHash && ACTIVE_STATUSES.has(item.status)
    ).length;
  }

  function setSettings(value) {
    if (!value || typeof value !== 'object') return null;
    const maxMessagesPerIp = integerInRange(value.maxMessagesPerIp, null);
    if (maxMessagesPerIp === null) return null;
    data.settings.maxMessagesPerIp = maxMessagesPerIp;
    return { ...data.settings };
  }

  function isRecentDuplicate(text, clientHash, windowMs) {
    const threshold = now() - windowMs;
    const normalized = String(text).toLocaleLowerCase('fr');
    return data.items.some(item =>
      item.clientHash === clientHash &&
      item.createdAt >= threshold &&
      item.kind !== 'gif' &&
      item.text.toLocaleLowerCase('fr') === normalized
    );
  }

  function getPublicStatus(id, receipt) {
    const item = find(id);
    if (!item || !timingSafeEqual(item.receipt, receipt)) return null;
    return {
      id: item.id,
      kind: item.kind || 'text',
      status: item.status,
      mode: data.mode,
      position: item.status === 'approved' ? queuePosition(item.id) : null,
      pendingPosition: item.status === 'pending' ? pendingPosition(item.id) : null,
      createdAt: item.createdAt,
    };
  }

  function adminView() {
    const playing = ordered('playing').map(publicItem);
    const pending = ordered('pending').map(publicItem);
    const queue = ordered('approved').map((item, index) => ({
      ...publicItem(item),
      position: index + 1,
    }));
    const history = data.items
      .filter(item => ['displayed', 'rejected'].includes(item.status))
      .sort((left, right) =>
        (right.displayedAt || right.rejectedAt || 0) - (left.displayedAt || left.rejectedAt || 0)
      )
      .slice(0, maxHistory)
      .map(publicItem);
    return {
      mode: data.mode,
      settings: { ...data.settings },
      playing,
      pending,
      queue,
      history,
      counts: counts(),
    };
  }

  return {
    snapshot,
    counts,
    submit,
    setMode,
    approve,
    reject,
    remove,
    takeNext,
    complete,
    requeue,
    replay,
    getItem: id => { const item = find(id); return item ? publicItem(item) : null; },
    queuePosition,
    pendingPosition,
    countActiveForClient,
    countActiveForIp,
    setSettings,
    getSettings: () => ({ ...data.settings }),
    isRecentDuplicate,
    getPublicStatus,
    adminView,
    hasApproved: () => ordered('approved').length > 0,
    getMode: () => data.mode,
    getGif: id => { const item = find(id); return item && item.gif ? { ...item.gif } : null; },
    isRecentGifDuplicate: (hash, clientHash, windowMs) => data.items.some(item =>
      item.gif && item.gif.hash === hash && item.clientHash === clientHash && item.createdAt >= now() - windowMs),
  };
}

module.exports = { createPublicMessageStore };
