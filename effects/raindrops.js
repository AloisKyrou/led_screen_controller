'use strict';
const { hexToRgb, hsvToRgb } = require('./font');
const name = 'raindrops';
const MAX_DROPS = 12, SPAWN_RATE = 2.5;

function init(W, H) {
  return { W, H, drops: [], spawnAcc: 0 };
}

function frame(state, t, dt, config) {
  const { W, H, drops } = state;
  const buf = new Uint8Array(H * W * 3);
  const useFixed = config && config.rainbow === false;
  const fixedRgb = useFixed ? hexToRgb(config.color || '#00aaff') : null;

  state.spawnAcc += SPAWN_RATE * dt;
  while (state.spawnAcc >= 1 && drops.length < MAX_DROPS) {
    state.spawnAcc -= 1;
    drops.push({
      x: Math.floor(Math.random() * W),
      y: Math.floor(Math.random() * H),
      age: 0,
      life: 0.5 + Math.random() * 0.8,
      hue: Math.random()
    });
  }
  if (state.spawnAcc > 1) state.spawnAcc = 0;

  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.age += dt;
    if (d.age >= d.life) { drops.splice(i, 1); continue; }

    const progress = d.age / d.life;
    const maxR = Math.max(W, H) * 0.35;
    const rv = progress * maxR;
    const alpha = (1 - progress) * (1 - progress);

    let pr, pg, pb;
    if (useFixed) {
      [pr, pg, pb] = fixedRgb;
    } else {
      [pr, pg, pb] = hsvToRgb(d.hue, 0.8, 1);
    }

    for (const r of [rv, rv * 0.5]) {
      if (r < 0.5) continue;
      const echoFade = (r < rv) ? 0.4 : 1;
      const bright = alpha * echoFade;
      const steps = Math.max(Math.ceil(2 * Math.PI * r) * 3, 32);
      for (let s = 0; s < steps; s++) {
        const angle = (s / steps) * 2 * Math.PI;
        const px = Math.round(d.x + Math.cos(angle) * r);
        const py = Math.round(d.y + Math.sin(angle) * r * 0.45);
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        const idx = (py * W + px) * 3;
        buf[idx]   = Math.min(255, Math.max(buf[idx],   Math.round(pr * bright)));
        buf[idx+1] = Math.min(255, Math.max(buf[idx+1], Math.round(pg * bright)));
        buf[idx+2] = Math.min(255, Math.max(buf[idx+2], Math.round(pb * bright)));
      }
    }

    if (progress < 0.12) {
      const f = 1 - progress / 0.12;
      const idx = (d.y * W + d.x) * 3;
      buf[idx]   = Math.min(255, Math.round(pr * f + 200));
      buf[idx+1] = Math.min(255, Math.round(pg * f + 200));
      buf[idx+2] = Math.min(255, Math.round(pb * f + 200));
    }
  }
  return buf;
}

module.exports = { name, init, frame };