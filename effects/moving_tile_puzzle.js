'use strict';
// MOVING TILE PUZZLE — sliding tile puzzle
// Port of moving_tile_puzzle.py — time-based

const name = 'moving_tile_puzzle';

const TILE_W = 6;
const TILE_H = 5;
const TILE_COLORS = [
  [220,40,40],[40,200,40],[40,80,220],[220,200,40],
  [180,40,200],[40,200,200],[220,120,40],[200,200,200],
  [0,0,0], // "empty" tile
];
const EMPTY_ID = TILE_COLORS.length - 1;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function init(W, H) {
  const COLS = Math.floor(W / TILE_W);
  const ROWS = Math.floor(H / TILE_H);
  const TOTAL = COLS * ROWS;
  const baseIds = Array.from({ length: TILE_COLORS.length - 1 }, (_, i) => i);
  const tileIds = [];
  while (tileIds.length < TOTAL - 1) tileIds.push(...baseIds);
  tileIds.splice(TOTAL - 1);
  tileIds.push(EMPTY_ID);
  shuffle(tileIds);
  const grid = [];
  for (let r = 0; r < ROWS; r++) grid.push(tileIds.slice(r * COLS, (r + 1) * COLS));

  let empCx = 0, empRy = 0;
  outer: for (let ry = 0; ry < ROWS; ry++) for (let cx = 0; cx < COLS; cx++) {
    if (grid[ry][cx] === EMPTY_ID) { empCx = cx; empRy = ry; break outer; }
  }

  return {
    W, H, COLS, ROWS, grid,
    empCx, empRy,
    slide: null,       // { srcCx, srcRy, ddx, ddy }
    slideProgress: 0,  // pixels moved
    direction: pickDir(COLS, ROWS, empCx, empRy),
    buf: new Uint8Array(H * W * 3),
  };
}

function pickDir(COLS, ROWS, empCx, empRy) {
  const dirs = [];
  if (empCx > 0)       dirs.push([-1, 0]);
  if (empCx < COLS-1)  dirs.push([ 1, 0]);
  if (empRy > 0)       dirs.push([ 0,-1]);
  if (empRy < ROWS-1)  dirs.push([ 0, 1]);
  return dirs.length ? dirs[(Math.random() * dirs.length) | 0] : null;
}

function render(state) {
  const { W, H, COLS, ROWS, grid, slide, slideProgress, buf } = state;
  buf.fill(0);

  // Static tiles
  for (let ry = 0; ry < ROWS; ry++) {
    for (let cx = 0; cx < COLS; cx++) {
      const [r, g, b] = TILE_COLORS[grid[ry][cx]];
      for (let dy = 0; dy < TILE_H; dy++) {
        for (let dx = 0; dx < TILE_W; dx++) {
          const px = cx * TILE_W + dx;
          const py = ry * TILE_H + dy;
          if (px < W && py < H) {
            const idx = (py * W + px) * 3;
            buf[idx]   = r;
            buf[idx+1] = g;
            buf[idx+2] = b;
          }
        }
      }
    }
  }

  // Sliding tile overlay
  if (slide) {
    const { srcCx, srcRy, ddx, ddy } = slide;
    const [r, g, b] = TILE_COLORS[grid[srcRy][srcCx]];
    for (let dy = 0; dy < TILE_H; dy++) {
      for (let dx = 0; dx < TILE_W; dx++) {
        const ox = Math.round(dx + ddx * slideProgress);
        const oy = Math.round(dy + ddy * slideProgress);
        const px = srcCx * TILE_W + ox;
        const py = srcRy * TILE_H + oy;
        if (px >= 0 && px < W && py >= 0 && py < H) {
          const idx = (py * W + px) * 3;
          buf[idx]   = r;
          buf[idx+1] = g;
          buf[idx+2] = b;
        }
      }
    }
  }
}

function frame(state, t, dt) {
  const { W, H, COLS, ROWS, grid } = state;
  const SLIDE_STEPS = Math.max(TILE_W, TILE_H);

  if (!state.direction) state.direction = pickDir(COLS, ROWS, state.empCx, state.empRy);

  if (state.direction) {
    const [dxDir, dyDir] = state.direction;
    const srcCx = state.empCx + dxDir;
    const srcRy = state.empRy + dyDir;
    if (!state.slide) {
      state.slide = { srcCx, srcRy, ddx: -dxDir, ddy: -dyDir };
      state.slideProgress = 0;
    }
    render(state);
    state.slideProgress++;
    if (state.slideProgress >= SLIDE_STEPS) {
      // Commit move
      grid[state.empRy][state.empCx] = grid[srcRy][srcCx];
      grid[srcRy][srcCx] = EMPTY_ID;
      state.empCx += dxDir;
      state.empRy += dyDir;
      state.slide = null;
      state.slideProgress = 0;
      state.direction = pickDir(COLS, ROWS, state.empCx, state.empRy);
    }
  } else {
    render(state);
  }
  return state.buf;
}

module.exports = { name, init, frame };
