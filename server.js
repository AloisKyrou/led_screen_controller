'use strict';
// panel_controller/server.js
// Node.js ArtNet LED panel server + REST API + web UI
// Requires: npm install express  (or NODE_PATH pointing to global express)

const path    = require('path');
const fs      = require('fs');
const dgram   = require('dgram');
const crypto  = require('crypto');
const express = require('express');
const { createPublicMessageStore } = require('./lib/public-message-store');
const { validateUpload, createPublicGifFiles } = require('./lib/public-gifs');
const PanelGif = require('./public/panel-gif');
const { createAudioInput, validateSettings: validateAudioSettings } = require('./lib/audio-input');
const { createKickOverlay, blendKickFlash } = require('./lib/kick-overlay');

// ── Panel geometry ─────────────────────────────────────────────────────────────
const W                 = 60;
const H                 = 15;
const SERPENTINE_ROWS   = true;
const TARGET_IP         = process.env.ARTNET_TARGET_IP || '255.255.255.255';
const ARTNET_PORT       = 6454;
const BASE_UNIVERSE     = 6;
const UNIVERSE_COUNT    = 6;
const PIXELS_PER_UNI    = 150;
const DMX_LEN           = 512;
const FPS               = 30;
const PORT              = Number(process.env.PORT) || 3000;

// Admin access and public message limits
const ADMIN_USERNAME            = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD            = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET            = process.env.SESSION_SECRET || ADMIN_PASSWORD;
const ADMIN_SESSION_SECONDS     = 12 * 60 * 60;
const PUBLIC_MESSAGE_MAX_LENGTH = 80;
const PUBLIC_MESSAGE_MAX_ACTIVE = 50;
const PUBLIC_COOLDOWN_MS        = (Number(process.env.PUBLIC_COOLDOWN_SECONDS) || 20) * 1000;
const PUBLIC_RATE_LIMIT         = Number(process.env.PUBLIC_RATE_LIMIT) || 3;
const PUBLIC_RATE_WINDOW_MS     = (Number(process.env.PUBLIC_RATE_WINDOW_SECONDS) || 300) * 1000;
const PUBLIC_GLOBAL_RATE_LIMIT  = Number(process.env.PUBLIC_GLOBAL_RATE_LIMIT) || 30;
const PUBLIC_DUPLICATE_WINDOW_MS = 5 * 60 * 1000;
const MEDIA_MAX_FRAMES          = 180;
const MEDIA_MAX_ENTRIES         = 30;
const MEDIA_FRAME_BYTES         = W * H * 3;
const MEDIA_BODY_LIMIT          = '1mb';
const SCENE_MAX_CUES            = 100;
const SCENE_MAX_ENTRIES         = 30;

if (process.env.NODE_ENV === 'production' && !ADMIN_PASSWORD) {
  console.error('ADMIN_PASSWORD is required when NODE_ENV=production');
  process.exit(1);
}
if (!ADMIN_PASSWORD) {
  console.warn('WARNING: admin login is disabled until ADMIN_PASSWORD is set');
}

// ── ArtNet ─────────────────────────────────────────────────────────────────────
const sock = dgram.createSocket('udp4');
sock.bind(() => sock.setBroadcast(true));

function artdmxPacket(universe, data512) {
  const pkt = Buffer.alloc(18 + data512.length);
  pkt.write('Art-Net\0', 0, 'ascii');
  pkt.writeUInt16LE(0x5000, 8);           // OpDMX
  pkt.writeUInt16BE(14, 10);              // ProtVer
  pkt[12] = 0; pkt[13] = 0;              // Sequence, Physical
  pkt.writeUInt16LE(universe & 0xFFFF, 14);
  pkt.writeUInt16BE(data512.length, 16);
  data512.copy(pkt, 18);
  return pkt;
}

function xyToGlobal(x, y) {
  const xEff = (SERPENTINE_ROWS && y % 2 === 1) ? (W - 1 - x) : x;
  return y * W + xEff;
}

function sendFrame(pixelBuf) {
  // pixelBuf: Uint8Array(H*W*3)   [y*W+x]*3 = R,G,B
  const frames = Array.from({ length: UNIVERSE_COUNT }, () => Buffer.alloc(DMX_LEN));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const gi   = xyToGlobal(x, y);
      const port = Math.floor(gi / PIXELS_PER_UNI);
      const idx  = gi % PIXELS_PER_UNI;
      if (port < 0 || port >= UNIVERSE_COUNT) continue;
      const ch = idx * 3;
      if (ch + 2 >= DMX_LEN) continue;
      const pi = (y * W + x) * 3;
      frames[port][ch]   = pixelBuf[pi+1]; // GRB panel: byte 0 = G
      frames[port][ch+1] = pixelBuf[pi];   // byte 1 = R
      frames[port][ch+2] = pixelBuf[pi+2]; // byte 2 = B
    }
  }
  for (let i = 0; i < UNIVERSE_COUNT; i++) {
    sock.send(artdmxPacket(BASE_UNIVERSE + i, frames[i]), ARTNET_PORT, TARGET_IP);
  }
}

// ── Load effects ───────────────────────────────────────────────────────────────
const EFFECTS_DIR = path.join(__dirname, 'effects');
const effectsList = []; // ordered array of effect modules
// Kept on disk for later reuse, excluded from UI, AUTO and scene playback.
const RETIRED_EFFECTS = new Set(['fete_trouble', 'moving_tile_puzzle', 'fillscreen_snakewise', 'bouncing_balls', 'audio_cauldron', 'audio_monster_mouth', 'audio_watching_eyes']);
const effectMap   = {}; // id → module

fs.readdirSync(EFFECTS_DIR).sort().forEach(file => {
  if (!file.endsWith('.js') || file === 'font.js') return;
  try {
    const mod = require(path.join(EFFECTS_DIR, file));
    if (mod.name && mod.init && mod.frame) {
      effectsList.push(mod);
      effectMap[mod.name] = mod;
      console.log(`  ✓ loaded ${mod.name}`);
    }
  } catch (e) {
    console.warn(`  ✗ failed ${file}: ${e.message}`);
  }
});

// ── Config (effects.json) ──────────────────────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, 'effects.json');
let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch{}

// Per-effect built-in defaults (rainbow/color/freq/duration) — survives effects.json reverts
const EFFECT_DEFAULTS = {
  ...Object.fromEntries(require('./lib/halloween').NAMES.map(name => ['audio_' + name,
    { duration: 20, freq: 2, enabled: false, reactivity: 1, disableKick: true }])),
  pharmacy_tunnel:     { duration: 20, freq: 2, enabled: false, rainbow: false, color: '#00ff80', speed: 30 },
  nool_scatter:        { duration: 20, freq: 2, enabled: false, rainbow: true, color: '#00ff80', speed: 30 },
  nol_chaos:           { duration: 20, freq: 2, enabled: false, rainbow: true, color: '#00ff80', speed: 30 },
  audio_spectrum:      { duration: 20, freq: 2, enabled: false, reactivity: 1, ball: true },
  audio_scope:         { duration: 20, freq: 2, enabled: false, reactivity: 2 },
  audio_mirror:        { duration: 20, freq: 2, enabled: false, reactivity: 1 },
  audio_kick_only:     { duration: 20, freq: 2, enabled: false, kickSensitivity: 2 },
  audio_kick_shockwave: { duration: 20, freq: 2, enabled: false, kickSensitivity: 2 },
  audio_pumping_circle: { duration: 20, freq: 2, enabled: false, reactivity: 1, rainbow: true, color: '#ff0080' },
  nools:               { duration: 15, freq: 1,  rainbow: true,  color: '#ff8800' },
  fete_trouble:        { duration: 15, freq: 1,  rainbow: true,  color: '#c36a04' },
  simple_firework:     { duration: 12, freq: 4,  rainbow: true,  color: '#ff4400' },
  fading_pixel:        { duration: 12, freq: 1,  rainbow: true,  color: '#ffffff' },
  bouncing_balls:      { duration: 10, freq: 5,  rainbow: true,  color: '#00a3f5' },
  pumping_circle:      { duration: 10, freq: 2,  rainbow: true,  color: '#ff0080' },
  scroll_text:         { duration: 12, freq: 3 },
  static_text:         { duration: 10, freq: 2 },
  public_messages:     { duration: 8,  freq: 3, speed: 30 },
  media:               { duration: 20, freq: 1, enabled: false },
  simple_color_scroll: { duration: 8,  freq: 2,  rainbow: true,  color: '#00ff80' },
  c64_loadscreen:      { duration: 10, freq: 1,  rainbow: true,  color: '#ff8800' },
  fillscreen_snakewise:{ duration: 15, freq: 1,  enabled: false },
  moving_tile_puzzle:  { duration: 78, freq: 1 },
  simple_snake:        { duration: 20, freq: 2,  rainbow: true,  color: '#00ffff' },
  fire:                { duration: 12, freq: 3 },
  rain:                { duration: 12, freq: 2,  rainbow: true,  color: '#00ccff' },
  starfield:           { duration: 15, freq: 3,  rainbow: true,  color: '#ffffff' },
  raindrops:           { duration: 12, freq: 2,  rainbow: true,  color: '#00aaff' },
};

