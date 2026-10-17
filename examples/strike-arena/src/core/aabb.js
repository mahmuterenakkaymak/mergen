// Axis-aligned boxes are the only collision shape: {min:{x,y,z}, max:{x,y,z}}.
// Flush contact is deliberately NOT an intersection, so a box resting on the
// ground or pressed against a wall is never treated as penetrating.

const REST_PROBE = 1e-3;
// Overlaps shallower than this are float noise from a previous flush clamp
// (a body resting on a crate sits ~1e-16 inside it) and must not read as a wall.
const SKIN = 1e-4;

function vec3(v) {
  if (Array.isArray(v)) return { x: v[0], y: v[1], z: v[2] };
  return { x: v.x, y: v.y, z: v.z };
}

export function makeBox(center, size) {
  const c = vec3(center);
  const s = vec3(size);
  return boxFromMinMax(
    { x: c.x - s.x / 2, y: c.y - s.y / 2, z: c.z - s.z / 2 },
    { x: c.x + s.x / 2, y: c.y + s.y / 2, z: c.z + s.z / 2 },
  );
}

export function boxFromMinMax(min, max) {
  const a = vec3(min);
  const b = vec3(max);
  return { min: { x: a.x, y: a.y, z: a.z }, max: { x: b.x, y: b.y, z: b.z } };
}

export function intersects(a, b) {
  return (
    a.min.x < b.max.x && a.max.x > b.min.x &&
    a.min.y < b.max.y && a.max.y > b.min.y &&
    a.min.z < b.max.z && a.max.z > b.min.z
  );
}

export function containsPoint(box, point) {
  const p = vec3(point);
  return (
    p.x >= box.min.x && p.x <= box.max.x &&
    p.y >= box.min.y && p.y <= box.max.y &&
    p.z >= box.min.z && p.z <= box.max.z
  );
}

function overlaps(a, b) {
  return (
    a.min.x < b.max.x - SKIN && a.max.x > b.min.x + SKIN &&
    a.min.y < b.max.y - SKIN && a.max.y > b.min.y + SKIN &&
    a.min.z < b.max.z - SKIN && a.max.z > b.min.z + SKIN
  );
}

function shift(box, axis, amount) {
  const min = { x: box.min.x, y: box.min.y, z: box.min.z };
  const max = { x: box.max.x, y: box.max.y, z: box.max.z };
  min[axis] += amount;
  max[axis] += amount;
  return { min, max };
}

// Moves along one axis, then pushes the box back flush against every collider
// it ended up inside. Returns the resolved box and whether movement was blocked.
function moveAxis(box, axis, amount, colliders) {
  if (amount === 0) return { box, blocked: false };

  let cur = shift(box, axis, amount);
  let blocked = false;

  for (const c of colliders) {
    if (!overlaps(cur, c)) continue;
    blocked = true;
    const gap = amount > 0 ? c.min[axis] - cur.max[axis] : c.max[axis] - cur.min[axis];
    cur = shift(cur, axis, gap);
  }

  return { box: cur, blocked };
}

function restsOn(box, colliders) {
  const probe = shift(box, 'y', -REST_PROBE);
  return colliders.some((c) => overlaps(probe, c));
}

// Move-and-slide for player and bots: X, then Z, then Y.
export function resolveMove(box, delta, colliders = []) {
  const d = vec3(delta);

  const alongX = moveAxis(box, 'x', d.x, colliders);
  const alongZ = moveAxis(alongX.box, 'z', d.z, colliders);
  const alongY = moveAxis(alongZ.box, 'y', d.y, colliders);

  const hitWall = alongX.blocked || alongZ.blocked;
  const hitCeiling = alongY.blocked && d.y > 0;
  const onGround = (alongY.blocked && d.y < 0) ||
    (!alongY.blocked && d.y <= 0 && restsOn(alongY.box, colliders));

  return { box: alongY.box, onGround, hitCeiling, hitWall };
}
