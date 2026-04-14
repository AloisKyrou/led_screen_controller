'use strict';
const { hsvToRgb, hexToRgb } = require('./font');
const name = 'starfield';
const STAR_COUNT = 80;
function spawnStar() { return { angle: Math.random()*Math.PI*2, r: Math.random()*1.5, speed: 4+Math.random()*20, hue: Math.random() }; }
function init(W, H) {
  const maxR = Math.sqrt((W/2)*(W/2)+(H/2)*(H/2));
  const stars = [];
  for (let i = 0; i < STAR_COUNT; i++) { const s=spawnStar(); s.r=Math.random()*maxR; stars.push(s); }
  return { W, H, maxR, stars };
}
function frame(state, t, dt, config) {
  const { W, H, maxR, stars } = state;
  const buf = new Uint8Array(H*W*3);
  const cx=W/2, cy=H/2;
  const useFixed = config && config.rainbow === false;
  const [cr,cg,cb] = useFixed ? hexToRgb(config.color||'#ffffff') : [0,0,0];
  for (const star of stars) {
    star.r += star.speed * dt;
    if (star.r > maxR) { Object.assign(star,spawnStar()); continue; }
    const px=Math.round(cx+Math.cos(star.angle)*star.r), py=Math.round(cy+Math.sin(star.angle)*star.r);
    if (px<0||px>=W||py<0||py>=H) { Object.assign(star,spawnStar()); continue; }
    const bright=Math.min(1,star.r/(maxR*0.5));
    let r,g,b;
    if (useFixed) { r=Math.round(cr*bright); g=Math.round(cg*bright); b=Math.round(cb*bright); }
    else { [r,g,b]=hsvToRgb(star.hue,0.25,bright); }
    const idx=(py*W+px)*3;
    buf[idx]=Math.max(buf[idx],r); buf[idx+1]=Math.max(buf[idx+1],g); buf[idx+2]=Math.max(buf[idx+2],b);
  }
  return buf;
}
module.exports = { name, init, frame };