// Ensure every effect has a config entry, merging built-in defaults with effects.json
effectsList.forEach(e => {
  const defaults = EFFECT_DEFAULTS[e.name] || {};
  if (!config[e.name]) config[e.name] = {};
  const stored = config[e.name];
  // Merge: base → defaults → stored (stored wins for fields it explicitly sets)
  // Exception: if stored has only rarity (no freq), don't let it override defaults.freq
  const storedFreqOverride = (stored.freq !== undefined) ? { freq: stored.freq }
    : (stored.rarity !== undefined && defaults.freq === undefined) ? { freq: stored.rarity }
    : {};
  config[e.name] = Object.assign(
    { duration: 10, freq: 3, brightness: 1, enabled: true, disableKick: false, kickBrightnessBump: false, forceKickColor: false, kickColor: '#ffffff' },
    defaults,
    stored,
    storedFreqOverride
  );
});

function saveConfig() {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2)); } catch{}
}

// ── Scheduler state ────────────────────────────────────────────────────────────
const TEXT_PATH = path.join(__dirname, 'text.json');
const MEDIA_PATH = path.join(__dirname, 'media.json');
const SCENE_PATH = path.join(__dirname, 'scene.json');
const MESSAGES_PATH = path.join(__dirname, 'messages.json');
const publicGifFiles = createPublicGifFiles(path.join(__dirname, 'public-gifs'));
let savedText = {};
try { savedText = JSON.parse(fs.readFileSync(TEXT_PATH, 'utf8')); } catch {}
let savedMedia = null;
try { savedMedia = JSON.parse(fs.readFileSync(MEDIA_PATH, 'utf8')); } catch {}
let savedScenes = { name: 'SCÈNE 1', loop: false, cues: [] };
try { savedScenes = JSON.parse(fs.readFileSync(SCENE_PATH, 'utf8')); } catch {}
let savedMessages = {};
try { savedMessages = JSON.parse(fs.readFileSync(MESSAGES_PATH, 'utf8')); } catch {}

function normalizeMediaLibrary(value) {
  const candidates = Array.isArray(value && value.entries)
    ? value.entries
    : value && Array.isArray(value.frames) ? [value] : [];
  return {
    entries: candidates.slice(0, MEDIA_MAX_ENTRIES).flatMap(clip => {
      if (!clip || !Array.isArray(clip.frames) || !clip.frames.length) return [];
      const fallbackId = `media-${crypto.createHash('sha256')
        .update(String(clip.name || 'media'))
        .update(String(clip.frames.length))
        .update(String(clip.frames[0] || ''))
        .digest('hex').slice(0, 20)}`;
      return [{
        id: typeof clip.id === 'string' && clip.id ? clip.id : fallbackId,
        version: Number(clip.version) || Date.now(),
        name: path.basename(String(clip.name || 'media')).slice(0, 120),
        frames: clip.frames,
        enabled: clip.enabled !== false,
        forceKickColor: clip.forceKickColor === true,
        disableKick: clip.disableKick === true,
        weight: Number.isFinite(clip.weight) ? Math.max(1, Math.min(10, clip.weight)) : 1,
        kickColor: /^#[a-f0-9]{6}$/i.test(clip.kickColor || '') ? clip.kickColor : '#ffffff',
        sourceGifHash: typeof clip.sourceGifHash === 'string' ? clip.sourceGifHash : null,
        durations: Array.isArray(clip.durations) ? clip.durations : [],
      }];
    }),
  };
}

const messageStore = createPublicMessageStore(savedMessages, {
  legacyQueue: savedText.publicQueue,
  maxActive: PUBLIC_MESSAGE_MAX_ACTIVE,
  maxHistory: 100,
  defaultMaxMessagesPerIp: PUBLIC_RATE_LIMIT,
});

function publicMessagesAdminView() {
  const view = messageStore.adminView();
  for (const item of [...view.pending, ...view.queue, ...view.playing, ...view.history]) {
    if (item.gif) item.savedMediaId = shared.mediaLibrary.entries.find(clip => clip.sourceGifHash === item.gif.hash)?.id || null;
  }
  view.settings.rateWindowSeconds = Math.ceil(PUBLIC_RATE_WINDOW_MS / 1000);
  return view;
}

const shared = {
  scrollPool: savedText.scrollPool || [{ text: 'NOOLS', color: '#ffffff', rainbow: false }],
  staticPool:  savedText.staticPool  || [{ text: 'NOOLS', color: '#ff8800', rainbow: false }],
  djName:      savedText.djName      || '',
  mediaLibrary: normalizeMediaLibrary(savedMedia),
  publicMessages: {
    takeNext() {
      let item = messageStore.takeNext();
      while (item && item.kind === 'gif') {
        try {
          item.animation = PanelGif.decode(publicGifFiles.read(item.gif));
          break;
        } catch (error) {
          console.warn(`Public GIF ${item.id} unavailable: ${error.message}`);
          messageStore.requeue(item.id);
          messageStore.reject(item.id);
          saveMessages();
          item = messageStore.takeNext();
        }
      }
      if (item) saveMessages();
      return item;
    },
    complete(id) {
      const item = messageStore.complete(id);
      if (item) saveMessages();
      return item;
    },
    requeue(id) {
      const item = messageStore.requeue(id);
      if (item) saveMessages();
      return item;
    },
  },
};

function saveText() {
  try {
    fs.writeFileSync(TEXT_PATH, JSON.stringify({
      scrollPool: shared.scrollPool,
      staticPool: shared.staticPool,
      djName: shared.djName,
    }, null, 2));
  } catch {}
}

