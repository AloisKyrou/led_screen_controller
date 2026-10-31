'use strict';

const { spawn } = require('child_process');
const RATE = 16000, SIZE = 1024, HOP = 512, BANDS = 15;
const WINDOW = Float64Array.from({ length: SIZE }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (SIZE - 1)));
const COS = Float64Array.from({ length: SIZE / 2 }, (_, i) => Math.cos(-2 * Math.PI * i / SIZE));
const SIN = Float64Array.from({ length: SIZE / 2 }, (_, i) => Math.sin(-2 * Math.PI * i / SIZE));
const defaults = { enabled: false, source: 'microphone', device: 'default', gain: 2,
  noiseGate: 0.008, sensitivity: 1.8, kickAdaptive: false, kickAdaptiveSensitivity: 1, kickEnabled: false, kickIntervalMs: 160,
  kickUnified: true, kickRainbow: false, kickColor: '#ffffff', kickBrightness: 1, kickDurationMs: 120,
  kickAttackMs: 0, kickReleaseMs: 300, kickBoostEnabled: false, kickBoostTarget: 1,
  kickVisual: 'flash', waveDurationMs: 500, kickOpacity: 1 };

function validateSettings(value) {
  const next = { ...defaults, ...value };
  if (typeof next.kickAdaptive !== 'boolean' || typeof next.kickBoostEnabled !== 'boolean' || typeof next.enabled !== 'boolean' || typeof next.kickEnabled !== 'boolean' || typeof next.kickRainbow !== 'boolean' || next.kickUnified !== true ||
      !/^#[a-f0-9]{6}$/i.test(next.kickColor) ||
      !['flash', 'shockwave', 'brightness'].includes(next.kickVisual) ||
      !['microphone', 'demo'].includes(next.source) || typeof next.device !== 'string' ||
      !/^[a-zA-Z0-9_:,.= -]{1,120}$/.test(next.device)) throw new Error('Configuration audio invalide.');
  for (const [key, min, max] of [['kickAdaptiveSensitivity', 0.5, 4], ['gain', 0.1, 20], ['noiseGate', 0.001, 0.2], ['sensitivity', 0.5, 4],
    ['kickAttackMs', 0, 2000], ['kickReleaseMs', 0, 3000], ['kickBoostTarget', 0, 1], ['kickIntervalMs', 80, 500], ['kickBrightness', 0, 1], ['kickOpacity', 0, 1], ['kickDurationMs', 40, 300], ['waveDurationMs', 150, 1200]]) {
    if (!Number.isFinite(next[key]) || next[key] < min || next[key] > max) throw new Error(`Réglage audio invalide : ${key}.`);
  }
  return Object.fromEntries(Object.keys(defaults).map(key => [key, next[key]]));
}

// 64 ms FFT windows, refreshed every 32 ms (50% overlap).
function spectrum(samples) {
  const re = new Float64Array(SIZE), im = new Float64Array(SIZE);
  for (let i = 0; i < SIZE; i++) re[i] = samples[i] * WINDOW[i];
  for (let i = 1, j = 0; i < SIZE; i++) {
    let bit = SIZE >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let len = 2; len <= SIZE; len <<= 1) {
    for (let start = 0; start < SIZE; start += len) {
      for (let j = 0; j < len / 2; j++) {
        const a = start + j, b = a + len / 2;
        const c = COS[j * SIZE / len], s = SIN[j * SIZE / len];
        const r = re[b] * c - im[b] * s, v = re[b] * s + im[b] * c;
        re[b] = re[a] - r; im[b] = im[a] - v; re[a] += r; im[a] += v;
      }
    }
  }
  return Array.from({ length: SIZE / 2 }, (_, i) => Math.hypot(re[i], im[i]) * 4 / SIZE);
}

