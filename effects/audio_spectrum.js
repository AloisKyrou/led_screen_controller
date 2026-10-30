'use strict';

const name = 'audio_spectrum';
const { stepBall } = require('../lib/spectrum-ball');
const { hsvToRgb, GLYPHS } = require('./font');
// Swept contact catches two fast squares passing between rendered frames.
function touched(start, end) {
  let enter = 0, leave = 1;
  for (const axis of ['x', 'y']) {
    const delta = end[axis] - start[axis];
    if (!delta) { if (Math.abs(start[axis]) > 2) return false; continue; }
    const a = (-2 - start[axis]) / delta, b = (2 - start[axis]) / delta;
    enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
  }
  return enter <= leave;
}
function init(W, H) { return { W, H, levels: Array(15).fill(0), peaks: Array(15).fill(0) }; }
function frame(state, t, dt, config, shared) {
  const { W, H } = state, output = new Uint8Array(W * H * 3);
  const audio = shared.audio.snapshot();
  const gain = Math.max(0.5, Math.min(8, Number(config?.reactivity) || 1));
  const previous = [...state.levels];
  const ballEnabled = config?.ball !== false;
  const barHeight = ballEnabled ? Math.max(1, H - 3) : H;
  for (let band = 0; band < 15; band++) {
    const target = Math.min(1, (audio.bands[band] || 0) * gain);
    state.levels[band] = Math.max(target, state.levels[band] - Math.max(0, dt) * 2.8);
    state.peaks[band] = Math.max(state.levels[band], state.peaks[band] - Math.max(0, dt) * 0.65);
    const height = Math.round(state.levels[band] * barHeight);
    const peak = Math.ceil(state.peaks[band] * barHeight) - 1;
    for (let x = Math.floor(band * W / 15); x < Math.floor((band + 1) * W / 15) - 1; x++) {
      for (let y = 0; y < H; y++) {
        const level = H - 1 - y, index = (y * W + x) * 3;
        if (level === peak && peak >= 0) output.set([170, 190, 160], index);
        else if (level < height) {
          const fraction = level / Math.max(1, barHeight - 1);
          const red = Math.round(255 * Math.min(1, fraction / 0.55));
          const green = Math.round(fraction < 0.55 ? 235 - fraction * 100 : 180 * (1 - fraction) / 0.45);
          // Alternating rows give the bars a segmented LED-meter texture.
          const shade = level % 2 ? 0.75 : 1;
          output.set([Math.round(red * shade), Math.round(green * shade), Math.round(22 * (1 - fraction) * shade)], index);
        }
      }
    }
  }
  if (ballEnabled) {
    state.ball ||= { x: W * 0.2, y: 0, vx: 2, vy: 0 };
    state.partner ||= { ball: { x: W * 0.8, y: 0, vx: -2, vy: 0, decisionIn: 1.3 } };
    const before = { x: state.ball.x - state.partner.ball.x, y: state.ball.y - state.partner.ball.y };
    stepBall(state, previous, state.levels, dt, W, H);
    stepBall(state.partner, previous, state.levels, dt, W, H);
    const after = { x: state.ball.x - state.partner.ball.x, y: state.ball.y - state.partner.ball.y };
    const contact = touched(before, after);
    if (contact && !state.touching && t >= (state.nextCelebration || 0)) {
      state.celebrateUntil = t + 1.2;
      state.nextCelebration = t + 2;
    }
    state.touching = Math.abs(after.x) <= 2 && Math.abs(after.y) <= 2;
    for (const [index, ball] of [state.ball, state.partner.ball].entries()) {
      const x = Math.round(ball.x), y = H - 2 - Math.round(ball.y);
      const color = hsvToRgb(((t / 8 + index * 0.5) % 1 + 1) % 1, 0.8, 1);
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        output.set(color, ((y + dy) * W + x + dx) * 3);
      }
    }
    if (t < (state.celebrateUntil || 0)) {
      const alpha = Math.min(1, (state.celebrateUntil - t) / 0.3);
      for (let i = 0; i < output.length; i++) output[i] *= 1 - 0.75 * alpha;
      const text = 'ULTRA NOOL', left = Math.floor((W - (text.length * 6 - 1)) / 2), top = 0;
      for (let c = 0; c < text.length; c++) for (let x = 0; x < 5; x++) for (let y = 0; y < 7; y++) {
        const px = left + c * 6 + x, py = top + y;
        if (px < 0 || px >= W || py < 0 || py >= H || !(GLYPHS[text[c]][x] & (1 << y))) continue;
        const fraction = (6 - y) / 6;
        const color = [255 * Math.min(1, fraction / 0.55), fraction < 0.55 ? 235 - fraction * 100 : 180 * (1 - fraction) / 0.45, 22 * (1 - fraction)];
        const offset = (py * W + px) * 3;
        for (let channel = 0; channel < 3; channel++) output[offset + channel] = Math.round(output[offset + channel] * (1 - alpha) + color[channel] * alpha);
      }
    }
  } else {
    state.ball = null; state.partner = null; state.touching = false;
    state.celebrateUntil = 0; state.nextCelebration = 0;
  }
  return output;
}
module.exports = { name, init, frame };
