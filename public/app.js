'use strict';
// Panel Controller — app.js

let state      = null;
let scrollPool = [{ text: 'NOOLS', color: '#ffffff', rainbow: false }];
let staticPool = [{ text: 'NOOLS', color: '#ff8800', rainbow: false }];
let mediaEntries = [];
let sceneLibrary = [];
let selectedSceneId = null;
let sceneConfig = { id: 'scene-1', name: 'SCÈNE 1', loop: false, cues: [] };
let sceneLoaded = false;
let sceneSaveQueue = Promise.resolve();
let publicMessageFingerprint = '';

// ── API helper ──────────────────────────────────────────────────────────────
async function api(url, method = 'GET', body = null) {
  const opts = { method, headers: {} };
  if (body !== null) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  try {
    const res = await fetch(url, opts);
    if (res.status === 401) {
      window.location.assign('/admin/login');
      return null;
    }
    const contentType = res.headers.get('content-type') || '';
    const result = contentType.includes('application/json') ? await res.json() : null;
    if (!res.ok) {
      console.warn(`${method} ${url} → ${res.status}`, result || res.statusText);
      return null;
    }
    return result;
  } catch (e) { console.warn(url, e); }
}

// ── State poll ──────────────────────────────────────────────────────────────
async function poll() {
  const s = await api('/api/state');
  if (!s) return;
  if (!audioLatest) renderAudio(s.audio);

  // Build or update effect cards
  if (!state || state.effects.length !== s.effects.length) {
    buildEffectList(s.effects);
  } else {
    s.effects.forEach(updateEffectRow);
  }

  // Header
  document.getElementById('nowName').textContent = s.currentEffectName || '—';
  const pct = Math.min(100, Math.round(s.progress * 100));
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('timeLabel').textContent =
    `${Math.floor(s.elapsed)}s / ${Math.round(s.duration)}s`;

  // Master brightness slider — only sync if not being dragged
  const mbSlider = document.getElementById('masterBright');
  if (document.activeElement !== mbSlider) {
    const pct = Math.round((s.globalBrightness ?? 1) * 100);
    mbSlider.value = pct;
    document.getElementById('masterBrightVal').textContent = pct + '%';
  }

  // Blackout button
  const bb = document.getElementById('blackoutBtn');
  bb.classList.toggle('on', !!s.blackout);
  bb.style.background = s.blackout ? '#d32' : '';

  // Highlight active card
  document.querySelectorAll('.effect-card').forEach(el =>
    el.classList.toggle('active-card', el.dataset.id === s.currentEffectId));

  // Sync pools from server on first load
  if (!state && s.shared) {
    if (s.shared.scrollPool && s.shared.scrollPool.length) {
      scrollPool = s.shared.scrollPool;
      renderPool('scroll');
    }
    if (s.shared.staticPool && s.shared.staticPool.length) {
      staticPool = s.shared.staticPool;
      renderPool('static');
    }
  }

  if (s.shared && Array.isArray(s.shared.media)) {
    const before = mediaEntries.map(item => `${item.id}:${item.name}:${item.frameCount}:${item.enabled}`).join('|');
    const after = s.shared.media.map(item => `${item.id}:${item.name}:${item.frameCount}:${item.enabled}`).join('|');
    if (before !== after) {
      mediaEntries = s.shared.media;
      renderMediaLibrary();
      if (sceneLoaded) refreshSceneEffectOptions(s.effects);
      if (!preparedMedia) {
        setMediaStatus(mediaEntries.length
          ? `${mediaEntries.length} média${mediaEntries.length > 1 ? 's' : ''} mémorisé${mediaEntries.length > 1 ? 's' : ''}.`
          : 'Choisis une image ou un GIF. Il sera converti en 60×15 dans ce navigateur.');
      }
    }
  }

  if (!sceneLoaded && s.scene) {
    sceneLibrary = Array.isArray(s.scenes) && s.scenes.length ? s.scenes : [s.scene];
    selectedSceneId = s.selectedSceneId || s.scene.id || sceneLibrary[0].id;
    sceneConfig = sceneLibrary.find(scene => scene.id === selectedSceneId) || sceneLibrary[0];
    selectedSceneId = sceneConfig.id;
    sceneLoaded = true;
    renderSceneEditor();
    refreshSceneEffectOptions(s.effects);
  }
  updateScenePlayback(s.scenePlayback);

  if (s.publicMessages) renderPublicMessages(s.publicMessages);

  state = s;
}

// ── Effect list ─────────────────────────────────────────────────────────────
const TEXT_EFFECT_IDS = ['scroll_text', 'static_text', 'public_messages'];
const MEDIA_EFFECT_IDS = ['media'];
const AUDIO_EFFECT_IDS = ['audio_spectrum', 'audio_scope', 'audio_mirror', 'audio_pumping_circle', 'audio_kick_only', 'audio_kick_shockwave'];

function makeEffectCard(e) {
  const card = document.createElement('div');
  card.className = 'effect-card';
  card.dataset.id = e.id;
  card.innerHTML = `
    <label class="tog" title="Enable/disable">
      <input type="checkbox" ${e.enabled ? 'checked' : ''}
        onchange="setConfig('${e.id}','enabled',this.checked)">
      <span class="tog-track"></span>
    </label>

    <div>
      <div class="effect-name">${e.id === 'audio_kick_only' ? 'Kick flash' : e.id === 'audio_kick_shockwave' ? 'Kick choc' : e.name}</div>
      ${!['audio_kick_only', 'audio_kick_shockwave'].includes(e.id) ? `<label class="public-gif-note" title="Bloque flash et onde de choc, mais conserve le boost de luminosité."><input class="disable-kick-toggle" type="checkbox" ${e.disableKick ? 'checked' : ''} onchange="setConfig('${e.id}','disableKick',this.checked)"> Désactiver les surcouches KICK</label>` : ''}
      ${['audio_kick_only', 'audio_kick_shockwave'].includes(e.id) ? '<div class="public-gif-note">KICK audio actif temporairement pendant ce visuel. Microphone requis. Les réglages habituels reviennent ensuite.</div>' : ''}
      ${e.id === 'audio_spectrum' ? `<label class="public-gif-note"><input class="spectrum-ball-toggle" type="checkbox" ${e.ball !== false ? 'checked' : ''} onchange="setConfig('${e.id}','ball',this.checked)"> Deux balles rebondissantes</label>` : ''}
      ${e.id === 'audio_pumping_circle' ? '<div class="public-gif-note">Gauche : basses · centre : médiums · droite : aigus</div>' : ''}
      <div class="effect-meta">
        <div class="srow">
          <span>Freq</span>
          <input type="range" min="1" max="10" value="${e.freq ?? 3}"
            oninput="this.nextElementSibling.textContent=this.value;setConfig('${e.id}','freq',+this.value)">
          <span class="val">${e.freq ?? 3}</span>
        </div>
        <div class="srow">
          <span>Dur</span>
          <input type="range" min="5" max="120" value="${e.duration}"
            oninput="this.nextElementSibling.textContent=this.value+'s';setConfig('${e.id}','duration',+this.value)">
          <span class="val">${e.duration}s</span>
        </div>
        <div class="srow">
          <span>Bright</span>
          <input type="range" min="0" max="100" value="${Math.round(e.brightness*100)}"
            oninput="this.nextElementSibling.textContent=this.value+'%';setConfig('${e.id}','brightness',this.value/100)">
          <span class="val">${Math.round(e.brightness*100)}%</span>
        </div>
        ${e.rainbow !== undefined ? `
        <div class="srow">
          <span>Color</span>
          <input type="color" class="effect-color ${e.rainbow ? 'dim' : ''}" value="${e.color || '#ffffff'}"
            oninput="setConfig('${e.id}','color',this.value)">
          <button class="rbtn ${e.rainbow ? 'on' : ''}" onclick="toggleRainbow('${e.id}')">&#127752;</button>
        </div>` : ''}
        ${e.speed !== undefined ? `
        <div class="srow">
          <span>Speed</span>
          <input type="range" min="5" max="120" value="${e.speed || 30}"
            oninput="this.nextElementSibling.textContent=this.value;setConfig('${e.id}','speed',+this.value)">
          <span class="val">${e.speed || 30}</span>
        </div>` : ''}
        ${e.reactivity !== undefined ? `
        <div class="srow">
          <span title="Amplification de ce visuel uniquement, sans changer la détection des kicks">Sensibilité</span>
          <input class="audio-reactivity" aria-label="Sensibilité ${e.name}" type="range" min="0.5" max="8" step="0.5" value="${e.reactivity}"
            oninput="this.nextElementSibling.textContent='×'+this.value" onchange="setConfig('${e.id}','reactivity',Number(this.value))">
          <span class="val">×${e.reactivity}</span>
        </div>` : ''}
      </div>
    </div>

    <button class="play-btn" ${e.available === false ? 'disabled title="Activer l’audio pour lire ce visuel"' : ''} onclick="playEffect('${e.id}')">&#9654; Play</button>
  `;
  return card;
}

