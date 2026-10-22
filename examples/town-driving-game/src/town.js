// Seeded town layout. Part 1 (T20): road centre lines, blocks with their sidewalk
// rects, parks, world bounds and the spawn point. Part 2 (T21): buildings, trees and
// ponds. Part 3 (T22): streetlights, road dashes and the collider list.
import { CONFIG } from './config.js';
import { createRng } from './util/rng.js';

const PARK_CHANCE = 0.16;
const LOT_TREE_CHANCE = 0.14; // an empty lot gets a tree instead of a building
const POND_CHANCE = 0.5; // per park
const LOT_MARGIN_MIN = 2.5; // building inset from its lot edges (m)
const LOT_MARGIN_MAX = 5;
const DOWNTOWN_R = 0.22; // height bands, as a fraction of the world size
const MID_R = 0.4;
const LIGHT_INSET = 0.6; // streetlight pole, off the kerb onto the sidewalk (m)
const DASH_GAP = 2; // dashes stop this far before a crossing so the junction stays clear
const DASH_STEP = 7; // one dash every 7 m along a road (2.4 m mark + gap)
const TRUNK_R = 0.5; // tree trunk collider half-size (m)

export function generateTown(seed = CONFIG.seed, cfg = CONFIG) {
  const cell = cfg.block + cfg.road;
  // Road centre line i. The grid is square, so one list of centres serves both axes.
  const rc = (i) => i * cell;
  const rng = createRng(seed).fork('town');

  const roads = [];
  for (let i = 0; i <= cfg.grid; i++) roads.push(rc(i));

  const blocks = [];
  for (let bi = 0; bi < cfg.grid; bi++) {
    for (let bj = 0; bj < cfg.grid; bj++) {
      blocks.push({
        x: rc(bi) + cfg.road / 2,
        z: rc(bj) + cfg.road / 2,
        w: cfg.block,
        h: cfg.block,
        park: rng.float() < PARK_CHANCE,
      });
    }
  }

  // The perimeter wall closes the town just outside the outer roads; the car is clamped in.
  const pad = cfg.road / 2 + 1;
  const outer = cfg.grid * cell;
  const bounds = { minX: -pad, maxX: outer + pad, minZ: -pad, maxZ: outer + pad };

  // ASSUMPTION: spawn in the right lane of the centre road, mid-block so the car does
  // not start in a crossing; heading 0 faces +z (car.js), i.e. along that road, and the
  // right of that direction is -x — so the lane sits at centre - road/4 (traffic, T33).
  const mid = Math.round(cfg.grid / 2);
  const spawn = { x: rc(mid) - cfg.road / 4, z: rc(mid) - cell / 2, heading: 0 };

  // Part 2 (T21): 2x2 lots per block. A forked stream, so the park pattern above —
  // and every earlier draw — stays put when props grow.
  const p = rng.fork('buildings');
  const buildings = [];
  const trees = [];
  const ponds = [];

  for (const b of blocks) {
    const cx = b.x + b.w / 2;
    const cz = b.z + b.h / 2;
    if (b.park) {
      // ASSUMPTION: the pond is drawn before the trees so none of them lands in the water.
      const pond = p.float() < POND_CHANCE ? { x: cx, z: cz, r: p.range(4, 7) } : null;
      if (pond) ponds.push(pond);
      for (let k = p.int(4, 8); k > 0; k--) {
        const x = p.range(b.x + 5, b.x + b.w - 5);
        const z = p.range(b.z + 5, b.z + b.h - 5);
        if (!pond || Math.hypot(x - pond.x, z - pond.z) > pond.r + 2) trees.push({ x, z });
      }
      continue;
    }
    const lot = b.w / 2;
    for (let li = 0; li < 2; li++) {
      for (let lj = 0; lj < 2; lj++) {
        const lx = b.x + li * lot;
        const lz = b.z + lj * lot;
        if (p.float() < LOT_TREE_CHANCE) {
          trees.push({ x: lx + lot / 2, z: lz + lot / 2 });
          continue;
        }
        const m = p.range(LOT_MARGIN_MIN, LOT_MARGIN_MAX);
        const w = p.range(lot * 0.45, lot - m * 2);
        const d = p.range(lot * 0.45, lot - m * 2);
        const x = lx + m + p.float() * (lot - m * 2 - w);
        const z = lz + m + p.float() * (lot - m * 2 - d);
        const dist = Math.hypot(x + w / 2 - outer / 2, z + d / 2 - outer / 2);
        const height = dist < outer * DOWNTOWN_R ? p.range(18, 42)
          : dist < outer * MID_R ? p.range(9, 26)
          : p.range(6, 15);
        buildings.push({ x, z, w, d, height, facade: p.int(0, cfg.palette.length - 1) });
      }
    }
  }

  // Part 3 (T22): props and colliders. Pure geometry off the fixed grid — no rng draws —
  // so adding them leaves every layout the earlier parts produced unchanged.
  const kerb = cfg.road / 2 + LIGHT_INSET;
  const lights = [];
  for (const ix of roads) {
    for (const iz of roads) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) lights.push({ x: ix + sx * kerb, z: iz + sz * kerb });
      }
    }
  }

  // One run of centre-line dashes per block side. ASSUMPTION: rot is the yaw the
  // instanced mark needs — 0 runs along +z, PI/2 along +x.
  const dashes = [];
  for (const c of roads) {
    for (let s = 0; s < cfg.grid; s++) {
      const from = s * cell + cfg.road / 2 + DASH_GAP;
      const to = (s + 1) * cell - cfg.road / 2 - DASH_GAP;
      for (let d = from; d < to; d += DASH_STEP) {
        dashes.push({ x: c, z: d, rot: 0 });
        dashes.push({ x: d, z: c, rot: Math.PI / 2 });
      }
    }
  }

  // Colliders for the car: buildings and tree trunks. The world bounds are a separate
  // clamp, not a box, so the perimeter wall stays out of this list.
  const aabbs = buildings.map((b) => ({ minX: b.x, maxX: b.x + b.w, minZ: b.z, maxZ: b.z + b.d }));
  for (const t of trees) {
    aabbs.push({ minX: t.x - TRUNK_R, maxX: t.x + TRUNK_R, minZ: t.z - TRUNK_R, maxZ: t.z + TRUNK_R });
  }

  return { roads, blocks, bounds, spawn, buildings, trees, ponds, lights, dashes, aabbs };
}
