'use strict';
// MEDIA — plays a browser-prepared 60x15 image or animated GIF.

const name = 'media';

function loadClip(state, clip) {
  state.version = clip && clip.version;
  state.frames = [];
  state.durations = [];
  state.frameIndex = 0;
  state.frameElapsedMs = 0;

  if (!clip || !Array.isArray(clip.frames)) return;
  state.frames = clip.frames.map(frame => Uint8Array.from(Buffer.from(frame, 'base64')));
  state.durations = state.frames.map((_, index) => {
    const duration = Number(clip.durations && clip.durations[index]);
    return Number.isFinite(duration) ? Math.max(20, Math.min(2000, duration)) : 100;
  });
}

function findClip(shared, mediaId) {
  const entries = shared && shared.mediaLibrary && shared.mediaLibrary.entries;
  if (!Array.isArray(entries) || !entries.length) return null;
  if (mediaId) return entries.find(clip => clip.id === mediaId) || null;
  const eligible = entries.filter(clip => clip.enabled !== false);
  const weight = clip => Number.isFinite(clip.weight) ? Math.max(1, Math.min(10, clip.weight)) : 1;
  let pick = Math.random() * eligible.reduce((sum, clip) => sum + weight(clip), 0);
  for (const clip of eligible) { pick -= weight(clip); if (pick < 0) return clip; }
  return eligible[eligible.length - 1] || null;
}

function init(W, H, config, shared, options) {
  const state = { W, H };
  const clip = findClip(shared, options && options.mediaId);
  state.mediaId = clip && clip.id;
  loadClip(state, clip);
  return state;
}

function frame(state, t, dt, config, shared) {
  const clip = findClip(shared, state.mediaId);
  if ((clip && clip.version) !== state.version) loadClip(state, clip);
  if (!state.frames.length) return new Uint8Array(state.W * state.H * 3);

  if (state.frames.length > 1) {
    state.frameElapsedMs += Math.max(0, dt) * 1000;
    let safety = state.frames.length;
    while (state.frameElapsedMs >= state.durations[state.frameIndex] && safety-- > 0) {
      state.frameElapsedMs -= state.durations[state.frameIndex];
      state.frameIndex = (state.frameIndex + 1) % state.frames.length;
    }
  }

  // The server applies effect and master brightness to this returned copy.
  return state.frames[state.frameIndex].slice();
}

module.exports = { name, init, frame };