function buildEffectList(effects) {
  const textEffectList = document.getElementById('textEffectList');
  textEffectList.innerHTML = '';
  effects.filter(e => TEXT_EFFECT_IDS.includes(e.id))
         .forEach(e => textEffectList.appendChild(makeEffectCard(e)));

  const mediaEffectList = document.getElementById('mediaEffectList');
  mediaEffectList.innerHTML = '';
  effects.filter(e => MEDIA_EFFECT_IDS.includes(e.id))
         .forEach(e => mediaEffectList.appendChild(makeEffectCard(e)));

  const list = document.getElementById('effectList');
  const audioList = document.getElementById('audioEffectList');
  audioList.innerHTML = '';
  effects.filter(e => AUDIO_EFFECT_IDS.includes(e.id)).forEach(e => audioList.appendChild(makeEffectCard(e)));
  list.innerHTML = '';
  effects.filter(e => !TEXT_EFFECT_IDS.includes(e.id) && !MEDIA_EFFECT_IDS.includes(e.id) && !AUDIO_EFFECT_IDS.includes(e.id))
         .forEach(e => list.appendChild(makeEffectCard(e)));
}

function updateEffectRow(e) {
  const card = document.querySelector(`.effect-card[data-id="${e.id}"]`);
  if (!card) return;
  card.querySelector('.play-btn').disabled = e.available === false;
  const reactivity = card.querySelector('.audio-reactivity');
  const ballToggle = card.querySelector('.spectrum-ball-toggle');
  const kickToggle = card.querySelector('.disable-kick-toggle');
  if (kickToggle && document.activeElement !== kickToggle) kickToggle.checked = !!e.disableKick;
  if (ballToggle && document.activeElement !== ballToggle) ballToggle.checked = e.ball !== false;
  if (reactivity && document.activeElement !== reactivity) {
    reactivity.value = e.reactivity;
    reactivity.nextElementSibling.textContent = `×${e.reactivity}`;
  }
  const cb = card.querySelector('input[type=checkbox]');
  if (document.activeElement !== cb) cb.checked = e.enabled;

  const colorPicker = card.querySelector('.effect-color');
  if (colorPicker && document.activeElement !== colorPicker) {
    colorPicker.value = e.color || '#ffffff';
    colorPicker.classList.toggle('dim', !!e.rainbow);
  }
  const rbtn = card.querySelector('.rbtn');
  if (rbtn) rbtn.classList.toggle('on', !!e.rainbow);
}

// ── Actions ─────────────────────────────────────────────────────────────────
function playEffect(id)        { api(`/api/effects/${id}/play`, 'POST'); }
function setConfig(id, k, v)   { api(`/api/effects/${id}/config`, 'POST', { [k]: v }); }
function toggleBlackout()      { api('/api/blackout', 'POST'); }
function setGlobalBrightness(pct) {
  document.getElementById('masterBrightVal').textContent = pct + '%';
  api('/api/brightness', 'POST', { value: pct / 100 });
}
async function pressKick() {
  const button = document.getElementById('kickButton');
  if (button.disabled) return;
  button.disabled = true;
  try {
    if (!document.getElementById('audioSettings').reportValidity()) return;
    if (await saveAudioSettings()) await api('/api/event', 'POST', { type: 'kick' });
  } finally { button.disabled = false; }
}
function toggleRainbow(id) {
  const eff = state && state.effects && state.effects.find(e => e.id === id);
  const newVal = eff ? !eff.rainbow : false;
  setConfig(id, 'rainbow', newVal);
}

// ── Pool management ─────────────────────────────────────────────────────────
let audioSettingsLoaded = false;
let audioLatest = null, audioLastBeat = null, audioPulseUntil = 0;
function renderAudio(audio) {
  if (!audio) return;
  audioLatest = audio;
  if (audioLastBeat !== null && audio.lastBeat && audio.lastBeat !== audioLastBeat) audioPulseUntil = performance.now() + 180;
  audioLastBeat = audio.lastBeat;
  if (!['listening', 'demo'].includes(audio.status)) audioPulseUntil = 0;
  if (!audioSettingsLoaded) {
    const settings = audio.settings;
    document.getElementById('audioEnabled').checked = settings.enabled;
    document.getElementById('audioKick').checked = settings.kickEnabled;
    document.getElementById('audioKickAdaptive').checked = settings.kickAdaptive;
    document.getElementById('audioKickAttack').value = settings.kickAttackMs / 1000;
    document.getElementById('audioKickRelease').value = settings.kickReleaseMs / 1000;
    document.getElementById('audioKickBoost').checked = settings.kickBoostEnabled;
    document.getElementById('audioKickBoostTarget').value = settings.kickBoostTarget * 100;
    document.getElementById('audioKickRainbow').checked = settings.kickRainbow;
    document.getElementById('audioKickColor').value = settings.kickColor;
    document.getElementById('audioKickBrightness').value = settings.kickBrightness * 100;
    document.getElementById('audioKickDuration').value = settings.kickDurationMs;
    document.getElementById('audioKickInterval').value = settings.kickIntervalMs;
    document.getElementById('audioKickOpacity').value = Math.round(settings.kickOpacity * 100);
    document.getElementById('audioKickOpacityValue').textContent = `${Math.round(settings.kickOpacity * 100)} %`;
    document.getElementById('audioKickVisual').value = settings.kickVisual;
    document.getElementById('audioWaveDuration').value = settings.waveDurationMs;
    toggleAudioKickFields();
    for (const [id, key] of [['audioSource', 'source'], ['audioDevice', 'device'], ['audioGain', 'gain'], ['audioGate', 'noiseGate'], ['audioSensitivity', 'sensitivity']]) {
      document.getElementById(id).value = settings[key];
    }
    audioSettingsLoaded = true;
  }
  const labels = { disabled: 'Audio désactivé', starting: 'Connexion au microphone…', listening: 'Microphone actif', demo: 'Démo — son simulé', error: 'Microphone indisponible' };
  document.getElementById('audioStatus').textContent = `${labels[audio.status] || audio.status}${audio.error ? ' : ' + audio.error : ''}${audio.clipping ? ' · Saturation : réduire le gain du micro' : ''}`;
  const detection = audio.detection;
  document.getElementById('audioSensitivity').title = detection?.adaptive ? `Seuil automatique actuel : ${detection.threshold.toFixed(4)}` : 'Multiplicateur manuel';
  const appearance = audio.kickAppearance;
  if (appearance) {
    const preview = document.getElementById('audioKickPreview');
    preview.style.background = appearance.rainbow ? 'linear-gradient(90deg,#f40,#fc0,#3f0,#0fc,#08f,#c0f)' : appearance.color;
    preview.style.filter = `brightness(${appearance.blackout ? 0 : appearance.brightness * appearance.masterBrightness})`;
    preview.style.opacity = appearance.opacity;
    const dark = appearance.blackout || appearance.masterBrightness === 0 || appearance.brightness === 0 || (!appearance.rainbow && appearance.color.toLowerCase() === '#000000');
    document.getElementById('audioKickDescription').textContent = appearance.visual === 'brightness'
      ? `Boost ${Math.round(appearance.masterBrightness * 100)} % vers ${Math.round(Math.max(appearance.masterBrightness, appearance.boostTarget) * 100)} % / ${appearance.attackMs} ms + ${appearance.releaseMs} ms`
      : appearance.opacity === 0
      ? 'Opacité 0 % : surcouche invisible, le fond reste affiché.'
      : dark
      ? 'Rendu noir : vérifier la couleur, les luminosités KICK / master et le blackout.'
      : `${appearance.visual === 'shockwave' ? 'Onde de choc superposée' : 'Flash plein panneau'} · ${appearance.rainbow ? 'couleur aléatoire' : appearance.color} · luminosité ${Math.round(appearance.brightness * 100)} % · opacité ${Math.round(appearance.opacity * 100)} % · ${appearance.durationMs} ms${appearance.temporaryOverride ? ' / KICK temporairement actif pour ce visuel' : audio.settings.kickEnabled ? '' : ' · déclenchement audio désactivé'}`;
  }
  document.getElementById('audioBassMeter').value = detection ? Math.min(3, detection.ratio) : 0;
  document.getElementById('audioDetectionInfo').textContent = detection
    ? `${!detection.ready ? 'Calibration…' : !detection.audible ? 'Sous le seuil de bruit' : `Basses : ${detection.ratio.toFixed(1)}× le seuil · ${detection.cooldownMs > 0 ? 'délai minimum' : !detection.armed ? 'attente de la retombée' : !detection.attack ? 'attente d’une attaque' : 'attaque'}`} · ${audio.beatCount} kicks détectés`
    : 'En attente du signal';
  if (detection?.adaptive) document.getElementById('audioDetectionInfo').textContent += ` · seuil adaptatif ${detection.threshold.toFixed(3)}`;
}
function toggleAudioKickFields() {
  document.getElementById('audioSensitivity').disabled = document.getElementById('audioKickAdaptive').checked;
  const boostOnly = document.getElementById('audioKickVisual').value === 'brightness';
  document.getElementById('audioKickBoost').closest('label').hidden = boostOnly;
  for (const id of ['audioKickOpacity', 'audioKickColor', 'audioKickRainbow', 'audioKickBrightness']) {
    document.getElementById(id).disabled = boostOnly;
  }
  const wave = document.getElementById('audioKickVisual').value === 'shockwave';
  document.getElementById('audioFlashDurationLabel').hidden = document.getElementById('audioKickVisual').value !== 'flash';
  document.getElementById('audioWaveDurationLabel').hidden = !wave;
  document.getElementById('audioKickColor').disabled = boostOnly || document.getElementById('audioKickRainbow').checked;
}
document.getElementById('audioKickRainbow').addEventListener('change', toggleAudioKickFields);
document.getElementById('audioKickVisual').addEventListener('change', toggleAudioKickFields);
document.getElementById('audioKickAdaptive').addEventListener('change', toggleAudioKickFields);
const audioPreview = document.getElementById('audioShowPreview');
try { audioPreview.checked = localStorage.getItem('audioPreview') === 'true'; } catch {}
function toggleAudioPreview() {
  document.getElementById('audioMeter').hidden = !audioPreview.checked;
  document.getElementById('audioPreviewModeLabel').hidden = !audioPreview.checked;
  try { localStorage.setItem('audioPreview', String(audioPreview.checked)); } catch {}
}
audioPreview.addEventListener('change', toggleAudioPreview);
toggleAudioPreview();

