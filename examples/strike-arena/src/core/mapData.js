// The arena as pure data: no Three.js, no DOM. Meters, Y-up, yaw 0 looks toward -Z.
// T side is +Z (1 player spawn), CT side is -Z (5 bot spawns). The layout is
// point-symmetric about the origin, so both sides get the same cover and angles.

import { MOVEMENT } from '../config.js';
import { boxFromMinMax, makeBox } from './aabb.js';

const ARENA_HALF_X = 20;
const ARENA_HALF_Z = 14;
const WALL_HEIGHT = 6;
const WALL_THICKNESS = 1;
const DIVIDER_X = 9; // interior walls that split mid from the two side corridors
const DIVIDER_HALF_Z = 6; // their z extent; the ends are the openings between lanes

// Playable volume. The floor sits just below min.y and the outer walls just
// outside min/max, so their inner faces are exactly the bounds.
export const BOUNDS = {
  min: { x: -ARENA_HALF_X, y: 0, z: -ARENA_HALF_Z },
  max: { x: ARENA_HALF_X, y: WALL_HEIGHT, z: ARENA_HALF_Z },
};

// Reference height for line-of-path checks: a bot can walk past anything lower.
export const CHEST_HEIGHT = MOVEMENT.playerHeight * 0.7;

const SPAN_X = 2 * ARENA_HALF_X + 2 * WALL_THICKNESS;
const SPAN_Z = 2 * ARENA_HALF_Z + 2 * WALL_THICKNESS;
const WALL_Y = WALL_HEIGHT / 2;

const FLOOR = makeBox(
  { x: 0, y: -WALL_THICKNESS / 2, z: 0 },
  { x: SPAN_X, y: WALL_THICKNESS, z: SPAN_Z },
);

const OUTER_WALLS = [
  makeBox({ x: 0, y: WALL_Y, z: -(ARENA_HALF_Z + WALL_THICKNESS / 2) }, { x: SPAN_X, y: WALL_HEIGHT, z: WALL_THICKNESS }),
  makeBox({ x: 0, y: WALL_Y, z: ARENA_HALF_Z + WALL_THICKNESS / 2 }, { x: SPAN_X, y: WALL_HEIGHT, z: WALL_THICKNESS }),
  makeBox({ x: -(ARENA_HALF_X + WALL_THICKNESS / 2), y: WALL_Y, z: 0 }, { x: WALL_THICKNESS, y: WALL_HEIGHT, z: SPAN_Z }),
  makeBox({ x: ARENA_HALF_X + WALL_THICKNESS / 2, y: WALL_Y, z: 0 }, { x: WALL_THICKNESS, y: WALL_HEIGHT, z: SPAN_Z }),
];

const DIVIDERS = [
  makeBox({ x: -DIVIDER_X, y: WALL_Y, z: 0 }, { x: WALL_THICKNESS, y: WALL_HEIGHT, z: 2 * DIVIDER_HALF_Z }),
  makeBox({ x: DIVIDER_X, y: WALL_Y, z: 0 }, { x: WALL_THICKNESS, y: WALL_HEIGHT, z: 2 * DIVIDER_HALF_Z }),
];

