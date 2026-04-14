'use strict';
const { hexToRgb, hsvToRgb } = require('./font');
const name = 'rain';
const DROP_COUNT = 35, TRAIL_LEN = 5;
function spawnDrop(W, H, scatter) {
  return { x: Math.floor(Math.random()*W), y: scatter ? Math.random()*H : -Math.random()*4, speed: 15+Math.random()*25 };
}
function init(W, H) {
  const drops = [];
  for (let i = 0; i < DROP_COUNT; i++) drops.push(spawnDrop(W,H,true));
  return { W, H, drops, hue: Math.random() };
}
function frame(state, t, dt, config) {
  const { W, H, drops } = state;
  const buf = new Uint8Array(H*W*3);
  const useFixed = config && config.rainbow === false;
  if (!useFixed) state.hue = (state.hue + 0.05 * dt) % 1;
  const [cr,cg,cb] = useFixed ? hexToRgb(config.color||'#00ccff') : hsvToRgb(state.hue, 0.9, 1);
  for (const drop of drops) {
    drop.y += drop.speed * dt;
    if (drop.y - TRAIL_LEN > H) Object.assign(drop, spawnDrop(W,H,false));
    for (let tr = 0; tr < TRAIL_LEN; tr++) {
      const py = Math.round(drop.y) - tr;
      if (py < 0 || py >= H) continue;
      const fade = (tr===0?1:0.85)*(1-tr/TRAIL_LEN);
      const r=Math.min(255,Math.round(cr*fade)), g=Math.min(255,Math.round(cg*fade)), b=Math.min(255,Math.round(cb*fade));
      const idx=(py*W+drop.x)*3;
      buf[idx]=Math.max(buf[idx],r); buf[idx+1]=Math.max(buf[idx+1],g); buf[idx+2]=Math.max(buf[idx+2],b);
    }
  }
  return buf;
}
module.exports = { name, init, frame };
