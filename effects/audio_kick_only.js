'use strict';

// A normal black background, not blackout: shared KICK overlays still render.
const name = 'audio_kick_only';
function init(W, H) { return { pixels: new Uint8Array(W * H * 3) }; }
function frame(state) {
  // Flash blending mutates its input buffer; clear it on every frame.
  state.pixels.fill(0);
  return state.pixels;
}
module.exports = { name, init, frame };