// Cover boxes. `jumpable` crates are within reach of a standing jump; `stackable`
// ones are the base of a two-high pile (the crate on top is its own entry).
const CRATES = [
  { id: 'mid_west', center: { x: -4, y: 0.5, z: 0 }, size: { x: 1.5, y: 1, z: 1.5 }, jumpable: true, stackable: false },
  { id: 'mid_east', center: { x: 4, y: 0.5, z: 0 }, size: { x: 1.5, y: 1, z: 1.5 }, jumpable: true, stackable: false },
  { id: 'mid_north', center: { x: 3, y: 0.5, z: -6 }, size: { x: 1.5, y: 1, z: 1.5 }, jumpable: true, stackable: false },
  { id: 'mid_south', center: { x: -3, y: 0.5, z: 6 }, size: { x: 1.5, y: 1, z: 1.5 }, jumpable: true, stackable: false },

  { id: 'stack_south_base', center: { x: -6, y: 0.3, z: -7 }, size: { x: 2, y: 0.6, z: 2 }, jumpable: true, stackable: true },
  { id: 'stack_south_top', center: { x: -6, y: 0.9, z: -7 }, size: { x: 1.2, y: 0.6, z: 1.2 }, jumpable: false, stackable: true },
  { id: 'stack_north_base', center: { x: 6, y: 0.3, z: 7 }, size: { x: 2, y: 0.6, z: 2 }, jumpable: true, stackable: true },
  { id: 'stack_north_top', center: { x: 6, y: 0.9, z: 7 }, size: { x: 1.2, y: 0.6, z: 1.2 }, jumpable: false, stackable: true },

  { id: 'west_far_north', center: { x: -17, y: 0.5, z: 4 }, size: { x: 1.5, y: 1, z: 1.5 }, jumpable: true, stackable: false },
  { id: 'west_far_south', center: { x: -17, y: 0.5, z: -4 }, size: { x: 1.5, y: 1, z: 1.5 }, jumpable: true, stackable: false },
  { id: 'west_near_north', center: { x: -12, y: 0.5, z: 6 }, size: { x: 1.5, y: 1, z: 1.5 }, jumpable: true, stackable: false },
  { id: 'west_near_south', center: { x: -12, y: 0.5, z: -6 }, size: { x: 1.5, y: 1, z: 1.5 }, jumpable: true, stackable: false },

  { id: 'east_far_south', center: { x: 17, y: 0.5, z: -4 }, size: { x: 1.5, y: 1, z: 1.5 }, jumpable: true, stackable: false },
  { id: 'east_far_north', center: { x: 17, y: 0.5, z: 4 }, size: { x: 1.5, y: 1, z: 1.5 }, jumpable: true, stackable: false },
  { id: 'east_near_south', center: { x: 12, y: 0.5, z: -6 }, size: { x: 1.5, y: 1, z: 1.5 }, jumpable: true, stackable: false },
  { id: 'east_near_north', center: { x: 12, y: 0.5, z: 6 }, size: { x: 1.5, y: 1, z: 1.5 }, jumpable: true, stackable: false },

  { id: 't_west', center: { x: -6, y: 0.5, z: 12.5 }, size: { x: 1.5, y: 1, z: 1.5 }, jumpable: true, stackable: false },
  { id: 't_east', center: { x: 6, y: 0.5, z: 12.5 }, size: { x: 1.5, y: 1, z: 1.5 }, jumpable: true, stackable: false },
  { id: 'ct_west', center: { x: -6, y: 0.5, z: -12.5 }, size: { x: 1.5, y: 1, z: 1.5 }, jumpable: true, stackable: false },
  { id: 'ct_east', center: { x: 6, y: 0.5, z: -12.5 }, size: { x: 1.5, y: 1, z: 1.5 }, jumpable: true, stackable: false },
];

const CRATE_BOXES = CRATES.map((c) => makeBox(c.center, c.size));

const COLLIDERS = [FLOOR, ...OUTER_WALLS, ...DIVIDERS, ...CRATE_BOXES];

// Fresh boxes every call: a caller clamping or shifting one must never corrupt
// the shared layout the next round reads.
export function getColliders() {
  return COLLIDERS.map((b) => boxFromMinMax(b.min, b.max));
}

export const SPAWN_ZONES = {
  T: {
    name: 'T',
    center: { x: 0, y: 0, z: 12 },
    spawns: [{ x: 0, y: 0, z: 12 }],
  },
  CT: {
    name: 'CT',
    center: { x: 0, y: 0, z: -12 },
    spawns: [
      { x: -8, y: 0, z: -12 },
      { x: -4, y: 0, z: -12 },
      { x: 0, y: 0, z: -12 },
      { x: 4, y: 0, z: -12 },
      { x: 8, y: 0, z: -12 },
    ],
  },
};

// Open central lane between the two dividers.
export const MID = {
  min: { x: -(DIVIDER_X - 1), y: 0, z: -ARENA_HALF_Z },
  max: { x: DIVIDER_X - 1, y: WALL_HEIGHT, z: ARENA_HALF_Z },
};

