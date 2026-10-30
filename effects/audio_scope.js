'use strict';

const name = 'audio_scope';
function init(W, H) { return { W, H, trail: new Float32Array(W * H) }; }
function frame(state, t, dt, config, shared) {
  const { W, H, trail } = state;
  const audio = shared.audio.snapshot();
  const wave = audio.waveform || [];
  const gain = Math.max(0.5, Math.min(8, Number(config?.reactivity) || 2));
  const mean = wave.length ? wave.reduce((sum, value) => sum + value, 0) / wave.length : 0;
  // Calibrated for a 15-row panel: x2 now has the former x8 excursion.
  const amplified = wave.map(value => Math.max(-1, Math.min(1, (value - mean) * gain * 4)));
  // A trace that cannot leave the centre pixel is not a useful visual signal.
  const visible = amplified.some(value => Math.abs(value) * (H - 1) * 0.45 >= 0.5);
  const active = visible && ['listening', 'demo'].includes(audio.status) && (audio.detection ? audio.detection.audible : audio.rms > 0);
  const centre = Math.floor(H / 2);
  for (let i = 0; i < trail.length; i++) {
    // Zero crossings must not accumulate into a persistent bright baseline.
    trail[i] *= Math.exp(-Math.max(0, dt) * (Math.floor(i / W) === centre ? 30 : 12));
  }
  let previous = Math.floor(H / 2);
  for (let x = 0; active && x < W; x++) {
    const sample = amplified[Math.min(amplified.length - 1, Math.floor(x * amplified.length / W))] || 0;
    const y = Math.round((H - 1) / 2 - sample * (H - 1) * 0.45);
    if (x === 0) previous = y;
    for (let row = Math.min(y, previous); row <= Math.max(y, previous); row++) {
      if (row >= 0 && row < H) trail[row * W + x] = row === centre ? 0.3 : 1;
    }
    previous = y;
  }
  const output = new Uint8Array(W * H * 3);
  for (let i = 0; i < trail.length; i++) {
    const light = trail[i];
    if (light < 0.015) continue;
    // Bright yellow-green trace, green persistence, black background.
    output.set([Math.round(220 * light * light), Math.round(255 * light), Math.round(70 * light * light)], i * 3);
  }
  return output;
}
module.exports = { name, init, frame };
