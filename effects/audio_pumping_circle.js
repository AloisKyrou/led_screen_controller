'use strict';

const { hsvToRgb, hexToRgb } = require('./font');
const name = 'audio_pumping_circle';

function init(W, H) {
  return { W, H, levels: [0, 0, 0], floors: [0, 0, 0], peaks: [0.3, 0.3, 0.3] };
}

function frame(state, t, dt, config, shared) {
  const { W, H, levels } = state;
  const bands = shared.audio.snapshot().bands;
  const gain = Math.max(0.5, Math.min(8, Number(config?.reactivity) || 1));
  const output = new Uint8Array(W * H * 3);
  const maxRadius = Math.min((H - 1) / 2, W / 6 - 1);
  for (let group = 0; group < 3; group++) {
    // Five logarithmic bands each: ~45–242 Hz, 242–1300 Hz, 1.3–7 kHz.
    let energy = 0;
    for (let band = group * 5; band < group * 5 + 5; band++) energy += (bands[band] || 0) ** 2;
    const raw = Math.sqrt(energy / 5);
    const elapsed = Math.max(0, dt);
    // Each frequency group gets its own slowly adapting range. Absolute FFT
    // levels otherwise occupy only one or two radius pixels (or stay saturated).
    state.floors[group] = Math.min(raw, state.floors[group] + (raw - state.floors[group]) * (1 - Math.exp(-elapsed * 0.7)));
    state.peaks[group] = Math.max(raw, state.peaks[group] * Math.exp(-elapsed * 0.25), 0.12);
    const floor = state.floors[group] * 0.85;
    const normalized = Math.max(0, raw - floor) / Math.max(0.08, state.peaks[group] - floor);
    // Retain a noise floor: auto-ranging must not amplify silence into motion.
    const target = raw < 0.015 ? 0 : Math.min(1, normalized * gain);
    const speed = target > levels[group] ? 50 : 16;
    levels[group] += (target - levels[group]) * (1 - Math.exp(-Math.max(0, dt) * speed));
    if (levels[group] < 0.025) continue;
    const radius = levels[group] * maxRadius;
    const cx = Math.floor((group + 0.5) * W / 3), cy = Math.floor(H / 2);
    const rgb = config?.rainbow === false
      ? hexToRgb(config.color || '#ff0080')
      : hsvToRgb((group / 3 + t / 36) % 1, 1, 1);
    const color = rgb.map(value => Math.round(value * (0.3 + levels[group] * 0.7)));
    const bound = Math.ceil(radius);
    for (let dy = -bound; dy <= bound; dy++) for (let dx = -bound; dx <= bound; dx++) {
      const x = cx + dx, y = cy + dy;
      const coverage = Math.max(0, Math.min(1, radius + 0.5 - Math.hypot(dx, dy)));
      if (coverage > 0 && x >= 0 && x < W && y >= 0 && y < H) {
        // Fractional edge brightness makes subpixel radius changes visible.
        output.set(color.map(value => Math.round(value * coverage)), (y * W + x) * 3);
      }
    }
  }
  return output;
}

module.exports = { name, init, frame };