// The two outer lanes. Each is walled off from mid in its middle section, so
// reaching mid means running around the end of a divider.
export const CORRIDORS = [
  {
    id: 'west',
    min: { x: -ARENA_HALF_X, y: 0, z: -ARENA_HALF_Z },
    max: { x: -(DIVIDER_X + 1), y: WALL_HEIGHT, z: ARENA_HALF_Z },
  },
  {
    id: 'east',
    min: { x: DIVIDER_X + 1, y: 0, z: -ARENA_HALF_Z },
    max: { x: ARENA_HALF_X, y: WALL_HEIGHT, z: ARENA_HALF_Z },
  },
];

// Foot positions a bot can back up to for cover, one per crate face that opens on
// a lane. `pos` is where the feet go; `facing` is the yaw to look over the crate.
export const COVER_POINTS = [
  { id: 'cover_mid_west', pos: { x: -4, y: 0, z: 1.6 }, facing: 0 },
  { id: 'cover_mid_east', pos: { x: 4, y: 0, z: -1.6 }, facing: Math.PI },
  { id: 'cover_mid_north', pos: { x: 3, y: 0, z: -4.4 }, facing: 0 },
  { id: 'cover_mid_south', pos: { x: -3, y: 0, z: 4.4 }, facing: Math.PI },
  { id: 'cover_stack_south', pos: { x: -6, y: 0, z: -5.4 }, facing: 0 },
  { id: 'cover_stack_north', pos: { x: 6, y: 0, z: 5.4 }, facing: Math.PI },
  { id: 'cover_west_far', pos: { x: -15.4, y: 0, z: 4 }, facing: Math.PI / 2 },
  { id: 'cover_east_far', pos: { x: 15.4, y: 0, z: -4 }, facing: -Math.PI / 2 },
  { id: 'cover_west_near', pos: { x: -12, y: 0, z: 4.4 }, facing: Math.PI },
  { id: 'cover_east_near', pos: { x: 12, y: 0, z: -4.4 }, facing: 0 },
];

// Bot navigation nodes. Bots only ever walk straight between two linked nodes, so
// every link is a clear line at body height.
export const WAYPOINTS = [
  { id: 't', pos: { x: 0, y: 0, z: 11 }, links: ['mid_s', 'west_s', 'east_s'] },
  { id: 'mid_s', pos: { x: 0, y: 0, z: 9 }, links: ['t', 'mid_c', 'west_s', 'east_s'] },
  { id: 'mid_c', pos: { x: 0, y: 0, z: 0 }, links: ['mid_s', 'mid_n'] },
  { id: 'mid_n', pos: { x: 0, y: 0, z: -9 }, links: ['mid_c', 'ct', 'west_n', 'east_n'] },
  { id: 'ct', pos: { x: 0, y: 0, z: -11 }, links: ['mid_n', 'west_n', 'east_n'] },
  { id: 'west_s', pos: { x: -14, y: 0, z: 10 }, links: ['t', 'mid_s', 'west_c'] },
  { id: 'west_c', pos: { x: -14, y: 0, z: 0 }, links: ['west_s', 'west_n'] },
  { id: 'west_n', pos: { x: -14, y: 0, z: -10 }, links: ['west_c', 'mid_n', 'ct'] },
  { id: 'east_s', pos: { x: 14, y: 0, z: 10 }, links: ['t', 'mid_s', 'east_c'] },
  { id: 'east_c', pos: { x: 14, y: 0, z: 0 }, links: ['east_s', 'east_n'] },
  { id: 'east_n', pos: { x: 14, y: 0, z: -10 }, links: ['east_c', 'mid_n', 'ct'] },
];

export const MAP_DATA = {
  bounds: BOUNDS,
  spawnZones: SPAWN_ZONES,
  mid: MID,
  corridors: CORRIDORS,
  coverPoints: COVER_POINTS,
  waypoints: WAYPOINTS,
  crates: CRATES,
};

export default MAP_DATA;