// Small dedicated request, no overlapping fetches or full admin refresh at this rate.
async function pollAudio() {
  if (!document.hidden) {
    try {
      const response = await fetch(`/api/audio/state?visual=${audioPreview.checked ? 1 : 0}`, { cache: 'no-store', signal: AbortSignal.timeout(2500) });
      if (response.status === 401) return;
      if (response.ok) renderAudio(await response.json());
    } catch {
      audioPulseUntil = 0;
      audioLatest = null;
      document.getElementById('audioStatus').textContent = 'Connexion audio interrompue…';
    }
  }
  setTimeout(pollAudio, audioPreview.checked ? 50 : 100);
}
pollAudio();
const audioLevels = Array(15).fill(0), audioPeaks = Array(15).fill(0);
let audioDrawTime = performance.now();
function drawAudioMonitor(now) {
  const dt = Math.min(0.1, Math.max(0, (now - audioDrawTime) / 1000));
  audioDrawTime = now;
  document.getElementById('audioBeatLamp').classList.toggle('detected', now < audioPulseUntil);
  if (!document.hidden && audioPreview.checked) {
    const ctx = document.getElementById('audioMeter').getContext('2d');
    if (document.getElementById('audioPreviewMode').value === 'scope') {
      ctx.fillStyle = `rgba(8,8,8,${1 - Math.exp(-dt * 12)})`;
      ctx.fillRect(0, 0, 300, 60);
      const gain = state?.effects?.find(effect => effect.id === 'audio_scope')?.reactivity ?? 2;
      const samples = audioLatest?.waveform || [];
      const mean = samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0;
      const wave = samples.map(value => Math.max(-1, Math.min(1, (value - mean) * gain * 4)));
      if (audioLatest?.detection?.audible && wave.some(value => Math.abs(value) * 6.3 >= 0.5)) {
        ctx.strokeStyle = '#d9ff65'; ctx.lineWidth = 1.2; ctx.beginPath();
        wave.forEach((v, i) => { const x = i * 300 / (wave.length - 1), y = 30 - v * 26; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        ctx.stroke();
      }
    } else {
      ctx.clearRect(0, 0, 300, 60);
      const gradient = ctx.createLinearGradient(0, 60, 0, 0);
      gradient.addColorStop(0, '#13e85b'); gradient.addColorStop(0.55, '#ffb21b'); gradient.addColorStop(1, '#ff3024');
      for (let i = 0; i < 15; i++) {
        const gain = state?.effects?.find(effect => effect.id === 'audio_spectrum')?.reactivity ?? 1;
        const target = Math.min(1, (audioLatest?.bands?.[i] || 0) * gain);
        audioLevels[i] = Math.max(target, audioLevels[i] - dt * 2.8);
        audioPeaks[i] = Math.max(audioLevels[i], audioPeaks[i] - dt * 0.65);
        ctx.fillStyle = gradient;
        for (let y = 0; y < Math.round(audioLevels[i] * 15); y++) ctx.fillRect(i * 20, 60 - (y + 1) * 4, 16, 3);
        if (audioPeaks[i] > 0) { ctx.fillStyle = '#edffd1'; ctx.fillRect(i * 20, Math.max(0, 60 - audioPeaks[i] * 60), 16, 1); }
      }
    }
  }
  requestAnimationFrame(drawAudioMonitor);
}
requestAnimationFrame(drawAudioMonitor);
function readAudioSettings() {
  return {
    enabled: document.getElementById('audioEnabled').checked,
    source: document.getElementById('audioSource').value,
    device: document.getElementById('audioDevice').value.trim(),
    gain: Number(document.getElementById('audioGain').value),
    noiseGate: Number(document.getElementById('audioGate').value),
    sensitivity: Number(document.getElementById('audioSensitivity').value),
    kickEnabled: document.getElementById('audioKick').checked,
    kickAdaptive: document.getElementById('audioKickAdaptive').checked,
    kickAttackMs: Number(document.getElementById('audioKickAttack').value) * 1000,
    kickReleaseMs: Number(document.getElementById('audioKickRelease').value) * 1000,
    kickBoostEnabled: document.getElementById('audioKickBoost').checked,
    kickBoostTarget: Number(document.getElementById('audioKickBoostTarget').value) / 100,
    kickRainbow: document.getElementById('audioKickRainbow').checked,
    kickColor: document.getElementById('audioKickColor').value,
    kickBrightness: Number(document.getElementById('audioKickBrightness').value) / 100,
    kickDurationMs: Number(document.getElementById('audioKickDuration').value),
    kickIntervalMs: Number(document.getElementById('audioKickInterval').value),
    kickOpacity: Number(document.getElementById('audioKickOpacity').value) / 100,
    kickVisual: document.getElementById('audioKickVisual').value,
    waveDurationMs: Number(document.getElementById('audioWaveDuration').value),
  };
}
let audioSaveQueue = Promise.resolve(), kickSaveTimer = null, kickEditRevision = 0;
function queueAudioSave(patch, revision) {
  const request = audioSaveQueue.then(() => api('/api/audio/settings', 'POST', patch));
  audioSaveQueue = request.catch(() => null);
  return request.then(result => {
    if (revision === kickEditRevision) document.getElementById('audioKickSaveStatus').textContent = result
      ? 'Réglages KICK appliqués.' : 'Échec de sauvegarde : les anciens réglages restent actifs. Réessayer avec Appliquer.';
    return result;
  });
}
async function saveAudioSettings() {
  clearTimeout(kickSaveTimer);
  const result = await queueAudioSave(readAudioSettings(), kickEditRevision);
  document.getElementById('audioSaveStatus').textContent = result ? 'Réglages audio enregistrés.' : 'Impossible d’enregistrer les réglages audio.';
  return result;
}
function saveKickAutomatically() {
  clearTimeout(kickSaveTimer);
  const fields = document.querySelectorAll('.audio-kick-space input, .audio-kick-space select');
  if ([...fields].some(field => !field.checkValidity())) {
    document.getElementById('audioKickSaveStatus').textContent = 'Valeur invalide : les anciens réglages restent actifs.';
    return;
  }
  const settings = readAudioSettings();
  const patch = Object.fromEntries(Object.entries(settings).filter(([key]) => key.startsWith('kick') || key === 'sensitivity' || key === 'waveDurationMs'));
  queueAudioSave(patch, kickEditRevision);
}
document.getElementById('audioSettings').addEventListener('submit', async event => {
  event.preventDefault();
  await saveAudioSettings();
});
document.getElementById('audioSettings').addEventListener('input', event => {
  if (['audioShowPreview', 'audioPreviewMode'].includes(event.target.id)) return;
  if (event.target.closest('.audio-kick-space')) {
    kickEditRevision++;
    clearTimeout(kickSaveTimer);
    document.getElementById('audioKickSaveStatus').textContent = 'Application des réglages KICK…';
    kickSaveTimer = setTimeout(saveKickAutomatically, 150);
    return;
  }
  document.getElementById('audioSaveStatus').textContent = 'Modifications non appliquées : cliquer sur Appliquer ou sur KICK.';
});
document.querySelector('.audio-kick-space').addEventListener('change', saveKickAutomatically);
document.getElementById('audioEnabled').addEventListener('change', async event => {
  const checkbox = event.target;
  const enabled = checkbox.checked;
  checkbox.disabled = true;
  document.getElementById('audioSaveStatus').textContent = 'Application…';
  try {
    const result = await queueAudioSave({ enabled }, -1);
    if (!result) checkbox.checked = !enabled;
    document.getElementById('audioSaveStatus').textContent = result
      ? enabled ? 'Audio activé.' : 'Audio coupé : visuels audio exclus de la lecture.'
      : 'Impossible d’enregistrer l’activation audio.';
  } finally { checkbox.disabled = false; }
});

function publicMessageTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function publicMessageRow(item, type) {
  const row = document.createElement('div');
  row.className = 'public-message-row';
  row.style.borderLeft = `3px solid ${item.rainbow ? '#f90' : item.color || '#fff'}`;

  const content = document.createElement('div');
  const text = document.createElement('div');
  text.className = 'public-message-text';
  text.textContent = item.kind === 'gif' ? `GIF · ${item.text}` : item.text;
  content.appendChild(text);

  const meta = document.createElement('div');
  meta.className = 'public-message-meta';
  if (type === 'pending') meta.textContent = `Reçu à ${publicMessageTime(item.createdAt)}`;
  else if (item.status === 'displayed') meta.textContent = `Joué à ${publicMessageTime(item.displayedAt)}`;
  else if (type === 'queue') meta.textContent = `Position ${item.position}`;
  else meta.textContent = 'Refusé';
  content.appendChild(meta);
  if (item.kind === 'gif') {
    const details = document.createElement('div');
    details.className = 'public-message-meta';
    details.textContent = `60 × 15 · ${item.gif.frameCount} images · ${(item.gif.durationMs / 1000).toLocaleString('fr-FR')} s`;
    const actions = document.createElement('div');
    actions.className = 'public-gif-actions';
    const preview = document.createElement('button');
    preview.type = 'button'; preview.className = 'btn btn-dark'; preview.textContent = 'Aperçu';
    preview.onclick = () => openPublicGif(item);
    const download = document.createElement('a');
    download.href = `/api/public-messages/${encodeURIComponent(item.id)}/gif?download=1`;
    download.textContent = 'Télécharger';
    actions.append(preview, download);
    if (['approved', 'playing', 'displayed'].includes(item.status)) {
      const save = document.createElement('button');
      save.type = 'button'; save.className = 'btn btn-dark'; save.textContent = 'Enregistrer dans nos GIF';
      if (item.savedMediaId) { save.textContent = 'Enregistré dans nos GIF'; save.disabled = true; }
      save.onclick = async () => {
        save.disabled = true;
        try {
          const result = await api(`/api/public-messages/${encodeURIComponent(item.id)}/save-media`, 'POST');
          if (result && result.ok) save.textContent = 'Enregistré dans nos GIF';
          else { alert(result && result.error || 'Enregistrement impossible.'); save.disabled = false; }
        } catch { alert('Connexion interrompue. Réessaie.'); save.disabled = false; }
      };
      actions.appendChild(save);
    }
    content.append(details, actions);
  }
  row.appendChild(content);

  if (item.status === 'displayed') {
    const actions = document.createElement('div');
    actions.className = 'public-message-actions';
    const replay = document.createElement('button');
    replay.type = 'button'; replay.className = 'btn play-btn'; replay.textContent = 'Relancer';
    replay.title = 'Remettre en fin de file';
    replay.onclick = () => moderatePublicMessage(item.id, 'replay');
    const discard = document.createElement('button');
    discard.type = 'button'; discard.className = 'btn btn-red'; discard.textContent = '✕';
    discard.title = 'Retirer de la file';
    discard.setAttribute('aria-label', 'Retirer de la file');
    discard.onclick = () => moderatePublicMessage(item.id, 'reject');
    actions.append(replay, discard);
    row.appendChild(actions);
  } else if (type === 'pending' || type === 'queue') {
    const actions = document.createElement('div');
    actions.className = 'public-message-actions';
    if (type === 'pending') {
      const approve = document.createElement('button');
      approve.className = 'btn play-btn';
      approve.type = 'button';
      approve.textContent = '✓';
      approve.title = item.kind === 'gif' ? 'Valider ce GIF' : 'Valider ce message';
      approve.onclick = () => moderatePublicMessage(item.id, 'approve');
      actions.appendChild(approve);
    }
    const reject = document.createElement('button');
    reject.className = 'btn btn-red';
    reject.type = 'button';
    reject.textContent = '✕';
    reject.title = type === 'pending' ? 'Refuser ce message' : 'Retirer de la file';
    reject.onclick = () => moderatePublicMessage(item.id, 'reject');
    actions.appendChild(reject);
    row.appendChild(actions);
  }
  return row;
}

function renderPublicMessageList(elementId, items, type, emptyText) {
  const container = document.getElementById(elementId);
  container.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'public-message-empty';
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }
  items.forEach(item => container.appendChild(publicMessageRow(item, type)));
}

function renderPublicMessages(data) {
  const fingerprint = JSON.stringify(data);
  if (fingerprint === publicMessageFingerprint) return;
  publicMessageFingerprint = fingerprint;

  document.getElementById('messageModeAutomatic').classList.toggle('active', data.mode === 'automatic');
  document.getElementById('messageModeModerated').classList.toggle('active', data.mode === 'moderated');
  document.getElementById('publicPendingCount').textContent = data.pending.length;
  document.getElementById('publicQueueCount').textContent = data.queue.length;
  document.getElementById('publicMessageSummary').textContent = data.mode === 'automatic'
    ? 'Texte automatique · GIF à valider'
    : 'Texte et GIF à valider';

  const settings = data.settings || {};
  const limitInput = document.getElementById('publicMessageIpLimit');
  if (document.activeElement !== limitInput && settings.maxMessagesPerIp) {
    limitInput.value = settings.maxMessagesPerIp;
  }
  const windowSeconds = Number(settings.rateWindowSeconds) || 300;
  const windowLabel = windowSeconds % 60 === 0
    ? `${windowSeconds / 60} minute${windowSeconds === 60 ? '' : 's'}`
    : `${windowSeconds} secondes`;
  document.getElementById('publicMessageLimitWindow').textContent = `sur ${windowLabel}`;

  const playing = document.getElementById('publicMessagePlaying');
  const current = data.playing[0];
  playing.hidden = !current;
  playing.textContent = current ? `Affiché maintenant : ${current.text}` : '';

  const playNext = document.getElementById('publicMessagePlayNext');
  playNext.disabled = !data.queue.length || !!current;

  renderPublicMessageList('publicPendingList', data.pending, 'pending', 'Aucun message à valider.');
  renderPublicMessageList('publicQueueList', [...data.queue, ...data.history.filter(item => item.status === 'displayed')], 'queue', 'La file est vide.');
  renderPublicMessageList('publicMessageHistory', data.history.filter(item => item.status === 'rejected'), 'history', 'Aucun élément refusé.');
  if (publicGifReview.item) {
    const item = [...data.pending, ...data.queue, ...data.playing, ...data.history].find(value => value.id === publicGifReview.item.id);
    publicGifReview.item = item || publicGifReview.item;
    document.getElementById('publicGifApprove').disabled = !item || item.status !== 'pending' || !publicGifReview.clip;
    document.getElementById('publicGifReject').disabled = !item || !['pending', 'approved'].includes(item.status);
  }
}

// Review uses the same decoder and black background as the actual LED output.
const publicGifReview = { item: null, clip: null, index: 0, playing: true, timer: null, request: 0, started: 0 };
const publicGifDialog = document.getElementById('publicGifDialog');

function drawPublicGifFrame() {
  const review = publicGifReview;
  if (!review.clip) return;
  const canvas = document.getElementById('publicGifCanvas'), ctx = canvas.getContext('2d');
  const rgb = review.clip.frames[review.index], rgba = ctx.createImageData(60, 15);
  for (let i = 0; i < 900; i++) {
    rgba.data.set(rgb.subarray(i * 3, i * 3 + 3), i * 4); rgba.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(rgba, 0, 0);
  document.getElementById('publicGifFrame').textContent = `Image ${review.index + 1} / ${review.clip.frames.length} · ${review.clip.durations[review.index]} ms`;
}

function animatePublicGif(time) {
  const review = publicGifReview;
  if (!publicGifDialog.open || !review.clip) return;
  if (review.playing && !document.hidden) {
    let elapsed = (time - review.started) % review.clip.totalDurationMs, index = 0;
    while (index < review.clip.frames.length - 1 && elapsed >= review.clip.durations[index]) elapsed -= review.clip.durations[index++];
    if (index !== review.index) { review.index = index; drawPublicGifFrame(); }
  }
  review.timer = requestAnimationFrame(animatePublicGif);
}

async function openPublicGif(item) {
  const review = publicGifReview, request = ++review.request;
  cancelAnimationFrame(review.timer);
  Object.assign(review, { item, clip: null, index: 0, playing: true });
  document.getElementById('publicGifTitle').textContent = `GIF · ${item.text}`;
  document.getElementById('publicGifDetail').textContent = 'Chargement et vérification…';
  document.getElementById('publicGifFrame').textContent = '';
  document.getElementById('publicGifCanvas').getContext('2d').clearRect(0, 0, 60, 15);
  document.getElementById('publicGifDownload').href = `/api/public-messages/${encodeURIComponent(item.id)}/gif?download=1`;
  document.getElementById('publicGifApprove').disabled = true;
  document.getElementById('publicGifReject').disabled = !['pending', 'approved'].includes(item.status);
  document.getElementById('publicGifToggle').textContent = 'Pause';
  publicGifDialog.showModal();
  try {
    const response = await fetch(`/api/public-messages/${encodeURIComponent(item.id)}/gif`, { cache: 'no-store' });
    if (!response.ok) throw new Error('GIF indisponible. Vérifie ta connexion à la console.');
    const bytes = await response.arrayBuffer();
    if (request !== review.request || !publicGifDialog.open) return;
    review.clip = PanelGif.decode(bytes);
    review.started = performance.now();
    document.getElementById('publicGifDetail').textContent = `60 × 15 pixels · ${review.clip.frames.length} images · ${(review.clip.totalDurationMs / 1000).toLocaleString('fr-FR')} s · fond noir`;
    document.getElementById('publicGifApprove').disabled = review.item.status !== 'pending';
    drawPublicGifFrame(); review.timer = requestAnimationFrame(animatePublicGif);
  } catch (error) {
    if (request === review.request) document.getElementById('publicGifDetail').textContent = error.message;
  }
}

document.getElementById('publicGifClose').onclick = () => publicGifDialog.close();
publicGifDialog.addEventListener('close', () => {
  publicGifReview.request++; cancelAnimationFrame(publicGifReview.timer);
  publicGifReview.clip = null; publicGifReview.item = null;
});
document.getElementById('publicGifToggle').onclick = () => {
  const review = publicGifReview;
  if (!review.clip) return;
  review.playing = !review.playing;
  review.started = performance.now() - review.clip.durations.slice(0, review.index).reduce((a, b) => a + b, 0);
  document.getElementById('publicGifToggle').textContent = review.playing ? 'Pause' : 'Lire';
};
function stepPublicGif(direction) {
  const review = publicGifReview;
  if (!review.clip) return;
  review.playing = false;
  review.index = (review.index + direction + review.clip.frames.length) % review.clip.frames.length;
  document.getElementById('publicGifToggle').textContent = 'Lire';
  drawPublicGifFrame();
}
document.getElementById('publicGifPrevious').onclick = () => stepPublicGif(-1);
document.getElementById('publicGifNext').onclick = () => stepPublicGif(1);
for (const [id, action] of [['publicGifApprove', 'approve'], ['publicGifReject', 'reject']]) {
  document.getElementById(id).onclick = async () => {
    const item = publicGifReview.item;
    if (!item) return;
    const button = document.getElementById(id); button.disabled = true;
    const result = await api(`/api/public-messages/${encodeURIComponent(item.id)}/${action}`, 'POST');
    if (result) {
      publicGifDialog.close();
      renderPublicMessages(result.publicMessages);
    } else {
      button.disabled = false;
      document.getElementById('publicGifDetail').textContent = 'Action impossible. Le fichier ou son état a peut-être changé ; ferme cet aperçu et actualise la liste.';
    }
  };
}

async function setPublicMessageMode(mode) {
  const result = await api('/api/public-messages/mode', 'POST', { mode });
  if (result && result.publicMessages) renderPublicMessages(result.publicMessages);
}

async function savePublicMessageLimit() {
  const input = document.getElementById('publicMessageIpLimit');
  const status = document.getElementById('publicMessageLimitStatus');
  const maxMessagesPerIp = Number(input.value);
  status.classList.remove('saved');
  if (!Number.isInteger(maxMessagesPerIp) || maxMessagesPerIp < 1 || maxMessagesPerIp > 100) {
    status.textContent = 'Choisir un nombre entre 1 et 100.';
    return;
  }
  const result = await api('/api/public-messages/settings', 'POST', { maxMessagesPerIp });
  if (!result) {
    status.textContent = 'Enregistrement impossible.';
    return;
  }
  status.textContent = 'Enregistré.';
  status.classList.add('saved');
  if (result.publicMessages) renderPublicMessages(result.publicMessages);
}

async function moderatePublicMessage(id, action) {
  const result = await api(`/api/public-messages/${encodeURIComponent(id)}/${action}`, 'POST');
  if (!result) alert('Action impossible. Vérifie que le GIF est disponible et que la file a une place libre.');
  if (result && result.publicMessages) renderPublicMessages(result.publicMessages);
}

async function playNextPublicMessage() {
  const result = await api('/api/public-messages/next', 'POST');
  if (result && result.publicMessages) renderPublicMessages(result.publicMessages);
}

function renderPool(type) {
  const pool = type === 'scroll' ? scrollPool : staticPool;
  const container = document.getElementById(type === 'scroll' ? 'scrollPool' : 'staticPool');
  const defaultColor = type === 'scroll' ? '#ffffff' : '#ff8800';
  container.innerHTML = '';
  pool.forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = 'pool-entry';

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = entry.text || '';
    inp.placeholder = 'Text\u2026';
    inp.oninput = () => { pool[i].text = inp.value; sendPool(); };
    row.appendChild(inp);

    const col = document.createElement('input');
    col.type = 'color';
    col.value = entry.color || defaultColor;
    if (entry.rainbow) col.classList.add('dim');
    col.oninput = () => { pool[i].color = col.value; sendPool(); };
    row.appendChild(col);

    const rb = document.createElement('button');
    rb.className = 'rbtn' + (entry.rainbow ? ' on' : '');
    rb.textContent = '\uD83C\uDF08';
    rb.onclick = () => { pool[i].rainbow = !pool[i].rainbow; renderPool(type); sendPool(); };
    row.appendChild(rb);

    const play = document.createElement('button');
    play.className = 'pool-play';
    play.type = 'button';
    play.textContent = '▶';
    play.title = `Jouer ce texte en mode ${type === 'scroll' ? 'défilant' : 'statique'}`;
    play.setAttribute('aria-label', play.title);
    play.onclick = () => playTextEntry(type, i);
    row.appendChild(play);

    if (pool.length > 1) {
      const del = document.createElement('button');
      del.className = 'pool-del';
      del.textContent = '\u2715';
      del.onclick = () => { pool.splice(i, 1); renderPool(type); sendPool(); };
      row.appendChild(del);
    }
    container.appendChild(row);
  });
  if (sceneLoaded) refreshSceneEffectOptions();
}