function saveMessages() {
  try {
    const temporaryPath = `${MESSAGES_PATH}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(messageStore.snapshot(), null, 2));
    fs.renameSync(temporaryPath, MESSAGES_PATH);
    try { publicGifFiles.prune(messageStore.snapshot().items); }
    catch (error) { console.warn(`Could not prune public GIF files: ${error.message}`); }
    return true;
  } catch (error) {
    console.warn(`Could not persist public messages: ${error.message}`);
    return false;
  }
}

saveMessages();
if (Array.isArray(savedText.publicQueue)) saveText();

function saveMedia() {
  try {
    fs.writeFileSync(MEDIA_PATH, JSON.stringify(shared.mediaLibrary));
    return true;
  } catch (error) {
    console.warn(`Could not persist media: ${error.message}`);
    return false;
  }
}

function saveScene() {
  try {
    fs.writeFileSync(SCENE_PATH, JSON.stringify(sceneLibrary, null, 2));
    return true;
  } catch (error) {
    console.warn(`Could not persist scene: ${error.message}`);
    return false;
  }
}

function mediaMetadata() {
  return shared.mediaLibrary.entries.map(clip => ({
    id: clip.id,
    name: clip.name,
    frameCount: clip.frames.length,
    animated: clip.frames.length > 1,
    enabled: clip.enabled !== false,
    forceKickColor: clip.forceKickColor === true,
    disableKick: clip.disableKick === true,
    weight: clip.weight ?? 1,
    kickColor: clip.kickColor || '#ffffff',
  }));
}

let currentEffect    = null;
let currentState     = null;
let currentConfigOverrides = null;
let effectStartTime  = 0;
let blackout         = false;
let globalBrightness = 1.0;
let kickFlash        = false;
let kickFlashEnd     = 0;
let kickFlashColor      = [255, 255, 255];
let kickFlashBrightness = 1.0;
let kickFlashOpacity = 1;
const { createKickEnvelope } = require('./lib/kick-envelope');
const flashEnvelope = createKickEnvelope(), boostEnvelope = createKickEnvelope();
const effectBrightnessEnvelope = createKickEnvelope();
function effectBumpEnabled() { return !!currentEffect && getCfg(currentEffect.name).kickBrightnessBump === true; }
function triggerEffectBrightness(now = Date.now() / 1000) {
  if (blackout || !effectBumpEnabled()) return;
  const settings = audioInput.snapshot().settings;
  effectBrightnessEnvelope.trigger(now, settings.kickAttackMs / 1000, settings.kickReleaseMs / 1000);
}
function effectiveEffectBrightness(now) {
  const base = currentConfigOverrides?.brightness ?? (currentEffect ? getCfg(currentEffect.name).brightness : 1);
  return base + (1 - base) * (effectBumpEnabled() ? effectBrightnessEnvelope.value(now) : 0);
}
let kickBoostTarget = 1;
const kickOverlay = createKickOverlay(W, H);
const { scaleOutput } = require('./lib/output-brightness');
function kickVisualOverride() {
  return currentEffect?.name === 'audio_kick_only' ? 'flash'
    : currentEffect?.name === 'audio_kick_shockwave' ? 'shockwave' : null;
}
function kickOverlaysDisabled() {
  if (kickVisualOverride() || !currentEffect) return false;
  const clip = currentEffect.name === 'media' ? shared.mediaLibrary.entries.find(item => item.id === currentState?.mediaId) : null;
  return getCfg(currentEffect.name).disableKick === true || clip?.disableKick === true;
}
function audioKickAppearance() {
  const settings = audioInput.snapshot().settings;
  const visual = kickVisualOverride() || settings.kickVisual;
  const effectConfig = currentEffect ? getCfg(currentEffect.name) : {};
  const clip = currentEffect?.name === 'media' ? shared.mediaLibrary.entries.find(item => item.id === currentState?.mediaId) : null;
  const overrideColor = clip?.forceKickColor ? clip.kickColor : effectConfig.forceKickColor ? effectConfig.kickColor : null;
  return { color: overrideColor || settings.kickColor, brightness: settings.kickBrightness, rainbow: overrideColor ? false : settings.kickRainbow,
    visual, temporaryOverride: !!kickVisualOverride(),
    attackMs: settings.kickAttackMs, releaseMs: settings.kickReleaseMs,
    boostEnabled: settings.kickBoostEnabled, boostTarget: settings.kickBoostTarget,
    opacity: settings.kickOpacity,
    durationMs: visual === 'shockwave' ? settings.waveDurationMs : settings.kickDurationMs,
    masterBrightness: globalBrightness, blackout };
}
function setKickAppearance(appearance) {
  const colors = ['#ff4400', '#ffcc00', '#33ff00', '#00ffcc', '#0088ff', '#cc00ff'];
  kickFlashColor = hexToRgbArray(appearance.rainbow ? colors[crypto.randomInt(colors.length)] : appearance.color);
  kickFlashBrightness = appearance.brightness;
  kickFlashOpacity = appearance.opacity ?? 1;
}
function triggerAudioKick() {
  const now = Date.now() / 1000;
  if (blackout) return;
  triggerEffectBrightness(now);
  const appearance = audioKickAppearance();
  setKickAppearance(appearance);
  if (appearance.boostEnabled || appearance.visual === 'brightness') {
    kickBoostTarget = appearance.boostTarget;
    boostEnvelope.trigger(now, appearance.attackMs / 1000, appearance.releaseMs / 1000);
  }
  if (appearance.visual === 'brightness' || kickOverlaysDisabled()) return;
  if (appearance.visual === 'shockwave') {
    kickOverlay.trigger(now, { color: kickFlashColor, brightness: appearance.brightness, durationMs: appearance.durationMs, opacity: appearance.opacity });
    return;
  }
  kickFlash = true;
  flashEnvelope.trigger(now, appearance.attackMs / 1000, appearance.releaseMs / 1000, appearance.durationMs / 1000);
  kickFlashEnd = now + (appearance.attackMs + appearance.durationMs + appearance.releaseMs) / 1000;
}

const AUDIO_PATH = path.join(__dirname, 'audio.json');
let savedAudio = {};
try { savedAudio = JSON.parse(fs.readFileSync(AUDIO_PATH, 'utf8')); } catch {}
// Migrate the previously effective audio appearance, preserving custom colours.
if (savedAudio.kickUnified !== true && savedAudio.kickUsePanel !== false) {
  savedAudio.kickColor = /^#[a-f0-9]{6}$/i.test(config._kick?.color) ? config._kick.color : '#ffffff';
  savedAudio.kickBrightness = Number.isFinite(config._kick?.brightness) ? Math.max(0, Math.min(1, config._kick.brightness)) : 1;
  savedAudio.kickRainbow = config._kick?.rainbow === true;
}
savedAudio.kickUnified = true;
const audioInput = createAudioInput(savedAudio, () => {
  if (audioInput.snapshot().settings.kickEnabled || kickVisualOverride()) triggerAudioKick();
  else triggerEffectBrightness();
}, {
  shouldTrigger: () => !!kickVisualOverride() || effectBumpEnabled(),
  kickSensitivity: () => kickVisualOverride() ? getCfg(currentEffect.name).kickSensitivity : 1,
});
shared.audio = audioInput;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { audioInput.stop(); process.exit(0); });
process.once('exit', () => audioInput.stop());

function hexToRgbArray(hex) {
  hex = (hex || '#ffffff').replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
  const n = parseInt(hex, 16) || 0;
  return [(n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF];
}

// Override: force-play an effect for at least `until` seconds
let override         = false;
let overrideUntil    = 0;
const scenePlayback  = { active: false, sceneId: null, cueIndex: -1 };

function getCfg(name) {
  const c = config[name] || { duration: 10, freq: 3, brightness: 1, enabled: true };
  // Normalize legacy rarity field on the fly
  if (c.rarity !== undefined && c.freq === undefined) c.freq = c.rarity;
  return c;
}

function normalizeScene(value, fallbackId = 'scene-1') {
  const source = value && typeof value === 'object' ? value : {};
  const cues = Array.isArray(source.cues) ? source.cues.slice(0, SCENE_MAX_CUES) : [];
  return {
    id: typeof source.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(source.id) ? source.id : fallbackId,
    name: String(source.name || 'SCÈNE 1').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 60) || 'SCÈNE 1',
    loop: !!source.loop,
    cues: cues.flatMap(cue => {
      if (!cue || typeof cue !== 'object' || !effectMap[cue.effectId] || cue.effectId === 'public_messages') return [];
      const duration = Number(cue.duration);
      const normalized = {
        effectId: cue.effectId,
        duration: Number.isFinite(duration) ? Math.max(1, Math.min(600, duration)) : getCfg(cue.effectId).duration,
      };
      const effectConfig = getCfg(cue.effectId);
      if (/^#[0-9a-f]{6}$/i.test(cue.color || '')) normalized.color = cue.color;
      else if (/^#[0-9a-f]{6}$/i.test(effectConfig.color || '')) normalized.color = effectConfig.color;
      if (typeof cue.rainbow === 'boolean') normalized.rainbow = cue.rainbow;
      else if (typeof effectConfig.rainbow === 'boolean') normalized.rainbow = effectConfig.rainbow;
      if ((cue.effectId === 'scroll_text' || cue.effectId === 'static_text') && cue.entry && typeof cue.entry.text === 'string') {
        normalized.entry = {
          text: cue.entry.text.slice(0, 300),
          color: /^#[0-9a-f]{6}$/i.test(cue.entry.color || '') ? cue.entry.color : '#ffffff',
          rainbow: !!cue.entry.rainbow,
        };
      }
      if (cue.effectId === 'media' && typeof cue.mediaId === 'string') {
        normalized.mediaId = cue.mediaId.slice(0, 80);
        normalized.mediaName = String(cue.mediaName || '').slice(0, 120);
      }
      return [normalized];
    }),
  };
}

function normalizeSceneLibrary(value) {
  const source = value && typeof value === 'object' ? value : {};
  const candidates = Array.isArray(source.scenes) ? source.scenes : [source];
  const scenes = [];
  const usedIds = new Set();
  candidates.slice(0, SCENE_MAX_ENTRIES).forEach((candidate, index) => {
    let fallbackId = `scene-${index + 1}`;
    while (usedIds.has(fallbackId)) fallbackId += '-copy';
    const normalized = normalizeScene(candidate, fallbackId);
    if (usedIds.has(normalized.id)) normalized.id = fallbackId;
    usedIds.add(normalized.id);
    scenes.push(normalized);
  });
  if (!scenes.length) scenes.push(normalizeScene({}, 'scene-1'));
  const selectedSceneId = scenes.some(item => item.id === source.selectedSceneId)
    ? source.selectedSceneId
    : scenes[0].id;
  return { version: 2, selectedSceneId, scenes };
}

let sceneLibrary = normalizeSceneLibrary(savedScenes);

function selectedScene() {
  return sceneLibrary.scenes.find(item => item.id === sceneLibrary.selectedSceneId) || sceneLibrary.scenes[0];
}

function playingScene() {
  if (!scenePlayback.active) return null;
  return sceneLibrary.scenes.find(item => item.id === scenePlayback.sceneId) || null;
}

function effectAvailable(effect) {
  return !RETIRED_EFFECTS.has(effect.name) && (!effect.name.startsWith('audio_') || audioInput.snapshot().settings.enabled);
}
function enabledEffects() {
  return effectsList.filter(effect =>
    effectAvailable(effect) &&
    getCfg(effect.name).enabled &&
    (effect.name !== 'public_messages' || messageStore.hasApproved()) &&
    (effect.name !== 'media' || shared.mediaLibrary.entries.some(clip => clip.enabled !== false))
  );
}

function pickNextEffect() {
  const pool = enabledEffects();
  if (!pool.length) return effectsList.find(effect => effectAvailable(effect) && !['media', 'public_messages'].includes(effect.name)) || null;
  const total = pool.reduce((s, e) => s + getCfg(e.name).freq, 0);
  let rand = Math.random() * total;
  for (const e of pool) {
    rand -= getCfg(e.name).freq;
    if (rand <= 0) return e;
  }
  return pool[pool.length - 1];
}

function switchTo(effect, options) {
  if (!effect) return;
  effectBrightnessEnvelope.clear();
  if (!effectAvailable(effect)) { effect = pickNextEffect(); options = undefined; }
  if (kickVisualOverride() || ['audio_kick_only', 'audio_kick_shockwave'].includes(effect.name)) {
    kickFlash = false; kickOverlay.clear(); flashEnvelope.clear(); boostEnvelope.clear();
  }
  if (currentEffect && currentState && typeof currentEffect.stop === 'function') {
    try { currentEffect.stop(currentState, shared); }
    catch (error) { console.warn('stop error for ' + currentEffect.name + ': ' + error.message); }
  }
  currentEffect   = effect;
  effectStartTime = Date.now() / 1000;
  currentConfigOverrides = options && options.config ? options.config : null;
  const activeConfig = currentConfigOverrides
    ? { ...getCfg(effect.name), ...currentConfigOverrides }
    : getCfg(effect.name);
  try {
    currentState = effect.init(W, H, activeConfig, shared, options);
  } catch(e) {
    console.error(`init error for ${effect.name}:`, e);
    currentState = {};
  }
  console.log(`▶ ${effect.name}`);
}

function leaveSceneMode() {
  scenePlayback.active = false;
  scenePlayback.sceneId = null;
  scenePlayback.cueIndex = -1;
}

function playSceneCue(index) {
  const scene = playingScene() || selectedScene();
  if (!scene.cues.length || index < 0 || index >= scene.cues.length) return false;
  let checked = 0;
  while (!effectAvailable(effectMap[scene.cues[index].effectId])) {
    checked++; index++;
    if (checked >= scene.cues.length || (index >= scene.cues.length && !scene.loop)) {
      finishScene(); return false;
    }
    index %= scene.cues.length;
  }
  const cue = scene.cues[index];
  const effect = effectMap[cue.effectId];
  if (!effect) return false;
  scenePlayback.active = true;
  scenePlayback.sceneId = scene.id;
  scenePlayback.cueIndex = index;
  override = false;
  const cueConfig = {};
  if (cue.color !== undefined) cueConfig.color = cue.color;
  if (cue.rainbow !== undefined) cueConfig.rainbow = cue.rainbow;
  const options = {
    ...(cue.entry ? { entry: cue.entry } : {}),
    ...(cue.mediaId ? { mediaId: cue.mediaId } : {}),
    ...(Object.keys(cueConfig).length ? { config: cueConfig } : {}),
  };
  switchTo(effect, options);
  return true;
}

function applyActiveCueLook() {
  if (!scenePlayback.active) return;
  const scene = playingScene();
  if (!scene) return finishScene();
  const cue = scene.cues[scenePlayback.cueIndex];
  if (!cue || !currentEffect || currentEffect.name !== cue.effectId) return;
  // Text effects pre-render their glyphs during init. Reinitialize only when
  // the active cue's text changes so the edited message is shown immediately.
  if (cue.entry && currentState && currentState.lastText !== cue.entry.text) {
    playSceneCue(scenePlayback.cueIndex);
    return;
  }
  const cueConfig = {};
  if (cue.color !== undefined) cueConfig.color = cue.color;
  if (cue.rainbow !== undefined) cueConfig.rainbow = cue.rainbow;
  currentConfigOverrides = Object.keys(cueConfig).length ? cueConfig : null;
  if (cue.entry && currentState) {
    currentState.color = cue.entry.color;
    currentState.rainbow = !!cue.entry.rainbow;
  }
}

function finishScene() {
  leaveSceneMode();
  switchTo(pickNextEffect());
}

function advanceScene(step = 1) {
  if (!scenePlayback.active) return false;
  const scene = playingScene();
  if (!scene) { finishScene(); return false; }
  let next = scenePlayback.cueIndex + step;
  if (next >= scene.cues.length) {
    if (scene.loop && scene.cues.length) next = 0;
    else { finishScene(); return false; }
  }
  if (next < 0) next = 0;
  return playSceneCue(next);
}

// Start with first available effect
switchTo(pickNextEffect());

// ── Render loop ────────────────────────────────────────────────────────────────
let lastFrameTime = Date.now() / 1000;

setInterval(() => {
  const now = Date.now() / 1000;
  const dt  = now - lastFrameTime;
  lastFrameTime = now;

  // Kick flash
  if (kickFlash && now > kickFlashEnd) kickFlash = false;

  // Blackout
  if (blackout) {
    kickOverlay.clear();
    boostEnvelope.clear(); flashEnvelope.clear(); effectBrightnessEnvelope.clear();
    sendFrame(new Uint8Array(H * W * 3));
    return;
  }

  // Scene mode has priority over the normal random scheduler.
  if (scenePlayback.active) {
    const scene = playingScene();
    if (!scene) { finishScene(); return; }
    const cue = scene.cues[scenePlayback.cueIndex];
    const effectReady = currentState.done !== false;
    if (!cue) finishScene();
    else if (now - effectStartTime >= cue.duration && effectReady) advanceScene(1);
  // Auto-advance — also wait for effect to signal done (e.g. scroll_text completing one full pass)
  } else if (!override || now > overrideUntil) {
    override = false;
    const t = now - effectStartTime;
    const dur = getCfg(currentEffect.name).duration;
    const effectReady = currentState.done !== false; // false means "not yet done"; undefined/true = ok
    if (t >= dur && effectReady) {
      switchTo(pickNextEffect());
    }
  }

  // Render
  let pixelBuf;
  try {
    const t = now - effectStartTime;
    const activeConfig = currentConfigOverrides
      ? { ...getCfg(currentEffect.name), ...currentConfigOverrides }
      : getCfg(currentEffect.name);
    pixelBuf = currentEffect.frame(currentState, t, dt, activeConfig, shared);
  } catch(e) {
    console.error(`frame error ${currentEffect.name}:`, e.message);
    pixelBuf = new Uint8Array(H * W * 3);
  }

  // Apply brightness (per-effect × global)
  const activeBrightness = effectiveEffectBrightness(now);
  const liveBrightness = globalBrightness + Math.max(0, kickBoostTarget - globalBrightness) * boostEnvelope.value(now);
  const bright = activeBrightness * liveBrightness;
  pixelBuf = scaleOutput(pixelBuf, bright);

  // Composite after rendering: the underlying animation keeps advancing.
  if (kickOverlaysDisabled()) {
    kickFlash = false; flashEnvelope.clear(); kickOverlay.clear();
  }
  pixelBuf = kickOverlay.render(pixelBuf, now, liveBrightness);
  // Both trigger sources blend with the freshly rendered background.
  if (kickFlash) {
    blendKickFlash(pixelBuf, kickFlashColor, kickFlashBrightness * liveBrightness, kickFlashOpacity * flashEnvelope.value(now));
  }
  sendFrame(pixelBuf);
}, 1000 / FPS);

// ── REST API ───────────────────────────────────────────────────────────────────
const app = express();
const PUBLIC_DIR = path.join(__dirname, 'public');
const rateBuckets = new Map();

app.disable('x-powered-by');
app.use(express.json({ limit: MEDIA_BODY_LIMIT }));
app.use(express.urlencoded({ extended: false, limit: '4kb' }));
app.use((error, req, res, next) => {
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Envoi trop volumineux. Maximum 512 Ko pour un GIF.' });
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Envoi illisible.' });
  next(error);
});
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return '';
}

function createAdminSession() {
  const expires = Math.floor(Date.now() / 1000) + ADMIN_SESSION_SECONDS;
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(String(expires)).digest('base64url');
  return `${expires}.${signature}`;
}

function hasValidAdminSession(req) {
  if (!ADMIN_PASSWORD) return true;
  const [expiresRaw, signature = ''] = readCookie(req, 'led_admin').split('.');
  const expires = Number(expiresRaw);
  if (!Number.isInteger(expires) || expires < Date.now() / 1000) return false;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(expiresRaw).digest('base64url');
  return safeEqual(signature, expected);
}

function requireAdmin(req, res, next) {
  if (hasValidAdminSession(req)) return next();
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'authentication required' });
  }
  return res.redirect(303, '/admin/login');
}

function checkRateLimits(rules, consume = true) {
  const now = Date.now();
  const buckets = rules.map(rule => ({
    ...rule,
    recent: (rateBuckets.get(rule.key) || [])
      .filter(timestamp => now - timestamp < rule.windowMs),
  }));
  let retryAfterMs = 0;
  for (const bucket of buckets) {
    rateBuckets.set(bucket.key, bucket.recent);
    if (bucket.recent.length >= bucket.limit) {
      retryAfterMs = Math.max(
        retryAfterMs,
        bucket.windowMs - (now - bucket.recent[0])
      );
    }
  }
  if (retryAfterMs > 0) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }
  if (consume) {
    for (const bucket of buckets) {
      bucket.recent.push(now);
      rateBuckets.set(bucket.key, bucket.recent);
    }
  }
  if (rateBuckets.size > 500) {
    for (const [bucketKey, timestamps] of rateBuckets) {
      if (!timestamps.some(timestamp => now - timestamp < PUBLIC_RATE_WINDOW_MS)) {
        rateBuckets.delete(bucketKey);
      }
    }
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

function loginRate(req, consume = false) {
  // Direct peer IP only: forwarded headers are untrusted without a configured proxy.
  return checkRateLimits([{ key: `login:${req.ip}`, limit: 5, windowMs: 5 * 60 * 1000 }], consume);
}

function normalizePublicMessage(value, allowLowercase = false) {
  if (typeof value !== 'string') return { error: 'Message manquant.' };
  let text = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!allowLowercase) text = text.toLocaleUpperCase('fr-FR');
  if (!text) return { error: 'Écris un message.' };
  if ([...text].length > PUBLIC_MESSAGE_MAX_LENGTH) {
    return { error: `Maximum ${PUBLIC_MESSAGE_MAX_LENGTH} caractères.` };
  }
  return { text };
}

function publicClientHash(req) {
  const rawClientId = req.body && req.body.clientId;
  const clientId = typeof rawClientId === 'string' && /^[a-zA-Z0-9_-]{16,100}$/.test(rawClientId)
    ? rawClientId
    : 'anonymous';
  return crypto.createHash('sha256')
    .update(String(req.ip || ''))
    .update('\0')
    .update(clientId)
    .digest('hex');
}

function publicIpHash(req) {
  return crypto.createHash('sha256')
    .update(String(req.ip || ''))
    .digest('hex');
}

function publicSubmissionResponse(item) {
  const status = messageStore.getPublicStatus(item.id, item.receipt);
  return {
    ok: true,
    id: item.id,
    receipt: item.receipt,
    ...status,
  };
}

app.get('/', (req, res) => res.redirect(302, '/message'));
app.get(['/message', '/message/'], (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'message.html')));
app.get('/message.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(PUBLIC_DIR, 'message.js'));
});
for (const asset of ['panel-gif.js', 'gif-editor.js', 'gif-editor.css']) {
  app.get(`/${asset}`, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(PUBLIC_DIR, asset));
  });
}

app.get('/admin/login', (req, res) => {
  if (hasValidAdminSession(req)) return res.redirect(303, '/admin/');
  res.setHeader('Cache-Control', 'no-store');
  return res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.get('/admin/login/status', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const rate = loginRate(req);
  return res.json({ blocked: !rate.allowed, retryAfterSeconds: rate.retryAfterSeconds });
});

app.post('/admin/login', (req, res) => {
  const rate = loginRate(req);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSeconds));
    return res.redirect(303, '/admin/login?error=rate');
  }
  const usernameOk = safeEqual(req.body.username || '', ADMIN_USERNAME);
  const passwordOk = ADMIN_PASSWORD && safeEqual(req.body.password || '', ADMIN_PASSWORD);
  if (!usernameOk || !passwordOk) {
    loginRate(req, true);
    return res.redirect(303, '/admin/login?error=credentials');
  }
  rateBuckets.delete(`login:${req.ip}`);
  res.setHeader('Set-Cookie', `led_admin=${encodeURIComponent(createAdminSession())}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ADMIN_SESSION_SECONDS}`);
  return res.redirect(303, '/admin/');
});

app.post('/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'led_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  return res.redirect(303, '/admin/login');
});

app.get('/admin', (req, res, next) => {
  if (req.path.endsWith('/')) return next();
  return res.redirect(302, '/admin/');
});
app.get('/admin/', requireAdmin, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});
app.get('/admin/app.js', requireAdmin, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(PUBLIC_DIR, 'app.js'));
});
app.get('/halloween-gifs/:file', requireAdmin, (req, res) => {
  if (!['pumpkin.gif', 'ghosts.gif', 'hands.gif', 'bat.gif', 'drip.gif', 'eyes.gif', 'spiders.gif', 'cauldron.gif'].includes(req.params.file)) return res.sendStatus(404);
  res.sendFile(path.join(PUBLIC_DIR, 'halloween-gifs', req.params.file));
});

app.get('/admin/vendor/gifuct.js', requireAdmin, (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(PUBLIC_DIR, 'vendor', 'gifuct.js'));
});

app.get('/api/public/messages/config', (req, res) => {
  return res.json({
    mode: messageStore.getMode(),
    maxLength: PUBLIC_MESSAGE_MAX_LENGTH,
    cooldownSeconds: Math.ceil(PUBLIC_COOLDOWN_MS / 1000),
    gif: { ...PanelGif.limits, requiresApproval: true },
  });
});

app.get('/api/public/messages/:id/status', (req, res) => {
  const status = messageStore.getPublicStatus(req.params.id, req.query.receipt);
  if (!status) return res.status(404).json({ error: 'Suivi de message introuvable.' });
  res.setHeader('Cache-Control', 'no-store');
  return res.json(status);
});

// Both public submission types share the same rate limits and FIFO capacity.
function publicSubmissionLimits(req, res) {
  const clientHash = publicClientHash(req);
  const ipHash = publicIpHash(req);
  const maxMessagesPerIp = messageStore.getSettings().maxMessagesPerIp;
  if (messageStore.countActiveForIp(ipHash) >= maxMessagesPerIp) {
    res.status(429).json({
      error: `Cette connexion a déjà ${maxMessagesPerIp} envoi${maxMessagesPerIp > 1 ? 's' : ''} en attente. Attends leur passage.`,
    });
    return null;
  }
  if (messageStore.counts().active >= PUBLIC_MESSAGE_MAX_ACTIVE) {
    res.status(429).json({ error: 'La file est pleine. Réessaie un peu plus tard.' });
    return null;
  }

  const rate = checkRateLimits([
    { key: `message:cooldown:${clientHash}`, limit: 1, windowMs: PUBLIC_COOLDOWN_MS },
    { key: `message:ip:${ipHash}`, limit: maxMessagesPerIp, windowMs: PUBLIC_RATE_WINDOW_MS },
    { key: 'message:global', limit: PUBLIC_GLOBAL_RATE_LIMIT, windowMs: 60 * 1000 },
  ]);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSeconds));
    res.status(429).json({
      error: `Trop d’envois. Réessaie dans ${rate.retryAfterSeconds} seconde${rate.retryAfterSeconds > 1 ? 's' : ''}.`,
      retryAfterSeconds: rate.retryAfterSeconds,
    });
    return null;
  }
  return { clientHash, ipHash };
}

// Public submissions never interrupt the current visual.
app.post('/api/public/message', (req, res) => {
  const normalized = normalizePublicMessage(req.body && req.body.text, req.body?.allowLowercase === true);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  if (messageStore.isRecentDuplicate(normalized.text, publicClientHash(req), PUBLIC_DUPLICATE_WINDOW_MS)) {
    return res.status(409).json({ error: 'Ce message a déjà été envoyé récemment.' });
  }
  const identity = publicSubmissionLimits(req, res);
  if (!identity) return;

  const item = messageStore.submit({
    text: normalized.text,
    color: req.body && req.body.color,
    rainbow: !!(req.body && req.body.rainbow),
    ...identity,
  });
  if (!item) {
    return res.status(429).json({ error: 'La file est pleine. Réessaie un peu plus tard.' });
  }
  saveMessages();
  return res.status(201).json(publicSubmissionResponse(item));
});

app.post('/api/public/gif', (req, res) => {
  const identity = publicSubmissionLimits(req, res);
  if (!identity) return;
  let upload;
  try { upload = validateUpload(req.body && req.body.gif); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  if (messageStore.isRecentGifDuplicate(upload.metadata.hash, identity.clientHash, PUBLIC_DUPLICATE_WINDOW_MS)) {
    return res.status(409).json({ error: 'Ce GIF a déjà été envoyé récemment.' });
  }
  try { publicGifFiles.save(upload); }
  catch (error) {
    console.warn(`Could not save public GIF: ${error.message}`);
    return res.status(503).json({ error: 'Impossible de conserver le GIF. Réessaie plus tard.' });
  }
  const name = typeof req.body.name === 'string' ? req.body.name : 'Mon animation';
  const text = name.normalize('NFKC').replace(/[\u0000-\u001f\u007f/\\]/g, ' ').trim().slice(0, 80) || 'Mon animation';
  const item = messageStore.submit({ text, gif: upload.metadata, ...identity });
  if (!saveMessages()) {
    messageStore.remove(item.id);
    return res.status(503).json({ error: 'Impossible de conserver cet envoi. Réessaie plus tard.' });
  }
  return res.status(201).json(publicSubmissionResponse(item));
});

// Everything below /api/public requires an authenticated admin session.
app.use('/api', requireAdmin);

app.get('/api/audio/state', (req, res) => {
  const audio = audioInput.snapshot();
  audio.kickAppearance = audioKickAppearance();
  if (req.query.visual === '0') { delete audio.bands; delete audio.waveform; }
  res.setHeader('Cache-Control', 'no-store');
  res.json(audio);
});

app.post('/api/kick/settings', (req, res) => {
  const patch = {};
  for (const [oldKey, key] of [['color', 'kickColor'], ['brightness', 'kickBrightness'], ['rainbow', 'kickRainbow']]) {
    if (req.body?.[oldKey] !== undefined) patch[key] = req.body[oldKey];
  }
  return updateAudioSettings(patch, res);
});
app.post('/api/audio/kick-test', (req, res) => {
  triggerAudioKick();
  res.json({ ok: true, appearance: audioKickAppearance() });
});

function updateAudioSettings(patch, res) {
  const previous = audioInput.snapshot().settings;
  let next;
  try { next = validateAudioSettings({ ...previous, ...patch }); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  try {
    fs.writeFileSync(`${AUDIO_PATH}.tmp`, JSON.stringify(next, null, 2));
    fs.renameSync(`${AUDIO_PATH}.tmp`, AUDIO_PATH);
  } catch { return res.status(500).json({ error: 'Impossible de sauvegarder les réglages audio.' }); }
  if (JSON.stringify(next) !== JSON.stringify(previous)) {
    audioInput.configure(next);
    kickOverlay.clear();
    boostEnvelope.clear(); flashEnvelope.clear(); effectBrightnessEnvelope.clear();
    kickFlash = false;
  }
  if (!next.enabled && currentEffect?.name.startsWith('audio_')) {
    if (scenePlayback.active) advanceScene(1);
    else { override = false; switchTo(pickNextEffect()); }
  }
  return res.json({ ok: true, audio: audioInput.snapshot() });
}
app.post('/api/audio/settings', (req, res) => updateAudioSettings(req.body, res));

app.get('/api/public-messages/:id/gif', (req, res) => {
  const gif = messageStore.getGif(req.params.id);
  if (!gif) return res.status(404).json({ error: 'GIF introuvable.' });
  try {
    const bytes = publicGifFiles.read(gif);
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.query.download === '1') res.attachment(`panneau-${gif.hash.slice(0, 12)}.gif`);
    return res.type('image/gif').send(bytes);
  } catch {
    return res.status(404).json({ error: 'Le fichier GIF n’est plus disponible.' });
  }
});

// GET /api/state
app.get('/api/state', (req, res) => {
  const now     = Date.now() / 1000;
  const elapsed = currentEffect ? now - effectStartTime : 0;
  const activeScene = playingScene();
  const activeCue = activeScene ? activeScene.cues[scenePlayback.cueIndex] : null;
  const dur     = activeCue ? activeCue.duration : currentEffect ? getCfg(currentEffect.name).duration : 1;
  res.json({
    currentEffectId:   currentEffect ? currentEffect.name : null,
    currentEffectName: currentEffect ? currentEffect.name.replace(/_/g, ' ') : '—',
    elapsed,
    duration: dur,
    progress: Math.min(1, elapsed / dur),
    blackout,
    globalBrightness,
    effectiveEffectBrightness: blackout ? 0 : effectiveEffectBrightness(Date.now() / 1000),
    effectiveBrightness: blackout ? 0 : globalBrightness + Math.max(0, kickBoostTarget - globalBrightness) * boostEnvelope.value(Date.now() / 1000),
    kickFlash,
    kickSettings: audioKickAppearance(),
    kickFlashOpacity,
    audio: audioInput.snapshot(),
    kickFlashBrightness,
    kickFlashColor: `#${kickFlashColor.map(v => v.toString(16).padStart(2,'0')).join('')}`,
    scene: selectedScene(),
    scenes: sceneLibrary.scenes,
    selectedSceneId: sceneLibrary.selectedSceneId,
    scenePlayback: {
      active: scenePlayback.active,
      sceneId: scenePlayback.sceneId,
      cueIndex: scenePlayback.cueIndex,
      cueCount: activeScene ? activeScene.cues.length : 0,
    },
    publicMessages: publicMessagesAdminView(),
    shared: {
      scrollPool: shared.scrollPool,
      staticPool: shared.staticPool,
      djName: shared.djName,
      media: mediaMetadata(),
    },
    effects: effectsList.filter(e => !RETIRED_EFFECTS.has(e.name)).map(e => ({
      id:   e.name,
      name: e.name.replace(/_/g, ' '),
      ...getCfg(e.name),
      available: effectAvailable(e),
    })),
  });
});

