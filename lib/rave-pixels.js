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
  return {
    name,
    init(W, H) { return { W, H, clock: 0, spawn: 0, sprites: [] }; },
    frame(state, t, dt, config) {
      const { W, H } = state, buf = new Uint8Array(W * H * 3);
      const elapsed = Math.min(0.1, Math.max(0, dt)) * (config?.speed || 30) / 30;
      state.clock += elapsed; state.spawn -= elapsed;
      state.sprites = state.sprites.filter(s => state.clock - s.born < s.life);
      if (state.spawn <= 0) {
        const text = chaos ? 'NOL'[Math.floor(Math.random() * 3)] : 'NOOL';
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
      return buf;
    },
  };
}
module.exports = { color, dot, line, makeLetters };
