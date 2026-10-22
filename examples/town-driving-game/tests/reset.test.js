// T39, rewritten for T43: R fades to black over 0.2 s, then respawns the car at the
// nearest road centre line facing along it — zero velocity, damage repaired, one `reset` event.
import { describe, it, expect } from 'vitest';
import { createGame, stepGame } from '../src/game.js';
import { applyImpact } from '../src/damage.js';
import { eventsToHud } from '../src/hud/hud.js';

const DT = 1 / 60;
const CAP = 120; // 2 s of frames to reach full black; the 0.2 s fade-out needs 12
const idle = { throttle: 0, brake: 0, steer: 0, handbrake: 0, horn: 0 };
const gas = { ...idle, throttle: 1 };
const rKey = { ...idle, reset: 1 };

const impacts = (w) => w.events.filter((e) => e.type === 'impact');

function run(world, controls, seconds) {
  for (let t = 0; t < seconds; t += DT) stepGame(world, controls, DT);
  return world;
}

// Step until the rescue lands — the frame world.fade reaches 1 is the frame the car moves
// and the `reset` event fires — or the cap runs out.
function stepToBlack(world, controls) {
  for (let i = 0; i < CAP; i++) {
    stepGame(world, controls, DT);
    if (world.fade === 1) return true;
  }
  return false;
}

function countResets(world, controls, frames) {
  let n = 0;
  for (let i = 0; i < frames; i++) {
    stepGame(world, controls, DT);
    for (const e of world.events) if (e.type === 'reset') n++;
  }
  return n;
}

describe('reset on R', () => {
  it('puts the car on the nearest road centre line, facing along it, with no velocity', () => {
    const w = run(createGame(), gas, 3);
    expect(Math.hypot(w.car.x - w.town.spawn.x, w.car.z - w.town.spawn.z)).toBeGreaterThan(5);

    expect(stepToBlack(w, rKey)).toBe(true);
    const roads = w.town.roads;
    const alongZ = [0, Math.PI].includes(w.car.heading); // an x = centre line runs along z
    const alongX = [Math.PI / 2, -Math.PI / 2].includes(w.car.heading);
    expect(alongZ || alongX).toBe(true);
    expect(alongZ ? roads.includes(w.car.x) : roads.includes(w.car.z)).toBe(true);
    expect(w.car.vx).toBe(0);
    expect(w.car.vz).toBe(0);
    expect(w.car.speed).toBe(0);
    expect(w.car.slip).toBe(0);
    expect(w.car.skidding).toBe(false);
  });

  it('repairs the damage and clears the overheating warning', () => {
    const w = createGame();
    applyImpact(w.damage, { speed: 60 }); // over damage.js's 60-point overheat line
    expect(w.damage.damage).toBeGreaterThan(60);
    expect(w.damage.smoking).toBe(true);

    expect(stepToBlack(w, rKey)).toBe(true);
    expect(w.damage.damage).toBe(0);
    expect(w.damage.smoking).toBe(false);
    expect(w.damage.warned).toBe(false); // so the next overheat warns again
  });

  it('emits one reset event per press, not one per frame while held', () => {
    const w = createGame();
    let n = countResets(w, rKey, CAP); // held through the fade, the rescue and the fade-back
    expect(n).toBe(1); // still held: silent

    stepGame(w, idle, DT); // released
    n += countResets(w, rKey, CAP); // pressed again
    expect(n).toBe(2);
  });

  it('frees a buried car without the wall it was inside ever getting a say', () => {
    const w = createGame();
    const box = w.town.aabbs[0]; // buildings come first in the collider list
    w.car.x = (box.minX + box.maxX) / 2;
    w.car.z = (box.minZ + box.maxZ) / 2; // dead inside it
    w.car.vz = 20; // still moving when it got there

    let hit = 0;
    for (let i = 0; i < CAP && w.fade < 1; i++) {
      stepGame(w, rKey, DT);
      hit += impacts(w).length;
    }
    expect(w.fade).toBe(1);
    expect(hit).toBe(0); // the fade frames and the rescue frame raise no crash
    expect(w.town.roads.includes(w.car.x) || w.town.roads.includes(w.car.z)).toBe(true);
    expect(w.car.speed).toBe(0);
  });

  it('drives off from the road centre when the throttle was held through the reset', () => {
    const w = run(createGame(), gas, 3);
    expect(stepToBlack(w, { ...gas, reset: 1 })).toBe(true);
    expect(w.car.speed).toBe(0); // the rescue zeroed the 3 s of throttle behind it
    const z = w.car.z;

    stepGame(w, gas, DT);
    const dz = w.car.z - z;
    expect(w.car.heading).toBe(0); // heading 0 faces +z
    expect(dz).toBeGreaterThan(0);
    expect(dz).toBeLessThan(0.1); // one frame's worth, not the throttle before the fade
  });
});

describe('reset event -> HUD', () => {
  it('shows the RESET — REPAIRED toast without a damage flash', () => {
    const w = createGame();
    expect(stepToBlack(w, rKey)).toBe(true); // the event fires on this frame
    const fx = eventsToHud(w.events, 0);
    expect(fx.toasts).toContain('RESET — REPAIRED');
    expect(fx.vignette).toBe(0);
  });
});