function addPoolEntry(type) {
  const pool = type === 'scroll' ? scrollPool : staticPool;
  pool.push({ text: '', color: type === 'scroll' ? '#ffffff' : '#ff8800', rainbow: false });
  renderPool(type);
  sendPool();
}

function sendPool() {
  api('/api/text', 'POST', { scrollPool, staticPool });
}

async function playTextEntry(type, index) {
  // Save first so a click immediately after typing always plays the visible value.
  await api('/api/text', 'POST', { scrollPool, staticPool });
  await api(`/api/text/${type}/${index}/play`, 'POST');
}

// ── Scene / cues ───────────────────────────────────────────────────────────
function cueLabel(cue) {
  if (cue.mediaId) {
    const media = mediaEntries.find(item => item.id === cue.mediaId);
    return `MEDIA · ${(media && media.name) || cue.mediaName || 'introuvable'}`;
  }
  if (cue.entry) {
    const mode = cue.effectId === 'scroll_text' ? 'SCROLL' : 'STATIC';
    return `${mode} · ${cue.entry.text}`;
  }
  const effect = state && state.effects && state.effects.find(item => item.id === cue.effectId);
  return effect ? effect.name : cue.effectId.replace(/_/g, ' ');
}

function refreshSceneEffectOptions(effects) {
  const select = document.getElementById('sceneEffectSelect');
  if (!select) return;
  const available = effects || (state && state.effects) || [];
  const previousValue = select.value;
  select.innerHTML = '';

  function addOption(group, label, value) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    group.appendChild(option);
  }

  const effectsGroup = document.createElement('optgroup');
  effectsGroup.label = 'Effets';
  available
    .filter(effect => !['scroll_text', 'static_text', 'media', 'public_messages'].includes(effect.id))
    .forEach(effect => addOption(effectsGroup, effect.name, `effect|${effect.id}`));
  select.appendChild(effectsGroup);

  if (mediaEntries.length) {
    const mediaGroup = document.createElement('optgroup');
    mediaGroup.label = 'Images / GIF';
    mediaEntries.forEach(media => addOption(mediaGroup, media.name, `media|${media.id}`));
    select.appendChild(mediaGroup);
  }

  const scrollGroup = document.createElement('optgroup');
  scrollGroup.label = 'Messages défilants';
  scrollPool.forEach((entry, index) => addOption(scrollGroup, entry.text || '(vide)', `text|scroll|${index}`));
  select.appendChild(scrollGroup);

  const staticGroup = document.createElement('optgroup');
  staticGroup.label = 'Messages statiques';
  staticPool.forEach((entry, index) => addOption(staticGroup, entry.text || '(vide)', `text|static|${index}`));
  select.appendChild(staticGroup);

  if ([...select.options].some(option => option.value === previousValue)) select.value = previousValue;
}