app.post('/api/public-messages/mode', (req, res) => {
  const result = messageStore.setMode(req.body && req.body.mode);
  if (!result) return res.status(400).json({ error: 'Mode inconnu.' });
  const persisted = saveMessages();
  return res.json({ ok: true, ...result, persisted, publicMessages: publicMessagesAdminView() });
});

app.post('/api/public-messages/settings', (req, res) => {
  const settings = messageStore.setSettings(req.body);
  if (!settings) {
    return res.status(400).json({ error: 'La limite doit être un nombre entier entre 1 et 100.' });
  }
  const persisted = saveMessages();
  return res.json({ ok: true, persisted, publicMessages: publicMessagesAdminView() });
});

app.post('/api/public-messages/:id/approve', (req, res) => {
  const gif = messageStore.getGif(req.params.id);
  if (gif) {
    try { PanelGif.decode(publicGifFiles.read(gif)); }
    catch { return res.status(409).json({ error: 'Ce GIF est illisible ou n’est plus disponible.' }); }
  }
  const item = messageStore.approve(req.params.id);
  if (!item) return res.status(409).json({ error: 'Ce message ne peut pas être validé.' });
  const persisted = saveMessages();
  return res.json({ ok: true, persisted, publicMessages: publicMessagesAdminView() });
});

