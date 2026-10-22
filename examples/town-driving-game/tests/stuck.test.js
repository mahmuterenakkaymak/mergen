// T43: the stuck rescue. A buried throttle going nowhere asks to be rescued, and R fades
// the screen out, puts the car on the nearest road centre facing along it, and fades back.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CONFIG } from '../src/config.js';
import { createGame, stepGame } from '../src/game.js';
import { applyImpact } from '../src/damage.js';
import { eventsToHud } from '../src/hud/hud.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(path.join(here, '..', 'src', f), 'utf8');

const DT = 1 / 60;
const idle = { throttle: 0, brake: 0, steer: 0, handbrake: 0, horn: 0 };
const gas = { ...idle, throttle: 1 };
const rKey = { ...idle, reset: 1 };

// Every event the run raised, not just the last frame's — stepGame empties the queue.
function collect(world, controls, seconds) {
  const all = [];
  for (let t = 0; t < seconds; t += DT) {
    stepGame(world, controls, DT);
    all.push(...world.events);
  }
  return all;
}

const stuckIn = (events) => events.filter((e) => e.type === 'stuck');
const resetsIn = (events) => events.filter((e) => e.type === 'reset');

// A fresh world with the AI cars gone: these tests are about a wall and a road, and a
// traffic shove between the R press and the blackout would move the car on purpose.
function alone() {
  const w = createGame();
  w.traffic.length = 0;
  return w;
}

// Nose against the perimeter wall: the bounds clamp hands back every m/s the throttle
// gives, so the car sits at 0 speed with the throttle buried — the state the ask is for.
function pinned() {
  const w = alone();
  w.car.x = w.town.bounds.maxX - CONFIG.car.radius;
  w.car.z = 100;
  w.car.heading = Math.PI / 2; // faces +x, straight into the wall
  return w;
}

// R is a fade, not a snap: press it, then run the frames the blackout needs.
function rescue(world, frames = 72, held = false) {
  const all = [];
  for (let i = 0; i < frames; i++) {
    stepGame(world, i === 0 || held ? rKey : idle, DT);
    all.push(...world.events);
  }
  return all;
}

// m from the car to the nearest collider, so a respawn can be proven clear of the town.
function clearance(w) {
  return Math.min(...w.town.aabbs.map((a) => Math.hypot(
    Math.max(a.minX - w.car.x, 0, w.car.x - a.maxX),
    Math.max(a.minZ - w.car.z, 0, w.car.z - a.maxZ),
  )));
}

describe('stuck detection', () => {
  it('asks after 2.5 s of throttle at a standstill', () => {
    const w = pinned();
    expect(stuckIn(collect(w, gas, 2.3))).toHaveLength(0);
    expect(stuckIn(collect(w, gas, 0.4))).toHaveLength(1);
  });

  it('asks once, not once a frame, while the car stays stuck', () => {
    expect(stuckIn(collect(pinned(), gas, 8))).toHaveLength(1);
  });

  it('says nothing while the car is rolling', () => {
    expect(stuckIn(collect(createGame(), gas, 8))).toHaveLength(0);
  });

  it('says nothing to a parked car with no throttle', () => {
    expect(stuckIn(collect(pinned(), idle, 8))).toHaveLength(0);
  });

  it('asks again once the throttle comes off and goes back on', () => {
    const w = pinned();
    expect(stuckIn(collect(w, gas, 3))).toHaveLength(1);
    collect(w, idle, 0.2);
    expect(stuckIn(collect(w, gas, 3))).toHaveLength(1);
  });

  it('shows the STUCK? PRESS R toast', () => {
    const w = pinned();
    let fx;
    for (let i = 0; i < 300 && !fx; i++) {
      stepGame(w, gas, DT);
      if (w.events.some((e) => e.type === 'stuck')) fx = eventsToHud(w.events, 0);
    }
    expect(fx.toasts).toContain('STUCK? PRESS R');
  });
});

