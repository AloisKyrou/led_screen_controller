'use strict';
const { hsvToRgb, hexToRgb, GLYPHS } = require('../effects/font');
function color(config, hue, light = 1) {
  const rgb = config?.rainbow === false ? hexToRgb(config.color || '#00ff80') : hsvToRgb((hue % 1 + 1) % 1, 1, 1);
  return rgb.map(v => Math.round(v * light));
}
function dot(buf, W, H, x, y, rgb) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const offset = (y * W + x) * 3;
  for (let c = 0; c < 3; c++) buf[offset + c] = Math.max(buf[offset + c], rgb[c]);
}
function line(buf, W, H, a, b, rgb) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) * 2));
  for (let i = 0; i <= steps; i++) dot(buf, W, H, a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps, rgb);
}
function makeLetters(name, chaos) {
  function startFormation(state) {
    const left = Math.floor(Math.random() * Math.max(1, state.W - 29));
    const top = Math.floor(Math.random() * Math.max(1, state.H - 7));
    const pool = [...state.sprites];
    const letters = [...'NOOLS'].map((text, i) => {
      const index = pool.findIndex(s => s.text === text);
      const sprite = index >= 0 ? pool.splice(index, 1)[0] : null;
      const age = sprite ? state.clock - sprite.born : 0;
      const angle = sprite ? sprite.angle + age * sprite.spin : Math.random() * Math.PI * 2;
      return { text, x: sprite ? sprite.x + age * sprite.vx : Math.random() * state.W,
        y: sprite ? sprite.y + age * sprite.vy : Math.random() * state.H,
        angle: Math.atan2(Math.sin(angle), Math.cos(angle)), tx: left + i * 6 + 2, ty: top + 3,
        vx: (i - 2) * 7 + (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 14,
        spin: (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 3), hue: Math.random() };
    });
    state.formation = { started: state.clock, letters, background: state.lastFrame };
    state.sprites = [];
  }
  function formationFrame(state, t, config, buf) {
    const formation = state.formation, age = state.clock - formation.started;
    const gather = 0.9, hold = 1.5, release = 0.7;
    if (age >= gather + hold + release) {
      state.sprites = formation.letters.map(s => ({ ...s, width: 5, x: s.tx + s.vx * release,
        y: s.ty + s.vy * release, angle: s.spin * release, born: state.clock, life: 1.5 }));
      state.formation = null;
      state.nextFormation = state.clock + 4 + Math.random() * 5;
      return false;
    }
    if (age < gather && formation.background) {
      for (let i = 0; i < buf.length; i++) buf[i] = Math.round(formation.background[i] * Math.max(0, 1 - age / 0.5));
    }
    const progress = Math.min(1, age / gather), ease = progress * progress * (3 - 2 * progress);
    const away = Math.max(0, age - gather - hold);
    for (const letter of formation.letters) {
      const x = letter.x + (letter.tx - letter.x) * ease + letter.vx * away;
      const y = letter.y + (letter.ty - letter.y) * ease + letter.vy * away;
      const angle = letter.angle * (1 - ease) + letter.spin * away;
      const c = Math.cos(angle), s = Math.sin(angle);
      for (let xx = 0; xx < 5; xx++) for (let yy = 0; yy < 7; yy++) {
        if (!(GLYPHS[letter.text][xx] & (1 << yy))) continue;
        // Bright twinkles over a readable base, without moving the settled word.
        const light = age >= gather && !away ? 0.6 + 0.4 * Math.pow(Math.max(0, Math.sin(t * 19 + xx * 7 + yy * 11 + letter.tx)), 4) : 1;
        dot(buf, state.W, state.H, x + (xx - 2) * c - (yy - 3) * s,
          y + (xx - 2) * s + (yy - 3) * c, color(config, letter.hue + t / 15, light));
      }
    }
    return true;
  }
  return {
    name,
    init(W, H) { return { W, H, clock: 0, spawn: 0, sprites: [], nextFormation: 4 + Math.random() * 3 }; },
    frame(state, t, dt, config) {
      const { W, H } = state, buf = new Uint8Array(W * H * 3);
      const elapsed = Math.min(0.1, Math.max(0, dt)) * (config?.speed || 30) / 30;
      state.clock += elapsed; state.spawn -= elapsed;
      if (chaos && !state.formation && state.clock >= state.nextFormation) startFormation(state);
      if (chaos && state.formation && formationFrame(state, t, config, buf)) {
        state.lastFrame = buf;
        return buf;
      }
      state.sprites = state.sprites.filter(s => state.clock - s.born < s.life);
      if (state.spawn <= 0) {
        const text = chaos ? 'NOOLS'[Math.floor(Math.random() * 5)] : 'NOOL';
        const width = text.length * 6 - 1;
        state.sprites.push({ text, width, x: width / 2 + Math.random() * Math.max(0, W - width - 1),
          y: 3 + Math.random() * Math.max(0, H - 7), born: state.clock, life: 0.8 + Math.random() * 1.4,
          angle: chaos ? Math.random() * Math.PI * 2 : 0, spin: (Math.random() < 0.5 ? -1 : 1) * (1 + Math.random() * 4),
          vx: (Math.random() - 0.5) * 12, vy: (Math.random() - 0.5) * 5, hue: Math.random() });
        state.spawn = chaos ? 0.09 : 0.22;
      }
      state.sprites = state.sprites.slice(chaos ? -24 : -9);
      for (const sprite of state.sprites) {
        const age = state.clock - sprite.born;
        const light = Math.min(1, (age + 0.04) / 0.12, (sprite.life - age) / 0.35);
        const rgb = color(config, sprite.hue + t / 15, light);
        const angle = chaos ? sprite.angle + age * sprite.spin : 0;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        for (let c = 0; c < sprite.text.length; c++) for (let x = 0; x < 5; x++) for (let y = 0; y < 7; y++) {
          if (!(GLYPHS[sprite.text[c]][x] & (1 << y))) continue;
          const dx = c * 6 + x - (sprite.width - 1) / 2, dy = y - 3;
          dot(buf, W, H, sprite.x + dx * cos - dy * sin + (chaos ? age * sprite.vx : 0),
            sprite.y + dx * sin + dy * cos + (chaos ? age * sprite.vy : 0), rgb);
        }
      }
      if (chaos) state.lastFrame = buf;
      return buf;
    },
  };
}
module.exports = { color, dot, line, makeLetters };