function renderSceneSelector() {
  const select = document.getElementById('sceneSelect');
  select.innerHTML = '';
  sceneLibrary.forEach(scene => {
    const option = document.createElement('option');
    option.value = scene.id;
    option.textContent = scene.name;
    select.appendChild(option);
  });
  select.value = selectedSceneId;
  document.getElementById('sceneDeleteBtn').disabled = sceneLibrary.length <= 1;
}

function renderSceneEditor() {
  document.getElementById('sceneName').value = sceneConfig.name;
  document.getElementById('sceneLoop').checked = !!sceneConfig.loop;
  renderSceneSelector();
  renderSceneCues();
}

function adoptSceneLibrary(scenes, sceneId) {
  if (!Array.isArray(scenes) || !scenes.length) return false;
  const selected = scenes.find(scene => scene.id === sceneId) || scenes[0];
  sceneLibrary = scenes;
  selectedSceneId = selected.id;
  sceneConfig = selected;
  renderSceneEditor();
  return true;
}

async function createScene() {
  if (sceneLoaded) await saveScene();
  const result = await api('/api/scenes', 'POST', { name: `SCÈNE ${sceneLibrary.length + 1}` });
  if (!result) return;
  adoptSceneLibrary(result.scenes, result.selectedSceneId);
}

async function selectScene(sceneId) {
  if (!sceneId || sceneId === selectedSceneId) return;
  const previousId = selectedSceneId;
  await saveScene();
  const result = await api(`/api/scenes/${encodeURIComponent(sceneId)}/select`, 'POST');
  if (!result) {
    document.getElementById('sceneSelect').value = previousId;
    return;
  }
  selectedSceneId = result.selectedSceneId;
  sceneConfig = sceneLibrary.find(scene => scene.id === selectedSceneId) || result.scene;
  renderSceneEditor();
}

