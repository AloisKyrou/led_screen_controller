'use strict';
const name = 'fire';
const COOLING = 45, SPARKING = 110;
function palette(h) {
  if (h <= 0)  return [0, 0, 0];
  if (h < 64)  return [h * 4, 0, 0];
  if (h < 128) return [255, (h-64)*4, 0];
  if (h < 192) return [255, 255, (h-128)*4];
  return [255, 255, 255];
}
function init(W, H) { return { W, H, heat: new Float32Array(H * W) }; }
function frame(state, t, dt, config) {
  const { W, H, heat } = state;
  const steps = Math.max(1, Math.round(dt * 30));
  for (let step = 0; step < steps; step++) {
    for (let i = 0; i < H * W; i++)
      heat[i] = Math.max(0, heat[i] - Math.random() * (COOLING * 10 / H + 2));
    for (let y = 0; y < H - 2; y++)
      for (let x = 0; x < W; x++)
        heat[y*W+x] = (heat[(y+1)*W+x] + heat[(y+1)*W+Math.max(0,x-1)] + heat[(y+2)*W+x]) / 3;
    for (let x = 0; x < W; x++)
      if (Math.random()*255 < SPARKING) {
        const sy = H-1-Math.floor(Math.random()*3);
        heat[sy*W+x] = Math.min(255, heat[sy*W+x] + 160 + Math.random()*95);
      }
  }
  const buf = new Uint8Array(H*W*3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const [r,g,b] = palette(heat[y*W+x]);
      const i = (y*W+x)*3; buf[i]=r; buf[i+1]=g; buf[i+2]=b;
    }
  return buf;
}
module.exports = { name, init, frame };
