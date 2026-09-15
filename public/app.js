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

  // Kick brightness slider
  const kbs = document.getElementById('kickBrightSlider');
  if (document.activeElement !== kbs) {
    const pct = Math.round((s.kickFlashBrightness ?? 1) * 100);
    kbs.value = pct;
    document.getElementById('kickBrightVal').textContent = pct + '%';
  }

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
    const before = mediaEntries.map(item => `${item.id}:${item.name}:${item.frameCount}`).join('|');
    const after = s.shared.media.map(item => `${item.id}:${item.name}:${item.frameCount}`).join('|');
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

  state = s;
}

// ── Effect list ─────────────────────────────────────────────────────────────
const TEXT_EFFECT_IDS = ['scroll_text', 'static_text'];
const MEDIA_EFFECT_IDS = ['media'];

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
      <div class="effect-name">${e.name}</div>
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
      </div>
    </div>

    <button class="play-btn" onclick="playEffect('${e.id}')">&#9654; Play</button>
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
  list.innerHTML = '';
  effects.filter(e => !TEXT_EFFECT_IDS.includes(e.id) && !MEDIA_EFFECT_IDS.includes(e.id))
         .forEach(e => list.appendChild(makeEffectCard(e)));
}

function updateEffectRow(e) {
  const card = document.querySelector(`.effect-card[data-id="${e.id}"]`);
  if (!card) return;
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
let kickRainbow = false;
function toggleKickRainbow() {
  kickRainbow = !kickRainbow;
  const btn = document.getElementById('kickRainbowBtn');
  btn.classList.toggle('on', kickRainbow);
  document.getElementById('kickColorPicker').classList.toggle('dim', kickRainbow);
}
function randomHexColor() {
  const h = Math.random();
  // HSV full saturation, full value → vivid colors
  const i = Math.floor(h * 6), f = h * 6 - i;
  const q = 1 - f, t = f;
  let r, g, b;
  switch (i % 6) {
    case 0: r=1; g=t; b=0; break; case 1: r=q; g=1; b=0; break;
    case 2: r=0; g=1; b=t; break; case 3: r=0; g=q; b=1; break;
    case 4: r=t; g=0; b=1; break; default: r=1; g=0; b=q;
  }
  return '#' + [r,g,b].map(v => Math.round(v*255).toString(16).padStart(2,'0')).join('');
}
function pressKick() {
  const color = kickRainbow ? randomHexColor() : document.getElementById('kickColorPicker').value;
  const brightness = document.getElementById('kickBrightSlider').value / 100;
  if (kickRainbow) document.getElementById('kickColorPicker').value = color;
  api('/api/event', 'POST', { type: 'kick', on: true, color, brightness });
}
function releaseKick() { api('/api/event', 'POST', { type: 'kick', on: false }); }
function toggleRainbow(id) {
  const eff = state && state.effects && state.effects.find(e => e.id === id);
  const newVal = eff ? !eff.rainbow : false;
  setConfig(id, 'rainbow', newVal);
}

// ── Pool management ─────────────────────────────────────────────────────────
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
    .filter(effect => effect.id !== 'scroll_text' && effect.id !== 'static_text' && effect.id !== 'media')
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