async function deleteSelectedScene() {
  if (sceneLibrary.length <= 1) return;
  const name = sceneConfig.name;
  if (!window.confirm(`Supprimer la scène « ${name} » ?`)) return;
  const result = await api(`/api/scenes/${encodeURIComponent(sceneConfig.id)}`, 'DELETE');
  if (!result) return;
  adoptSceneLibrary(result.scenes, result.selectedSceneId);
}

function renderSceneCues() {
  const list = document.getElementById('sceneCueList');
  list.innerHTML = '';
  if (!sceneConfig.cues.length) {
    const empty = document.createElement('div');
    empty.className = 'cue-empty';
    empty.textContent = 'Aucun cue — choisis un effet ci-dessous.';
    list.appendChild(empty);
    return;
  }

  sceneConfig.cues.forEach((cue, index) => {
    const row = document.createElement('div');
    row.className = 'cue-row';
    row.dataset.cueIndex = index;

    const number = document.createElement('span');
    number.className = 'cue-number';
    number.textContent = index + 1;
    row.appendChild(number);

    const main = document.createElement('div');
    main.className = 'cue-main';
    const label = document.createElement('div');
    label.className = 'cue-label';
    label.textContent = cue.entry
      ? (cue.effectId === 'scroll_text' ? 'SCROLL TEXT' : 'STATIC TEXT')
      : cueLabel(cue);
    label.title = cueLabel(cue);
    main.appendChild(label);

    if (cue.entry) {
      const text = document.createElement('input');
      text.type = 'text';
      text.className = 'cue-text';
      text.maxLength = 300;
      text.value = cue.entry.text || '';
      text.placeholder = 'Texte de cette cue…';
      text.title = 'Texte propre à cette cue';
      text.oninput = () => {
        cue.entry.text = text.value;
        label.title = cueLabel(cue);
      };
      text.onchange = () => saveScene();
      text.onkeydown = event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          text.blur();
        }
      };
      main.appendChild(text);
    }

    const visual = cue.entry || cue;
    if (visual.color !== undefined) {
      const look = document.createElement('div');
      look.className = 'cue-look';
      const color = document.createElement('input');
      color.type = 'color';
      color.value = visual.color || '#ffffff';
      color.title = 'Couleur propre à ce cue';
      color.classList.toggle('dim', !!visual.rainbow);
      color.oninput = () => { visual.color = color.value; };
      color.onchange = () => saveScene();
      look.appendChild(color);
      if (visual.rainbow !== undefined) {
        const rainbow = document.createElement('button');
        rainbow.type = 'button';
        rainbow.className = `rbtn${visual.rainbow ? ' on' : ''}`;
        rainbow.textContent = '🌈';
        rainbow.title = 'Arc-en-ciel propre à ce cue';
        rainbow.onclick = () => {
          visual.rainbow = !visual.rainbow;
          rainbow.classList.toggle('on', visual.rainbow);
          color.classList.toggle('dim', visual.rainbow);
          saveScene();
        };
        look.appendChild(rainbow);
      }
      main.appendChild(look);
    }
    row.appendChild(main);

    const duration = document.createElement('input');
    duration.className = 'cue-duration';
    duration.type = 'number';
    duration.min = '1';
    duration.max = '600';
    duration.step = '0.5';
    duration.value = cue.duration;
    duration.title = 'Durée minimale du cue en secondes';
    duration.onchange = () => {
      cue.duration = Math.max(1, Math.min(600, Number(duration.value) || 1));
      duration.value = cue.duration;
      saveScene();
    };
    row.appendChild(duration);

    const up = document.createElement('button');
    up.className = 'cue-move';
    up.type = 'button';
    up.textContent = '↑';
    up.title = 'Monter';
    up.disabled = index === 0;
    up.onclick = () => moveSceneCue(index, -1);
    row.appendChild(up);

    const down = document.createElement('button');
    down.className = 'cue-move';
    down.type = 'button';
    down.textContent = '↓';
    down.title = 'Descendre';
    down.disabled = index === sceneConfig.cues.length - 1;
    down.onclick = () => moveSceneCue(index, 1);
    row.appendChild(down);

    const remove = document.createElement('button');
    remove.className = 'cue-delete';
    remove.type = 'button';
    remove.textContent = '✕';
    remove.title = 'Supprimer';
    remove.onclick = () => removeSceneCue(index);
    row.appendChild(remove);
    list.appendChild(row);
  });
}

