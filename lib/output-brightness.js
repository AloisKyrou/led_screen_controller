'use strict';

// Effects may return their persistent canvas. Dimming belongs only to output,
// never to the simulation's next frame (even at zero brightness).
function scaleOutput(frame, brightness) {
  const output = Uint8Array.from(frame);
  const gain = Math.max(0, Math.min(1, brightness));
  if (gain < 1) {
    for (let i = 0; i < output.length; i++) output[i] = Math.round(output[i] * gain);
  }
  return output;
}
module.exports = { scaleOutput };
