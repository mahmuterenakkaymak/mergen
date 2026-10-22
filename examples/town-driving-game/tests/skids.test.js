import { describe, it, expect } from 'vitest';
import { createSkids, emitSkids } from '../src/fx/skids.js';
import { CONFIG } from '../src/config.js';

const car = (over) => ({ x: 0, z: 0, heading: 0, skidding: false, ...over });

describe('createSkids', () => {
  it('starts with the configured pool, nothing written yet', () => {
    const p = createSkids();
    expect(p.capacity).toBe(CONFIG.fx.skids);
    expect(p.x.length).toBe(CONFIG.fx.skids);
    expect(p.z.length).toBe(CONFIG.fx.skids);
    expect(p.heading.length).toBe(CONFIG.fx.skids);
    expect(p.count).toBe(0);
    expect(p.head).toBe(0);
  });
});

describe('emitSkids', () => {
  it('writes nothing while the car grips the road', () => {
    const p = createSkids(8);
    emitSkids(p, car({ x: 4, heading: 1 }));
    expect(p.count).toBe(0);
    expect(p.head).toBe(0);
  });

  it('drops a quad under each rear wheel while skidding', () => {
    const p = createSkids(8);
    // heading 0: forward = +z, right = +x → rear wheels at x ±0.95, z −1.35
    emitSkids(p, car({ skidding: true }));
    expect(p.count).toBe(2);
    expect(p.head).toBe(2);
    expect(p.z[0]).toBeCloseTo(-1.35, 5);
    expect(p.z[1]).toBeCloseTo(-1.35, 5);
    expect(p.x[0]).toBeCloseTo(-0.95, 5);
    expect(p.x[1]).toBeCloseTo(0.95, 5);
    expect(p.heading[0]).toBe(0);
    expect(p.heading[1]).toBe(0);
  });

  it('lays the quads behind the car along its heading', () => {
    const p = createSkids(8);
    // heading π/2: forward = +x, right = −z → rear wheels at x 10−1.35, z 5∓0.95
    emitSkids(p, car({ x: 10, z: 5, heading: Math.PI / 2, skidding: true }));
    expect(p.x[0]).toBeCloseTo(10 - 1.35, 4);
    expect(p.x[1]).toBeCloseTo(10 - 1.35, 4);
    expect(p.z[0]).toBeCloseTo(5 + 0.95, 4);
    expect(p.z[1]).toBeCloseTo(5 - 0.95, 4);
    expect(p.heading[0]).toBeCloseTo(Math.PI / 2, 6);
  });

  it('overwrites the oldest quads once the pool wraps and never grows', () => {
    const p = createSkids(4);
    for (let k = 0; k < 4; k++) emitSkids(p, car({ x: k, skidding: true }));
    expect(p.count).toBe(4);
    expect(p.head).toBe(0);

    emitSkids(p, car({ x: 99, skidding: true })); // overwrites slots 0 and 1
    expect(p.x.length).toBe(4);
    expect(p.count).toBe(4);
    expect(p.x[0]).toBeCloseTo(99 - 0.95, 4);
    expect(p.x[1]).toBeCloseTo(99 + 0.95, 4);
    expect(p.x[2]).toBeCloseTo(3 - 0.95, 4); // the rest still holds the last lap
    expect(p.x[3]).toBeCloseTo(3 + 0.95, 4);
    expect(p.head).toBe(2);
  });
});