function readSceneHeader() {
  sceneConfig.name = document.getElementById('sceneName').value.trim() || 'SCÈNE 1';
  sceneConfig.loop = document.getElementById('sceneLoop').checked;
  const option = [...document.getElementById('sceneSelect').options]
    .find(item => item.value === sceneConfig.id);
  if (option) option.textContent = sceneConfig.name;
}

async function saveScene(showStatus = false) {
  readSceneHeader();
  // Snapshot now, then serialize writes so an older response can never
  // overwrite a more recent color/rainbow edit.
  const snapshot = JSON.parse(JSON.stringify(sceneConfig));
  const request = sceneSaveQueue.then(() => api('/api/scene', 'POST', snapshot));
  sceneSaveQueue = request.catch(() => null);
  const result = await request;
  if (!result) return null;
  if (showStatus) {
    const status = document.getElementById('sceneStatus');
    status.textContent = result.persisted ? 'Scène enregistrée.' : 'Scène active, sauvegarde disque impossible.';
    status.classList.toggle('playing', !!result.persisted);
  }
  return result;
}

function addSceneCue() {
  const value = document.getElementById('sceneEffectSelect').value;
  if (!value || sceneConfig.cues.length >= 100) return;
  const [kind, selected, indexValue] = value.split('|');
  let effectId = selected;
  let entry;
  let mediaId;
  let mediaName;
  if (kind === 'text') {
    effectId = selected === 'scroll' ? 'scroll_text' : 'static_text';
    const pool = selected === 'scroll' ? scrollPool : staticPool;
    const source = pool[Number(indexValue)];
    if (!source || !String(source.text || '').trim()) return;
    entry = { text: source.text, color: source.color, rainbow: !!source.rainbow };
  } else if (kind === 'media') {
    effectId = 'media';
    const media = mediaEntries.find(item => item.id === selected);
    if (!media) return;
    mediaId = media.id;
    mediaName = media.name;
  }
  const effect = state && state.effects && state.effects.find(item => item.id === effectId);
  if (!effect) return;
  const cue = {
    effectId,
    duration: effect.duration || 10,
    ...(entry ? { entry } : {}),
    ...(mediaId ? { mediaId, mediaName } : {}),
  };
  if (!entry && effect.color !== undefined) cue.color = effect.color;
  if (!entry && effect.rainbow !== undefined) cue.rainbow = !!effect.rainbow;
  sceneConfig.cues.push(cue);
  renderSceneCues();
  saveScene();
}

function moveSceneCue(index, direction) {
  const target = index + direction;
  if (target < 0 || target >= sceneConfig.cues.length) return;
  [sceneConfig.cues[index], sceneConfig.cues[target]] = [sceneConfig.cues[target], sceneConfig.cues[index]];
  renderSceneCues();
  saveScene();
}

function removeSceneCue(index) {
  sceneConfig.cues.splice(index, 1);
  renderSceneCues();
  saveScene();
}

async function playScene() {
  const saved = await saveScene();
  if (!saved || !sceneConfig.cues.length) return;
  await api('/api/scene/play', 'POST');
}

function updateScenePlayback(playback) {
  const active = !!(playback && playback.active);
  const selectedIsPlaying = active && playback.sceneId === selectedSceneId;
  document.querySelectorAll('.cue-row').forEach(row => {
    row.classList.toggle('active', selectedIsPlaying && Number(row.dataset.cueIndex) === playback.cueIndex);
  });
  document.getElementById('scenePreviousBtn').disabled = !active;
  document.getElementById('sceneNextBtn').disabled = !active;
  document.getElementById('sceneStopBtn').disabled = !active;
  const status = document.getElementById('sceneStatus');
  status.classList.toggle('playing', active);
  document.getElementById('sceneDeleteBtn').disabled = sceneLibrary.length <= 1 || selectedIsPlaying;
  if (active) {
    const activeScene = sceneLibrary.find(scene => scene.id === playback.sceneId);
    const cue = activeScene && activeScene.cues[playback.cueIndex];
    status.textContent = `${activeScene ? activeScene.name : 'SCÈNE'} · cue ${playback.cueIndex + 1}/${playback.cueCount}${cue ? ` · ${cueLabel(cue)}` : ''}`;
  } else {
    status.textContent = `Mode automatique · ${sceneConfig.cues.length} cue${sceneConfig.cues.length > 1 ? 's' : ''} prêt${sceneConfig.cues.length > 1 ? 's' : ''}`;
  }
}

// ── Image / GIF preparation ────────────────────────────────────────────────
const PANEL_W = 60;
const PANEL_H = 15;
const MEDIA_MAX_FRAMES = 180;
let preparedMedia = null;

function renderMediaLibrary() {
  const library = document.getElementById('mediaLibrary');
  library.innerHTML = '';
  mediaEntries.forEach(media => {
    const row = document.createElement('div');
    row.className = 'media-entry';

    const name = document.createElement('span');
    name.className = 'media-entry-name';
    name.textContent = media.name;
    name.title = media.name;
    row.appendChild(name);

    const meta = document.createElement('span');
    meta.className = 'media-entry-meta';
    meta.textContent = media.animated ? `${media.frameCount} frames` : 'image';
    row.appendChild(meta);

    const selection = document.createElement('label');
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = media.enabled !== false;
    enabled.setAttribute('aria-label', `Autoriser ${media.name} en AUTO`);
    selection.append(enabled, ' AUTO');
    selection.title = 'Inclure dans le tirage automatique ; le fichier reste conservé si décoché.';
    enabled.onchange = async () => {
      enabled.disabled = true;
      const result = await api(`/api/media/${encodeURIComponent(media.id)}/enabled`, 'POST', { enabled: enabled.checked });
      if (result) { mediaEntries = result.library; renderMediaLibrary(); }
      else { enabled.checked = media.enabled !== false; enabled.disabled = false; setMediaStatus('Sélection non enregistrée.', true); }
    };
    row.appendChild(selection);

    const play = document.createElement('button');
    play.className = 'pool-play';
    play.type = 'button';
    play.textContent = '▶';
    play.title = 'Afficher ce média';
    play.onclick = () => playMedia(media.id);
    row.appendChild(play);

    const remove = document.createElement('button');
    remove.className = 'pool-del';
    remove.type = 'button';
    remove.textContent = '✕';
    remove.title = 'Supprimer ce média';
    remove.onclick = () => deleteMedia(media.id);
    row.appendChild(remove);
    library.appendChild(row);
  });
}

