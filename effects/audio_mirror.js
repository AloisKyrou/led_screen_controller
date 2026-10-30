'use strict';

const name = 'audio_mirror';
function init(W, H) { return { W, H, levels: Array(15).fill(0) }; }
function frame(state, t, dt, config, shared) {
  const { W, H, levels } = state;
  const bands = shared.audio.snapshot().bands;
  const gain = Math.max(0.5, Math.min(8, Number(config?.reactivity) || 1));
  const output = new Uint8Array(W * H * 3);
  for (let i = 0; i < levels.length; i++) levels[i] = Math.max(Math.min(1, (bands[i] || 0) * gain), levels[i] - Math.max(0, dt) * 2.4);
  for (let x = 0; x < W; x++) {
    const band = Math.min(14, Math.floor(Math.abs(x - (W - 1) / 2) / (W / 30)));
    const level = levels[band];
    if (level < 0.025) continue;
    const height = Math.round(level * (H - 1) / 2);
    const hue = band / 14;
    for (let y = 0; y < H; y++) {
      const distance = Math.abs(y - (H - 1) / 2);
      if (distance > height) continue;
      const brightness = 0.4 + 0.6 * (1 - distance / Math.max(1, height + 1));
      output.set([Math.round((40 + hue * 215) * brightness), Math.round((240 - hue * 190) * brightness), Math.round(255 * brightness)], (y * W + x) * 3);
    }
  }
  return output;
}
module.exports = { name, init, frame };
