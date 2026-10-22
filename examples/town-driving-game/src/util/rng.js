// Deterministic PRNG. Every sim system draws from its own forked stream so adding
// a consumer never shifts the numbers another one sees (same seed → same town).

// mulberry32: 32-bit state, one add + two imuls per call. Returns floats in [0, 1).
export function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a: mixes a label path into a 32-bit seed.
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

function makeRng(root, path) {
  const next = mulberry32(hash(path ? `${root}/${path}` : root));
  return {
    float: next,
    range(min, max) {
      return min + (max - min) * next();
    },
    // ASSUMPTION: int(min, max) is inclusive at both ends; range(min, max) is [min, max).
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    pick(items) {
      return items[Math.floor(next() * items.length)];
    },
    fork(label) {
      return makeRng(root, path ? `${path}/${label}` : String(label));
    },
  };
}

export function createRng(seed) {
  return makeRng(String(seed), '');
}
