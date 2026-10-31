'use strict';
const { GLYPHS } = require('../effects/font');
const NAMES = ['pumpkin_groove', 'pumpkin_jump', 'watching_eyes', 'elastic_ghosts', 'spiders', 'bat_swarm', 'cauldron', 'monster_mouth', 'skeleton'];
const BLACK = [0, 0, 0], ORANGE = [255, 70, 0], GREEN = [40, 255, 20], BONE = [210, 230, 180], PURPLE = [125, 20, 230];
const pumpkin = ['.....g.....','...ooooo...','..ooooooo..','.ooooooooo.','ooo.ooo.ooo','oo...o...oo','ooooooooooo','oo.ooooo.oo','.oo.....oo.','..ooooooo..','...ooooo...'];
const ghost = ['..www..','.wwwww.','ww.w.ww','ww.w.ww','wwwwwww','www.www','ww...ww','wwwwwww','w.w.w.w'];
const palette = { o: ORANGE, g: GREEN, w: BONE };
function drawing(W, H) {
  const buf = new Uint8Array(W * H * 3);
  function pixel(x, y, rgb) {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && y >= 0 && x < W && y < H) buf.set(rgb, (y * W + x) * 3);
  }
  function line(x, y, xx, yy, rgb) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(xx - x), Math.abs(yy - y))));
    for (let i = 0; i <= n; i++) pixel(x + (xx - x) * i / n, y + (yy - y) * i / n, rgb);
  }
  function sprite(rows, cx, cy, scale = 1, angle = 0, colors = palette, stretch = 1) {
    const sw = rows[0].length, sh = rows.length, c = Math.cos(angle), s = Math.sin(angle);
    // Inverse rasterisation keeps enlarged silhouettes solid on a low-res panel.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = x - cx, dy = y - cy;
      const sx = Math.round((dx * c + dy * s) / scale + (sw - 1) / 2);
      const sy = Math.round((-dx * s + dy * c) / (scale * stretch) + (sh - 1) / 2);
      if (sx < 0 || sx >= sw || sy < 0 || sy >= sh) continue;
      const char = rows[sy][sx];
      if (char !== '.') pixel(x, y, colors[char] || BLACK);
    }
  }
  function text(word, x, y, rgb) {
    [...word].forEach((char, i) => { for (let xx = 0; xx < 5; xx++) for (let yy = 0; yy < 7; yy++) {
      if (GLYPHS[char]?.[xx] & (1 << yy)) pixel(x + i * 6 + xx, y + yy, rgb);
    } });
  }
  return { buf, pixel, line, sprite, text };
}
function render(kind, W, H, t, levels, pulse, particles = []) {
  const d = drawing(W, H), { pixel, line, sprite, text } = d;
  const [bass, mid, high] = levels, cy = (H - 1) / 2;
  if (kind === 'pumpkin_groove' || kind === 'gif_pumpkin') {
    // Draw at native pixel size: downscaling/rotating the tiny faces erased
    // stems and triangular eyes. Three broad ribbed pumpkins fit 60 columns.
    for (let i = 0; i < 3; i++) {
      const cx = Math.floor((i + 0.5) * W / 3);
      const top = Math.max(2, Math.floor(H / 2) - 4 + Math.round(Math.sin(t * 2 + i * 2) * (0.4 + levels[i] * 0.6)));
      const widths = [3, 5, 6, 7, 7, 7, 7, 6, 5, 3];
      for (let y = 0; y < widths.length; y++) {
        for (let x = -widths[y]; x <= widths[y]; x++) {
          const rib = (Math.abs(x) === 3 || Math.abs(x) === 6) && y > 0 && y < 9;
          pixel(cx + x, top + y, rib ? [170, 40, 0] : [255, Math.round(65 + levels[i] * 35), 0]);
        }
      }
      line(cx, top - 2, cx, top - 1, GREEN); pixel(cx + 1, top - 2, GREEN);
      const eyes = pulse > 0.5 || high > 0.65 ? [255, 210, 0] : BLACK;
      const blink = kind === 'gif_pumpkin' && (t + i * 0.2) % 3 > 2.65;
      for (const sign of [-1, 1]) {
        pixel(cx + sign * 3, top + 2, blink ? ORANGE : eyes);
        line(cx + sign * 3 - 1, top + 3, cx + sign * 3 + 1, top + 3, eyes);
      }
      pixel(cx, top + 5, BLACK);
      line(cx - 4, top + 6, cx + 4, top + 6, BLACK);
      line(cx - 3, top + 7, cx + 3, top + 7, BLACK);
      pixel(cx - 1, top + 6, ORANGE); pixel(cx + 2, top + 7, ORANGE);
    }
  } else if (kind === 'pumpkin_jump') {
    sprite(pumpkin, (W - 1) / 2, cy, 1 + pulse * 1.9, t * 0.45);
  } else if (kind === 'watching_eyes') {
    for (let i = 0; i < 5; i++) {
      const x = 6 + i * (W - 12) / 4, y = 3 + (i % 2) * 7;
      const awake = pulse > 0.2 || Math.sin(t * 1.2 + i * 2) + mid > 0.1;
      if (!awake) continue;
      const height = pulse > 0.25 ? 2 : 1;
      const look = pulse > 0.2 ? 0 : Math.round(Math.sin(t * 0.8 + i));
      for (const offset of [-3, 3]) {
        for (let yy = -height; yy <= height; yy++) {
          const width = Math.abs(yy) === height ? 1 : 2;
          line(x + offset - width, y + yy, x + offset + width, y + yy, i % 2 ? ORANGE : GREEN);
        }
        pixel(x + offset + look, y, BLACK);
      }
    }
  } else if (kind === 'elastic_ghosts' || kind === 'gif_ghosts') {
    const count = kind === 'gif_ghosts' ? 4 : 3;
    for (let i = 0; i < count; i++) {
      const x = kind === 'gif_ghosts' ? ((i * 15 + t * 8) % (W + 12)) - 6 : (i + 0.5) * W / 3 + Math.sin(i * 2 + t) * pulse * 6;
      const y = cy + Math.sin(t * 2 + i) * 1.5;
      sprite(ghost, x, y, 0.8 + (levels[i % 3] || 0) * 0.35, Math.sin(t + i) * 0.12, { w: [100 + i * 35, 220, 255] }, 1 + levels[i % 3] * 0.35);
      if (kind === 'gif_ghosts') text('NOOL'[i], x - 2, 4, PURPLE);
    }
  } else if (kind === 'spiders') {
    for (let i = 0; i < 5; i++) {
      const x = 6 + i * (W - 12) / 4, y = 2 + (0.5 + 0.5 * Math.sin(t * 0.9 + i * 1.7)) * 7 + pulse * 2;
      line(x + Math.sin(t * 8 + i) * high, 0, x, y, [50, 70, 60]);
      for (let j = -1; j <= 1; j++) { line(x - 1, y, x - 4, y + j * 2, PURPLE); line(x + 1, y, x + 4, y + j * 2, PURPLE); }
      line(x, y - 1, x, y + 1, ORANGE);
    }
    for (const p of particles) if (p.kind === 'spider') sprite(['.o.','ooo','.o.'], p.x, p.y, 1, 0);
  } else if (kind === 'bat_swarm' || kind === 'gif_bat') {
    if (kind === 'gif_bat') {
      const spread = 10 + Math.sin(t * Math.PI / 2) * 7;
      for (const sign of [-1, 1]) for (let j = 0; j < 3; j++) line(W / 2, cy + j, W / 2 + sign * spread, 2 + j * 3, PURPLE);
      text('NOOL', (W - 23) / 2, 4, ORANGE);
    } else {
      for (let i = 0; i < 3 + Math.round(mid * 5); i++) {
        const x = (t * (7 + bass * 8) + i * 13) % (W + 10) - 5, y = 3 + (i % 3) * 4;
        const flap = Math.sin(t * 12 + i) * 2;
        line(x - 4, y + flap, x, y, PURPLE); line(x, y, x + 4, y + flap, PURPLE); pixel(x, y + 1, ORANGE);
      }
      for (const p of particles) if (p.kind === 'bat') { line(p.x - 3, p.y - 1, p.x, p.y + 1, ORANGE); line(p.x, p.y + 1, p.x + 3, p.y - 1, ORANGE); }
    }
  } else if (kind === 'cauldron' || kind === 'gif_potion') {
    for (let x = 0; x < W; x++) {
      const top = H - 3 - Math.round(bass * 3 + Math.sin(x * 0.4 + t * 4) + pulse * 2);
      line(x, top, x, H - 1, [20, 120, 5]); pixel(x, top, GREEN);
      if (x % 9 === 0) pixel(x + Math.sin(t + x) * 2, (H - 1 - (t * (2 + high * 5) + x) % H), PURPLE);
    }
    for (const p of particles) if (p.kind === 'drop') pixel(p.x, p.y, GREEN);
    if (kind === 'gif_potion') {
      text('NOOL', (W - 23) / 2, 1, PURPLE);
      for (let i = 0; i < 4; i++) line(20 + i * 6, 7, 20 + i * 6, 7 + (t * 3 + i) % 5, PURPLE);
    }
  } else if (kind === 'monster_mouth') {
    const opening = 1 + Math.round(mid * 4 * (1 - pulse));
    for (let x = 2; x < W - 2; x++) {
      pixel(x, cy - opening - 1, [180, 0, 20]); pixel(x, cy + opening + 1, [180, 0, 20]);
      if (x % 6 < 2) { line(x, cy - opening, x, cy - opening + 1, BONE); line(x, cy + opening, x, cy + opening - 1, BONE); }
    }
  } else if (kind === 'skeleton' || kind === 'gif_hands') {
    if (kind === 'skeleton') {
      // Original 9x8 skull, scaled uniformly to panel height (~17x15).
      // Eye sockets are drawn separately to keep their original 2x2 size.
      const scale = H / 8, cx = Math.floor(W / 2);
      const widths = [5, 7, 9, 9, 9, 7, 5, 5];
      for (let y = 0; y < H; y++) {
        const width = Math.round(widths[Math.min(7, Math.floor(y / scale))] * scale);
        const left = cx - Math.floor(width / 2);
        line(left, y, left + width - 1, y, BONE);
      }
      const look = Math.round(Math.sin(t * 1.4)), eyeY = Math.round(H * 0.4);
      for (const side of [-1, 1]) {
        const eyeX = cx + Math.round(side * 2 * scale) + look;
        for (let yy = 0; yy < 2; yy++) line(eyeX, eyeY + yy, eyeX + 1, eyeY + yy, BLACK);
      }
      pixel(cx, cy + 2, BLACK); line(cx - 1, cy + 3, cx + 1, cy + 3, BLACK);
      const jawY = Math.min(H - 2, Math.round(H * 0.73 + pulse * 2));
      line(cx - 3, jawY, cx + 3, jawY, BLACK);
      for (let x = cx - 3; x <= cx + 3; x += 3) line(x, jawY, x, H - 1, BLACK);
    }
    for (const side of [-1, 1]) {
      const cx = side < 0 ? 7 : W - 8, lift = Math.sin(t * 2 + side) * 2 + pulse * 2;
      const handColor = BONE;
      line(cx - 3, H - 3 - lift, cx + 3, H - 3 - lift, handColor);
      for (let finger = 0; finger < 4; finger++) {
        const x = cx - 3 + finger * 2, y = H - 7 - lift - (finger % 2);
        line(x, H - 3 - lift, x, y, handColor); line(x, y, x + side, y - 1, handColor);
      }
      line(cx, H - 3 - lift, cx, H - 1, handColor);
    }
  } else if (kind === 'gif_drip') {
    text('NOOL', (W - 23) / 2, 2, GREEN);
    for (let i = 0; i < 6; i++) { const x = 20 + i * 4; line(x, 8, x, 8 + (t * 3 + i * 0.8) % 7, GREEN); }
  }
  if (kind === 'gif_pumpkin') {
    const phase = t % (Math.PI * 2);
    const light = phase > 5 ? Math.max(0, (5.8 - phase) / 0.8) : Math.min(1, phase * 3);
    for (let i = 0; i < d.buf.length; i++) d.buf[i] = Math.round(d.buf[i] * light);
  }
  return d.buf;
}
function makeEffect(kind) {
  return {
    name: 'audio_' + kind,
    init(W, H) { return { W, H, levels: [0,0,0], pulse: 0, beat: null, particles: [] }; },
    frame(state, t, dt, config, shared) {
      const audio = shared.audio.snapshot(), elapsed = Math.min(0.1, Math.max(0, dt));
      const gain = Math.max(0.5, Math.min(8, Number(config?.reactivity) || 1));
      for (let g = 0; g < 3; g++) {
        const energy = Math.sqrt((audio.bands || []).slice(g * 5, g * 5 + 5).reduce((sum, v) => sum + v * v, 0) / 5);
        const target = Math.min(1, energy * gain);
        state.levels[g] += (target - state.levels[g]) * (1 - Math.exp(-elapsed * (target > state.levels[g] ? 30 : 10)));
      }
      state.pulse = Math.max(0, state.pulse - elapsed * 3);
      if (state.beat !== null && audio.beatCount > state.beat) {
        state.pulse = 1;
        const particleKind = kind === 'spiders' ? 'spider' : kind === 'bat_swarm' ? 'bat' : 'drop';
        for (let i = 0; i < 5; i++) state.particles.push({ kind: particleKind, x: Math.random() * state.W, y: particleKind === 'drop' ? state.H - 3 : 0,
          vx: (Math.random() - 0.5) * 14, vy: particleKind === 'drop' ? -12 - Math.random() * 8 : 4 + Math.random() * 6, life: 1.5 });
      }
      state.beat = audio.beatCount || 0;
      state.particles = state.particles.filter(p => p.life > 0).slice(-35);
      for (const p of state.particles) { p.life -= elapsed; p.x += p.vx * elapsed; p.y += p.vy * elapsed; if (p.kind === 'drop') p.vy += 24 * elapsed; }
      return render(kind, state.W, state.H, t, state.levels, state.pulse, state.particles);
    },
  };
}
module.exports = { NAMES, render, makeEffect };
