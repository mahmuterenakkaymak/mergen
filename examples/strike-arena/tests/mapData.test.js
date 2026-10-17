import { describe, expect, it } from 'vitest';
import { MOVEMENT } from '../src/config.js';
import { intersects, makeBox } from '../src/core/aabb.js';
import {
  BOUNDS,
  CHEST_HEIGHT,
  COVER_POINTS,
  CORRIDORS,
  MID,
  SPAWN_ZONES,
  WAYPOINTS,
  getColliders,
} from '../src/core/mapData.js';

const COLLIDERS = getColliders();
const BODY = { width: MOVEMENT.playerWidth, height: MOVEMENT.playerHeight };
// Lift the probe off the floor so resting on the ground is not read as being
// inside the floor slab.
const FOOT_CLEARANCE = 0.02;

function bodyAt(p, height = BODY.height) {
  return makeBox(
    { x: p.x, y: p.y + FOOT_CLEARANCE + height / 2, z: p.z },
    { x: BODY.width, y: height, z: BODY.width },
  );
}

function insideBounds(p) {
  return (
    p.x >= BOUNDS.min.x && p.x <= BOUNDS.max.x &&
    p.y >= BOUNDS.min.y && p.y <= BOUNDS.max.y &&
    p.z >= BOUNDS.min.z && p.z <= BOUNDS.max.z
  );
}

// Sweep a box along the XZ segment and report the first collider it would hit.
function firstBlocker(from, to, buildProbe) {
  const steps = Math.max(2, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.1));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = { x: from.x + (to.x - from.x) * t, y: 0, z: from.z + (to.z - from.z) * t };
    const probe = buildProbe(p);
    const hit = COLLIDERS.find((c) => intersects(c, probe));
    if (hit) return { at: p, collider: hit };
  }
  return null;
}

const allSpawns = [...SPAWN_ZONES.T.spawns, ...SPAWN_ZONES.CT.spawns];
const allPoints = [
  ...allSpawns.map((pos) => ({ label: 'spawn', pos })),
  ...WAYPOINTS.map((w) => ({ label: `waypoint ${w.id}`, pos: w.pos })),
  ...COVER_POINTS.map((c) => ({ label: `cover ${c.id}`, pos: c.pos })),
];

const links = WAYPOINTS.flatMap((w) => w.links.map((other) => [w, WAYPOINTS.find((n) => n.id === other)]));

describe('arena layout', () => {
  it('has two spawn zones, one player spawn and five bot spawns', () => {
    expect(Object.keys(SPAWN_ZONES)).toEqual(['T', 'CT']);
    expect(SPAWN_ZONES.T.spawns).toHaveLength(1);
    expect(SPAWN_ZONES.CT.spawns).toHaveLength(5);
    // The sides face each other across the map.
    expect(Math.sign(SPAWN_ZONES.T.center.z)).toBe(-Math.sign(SPAWN_ZONES.CT.center.z));
  });

  it('keeps the mid area and the two corridors inside bounds and apart', () => {
    expect(CORRIDORS).toHaveLength(2);
    expect(insideBounds(MID.min)).toBe(true);
    expect(insideBounds(MID.max)).toBe(true);
    for (const c of CORRIDORS) {
      expect(insideBounds(c.min)).toBe(true);
      expect(insideBounds(c.max)).toBe(true);
    }
    const [west, east] = CORRIDORS;
    expect(west.max.x).toBeLessThan(MID.min.x);
    expect(east.min.x).toBeGreaterThan(MID.max.x);
  });

  it('exposes more than ten colliders', () => {
    expect(COLLIDERS.length).toBeGreaterThan(10);
  });

  it('hands out copies, so a caller cannot corrupt the shared layout', () => {
    const first = getColliders();
    first[0].min.y = -99;
    expect(getColliders()[0].min.y).not.toBe(-99);
  });
});

describe('spawn, waypoint and cover placement', () => {
  it.each(allPoints.map((p) => [p.label, p.pos]))(
    '%s is inside bounds and not inside a collider',
    (_label, pos) => {
      expect(insideBounds(pos)).toBe(true);
      const body = bodyAt(pos);
      const blocking = COLLIDERS.filter((c) => intersects(c, body));
      expect(blocking).toEqual([]);
    },
  );
});

describe('waypoint graph', () => {
  it('has unique ids and links that resolve', () => {
    const ids = WAYPOINTS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [from, to] of links) {
      expect(to, `link ${from.id} -> ??? points at a missing waypoint`).toBeDefined();
    }
  });

  it('links symmetrically in both directions', () => {
    for (const [from, to] of links) {
      expect(to.links, `${to.id} does not link back to ${from.id}`).toContain(from.id);
    }
  });

  it.each(links.map(([a, b]) => [`${a.id} -> ${b.id}`, a, b]))(
    'the segment %s is clear at chest height',
    (_label, a, b) => {
      const probe = (p) => makeBox({ x: p.x, y: CHEST_HEIGHT, z: p.z }, { x: 0.4, y: 0.3, z: 0.4 });
      expect(firstBlocker(a.pos, b.pos, probe)).toBeNull();
    },
  );

  it.each(links.map(([a, b]) => [`${a.id} -> ${b.id}`, a, b]))(
    'the segment %s is clear for a standing body',
    (_label, a, b) => {
      expect(firstBlocker(a.pos, b.pos, (p) => bodyAt(p))).toBeNull();
    },
  );
});
