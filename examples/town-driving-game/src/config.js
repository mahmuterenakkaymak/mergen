// All tunables, values taken from prototype/index.html. Read-only at runtime.
// ASSUMPTION: "every tunable" = the prototype's CFG plus its inline clamped/used
// constants (pitch clamps, traffic speed, fx pool sizes, audio volumes, colors);
// gameplay thresholds (yield 11 m, damage 6 m/s, horn 12 m) live with their own tasks.
function deepFreeze(obj) {
  for (const v of Object.values(obj)) {
    if (v !== null && typeof v === 'object') deepFreeze(v);
  }
  return Object.freeze(obj);
}

export const CONFIG = deepFreeze({
  seed: 20261020,
  grid: 6,        // blocks per side
  block: 54,      // block size (m)
  road: 14,       // road width (m)
  wall: 3,        // perimeter wall height (m)
  car: {
    accel: 10.5, brake: 24, reverseMax: 9, maxSpeed: 29,
    drag: 0.45, rollResist: 1.2,
    steerMax: 0.62, steerSpeed: 2.6, refSpeed: 9,
    grip: 6.5, handGrip: 1.6, handDrag: 2.2,
    radius: 2.05,
  },
  cam: {
    dist: 10.5, minDist: 5.5, maxDist: 20,
    pitch0: 0.42, pitchMin: 0.08, pitchMax: 1.25,
    height: 1.7, fov: 62, fovMax: 73,
  },
  traffic: { count: 14, speed: 8.5 },
  peds: { count: 26 },
  fx: { skids: 500, particles: 420 },
  audio: {
    master: 0.8,
    engineBase: 0.028, engineLoad: 0.05, engineRpm: 0.02,
    squeal: 0.16, horn: 0.28, thud: 0.9,
  },
  palette: [
    '#8d99ae', '#b08968', '#b5838d', '#6d8b74', '#9a8c98',
    '#a68a64', '#7d8597', '#c09f80', '#5c6b73', '#93b1a5',
  ],
  colors: {
    carBody: 0xd62828,
    traffic: [0x3a86ff, 0x2a9d8f, 0xf4a261, 0xe9c46a, 0x8d5a97, 0x50667a, 0xf1faee, 0x40484f],
    peds: [0xef476f, 0x118ab2, 0xffd166, 0x06d6a0, 0x9b5de5, 0xf15bb5, 0x00bbf9, 0xee6c4d],
    fog: 0xcfe0ee,
    asphalt: 0x3a3d42,
    grass: 0x6f8f52,
    sidewalk: 0x9aa0a6,
    lawn: 0x61a04a,
    pond: 0x4f86c6,
    roofCap: 0x4a4f57,
    trunk: 0x6b4a2f,
    leaf: 0x3e7d3a,
    pole: 0x2f353d,
    lamp: 0xffe9a0,
    dash: 0xd9d9d2,
    sun: 0xfff2d8,
    hemiSky: 0xbfd7f0,
    hemiGround: 0x5c5344,
    windowLit: '#ffe9a8',
    windowDark: '#1c2733',
    wallStripe: ['#d64545', '#e8e8e8'],
    sky: ['#4f8fd4', '#9cc6ea', '#dfeaf2', '#f2e3c4'],
  },
});
