// Seeded RNG for everything that has to be reproducible in tests: spread sampling, bot
// aim error and reaction delays. mulberry32 is a 32-bit generator — tiny, fast, and good
// enough for gameplay randomness (it is not a cryptographic primitive).

// Returns a generator: calling it yields the next float in [0, 1). Two generators built
// from the same seed produce the same sequence, and each generator keeps its own state.
export function mulberry32(seed) {
  let state = seed >>> 0;

  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
