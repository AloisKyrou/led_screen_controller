'use strict';
// panel_controller/server.js
// Node.js ArtNet LED panel server + REST API + web UI
// Requires: npm install express  (or NODE_PATH pointing to global express)

const path    = require('path');
const fs      = require('fs');
const dgram   = require('dgram');
const express = require('express');

// ── Panel geometry ─────────────────────────────────────────────────────────────
const W                 = 60;
const H                 = 15;
const SERPENTINE_ROWS   = true;
const TARGET_IP         = '255.255.255.255';
const ARTNET_PORT       = 6454;
const BASE_UNIVERSE     = 6;
const UNIVERSE_COUNT    = 6;
const PIXELS_PER_UNI    = 150;
const DMX_LEN           = 512;
const FPS               = 30;
const PORT              = 3000;

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
  nools:               { duration: 15, freq: 1,  rainbow: true,  color: '#ff8800' },
  fete_trouble:        { duration: 15, freq: 1,  rainbow: true,  color: '#c36a04' },
  simple_firework:     { duration: 12, freq: 4,  rainbow: true,  color: '#ff4400' },
  fading_pixel:        { duration: 12, freq: 1,  rainbow: true,  color: '#ffffff' },
  bouncing_balls:      { duration: 10, freq: 5,  rainbow: true,  color: '#00a3f5' },
  pumping_circle:      { duration: 10, freq: 2,  rainbow: true,  color: '#ff0080' },
  scroll_text:         { duration: 12, freq: 3 },
  static_text:         { duration: 10, freq: 2 },
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
    { duration: 10, freq: 3, brightness: 1, enabled: true },
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
let savedText = {};
try { savedText = JSON.parse(fs.readFileSync(TEXT_PATH, 'utf8')); } catch {}

const shared = {
  scrollPool: savedText.scrollPool || [{ text: 'NOOLS', color: '#ffffff', rainbow: false }],
  staticPool:  savedText.staticPool  || [{ text: 'NOOLS', color: '#ff8800', rainbow: false }],
  djName:      savedText.djName      || '',
};

function saveText() {
  try { fs.writeFileSync(TEXT_PATH, JSON.stringify({ scrollPool: shared.scrollPool, staticPool: shared.staticPool, djName: shared.djName }, null, 2)); } catch {}
}

let currentEffect    = null;
let currentState     = null;
let effectStartTime  = 0;
let blackout         = false;
let globalBrightness = 1.0;
let kickFlash        = false;
let kickFlashEnd     = 0;
let kickFlashColor      = [255, 255, 255];
let kickFlashBrightness = 1.0;

