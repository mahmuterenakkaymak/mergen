// Pure ring buffer of skid quads. Fixed capacity, the oldest quad is overwritten when the
// pool wraps, so a long drift never allocates. A quad is a flat plane lying on the road,
// so x/z/heading is all the InstancedMesh view needs; `count` tells it how many slots hold
// a real mark before the pool has filled once.
import { CONFIG } from '../config.js';

const REAR_AXLE = 1.35; // m behind the car centre the rear wheels sit at
const WHEEL_SPREAD = 0.95; // m lateral offset of each rear wheel from the centre line

export function createSkids(capacity = CONFIG.fx.skids) {
  return {
    capacity,
    head: 0,
    count: 0, // slots written at least once, capped at capacity
    x: new Float32Array(capacity),
    z: new Float32Array(capacity),
    heading: new Float32Array(capacity),
  };
}

// Drop one quad under each rear wheel while the car skids; nothing otherwise.
// ASSUMPTION: the prototype's 0.85 per-frame emission chance is dropped — deterministic
// emission keeps runs replayable (PLAN determinism) and overlapping quads set density anyway.
export function emitSkids(pool, car) {
  if (!car.skidding) return;
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  const rx = Math.cos(car.heading);
  const rz = -Math.sin(car.heading);

  for (const s of [-WHEEL_SPREAD, WHEEL_SPREAD]) {
    const i = pool.head;
    pool.head = (pool.head + 1) % pool.capacity;
    if (pool.count < pool.capacity) pool.count++;
    pool.x[i] = car.x - fx * REAR_AXLE + rx * s;
    pool.z[i] = car.z - fz * REAR_AXLE + rz * s;
    pool.heading[i] = car.heading;
  }
}
