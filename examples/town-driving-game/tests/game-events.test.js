import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createGame, stepGame } from '../src/game.js';
import { eventsToHud } from '../src/hud/hud.js';

// M3's feedback loop, headless. A scripted wall hit has to reach every view channel at
// once — the `impact` event (thud + vignette + toasts), the particle pool (sparks) and
// world.damage (bar, paint, bonnet smoke) — and the world the M3 views read (traffic,
// pedestrians, skid marks) has to be there and moving.
const DT = 1 / 60;
const R = CONFIG.car.radius;
const idle = { throttle: 0, brake: 0, steer: 0, handbrake: 0, horn: 0 };
const gas = { throttle: 1, brake: 0, steer: 0, handbrake: 0, horn: 0 };

const events = (w, type) => w.events.filter((e) => e.type === type);
const alive = (w) => Array.from(w.particles.life).filter((l) => l > 0).length;

// A world whose car sits `runway` m from the first building's face (buildings come first
// in the collider list). Traffic is cleared so the wall is the only thing that can touch it.
function atWall() {
  const w = createGame();
  w.traffic.length = 0;
  return { w, box: w.town.aabbs[0] };
}

// Put the car back on its run line at `speed` m/s and coast it into the face.
function slam(w, box, speed, runway = 3) {
  const car = w.car;
  car.x = (box.minX + box.maxX) / 2;
  car.z = box.minZ - R - runway;
  car.heading = 0; // faces +z, straight at the wall
  car.vx = 0;
  car.vz = speed;
  car.speed = speed;
  for (let i = 0; i < 120; i++) {
    stepGame(w, idle, DT);
    const hit = events(w, 'impact')[0];
    if (hit) return hit;
  }
  throw new Error('the car never reached the wall');
}

describe('a wall hit', () => {
  it('emits an impact, costs paint, shakes the camera and throws sparks', () => {
    const { w, box } = atWall();
    const hit = slam(w, box, 25);

    expect(hit.speed).toBeGreaterThan(20);
    expect(w.damage.damage).toBeGreaterThan(0);
    expect(w.cam.shake).toBeGreaterThan(0);
    expect(alive(w)).toBeGreaterThan(0);

    // sparks at the scraped wall face, not at the car that threw them
    const p = w.particles.pos;
    for (let i = 0; i < w.particles.capacity; i++) {
      if (w.particles.life[i] <= 0) continue;
      expect(Math.abs(p[i * 3] - hit.contact.x)).toBeLessThan(0.5);
      expect(Math.abs(p[i * 3 + 2] - hit.contact.z)).toBeLessThan(0.5);
    }
  });

  it('dresses the impact event with the flash and overheat flag the HUD reads', () => {
    const { w, box } = atWall();
    const hit = slam(w, box, 25);

    expect(hit.vignette).toBeGreaterThan(0);
    expect(hit.overheat).toBe(false);
    // the HUD takes the flash off the event, so the bar and the red flash agree
    expect(eventsToHud([hit], 0).vignette).toBeCloseTo(hit.vignette, 6);
  });

  it('cooks the engine after enough hits: one impact carries overheat, and it toasts', () => {
    const { w, box } = atWall();
    const hits = [];
    for (let i = 0; i < 4; i++) {
      hits.push(slam(w, box, 25));
      if (w.damage.smoking) break;
    }

    expect(w.damage.smoking).toBe(true);
    expect(hits.filter((h) => h.overheat)).toHaveLength(1); // warned once, until repaired
    expect(eventsToHud(hits, 0).toasts).toContain('ENGINE OVERHEATING — R TO REPAIR');
  });

  it('a scrape under the damage floor still thuds but costs no paint and throws no sparks', () => {
    const { w, box } = atWall();
    const hit = slam(w, box, 4, 1);

    expect(hit.speed).toBeGreaterThan(1); // over game.js's MIN_IMPACT: worth a thud
    expect(w.damage.damage).toBe(0);
    expect(hit.vignette).toBe(0);
    expect(alive(w)).toBe(0);
  });
});

describe('the world the M3 views read', () => {
  it('comes with pedestrians, and they walk', () => {
    const w = createGame();
    expect(w.peds).toHaveLength(CONFIG.peds.count);

    const p = w.peds[0];
    const { x, z } = p;
    for (let i = 0; i < 60; i++) stepGame(w, idle, DT);
    expect(Math.hypot(p.x - x, p.z - z)).toBeGreaterThan(0.5);
  });

  it('raises a watchOut event when the car clips a walker at speed', () => {
    const w = createGame();
    w.traffic.length = 0;
    const car = w.car;

    // stand one walker on the car's own line, just ahead of its nose
    const p = w.peds[0];
    p.axis = 'z';
    p.cross = car.x;
    p.lo = car.z;
    p.hi = car.z + 40;
    p.x = car.x;
    p.z = car.z + 2;
    p.dir = 1;
    p.panic = 0;
    car.vz = 12;
    car.speed = 12;

    stepGame(w, gas, DT);
    expect(events(w, 'watchOut')).toHaveLength(1);
  });

  it('lays skid marks while the car slides on the handbrake', () => {
    const w = createGame();
    w.traffic.length = 0;
    const drift = { throttle: 0, brake: 0, steer: 0.6, handbrake: 1, horn: 0 };

    for (let i = 0; i < 60; i++) stepGame(w, gas, DT); // a run down the spawn road
    expect(w.skids.count).toBe(0); // nothing laid down while it grips
    for (let i = 0; i < 5; i++) stepGame(w, drift, DT);
    expect(w.skids.count).toBeGreaterThan(0);
  });
});