function hexToRgbArray(hex) {
  hex = (hex || '#ffffff').replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
  const n = parseInt(hex, 16) || 0;
  return [(n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF];
}

// Override: force-play an effect for at least `until` seconds
let override         = false;
let overrideUntil    = 0;

function getCfg(name) {
  const c = config[name] || { duration: 10, freq: 3, brightness: 1, enabled: true };
  // Normalize legacy rarity field on the fly
  if (c.rarity !== undefined && c.freq === undefined) c.freq = c.rarity;
  return c;
}

function enabledEffects() {
  return effectsList.filter(e => getCfg(e.name).enabled);
}

function pickNextEffect() {
  const pool = enabledEffects();
  if (!pool.length) return effectsList[0] || null;
  const total = pool.reduce((s, e) => s + getCfg(e.name).freq, 0);
  let rand = Math.random() * total;
  for (const e of pool) {
    rand -= getCfg(e.name).freq;
    if (rand <= 0) return e;
  }
  return pool[pool.length - 1];
}

function switchTo(effect) {
  if (!effect) return;
  currentEffect   = effect;
  effectStartTime = Date.now() / 1000;
  try {
    currentState = effect.init(W, H, getCfg(effect.name), shared);
  } catch(e) {
    console.error(`init error for ${effect.name}:`, e);
    currentState = {};
  }
  console.log(`▶ ${effect.name}`);
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
    sendFrame(new Uint8Array(H * W * 3));
    return;
  }

  // Kick flash override → kickFlashColor × brightness
  if (kickFlash) {
    const fb = new Uint8Array(H * W * 3);
    const kbright = kickFlashBrightness * globalBrightness;
    const kr = Math.round(kickFlashColor[0] * kbright);
    const kg = Math.round(kickFlashColor[1] * kbright);
    const kb = Math.round(kickFlashColor[2] * kbright);
    for (let i = 0; i < H * W; i++) { fb[i*3] = kr; fb[i*3+1] = kg; fb[i*3+2] = kb; }
    sendFrame(fb);
    return;
  }

  // Auto-advance — also wait for effect to signal done (e.g. scroll_text completing one full pass)
  if (!override || now > overrideUntil) {
    override = false;
    const t = now - effectStartTime;
    const dur = getCfg(currentEffect.name).duration;
    const effectReady = currentState.done !== false; // false means "not yet done"; undefined/true = ok
    if (t >= dur && effectReady) switchTo(pickNextEffect());
  }

  // Render
  let pixelBuf;
  try {
    const t = now - effectStartTime;
    pixelBuf = currentEffect.frame(currentState, t, dt, getCfg(currentEffect.name), shared);
  } catch(e) {
    console.error(`frame error ${currentEffect.name}:`, e.message);
    pixelBuf = new Uint8Array(H * W * 3);
  }

  // Apply brightness (per-effect × global)
  const bright = getCfg(currentEffect.name).brightness * globalBrightness;
  if (bright < 1) {
    for (let i = 0; i < pixelBuf.length; i++) pixelBuf[i] = (pixelBuf[i] * bright) | 0;
  }

  sendFrame(pixelBuf);
}, 1000 / FPS);

// ── REST API ───────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// GET /api/state
app.get('/api/state', (req, res) => {
  const now     = Date.now() / 1000;
  const elapsed = currentEffect ? now - effectStartTime : 0;
  const dur     = currentEffect ? getCfg(currentEffect.name).duration : 1;
  res.json({
    currentEffectId:   currentEffect ? currentEffect.name : null,
    currentEffectName: currentEffect ? currentEffect.name.replace(/_/g, ' ') : '—',
    elapsed,
    duration: dur,
    progress: Math.min(1, elapsed / dur),
    blackout,
    globalBrightness,
    kickFlash,
    kickFlashBrightness,
    kickFlashColor: `#${kickFlashColor.map(v => v.toString(16).padStart(2,'0')).join('')}`,
    shared: { ...shared },
    effects: effectsList.map(e => ({
      id:   e.name,
      name: e.name.replace(/_/g, ' '),
      ...getCfg(e.name),
    })),
  });
});

// POST /api/effects/:id/config
app.post('/api/effects/:id/config', (req, res) => {
  const id = req.params.id;
  if (!effectMap[id]) return res.status(404).json({ error: 'not found' });
  const { duration, freq, brightness, enabled, color, rainbow, speed } = req.body;
  const cfg = getCfg(id);
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
  switchTo(effect);
  override      = true;
  overrideUntil = Date.now() / 1000 + getCfg(id).duration;
  res.json({ ok: true, playing: id });
});

// POST /api/next
app.post('/api/next', (req, res) => {
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
// { type:'kick' }              → 180ms flash (TD compat)
// { type:'kick', on:true,  color:'#ff0000' } → hold until released
// { type:'kick', on:false }  → stop immediately
app.post('/api/event', (req, res) => {
  const body = req.body || {};
  if (body.type === 'kick') {
    if (body.color) kickFlashColor = hexToRgbArray(body.color);
    if (body.brightness !== undefined) kickFlashBrightness = Math.max(0, Math.min(1, +body.brightness));
    if (body.on === false) {
      kickFlash = false;
    } else if (body.on === true) {
      kickFlash    = true;
      kickFlashEnd = Date.now() / 1000 + 30; // held — auto-release safety
    } else {
      kickFlash    = true;
      kickFlashEnd = Date.now() / 1000 + 0.18; // 180ms (TD compat)
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
