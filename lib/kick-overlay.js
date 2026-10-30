'use strict';

// Transient additive layer: never becomes the selected effect or changes its clock.
function createKickOverlay(W, H) {
  let waves = [];
  return {
    trigger(now, { color, brightness, durationMs, opacity = 1 }) {
      waves.push({ started: now, duration: durationMs / 1000, color: [...color], brightness, opacity });
      waves = waves.slice(-6);
    },
    clear() { waves = []; },
    render(base, now, masterBrightness = 1) {
      waves = waves.filter(wave => now - wave.started < wave.duration);
      const result = Uint8Array.from(base);
      for (const wave of waves) {
        const progress = Math.max(0, (now - wave.started) / wave.duration);
        const radius = progress * 1.2;
        const gain = wave.brightness * masterBrightness * (1 - progress * 0.65);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const dx = (x - (W - 1) / 2) / (W / 2), dy = (y - (H - 1) / 2) / (H / 2);
          const distance = Math.hypot(dx, dy * 0.6);
          const light = Math.max(0, 1 - Math.abs(distance - radius) / 0.16) * gain;
          if (!light) continue;
          const offset = (y * W + x) * 3;
          for (let c = 0; c < 3; c++) {
            const background = result[offset + c];
            const full = Math.min(255, background + Math.round(wave.color[c] * light));
            result[offset + c] = Math.round(background + (full - background) * wave.opacity);
          }
        }
      }
      return result;
    },
  };
}
function blendKickFlash(base, color, brightness, opacity = 1) {
  for (let i = 0; i < base.length; i++) {
    base[i] = Math.round(base[i] * (1 - opacity) + color[i % 3] * brightness * opacity);
  }
  return base;
}
module.exports = { createKickOverlay, blendKickFlash };