app.post('/api/public-messages/:id/reject', (req, res) => {
  const item = messageStore.reject(req.params.id);
  if (!item) return res.status(409).json({ error: 'Ce message ne peut pas être retiré.' });
  const persisted = saveMessages();
  return res.json({ ok: true, persisted, publicMessages: publicMessagesAdminView() });
});

app.post('/api/public-messages/:id/replay', (req, res) => {
  const gif = messageStore.getGif(req.params.id);
  if (gif) {
    try { PanelGif.decode(publicGifFiles.read(gif)); }
    catch { return res.status(409).json({ error: 'Ce GIF est illisible ou n’est plus disponible.' }); }
  }
  if (!messageStore.replay(req.params.id)) {
    return res.status(409).json({ error: 'Cet élément doit avoir été joué et la file doit avoir une place libre.' });
  }
  const persisted = saveMessages();
  return res.json({ ok: true, persisted, publicMessages: publicMessagesAdminView() });
});

app.post('/api/public-messages/:id/save-media', (req, res) => {
  const item = messageStore.getItem(req.params.id);
  if (!item || item.kind !== 'gif' || !['approved', 'playing', 'displayed'].includes(item.status)) {
    return res.status(409).json({ error: 'Valide ce GIF avant de l’enregistrer dans la bibliothèque.' });
  }
  let clip = shared.mediaLibrary.entries.find(entry => entry.sourceGifHash === item.gif.hash);
  const existing = !!clip;
  if (!clip) {
    if (shared.mediaLibrary.entries.length >= MEDIA_MAX_ENTRIES) {
      return res.status(409).json({ error: `La bibliothèque est limitée à ${MEDIA_MAX_ENTRIES} médias.` });
    }
    let animation;
    try { animation = PanelGif.decode(publicGifFiles.read(item.gif)); }
    catch { return res.status(409).json({ error: 'Ce GIF est illisible ou n’est plus disponible.' }); }
    const frames = [], durations = [];
    animation.frames.forEach((frame, index) => {
      const encoded = Buffer.from(frame).toString('base64');
      // The media player caps each frame at 2 s. Split long holds without
      // changing the animation timing (at most 127 frames for a public GIF).
      const parts = Math.ceil(animation.durations[index] / 2000);
      for (let part = 0; part < parts; part++) {
        frames.push(encoded);
        durations.push(animation.durations[index] / parts);
      }
    });
    clip = { id: crypto.randomUUID(), version: Date.now(), name: item.text,
      sourceGifHash: item.gif.hash, frames, durations };
    shared.mediaLibrary.entries.push(clip);
    if (!saveMedia()) {
      shared.mediaLibrary.entries.pop();
      return res.status(500).json({ error: 'Impossible d’enregistrer la bibliothèque sur le disque.' });
    }
  }
  getCfg('media').enabled = true;
  saveConfig();
  return res.status(existing ? 200 : 201).json({ ok: true, existing,
    media: mediaMetadata().find(entry => entry.id === clip.id), library: mediaMetadata() });
});

