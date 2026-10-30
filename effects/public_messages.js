'use strict';

// PUBLIC MESSAGES — one approved public message, then back to the AUTO scheduler.
const scrollText = require('./scroll_text');

const name = 'public_messages';

function init(W, H, config, shared) {
  const message = shared && shared.publicMessages && shared.publicMessages.takeNext
    ? shared.publicMessages.takeNext()
    : null;
  const entry = message || { text: 'NOOLS', color: '#ffffff', rainbow: false };
  const state = message && message.kind === 'gif'
    ? { W, H, gif: message.animation, elapsedMs: 0, done: false }
    : scrollText.init(W, H, config, shared, { entry });
  state.publicMessageId = message && message.id;
  state.publicMessageFinished = !message;
  if (!message) state.done = true;
  return state;
}

function frame(state, t, dt, config, shared) {
  if (state.gif) {
    state.elapsedMs += Math.max(0, dt) * 1000;
    if (state.elapsedMs >= state.gif.totalDurationMs) state.done = true;
    let withinLoop = state.elapsedMs % state.gif.totalDurationMs;
    let index = 0;
    while (index < state.gif.frames.length - 1 && withinLoop >= state.gif.durations[index]) {
      withinLoop -= state.gif.durations[index++];
    }
    // Brightness is applied by the server in place, so never return the original.
    return state.gif.frames[index].slice();
  }
  return scrollText.frame(state, t, dt, config, shared);
}

function stop(state, shared) {
  if (!state || !state.publicMessageId || state.publicMessageFinished) return;
  state.publicMessageFinished = true;
  if (state.done && shared && shared.publicMessages && shared.publicMessages.complete) {
    shared.publicMessages.complete(state.publicMessageId);
  } else if (shared && shared.publicMessages && shared.publicMessages.requeue) {
    shared.publicMessages.requeue(state.publicMessageId);
  }
}

module.exports = { name, init, frame, stop };