async function playMedia(id) {
  await api(`/api/media/${encodeURIComponent(id)}/play`, 'POST');
}

async function deleteMedia(id) {
  if (sceneLibrary.some(scene => scene.cues.some(cue => cue.mediaId === id))) {
    setMediaStatus('Ce média est utilisé dans la scène : supprime d’abord ses cues.', true);
    return;
  }
  const result = await api(`/api/media/${encodeURIComponent(id)}`, 'DELETE');
  if (!result) return;
  mediaEntries = result.library;
  renderMediaLibrary();
  refreshSceneEffectOptions();
  setMediaStatus(`${mediaEntries.length} média${mediaEntries.length > 1 ? 's' : ''} mémorisé${mediaEntries.length > 1 ? 's' : ''}.`);
}

function setMediaStatus(message, isError = false) {
  const status = document.getElementById('mediaStatus');
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function rgbFrameFromCanvas(canvas) {
  const rgba = canvas.getContext('2d').getImageData(0, 0, PANEL_W, PANEL_H).data;
  const rgb = new Uint8Array(PANEL_W * PANEL_H * 3);
  for (let source = 0, target = 0; source < rgba.length; source += 4) {
    rgb[target++] = rgba[source];
    rgb[target++] = rgba[source + 1];
    rgb[target++] = rgba[source + 2];
  }
  let binary = '';
  for (const value of rgb) binary += String.fromCharCode(value);
  return btoa(binary);
}

function drawFitted(source, sourceWidth, sourceHeight) {
  const canvas = document.getElementById('mediaPreview');
  const ctx = canvas.getContext('2d', { alpha: false });
  const fit = document.getElementById('mediaFit').value;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, PANEL_W, PANEL_H);
  ctx.imageSmoothingEnabled = true;

  if (fit === 'stretch') {
    ctx.drawImage(source, 0, 0, PANEL_W, PANEL_H);
  } else {
    const scale = fit === 'cover'
      ? Math.max(PANEL_W / sourceWidth, PANEL_H / sourceHeight)
      : Math.min(PANEL_W / sourceWidth, PANEL_H / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    ctx.drawImage(source, (PANEL_W - width) / 2, (PANEL_H - height) / 2, width, height);
  }
  return rgbFrameFromCanvas(canvas);
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Impossible de lire cette image.')); };
    image.src = url;
  });
}

async function prepareStaticImage(file) {
  const image = await loadImage(file);
  return {
    name: file.name,
    frames: [drawFitted(image, image.naturalWidth, image.naturalHeight)],
    durations: [1000],
  };
}

async function prepareGif(file) {
  if (!window.gifuct || !window.gifuct.parseGIF) throw new Error('Le décodeur GIF n’est pas disponible.');
  const parsed = window.gifuct.parseGIF(await file.arrayBuffer());
  const decoded = window.gifuct.decompressFrames(parsed, true);
  if (!decoded.length) throw new Error('Ce GIF ne contient aucune image lisible.');

  const sourceWidth = parsed.lsd.width;
  const sourceHeight = parsed.lsd.height;
  const composed = document.createElement('canvas');
  const patchCanvas = document.createElement('canvas');
  composed.width = sourceWidth;
  composed.height = sourceHeight;
  const composedCtx = composed.getContext('2d');
  const patchCtx = patchCanvas.getContext('2d');
  const step = Math.max(1, Math.ceil(decoded.length / MEDIA_MAX_FRAMES));
  const frames = [];
  const durations = [];
  let previous = null;
  let restore = null;

  decoded.forEach((frame, index) => {
    if (previous && previous.disposalType === 2) {
      composedCtx.clearRect(previous.dims.left, previous.dims.top, previous.dims.width, previous.dims.height);
    } else if (previous && previous.disposalType === 3 && restore) {
      composedCtx.putImageData(restore, 0, 0);
    }
    restore = frame.disposalType === 3
      ? composedCtx.getImageData(0, 0, sourceWidth, sourceHeight)
      : null;

    patchCanvas.width = frame.dims.width;
    patchCanvas.height = frame.dims.height;
    const patch = patchCtx.createImageData(frame.dims.width, frame.dims.height);
    patch.data.set(frame.patch);
    patchCtx.putImageData(patch, 0, 0);
    composedCtx.drawImage(patchCanvas, frame.dims.left, frame.dims.top);

    if (index % step === 0) {
      frames.push(drawFitted(composed, sourceWidth, sourceHeight));
      durations.push(0);
    }
    durations[durations.length - 1] += Math.max(20, Number(frame.delay) || 100);
    previous = frame;
  });

  return { name: file.name, frames, durations };
}

async function prepareSelectedMedia() {
  const file = document.getElementById('mediaFile').files[0];
  const button = document.getElementById('mediaUploadBtn');
  preparedMedia = null;
  button.disabled = true;
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    setMediaStatus('Fichier trop gros : maximum 8 Mo.', true);
    return;
  }

  setMediaStatus('Préparation…');
  try {
    preparedMedia = file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif')
      ? await prepareGif(file)
      : await prepareStaticImage(file);
    button.disabled = false;
    const detail = preparedMedia.frames.length > 1 ? `${preparedMedia.frames.length} images` : 'image fixe';
    setMediaStatus(`${file.name} — ${detail}, prêt en 60×15.`);
  } catch (error) {
    setMediaStatus(error.message || 'Impossible de préparer ce fichier.', true);
  }
}

async function uploadPreparedMedia() {
  if (!preparedMedia) return;
  const button = document.getElementById('mediaUploadBtn');
  button.disabled = true;
  setMediaStatus('Envoi au panneau…');
  try {
    const response = await fetch('/api/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preparedMedia),
    });
    if (response.status === 401) return window.location.assign('/admin/login');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Échec de l’envoi.');
    mediaEntries = result.library;
    renderMediaLibrary();
    refreshSceneEffectOptions();
    setMediaStatus(result.persisted
      ? `${result.media.name} est affiché et mémorisé sur le serveur.`
      : `${result.media.name} est affiché, mais ne pourra pas être restauré après redémarrage.`,
      !result.persisted);
  } catch (error) {
    setMediaStatus(error.message || 'Échec de l’envoi.', true);
  } finally {
    button.disabled = !preparedMedia;
  }
}

// ── Boot ────────────────────────────────────────────────────────────────────
renderPool('scroll');
renderPool('static');
document.getElementById('mediaFile').addEventListener('change', prepareSelectedMedia);
document.getElementById('mediaFit').addEventListener('change', prepareSelectedMedia);
document.getElementById('mediaUploadBtn').addEventListener('click', uploadPreparedMedia);
document.getElementById('messageModeAutomatic').addEventListener('click', () => setPublicMessageMode('automatic'));
document.getElementById('messageModeModerated').addEventListener('click', () => setPublicMessageMode('moderated'));
document.getElementById('publicMessagePlayNext').addEventListener('click', playNextPublicMessage);
document.getElementById('publicMessageSaveLimit').addEventListener('click', savePublicMessageLimit);
document.getElementById('sceneSelect').addEventListener('change', event => selectScene(event.target.value));
document.getElementById('sceneCreateBtn').addEventListener('click', createScene);
document.getElementById('sceneDeleteBtn').addEventListener('click', deleteSelectedScene);
document.getElementById('sceneName').addEventListener('change', () => saveScene(true));
document.getElementById('sceneLoop').addEventListener('change', () => saveScene(true));
document.getElementById('sceneAddBtn').addEventListener('click', addSceneCue);
document.getElementById('scenePlayBtn').addEventListener('click', playScene);
document.getElementById('scenePreviousBtn').addEventListener('click', () => api('/api/scene/previous', 'POST'));
document.getElementById('sceneNextBtn').addEventListener('click', () => api('/api/scene/next', 'POST'));
document.getElementById('sceneStopBtn').addEventListener('click', () => api('/api/scene/stop', 'POST'));
poll();
setInterval(poll, 500);
