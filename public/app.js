'use strict';
// Panel Controller — app.js

let state      = null;
let scrollPool = [{ text: 'NOOLS', color: '#ffffff', rainbow: false }];
let staticPool = [{ text: 'NOOLS', color: '#ff8800', rainbow: false }];

// ── API helper ──────────────────────────────────────────────────────────────
async function api(url, method = 'GET', body = null) {
  const opts = { method, headers: {} };
  if (body !== null) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  try {
    const res = await fetch(url, opts);
    return res.json();
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

  state = s;
}

// ── Effect list ─────────────────────────────────────────────────────────────
const TEXT_EFFECT_IDS = ['scroll_text', 'static_text'];

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

  const list = document.getElementById('effectList');
  list.innerHTML = '';
  effects.filter(e => !TEXT_EFFECT_IDS.includes(e.id))
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

    if (pool.length > 1) {
      const del = document.createElement('button');
      del.className = 'pool-del';
      del.textContent = '\u2715';
      del.onclick = () => { pool.splice(i, 1); renderPool(type); sendPool(); };
      row.appendChild(del);
    }
    container.appendChild(row);
  });
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

// ── Boot ────────────────────────────────────────────────────────────────────
renderPool('scroll');
renderPool('static');
poll();
setInterval(poll, 500);
