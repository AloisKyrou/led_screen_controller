'use strict';

function createKickEnvelope() {
  let pulse = null;
  function value(now) {
    if (!pulse) return 0;
    const age = Math.max(0, now - pulse.start);
    if (age < pulse.attack) return pulse.from + (1 - pulse.from) * age / pulse.attack;
    if (age < pulse.attack + pulse.hold) return 1;
    return pulse.release ? Math.max(0, 1 - (age - pulse.attack - pulse.hold) / pulse.release) : 0;
  }
  return {
    value,
    trigger(now, attack, release, hold = 0) {
      // Retrigger from the current level rather than dropping to black.
      pulse = { start: now, from: value(now), attack, release, hold };
    },
    clear() { pulse = null; },
  };
}
module.exports = { createKickEnvelope };
