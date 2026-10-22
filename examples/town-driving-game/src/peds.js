// Pedestrians: walkers pacing a block's sidewalk edge, back and forth, panic-running
// from the car when it clips them. Pure sim — the actor view reads x/z/axis/dir/phase.
import { CONFIG } from './config.js';
import { clamp } from './util/math.js';

const INSET = 1.4; // m: a walker's line, off the kerb onto the sidewalk slab
// ASSUMPTION: "stay in bounds" = a walker never leaves its sidewalk band, so a shove can
// never put it in the road, in a building or outside the perimeter wall.
const BAND = 1.2; // m: how far off that line a shove or a panic dart may push a walker
const WALK_SPEED = 1.35;
const PANIC_SPEED = 4.2;
const PANIC_TIME = 3; // s a clip keeps a walker running
const FLEE_SLIDE = 0.4; // fraction of the flee speed spent off the sidewalk line
const MIN_SCARE = 3.5; // m/s: slower than this the car only nudges past them
const PED_R = 0.45; // m: walker radius, added to the car's for a clip
const HORN_RADIUS = 12; // m: within this of the horn, a walker hears it
const FLINCH_TIME = 0.5; // s a blast keeps a walker off balance
const FLINCH_SPEED = 3.4; // m/s the sidestep starts at, fading out to nothing
const WALK_PHASE = 7; // rad/s of leg swing, doubled in a panic

export function makePeds(rng, town, cfg = CONFIG) {
  const peds = [];
  for (let i = 0; i < cfg.peds.count; i++) {
    const b = rng.pick(town.blocks);
    const edge = rng.int(0, 3);
    const alongX = edge < 2; // edges 0/1 are the block's z faces, walked along x
    const lo = (alongX ? b.x : b.z) + INSET;
    const hi = (alongX ? b.x + b.w : b.z + b.h) - INSET;
    const cross = edge % 2 === 0
      ? (alongX ? b.z : b.x) + INSET
      : (alongX ? b.z + b.h : b.x + b.w) - INSET;
    peds.push({
      axis: alongX ? 'x' : 'z',
      dir: rng.float() < 0.5 ? 1 : -1,
      lo,
      hi,
      cross,
      x: alongX ? rng.range(lo, hi) : cross,
      z: alongX ? cross : rng.range(lo, hi),
      phase: rng.range(0, Math.PI * 2),
      panic: 0,
      flinch: 0,
      color: rng.pick(cfg.colors.peds),
    });
  }
  return peds;
}

// One frame for every walker: pace the block edge, flinch off a horn, sprint off the car
// while panicked, and get shoved clear of it when it overlaps.
// ASSUMPTION: like damage.js, stepPeds returns what happened (the events for the caller
// to append to world.events) — one `watchOut` per clip, not one per frame.
export function stepPeds(peds, car, dt, cfg = CONFIG) {
  const events = [];
  const min = cfg.car.radius + PED_R;
  const fast = Math.abs(car.speed) > MIN_SCARE;

  for (const p of peds) {
    const alongX = p.axis === 'x';
    // Every move happens in the walker's own frame: `along` paces between the block's
    // ends, `across` sits on p.cross. That keeps the sidewalk rules in one place.
    let along = alongX ? p.x : p.z;
    let across = alongX ? p.z : p.x;
    const carAlong = alongX ? car.x : car.z;
    const carAcross = alongX ? car.z : car.x;

    let sp = WALK_SPEED;
    if (p.panic > 0) {
      p.panic -= dt;
      sp = PANIC_SPEED;
      const da = along - carAlong, dc = across - carAcross;
      const d = Math.hypot(da, dc) || 1;
      p.dir = da >= 0 ? 1 : -1; // sprint away along the pavement...
      along += (da / d) * sp * FLEE_SLIDE * dt;
      across += (dc / d) * sp * FLEE_SLIDE * dt; // ...darting off it a little
      along += p.dir * sp * dt;
    } else if (p.flinch > 0) {
      // A horn within earshot: the walker quits its stride to get off the car's side, the
      // step easing out over the flinch so it walks on again instead of snapping upright.
      p.flinch = Math.max(0, p.flinch - dt);
      sp = FLINCH_SPEED * (p.flinch / FLINCH_TIME);
      const da = along - carAlong, dc = across - carAcross;
      const d = Math.hypot(da, dc) || 1;
      along += (da / d) * sp * dt;
      across += (dc / d) * sp * dt;
    } else {
      along += p.dir * WALK_SPEED * dt;
    }
    if (along < p.lo) { along = p.lo; p.dir = 1; }
    else if (along > p.hi) { along = p.hi; p.dir = -1; }

    const da = along - carAlong, dc = across - carAcross;
    const d = Math.hypot(da, dc);
    if (d < min) {
      // Clipped: stand the walker on the car's shoulder. Directly under it there is no
      // side to pick, so it goes across the pavement, away from the kerb.
      const inv = d > 1e-6 ? (min - d) / d : 1;
      along += (d > 1e-6 ? da : 0) * inv;
      across += (d > 1e-6 ? dc : 1) * inv;
      if (fast) {
        if (p.panic <= 0) {
          events.push({ type: 'watchOut', x: alongX ? along : across, z: alongX ? across : along });
        }
        p.panic = PANIC_TIME;
      }
    }

    // Last word, so a shove can never put a walker in the road, in a building or out
    // of the world: a car on the kerb slides one along the pavement instead of through it.
    along = clamp(along, p.lo, p.hi);
    across = clamp(across, p.cross - BAND, p.cross + BAND);
    if (alongX) { p.x = along; p.z = across; } else { p.z = along; p.x = across; }
    p.phase += dt * (sp > WALK_SPEED ? WALK_PHASE * 2 : WALK_PHASE);
  }
  return events;
}

// The player's horn: every walker close enough to hear it flinches and steps off the car's
// side, which stepPeds moves out of the flinch it leaves running. Only a startle — it takes
// the car actually clipping them to make one run.
export function startlePeds(peds, car) {
  for (const p of peds) {
    if (Math.hypot(p.x - car.x, p.z - car.z) <= HORN_RADIUS) p.flinch = FLINCH_TIME;
  }
}