describe('the rescue', () => {
  it('fades out, moves the car at full black, and fades back in', () => {
    const w = alone();
    w.car.x = 73;
    w.car.z = 100;

    stepGame(w, rKey, DT);
    expect(w.fade).toBeGreaterThan(0);
    expect(w.fade).toBeLessThan(1);
    expect(w.car.x).toBe(73); // the screen is only partly black: not yet

    let black = false; // 0.2 s of fade-out: the car moves on the frame the screen fills
    for (let i = 0; i < 30 && !black; i++) {
      stepGame(w, idle, DT);
      black = w.fade === 1;
    }
    expect(black).toBe(true);
    expect(w.car.x).toBe(68);

    for (let i = 0; i < 40; i++) stepGame(w, idle, DT);
    expect(w.fade).toBe(0);
  });

  it('respawns on the nearest road centre, keeping its place along the road', () => {
    const w = alone();
    w.car.x = 73; // 5 m off the x = 68 centre line, 32 m off the nearest z one
    w.car.z = 100;
    w.car.heading = 0;
    rescue(w);
    expect(w.car.x).toBe(68);
    expect(w.car.z).toBe(100);
    expect(w.car.heading).toBe(0);
  });

  it('snaps across to a z-running road when that one is nearer', () => {
    const w = alone();
    w.car.x = 40;
    w.car.z = 141; // 5 m off the z = 136 centre line, 28 m off the nearest x one
    w.car.heading = 0;
    rescue(w);
    expect(w.car.x).toBe(40);
    expect(w.car.z).toBe(136);
    expect(w.car.heading).toBe(Math.PI / 2); // along the road, the way it was going
  });

  it('faces along the road without turning the car around', () => {
    const w = alone();
    w.car.x = 73;
    w.car.z = 100;
    w.car.heading = Math.PI; // reversing up the road when it got stuck
    rescue(w);
    expect(w.car.heading).toBe(Math.PI);
  });

  it('repairs the damage and emits one reset per press, even while held', () => {
    const w = alone();
    applyImpact(w.damage, { speed: 60 }); // over damage.js's 60-point overheat line
    const events = rescue(w, 72, true);
    expect(w.damage.damage).toBe(0);
    expect(w.damage.smoking).toBe(false);
    expect(resetsIn(events)).toHaveLength(1);
  });

  it('lands on a road centre, clear of every collider and inside the bounds', () => {
    for (const [x, z] of [[73, 100], [40, 141], [3, 3], [410, 410], [5, 400], [130, 130], [390, 136], [204, 240]]) {
      const w = alone();
      w.car.x = x;
      w.car.z = z;
      rescue(w);
      const b = w.town.bounds;
      expect(w.car.x).toBeGreaterThanOrEqual(b.minX);
      expect(w.car.x).toBeLessThanOrEqual(b.maxX);
      expect(w.car.z).toBeGreaterThanOrEqual(b.minZ);
      expect(w.car.z).toBeLessThanOrEqual(b.maxZ);
      const onRoad = w.town.roads.includes(w.car.x) || w.town.roads.includes(w.car.z);
      expect(onRoad).toBe(true);
      expect(clearance(w)).toBeGreaterThan(CONFIG.car.radius);
    }
  });
});

describe('the blackout the frame loop paints', () => {
  const css = read('style.css');

  it('style.css keeps #fade a full-screen blackout above the HUD', () => {
    const rule = css.match(/#fade\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule[0]).toMatch(/position:\s*fixed/);
    expect(rule[0]).toMatch(/inset:\s*0/);
    expect(rule[0]).toMatch(/z-index:\s*[6-9]/); // over the HUD (5), under the start scrim (10)
    expect(rule[0]).not.toMatch(/transition/); // the sim writes opacity every frame
  });

  it('hud.js builds it and main.js paints world.fade onto it', () => {
    expect(read('hud/hud.js')).toMatch(/id = 'fade'/);
    expect(read('main.js')).toMatch(/setFade\(world\.fade\)/);
  });
});