function createAnalyzer() {
  let baseline = 0, previousBass = 0, started = null, lastBeat = -Infinity;
  let valley = 0, peakBass = 0, armed = true;
  const bassHistory = [];
  let adaptiveThreshold = 0;
  return (samples, settings, now, kickSensitivity = 1) => {
    const visualGain = Number.isFinite(kickSensitivity) ? Math.max(0.5, Math.min(8, kickSensitivity)) : 1;
    const detectionGain = visualGain * (settings.kickAdaptive ? (settings.kickAdaptiveSensitivity ?? 1) : 1);
    const magnitudes = spectrum(samples);
    let sum = 0, peak = 0;
    for (const sample of samples) { sum += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
    const rms = Math.sqrt(sum / SIZE), audible = rms * settings.gain >= settings.noiseGate;
    const bands = Array.from({ length: BANDS }, (_, band) => {
      const low = Math.max(1, Math.floor(45 * Math.pow(7000 / 45, band / BANDS) * SIZE / RATE));
      const high = Math.max(low + 1, Math.ceil(45 * Math.pow(7000 / 45, (band + 1) / BANDS) * SIZE / RATE));
      const amplitude = Math.max(...magnitudes.slice(low, high)) * settings.gain;
      return audible ? Math.max(0, Math.min(1, (20 * Math.log10(Math.max(1e-8, amplitude)) + 60) / 60)) : 0;
    });
    const bass = Math.sqrt(magnitudes.slice(3, 12).reduce((sum, v) => sum + v * v, 0)) * settings.gain;
    if (started === null) started = now;
    const ready = now - started >= 384;
    // Robust recent bass floor + variation, independent of treble and kick count.
    // The current onset is excluded so it cannot raise its own threshold.
    const ordered = [...bassHistory].sort((a, b) => a - b);
    const median = ordered[Math.floor(ordered.length / 2)] || 0;
    const deviations = ordered.map(value => Math.abs(value - median)).sort((a, b) => a - b);
    const deviation = deviations[Math.floor(deviations.length / 2)] || 0;
    const targetThreshold = Math.max(settings.noiseGate, median + deviation * 3, baseline * 0.85);
    adaptiveThreshold += (targetThreshold - adaptiveThreshold) * 0.15;
    const baseThreshold = settings.kickAdaptive
      ? Math.max(settings.noiseGate, adaptiveThreshold)
      : Math.max(settings.noiseGate, baseline * settings.sensitivity);
    const threshold = Math.max(settings.noiseGate, baseThreshold / detectionGain);
    bassHistory.push(bass);
    if (bassHistory.length > 64) bassHistory.shift();
    peakBass = Math.max(peakBass, bass);
    if (!armed && bass < peakBass * 0.85) { armed = true; valley = bass; }
    valley = Math.min(valley, bass);
    const attack = bass > previousBass && bass - valley > Math.max(settings.noiseGate * 0.5, baseline * 0.08 / detectionGain);
    const interval = settings.kickIntervalMs ?? defaults.kickIntervalMs;
    const beat = ready && audible && bass > threshold && attack && armed && now - lastBeat >= interval;
    // Limit the influence of individual peaks on the background estimate.
    baseline += (Math.min(bass, Math.max(settings.noiseGate, baseline * 3)) - baseline) * 0.04;
    previousBass = bass;
    if (beat) { lastBeat = now; armed = false; peakBass = bass; valley = bass; }
    // Trigger the trace at a rising zero crossing to reduce horizontal jitter.
    let start = 0;
    for (let i = 1; i < SIZE / 2; i++) {
      if (samples[i - 1] <= 0 && samples[i] > 0) { start = i; break; }
    }
    const waveform = Array.from({ length: 60 }, (_, x) => {
      let value = 0;
      for (let i = 0; i < 8; i++) value += samples[start + x * 8 + i];
      return audible ? Math.max(-1, Math.min(1, value / 8 * settings.gain * 2)) : 0;
    });
    return { bands, waveform, rms: Math.min(1, rms * settings.gain), clipping: peak >= 0.98, beat,
      detection: { bass, threshold, sensitivityMultiplier: detectionGain, adaptive: !!settings.kickAdaptive, ratio: bass / threshold, audible, ready, attack, armed,
        cooldownMs: Math.max(0, interval - (now - lastBeat)), bandHz: [46.875, 171.875] } };
  };
}

function createAudioInput(initial, onBeat, options = {}) {
  let settings;
  try { settings = validateSettings(initial); } catch { settings = { ...defaults }; }
  const launch = options.spawn || spawn;
  let child = null, retry = null, timer = null, watchdog = null, generation = 0;
  let analyze = createAnalyzer(), pending = Buffer.alloc(0), lastData = 0, demoTime = 0, sampleTime = 0;
  let state = { status: 'disabled', error: '', bands: Array(BANDS).fill(0), waveform: Array(60).fill(0),
    rms: 0, clipping: false, lastBeat: 0, beatCount: 0, detection: null };
  function clearSignal() {
    state.bands = Array(BANDS).fill(0); state.waveform = Array(60).fill(0);
    state.rms = 0; state.clipping = false; state.beat = false; state.detection = null;
  }
  function feed(bytes) {
    pending = Buffer.concat([pending, bytes]);
    while (pending.length >= SIZE * 2) {
      const samples = new Float64Array(SIZE);
      for (let i = 0; i < SIZE; i++) samples[i] = pending.readInt16LE(i * 2) / 32768;
      pending = pending.subarray(HOP * 2);
      lastData = Date.now();
      const result = analyze(samples, settings, sampleTime, options.kickSensitivity?.() ?? 1);
      sampleTime += HOP / RATE * 1000;
      Object.assign(state, result, { status: settings.source === 'demo' ? 'demo' : 'listening', error: '' });
      if (result.beat) { state.lastBeat = lastData; state.beatCount++; if (settings.kickEnabled || options.shouldTrigger?.()) onBeat(); }
    }
  }
  function stop() {
    generation++;
    clearTimeout(retry); clearInterval(timer); clearInterval(watchdog);
    retry = timer = watchdog = null;
    if (child) { child.kill(); child = null; }
    pending = Buffer.alloc(0); analyze = createAnalyzer(); sampleTime = 0; clearSignal();
    state.status = 'disabled'; state.error = ''; state.lastBeat = 0; state.beatCount = 0;
  }
  function start() {
    if (!settings.enabled) return;
    const token = generation;
    if (settings.source === 'demo') {
      timer = setInterval(() => {
        const bytes = Buffer.alloc(HOP * 2);
        for (let i = 0; i < HOP; i++, demoTime++) {
          const t = demoTime / RATE, envelope = Math.exp(-(t % 0.5) * 35);
          const sample = envelope * 0.55 * Math.sin(2 * Math.PI * 70 * t) +
            0.05 * Math.sin(2 * Math.PI * 450 * t) + 0.025 * Math.sin(2 * Math.PI * 2400 * t);
          bytes.writeInt16LE(Math.round(sample * 32767), i * 2);
        }
        feed(bytes);
      }, HOP / RATE * 1000);
      return;
    }
    state.status = 'starting'; lastData = Date.now();
    child = launch('arecord', ['-q', '-D', settings.device, '-t', 'raw', '-f', 'S16_LE', '-r', String(RATE), '-c', '1', '--buffer-time=100000', '--period-time=32000'],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let diagnostic = '', failed = false;
    function fail(message) {
      if (token !== generation || failed) return;
      failed = true;
      clearInterval(watchdog); watchdog = null;
      if (child) { child.kill(); child = null; }
      clearSignal(); pending = Buffer.alloc(0); analyze = createAnalyzer();
      state.status = 'error'; state.error = message.slice(0, 400);
      retry = setTimeout(start, 5000);
    }
    child.stdout.on('data', bytes => { if (token === generation && !failed) feed(bytes); });
    child.stderr.on('data', bytes => { diagnostic = (diagnostic + bytes.toString()).slice(-400); });
    child.on('error', error => fail(error.code === 'ENOENT' ? 'arecord introuvable : installer alsa-utils sur le Pi.' : error.message));
    child.on('close', () => fail(diagnostic || 'Microphone déconnecté ou indisponible.'));
    watchdog = setInterval(() => { if (Date.now() - lastData > 3000) fail('Aucun signal reçu du microphone.'); }, 1000);
  }
  start();
  return {
    configure(value) {
      const next = validateSettings({ ...settings, ...value });
      const restart = ['enabled', 'source', 'device', 'gain'].some(key => next[key] !== settings[key]);
      if (restart) stop();
      settings = next;
      if (restart) start();
    },
    stop,
    snapshot() { return { ...state, bands: [...state.bands], waveform: [...state.waveform], settings: { ...settings } }; },
  };
}

module.exports = { createAudioInput, createAnalyzer, validateSettings, defaults, RATE, SIZE, HOP };