app.post('/api/public-messages/next', (req, res) => {
  const effect = effectMap.public_messages;
  if (!effect || !messageStore.hasApproved()) {
    return res.status(409).json({ error: 'Aucun message validé dans la file.' });
  }
  if (currentEffect === effect && currentState && currentState.done === false) {
    return res.status(409).json({ error: 'Un message public est déjà en cours.' });
  }
  leaveSceneMode();
  switchTo(effect);
  override = true;
  overrideUntil = Date.now() / 1000 + getCfg(effect.name).duration;
  return res.json({ ok: true, playing: effect.name, publicMessages: publicMessagesAdminView() });
});

// POST /api/effects/:id/config
app.post('/api/effects/:id/config', (req, res) => {
  const id = req.params.id;
  if (!effectMap[id]) return res.status(404).json({ error: 'not found' });
  const { duration, freq, brightness, enabled, color, rainbow, speed, reactivity, ball, disableKick, kickSensitivity, forceKickColor, kickColor, kickBrightnessBump } = req.body;
  if (kickBrightnessBump !== undefined && typeof kickBrightnessBump !== 'boolean') return res.status(400).json({ error: 'Option boost invalide.' });
  if ((forceKickColor !== undefined && typeof forceKickColor !== 'boolean') || (kickColor !== undefined && (typeof kickColor !== 'string' || !/^#[a-f0-9]{6}$/i.test(kickColor)))) {
    return res.status(400).json({ error: 'Couleur KICK invalide.' });
  }
  if (kickSensitivity !== undefined && (!['audio_kick_only', 'audio_kick_shockwave'].includes(id) || !Number.isFinite(kickSensitivity) || kickSensitivity < 0.5 || kickSensitivity > 8)) {
    return res.status(400).json({ error: 'Sensibilité KICK invalide : ×0,5 à ×8 sur les visuels KICK uniquement.' });
  }
  if (disableKick !== undefined && (typeof disableKick !== 'boolean' || ['audio_kick_only', 'audio_kick_shockwave'].includes(id))) {
    return res.status(400).json({ error: 'Option KICK invalide pour cet effet.' });
  }
  if (ball !== undefined && (id !== 'audio_spectrum' || typeof ball !== 'boolean')) return res.status(400).json({ error: 'Option balle invalide.' });
  if (reactivity !== undefined && (!Number.isFinite(reactivity) || reactivity < 0.5 || reactivity > 8 || !['audio_scope', 'audio_spectrum', 'audio_mirror', 'audio_pumping_circle', ...require('./lib/halloween').NAMES.map(name => 'audio_' + name)].includes(id))) {
    return res.status(400).json({ error: 'La sensibilité visuelle doit être comprise entre ×0,5 et ×8.' });
  }
  const cfg = getCfg(id);
  if (kickBrightnessBump !== undefined) {
    cfg.kickBrightnessBump = kickBrightnessBump;
    if (currentEffect?.name === id) effectBrightnessEnvelope.clear();
  }
  if (forceKickColor !== undefined) cfg.forceKickColor = forceKickColor;
  if (kickColor !== undefined) cfg.kickColor = kickColor;
  if (kickSensitivity !== undefined) cfg.kickSensitivity = kickSensitivity;
  if (disableKick !== undefined) cfg.disableKick = disableKick;
  if (ball !== undefined) cfg.ball = ball;
  if (reactivity !== undefined) cfg.reactivity = reactivity;
  if (duration   !== undefined) cfg.duration   = Math.max(2, +duration);
  if (freq       !== undefined) cfg.freq       = Math.max(1, +freq);
  if (brightness !== undefined) cfg.brightness = Math.max(0, Math.min(1, +brightness));
  if (enabled    !== undefined) cfg.enabled    = !!enabled;
  if (color      !== undefined) cfg.color      = color;
  if (rainbow    !== undefined) cfg.rainbow    = !!rainbow;
  if (speed      !== undefined) cfg.speed      = Math.max(5, Math.min(200, +speed));
  config[id] = cfg;
  saveConfig();
  res.json({ ok: true, config: cfg });
});

// POST /api/effects/:id/play
app.post('/api/effects/:id/play', (req, res) => {
  const id = req.params.id;
  const effect = effectMap[id];
  if (!effect) return res.status(404).json({ error: 'not found' });
  if (RETIRED_EFFECTS.has(id)) return res.status(409).json({ error: 'Cet effet est mis de côté.' });
  if (!effectAvailable(effect)) return res.status(409).json({ error: 'Active l’audio pour lancer ce visuel.' });
  if (id === 'public_messages' && !messageStore.hasApproved()) {
    return res.status(409).json({ error: 'Aucun message validé dans la file.' });
  }
  leaveSceneMode();
  switchTo(effect);
  override      = true;
  overrideUntil = Date.now() / 1000 + getCfg(id).duration;
  res.json({ ok: true, playing: id });
});

// POST /api/text/:type/:index/play — play one exact entry from either text pool.
app.post('/api/text/:type/:index/play', (req, res) => {
  const type = req.params.type;
  const index = Number(req.params.index);
  const pool = type === 'scroll' ? shared.scrollPool : type === 'static' ? shared.staticPool : null;
  const effect = effectMap[type === 'scroll' ? 'scroll_text' : type === 'static' ? 'static_text' : ''];
  if (!pool || !effect) return res.status(404).json({ error: 'Type de texte inconnu.' });
  if (!Number.isInteger(index) || index < 0 || index >= pool.length) {
    return res.status(404).json({ error: 'Message introuvable.' });
  }
  const source = pool[index];
  if (!source || typeof source.text !== 'string' || !source.text.trim()) {
    return res.status(400).json({ error: 'Ce message est vide.' });
  }
  const entry = {
    text: source.text,
    color: /^#[0-9a-f]{6}$/i.test(source.color || '') ? source.color : '#ffffff',
    rainbow: !!source.rainbow,
  };
  leaveSceneMode();
  switchTo(effect, { entry });
  override = true;
  overrideUntil = Date.now() / 1000 + getCfg(effect.name).duration;
  return res.json({ ok: true, playing: effect.name, index, text: entry.text });
});

// Scene library and playback controls. Stopping returns to AUTO mode.
app.post('/api/scene', (req, res) => {
  const requestedId = req.body && req.body.id;
  const index = sceneLibrary.scenes.findIndex(item => item.id === requestedId);
  if (index < 0) return res.status(404).json({ error: 'Scène introuvable.' });
  const scene = normalizeScene(req.body, requestedId);
  scene.id = requestedId;
  sceneLibrary.scenes[index] = scene;
  if (scenePlayback.active && scenePlayback.sceneId === scene.id) {
    if (scenePlayback.cueIndex >= scene.cues.length) finishScene();
    else applyActiveCueLook();
  }
  const persisted = saveScene();
  return res.json({ ok: true, scene, persisted });
});

app.post('/api/scenes', (req, res) => {
  if (sceneLibrary.scenes.length >= SCENE_MAX_ENTRIES) {
    return res.status(409).json({ error: `La bibliothèque est limitée à ${SCENE_MAX_ENTRIES} scènes.` });
  }
  const scene = normalizeScene({
    id: crypto.randomUUID(),
    name: req.body && req.body.name,
    loop: false,
    cues: [],
  });
  sceneLibrary.scenes.push(scene);
  sceneLibrary.selectedSceneId = scene.id;
  const persisted = saveScene();
  return res.status(201).json({
    ok: true,
    scene,
    scenes: sceneLibrary.scenes,
    selectedSceneId: sceneLibrary.selectedSceneId,
    persisted,
  });
});

app.post('/api/scenes/:id/select', (req, res) => {
  const scene = sceneLibrary.scenes.find(item => item.id === req.params.id);
  if (!scene) return res.status(404).json({ error: 'Scène introuvable.' });
  sceneLibrary.selectedSceneId = scene.id;
  const persisted = saveScene();
  return res.json({ ok: true, scene, selectedSceneId: scene.id, persisted });
});

app.delete('/api/scenes/:id', (req, res) => {
  if (sceneLibrary.scenes.length <= 1) {
    return res.status(409).json({ error: 'Il faut conserver au moins une scène.' });
  }
  if (scenePlayback.active && scenePlayback.sceneId === req.params.id) {
    return res.status(409).json({ error: 'Arrête cette scène avant de la supprimer.' });
  }
  const index = sceneLibrary.scenes.findIndex(item => item.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Scène introuvable.' });
  sceneLibrary.scenes.splice(index, 1);
  if (sceneLibrary.selectedSceneId === req.params.id) {
    sceneLibrary.selectedSceneId = sceneLibrary.scenes[Math.min(index, sceneLibrary.scenes.length - 1)].id;
  }
  const persisted = saveScene();
  return res.json({
    ok: true,
    scene: selectedScene(),
    scenes: sceneLibrary.scenes,
    selectedSceneId: sceneLibrary.selectedSceneId,
    persisted,
  });
});

app.post('/api/scene/play', (req, res) => {
  const scene = selectedScene();
  if (!scene.cues.length) return res.status(400).json({ error: 'La scène ne contient aucun cue.' });
  scenePlayback.sceneId = scene.id;
  playSceneCue(0);
  return res.json({ ok: true, sceneId: scene.id, cueIndex: scenePlayback.cueIndex, playing: currentEffect.name });
});

app.post('/api/scene/stop', (req, res) => {
  if (scenePlayback.active) finishScene();
  return res.json({ ok: true, mode: 'auto', playing: currentEffect && currentEffect.name });
});

app.post('/api/scene/next', (req, res) => {
  if (!scenePlayback.active) return res.status(409).json({ error: 'La scène n’est pas en lecture.' });
  advanceScene(1);
  return res.json({ ok: true, active: scenePlayback.active, cueIndex: scenePlayback.cueIndex });
});

app.post('/api/scene/previous', (req, res) => {
  if (!scenePlayback.active) return res.status(409).json({ error: 'La scène n’est pas en lecture.' });
  advanceScene(-1);
  return res.json({ ok: true, active: scenePlayback.active, cueIndex: scenePlayback.cueIndex });
});

// POST /api/media — frames are pre-scaled by the browser to RGB 60x15.
app.post('/api/media', (req, res) => {
  const body = req.body || {};
  const frames = Array.isArray(body.frames) ? body.frames : [];
  if (shared.mediaLibrary.entries.length >= MEDIA_MAX_ENTRIES) {
    return res.status(409).json({ error: `La bibliothèque est limitée à ${MEDIA_MAX_ENTRIES} médias.` });
  }
  if (!frames.length || frames.length > MEDIA_MAX_FRAMES) {
    return res.status(400).json({ error: `1 à ${MEDIA_MAX_FRAMES} images attendues.` });
  }

  const normalizedFrames = [];
  for (const encoded of frames) {
    if (typeof encoded !== 'string') return res.status(400).json({ error: 'Image invalide.' });
    const decoded = Buffer.from(encoded, 'base64');
    if (decoded.length !== MEDIA_FRAME_BYTES || decoded.toString('base64') !== encoded) {
      return res.status(400).json({ error: `Chaque image doit contenir ${MEDIA_FRAME_BYTES} octets RGB.` });
    }
    normalizedFrames.push(encoded);
  }

  const durations = normalizedFrames.map((_, index) => {
    const duration = Number(body.durations && body.durations[index]);
    return Number.isFinite(duration) ? Math.round(Math.max(20, Math.min(2000, duration))) : 100;
  });
  const cleanName = path.basename(String(body.name || 'media')).slice(0, 120);
  const clip = {
    id: crypto.randomUUID(),
    version: Date.now(),
    name: cleanName,
    frames: normalizedFrames,
    durations,
  };
  shared.mediaLibrary.entries.push(clip);
  const persisted = saveMedia();

  const effect = effectMap.media;
  if (effect) {
    leaveSceneMode();
    switchTo(effect, { mediaId: clip.id });
    override = true;
    overrideUntil = Date.now() / 1000 + getCfg(effect.name).duration;
  }
  const library = mediaMetadata();
  return res.status(201).json({
    ok: true,
    media: library.find(item => item.id === clip.id),
    library,
    playing: !!effect,
    persisted,
  });
});

app.post('/api/media/:id/weight', (req, res) => {
  const clip = shared.mediaLibrary.entries.find(item => item.id === req.params.id);
  if (!clip) return res.status(404).json({ error: 'Média introuvable.' });
  if (!Number.isInteger(req.body.weight) || req.body.weight < 1 || req.body.weight > 10) return res.status(400).json({ error: 'Poids attendu : entier de 1 à 10.' });
  const previous = clip.weight;
  clip.weight = req.body.weight;
  if (!saveMedia()) {
    clip.weight = previous;
    return res.status(500).json({ error: 'Impossible de sauvegarder le poids.' });
  }
  return res.json({ ok: true, library: mediaMetadata() });
});

app.post('/api/media/:id/kick-overlay', (req, res) => {
  const clip = shared.mediaLibrary.entries.find(item => item.id === req.params.id);
  if (!clip) return res.status(404).json({ error: 'Média introuvable.' });
  if (typeof req.body.disableKick !== 'boolean') return res.status(400).json({ error: 'Option KICK invalide.' });
  const previous = clip.disableKick;
  clip.disableKick = req.body.disableKick;
  if (!saveMedia()) {
    clip.disableKick = previous;
    return res.status(500).json({ error: 'Impossible de sauvegarder le réglage KICK.' });
  }
  return res.json({ ok: true, library: mediaMetadata() });
});

app.post('/api/media/:id/kick-color', (req, res) => {
  const clip = shared.mediaLibrary.entries.find(item => item.id === req.params.id);
  if (!clip) return res.status(404).json({ error: 'Média introuvable.' });
  const { forceKickColor, kickColor } = req.body;
  if (typeof forceKickColor !== 'boolean' || typeof kickColor !== 'string' || !/^#[a-f0-9]{6}$/i.test(kickColor)) return res.status(400).json({ error: 'Couleur KICK invalide.' });
  const previous = { forceKickColor: clip.forceKickColor, kickColor: clip.kickColor };
  Object.assign(clip, { forceKickColor, kickColor });
  if (!saveMedia()) {
    Object.assign(clip, previous);
    return res.status(500).json({ error: 'Impossible de sauvegarder la couleur KICK.' });
  }
  return res.json({ ok: true, library: mediaMetadata() });
});

app.post('/api/media/:id/enabled', (req, res) => {
  const clip = shared.mediaLibrary.entries.find(item => item.id === req.params.id);
  if (!clip) return res.status(404).json({ error: 'Media introuvable.' });
  if (typeof req.body.enabled !== 'boolean') return res.status(400).json({ error: 'enabled doit etre un booleen.' });
  const previous = clip.enabled;
  clip.enabled = req.body.enabled;
  if (!saveMedia()) {
    clip.enabled = previous;
    return res.status(500).json({ error: 'Impossible de sauvegarder la selection.' });
  }
  return res.json({ ok: true, library: mediaMetadata() });
});

app.post('/api/media/:id/play', (req, res) => {
  const clip = shared.mediaLibrary.entries.find(item => item.id === req.params.id);
  const effect = effectMap.media;
  if (!clip || !effect) return res.status(404).json({ error: 'Média introuvable.' });
  leaveSceneMode();
  switchTo(effect, { mediaId: clip.id });
  override = true;
  overrideUntil = Date.now() / 1000 + getCfg(effect.name).duration;
  return res.json({ ok: true, playing: effect.name, media: clip.id });
});

app.delete('/api/media/:id', (req, res) => {
  if (sceneLibrary.scenes.some(scene => scene.cues.some(cue => cue.mediaId === req.params.id))) {
    return res.status(409).json({ error: 'Ce média est utilisé dans la scène.' });
  }
  const index = shared.mediaLibrary.entries.findIndex(item => item.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Média introuvable.' });
  shared.mediaLibrary.entries.splice(index, 1);
  const persisted = saveMedia();
  return res.json({ ok: true, library: mediaMetadata(), persisted });
});

// POST /api/next
app.post('/api/next', (req, res) => {
  if (scenePlayback.active) {
    advanceScene(1);
    return res.json({
      ok: true,
      mode: scenePlayback.active ? 'scene' : 'auto',
      cueIndex: scenePlayback.cueIndex,
      playing: currentEffect.name,
    });
  }
  override = false;
  switchTo(pickNextEffect());
  res.json({ ok: true, playing: currentEffect.name });
});

// POST /api/blackout   body: { on: bool }  (omit to toggle)
app.post('/api/blackout', (req, res) => {
  if (req.body && req.body.on !== undefined) {
    blackout = !!req.body.on;
  } else {
    blackout = !blackout;
  }
  res.json({ ok: true, blackout });
});

// POST /api/brightness  body: { value: 0..1 }
app.post('/api/brightness', (req, res) => {
  const v = parseFloat(req.body && req.body.value);
  if (!isNaN(v)) globalBrightness = Math.max(0, Math.min(1, v));
  res.json({ ok: true, globalBrightness });
});

// POST /api/event
// Manual and audio triggers use the same saved overlay and duration.
// { type:'kick', on:false } cancels active overlays for legacy clients.
app.post('/api/event', (req, res) => {
  const body = req.body || {};
  if (body.type === 'kick') {
    if (body.on === false) {
      kickFlash = false;
      kickOverlay.clear();
    boostEnvelope.clear(); flashEnvelope.clear(); effectBrightnessEnvelope.clear();
    } else {
      triggerAudioKick();
    }
  }
  res.json({ ok: true });
});

// POST /api/text
app.post('/api/text', (req, res) => {
  const { scrollPool, staticPool, djName } = req.body || {};
  if (Array.isArray(scrollPool) && scrollPool.length) shared.scrollPool = scrollPool;
  if (Array.isArray(staticPool)  && staticPool.length)  shared.staticPool  = staticPool;
  if (djName !== undefined) shared.djName = djName;
  saveText();
  res.json({ ok: true, shared: { ...shared } });
});

// ── HTTP server ────────────────────────────────────────────────────────────────
const os = require('os');
app.listen(PORT, '0.0.0.0', () => {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push({ name, address: iface.address });
    }
  }
  console.log(`\n Panel Controller running on http://localhost:${PORT}`);
  if (ips.length) {
    console.log(' Remote access (phone / other devices):');
    ips.forEach(({ name, address }) =>
      console.log(`   http://${address}:${PORT}  (${name})`));
  }
  console.log(` ArtNet → ${TARGET_IP}:${ARTNET_PORT} (universes ${BASE_UNIVERSE}–${BASE_UNIVERSE + UNIVERSE_COUNT - 1})`);
  console.log(` Panel: ${W}×${H}  FPS: ${FPS}\n`);
});
