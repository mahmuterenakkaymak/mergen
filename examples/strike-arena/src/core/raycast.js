// Hitscan against the only shapes the game has: static wall boxes and bot
// head/body boxes. `dir` does not have to be unit length — t is always METRES
// from the origin, so callers can hand over a raw aim vector.

const EPS = 1e-8;
const AXES = ['x', 'y', 'z'];

function vec3(v) {
  if (Array.isArray(v)) return { x: v[0], y: v[1], z: v[2] };
  return { x: v.x, y: v.y, z: v.z };
}

function normalize(v) {
  const d = vec3(v);
  const len = Math.hypot(d.x, d.y, d.z);
  if (!(len > EPS)) return null;
  return { x: d.x / len, y: d.y / len, z: d.z / len };
}

// Classic slab test. Returns {t, point, normal} for the entry face, or null when
// the ray misses or the box sits behind the origin. A ray starting inside the
// box reports t = 0 with the normal of the face it would exit through reversed,
// which keeps an embedded shooter from getting a back-facing surface.
export function rayAabb(origin, dir, box) {
  if (!box) return null;
  const o = vec3(origin);
  const d = normalize(dir);
  if (!d) return null;

  let tMin = 0;
  let tMax = Infinity;
  let axis = null;
  let sign = 0;

  for (const a of AXES) {
    if (Math.abs(d[a]) < EPS) {
      if (o[a] < box.min[a] || o[a] > box.max[a]) return null;
      continue;
    }
    const inv = 1 / d[a];
    let enter = (box.min[a] - o[a]) * inv;
    let leave = (box.max[a] - o[a]) * inv;
    let face = -1;
    if (enter > leave) {
      const swap = enter;
      enter = leave;
      leave = swap;
      face = 1;
    }
    if (enter > tMin) {
      tMin = enter;
      axis = a;
      sign = face;
    }
    if (leave < tMax) tMax = leave;
    if (tMin > tMax) return null;
  }

  if (tMax < 0) return null;

  if (axis === null) {
    axis = AXES.reduce((best, a) => (Math.abs(d[a]) > Math.abs(d[best]) ? a : best), 'x');
    sign = -Math.sign(d[axis]);
  }

  const normal = { x: 0, y: 0, z: 0 };
  normal[axis] = sign < 0 ? -1 : 1;

  return {
    t: tMin,
    point: { x: o.x + d.x * tMin, y: o.y + d.y * tMin, z: o.z + d.z * tMin },
    normal,
  };
}

// Nearest hit within `range` across walls and every target's head/body boxes.
// Walls are tested first and ties do not displace the current best, so a wall
// touching a hitbox reads as a wall hit — cover always beats the thing behind it.
export function castHitscan(origin, dir, range, walls = [], targets = []) {
  const d = normalize(dir);
  if (!d || !(range > 0)) return null;

  let best = null;
  const consider = (hit, kind, targetId) => {
    if (!hit || hit.t > range) return;
    if (best && hit.t >= best.t) return;
    best = { kind, t: hit.t, point: hit.point, normal: hit.normal, targetId };
  };

  for (const wall of walls) consider(rayAabb(origin, d, wall), 'wall', null);
  for (const target of targets) {
    consider(rayAabb(origin, d, target.head), 'head', target.id);
    consider(rayAabb(origin, d, target.body), 'body', target.id);
  }

  return best;
}

export function applyDamage(hit, def) {
  if (!hit) return 0;
  if (hit.kind === 'head') return def.damage * def.headshotMult;
  if (hit.kind === 'body') return def.damage;
  return 0;
}
