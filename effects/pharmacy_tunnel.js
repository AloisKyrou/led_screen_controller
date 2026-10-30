'use strict';
const { color, line } = require('../lib/rave-pixels');
const cross = [[-1,-3],[1,-3],[1,-1],[3,-1],[3,1],[1,1],[1,3],[-1,3],[-1,1],[-3,1],[-3,-1],[-1,-1]];
module.exports = {
  name: 'pharmacy_tunnel',
  init(W, H) { return { W, H, clock: 0 }; },
  frame(state, t, dt, config) {
    const { W, H } = state, buf = new Uint8Array(W * H * 3);
    state.clock += Math.max(0, dt) * (config?.speed || 30) / 30;
    const time = state.clock;
    for (let tunnel = 0; tunnel < 3; tunnel++) {
      const cx = (tunnel + 0.5) * W / 3 + Math.sin(time * 0.8 + tunnel) * 2;
      const cy = (H - 1) / 2 + Math.cos(time * 0.65 + tunnel) * 1.3;
      for (let ring = 0; ring < 4; ring++) {
        const phase = (time * 0.45 + ring / 4 + tunnel * 0.08) % 1;
        const radius = 0.7 + phase * 10;
        const angle = Math.sin(time * 0.55 + tunnel) * 0.3;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const points = cross.map(([x,y]) => [cx + (x * cos - y * sin) * radius / 3, cy + (x * sin + y * cos) * radius / 3]);
        const rgb = color(config, 0.33 + tunnel * 0.1 + phase * 0.15 + time / 35, Math.sin(phase * Math.PI) * 0.85 + 0.15);
        for (let i = 0; i < points.length; i++) line(buf, W, H, points[i], points[(i + 1) % points.length], rgb);
      }
    }
    return buf;
  },
};
