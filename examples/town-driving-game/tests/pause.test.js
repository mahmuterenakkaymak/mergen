// T46: the pause. Esc or a window blur holds the whole session — car, AI cars, walkers,
// camera, the rescue fade — and the click back must not throw the time the tab spent
// hidden at the car as one frame of dt.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CONFIG } from '../src/config.js';
import { createGame, stepGame, setPaused } from '../src/game.js';
import { createHud } from '../src/hud/hud.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(path.join(here, '..', 'src', f), 'utf8');
const css = read('style.css');
const main = read('main.js');

const DT = 1 / 60;
const idle = { throttle: 0, brake: 0, steer: 0, handbrake: 0, horn: 0, reset: 0 };
const gas = { ...idle, throttle: 1 };

const run = (w, controls, seconds) => {
  for (let t = 0; t < seconds; t += DT) stepGame(w, controls, DT);
};

// Everything the sim owns. A paused step that changes none of it is a frozen sim.
const snapshot = (w) => JSON.stringify(
  { car: w.car, traffic: w.traffic, peds: w.peds, damage: w.damage, pose: w.pose }
);

// Nose against the perimeter wall with the throttle buried: unpaused, that is a stuck ask.
function pinned() {
  const w = createGame();
  w.traffic.length = 0;
  w.car.x = w.town.bounds.maxX - CONFIG.car.radius;
  w.car.z = 100;
  w.car.heading = Math.PI / 2; // faces +x, straight into the wall
  return w;
}

const eventsOf = (w, controls, seconds) => {
  const all = [];
  for (let t = 0; t < seconds; t += DT) {
    stepGame(w, controls, DT);
    all.push(...w.events);
  }
  return all;
};

describe('the sim holds', () => {
  it('changes nothing while paused, throttle and all', () => {
    const w = createGame();
    run(w, gas, 1);
    setPaused(w, true);
    const before = snapshot(w);
    run(w, gas, 3);
    expect(snapshot(w)).toBe(before);
  });

  it('keeps the camera pose it had, so the view does not drift behind the dim', () => {
    const w = createGame();
    run(w, gas, 1);
    const pose = w.pose;
    setPaused(w, true);
    run(w, gas, 1);
    expect(w.pose).toBe(pose);
  });

  it('raises no events: not even the stuck ask a wall and a buried throttle always give', () => {
    expect(eventsOf(pinned(), gas, 4).filter((e) => e.type === 'stuck')).toHaveLength(1);
    const w = pinned();
    setPaused(w, true);
    expect(eventsOf(w, gas, 4)).toEqual([]);
  });

  it('holds a rescue fade where it stopped and finishes it on the way back', () => {
    const w = createGame();
    w.traffic.length = 0;
    stepGame(w, { ...idle, reset: 1 }, DT);
    expect(w.fade).toBeGreaterThan(0);
    const fade = w.fade;

    setPaused(w, true);
    run(w, idle, 2);
    expect(w.fade).toBe(fade);

    setPaused(w, false);
    const after = eventsOf(w, idle, 2);
    expect(w.fade).toBe(0);
    expect(after.filter((e) => e.type === 'reset')).toHaveLength(1);
  });

  it('carries on from the exact state it held', () => {
    const w = createGame();
    run(w, gas, 1);
    setPaused(w, true);
    run(w, gas, 2);
    const { x, z, speed } = w.car;

    setPaused(w, false);
    run(w, gas, 0.5);
    expect(Math.hypot(w.car.x - x, w.car.z - z)).toBeGreaterThan(1);
    expect(w.car.speed).toBeGreaterThan(speed);
  });

  it('is a state, not a count: setting it twice stays paused', () => {
    const w = createGame();
    expect(setPaused(w, true)).toBe(true);
    expect(setPaused(w, true)).toBe(true);
    expect(setPaused(w, false)).toBe(false);
    expect(w.paused).toBe(false);
  });
});

// createHud only needs createElement/body.appendChild, plus classList for the dim.
function fakeDoc() {
  const items = [];
  const make = () => {
    const el = {
      id: '', className: '', textContent: '', innerHTML: '', style: {}, children: [],
      classes: new Set(),
      append(...els) { el.children.push(...els); },
      classList: {
        toggle: (c, on) => (on ? el.classes.add(c) : el.classes.delete(c)),
        contains: (c) => el.classes.has(c),
      },
    };
    return el;
  };
  return { body: { appendChild: (el) => items.push(el) }, createElement: make, items };
}
// The fake element has no layout, so the class it carries is the whole check.
const pauseElOf = (doc, hud) => {
  hud.setPaused(true);
  return doc.items.find((el) => el.id === 'pause');
};

describe('the PAUSED overlay', () => {
  it('hud.js builds it with the word and the way back', () => {
    const doc = fakeDoc();
    createHud(doc);
    const el = doc.items.find((item) => item.id === 'pause');
    expect(el).toBeTruthy();
    expect(el.innerHTML).toContain('PAUSED');
    expect(el.innerHTML).toContain('CLICK TO RESUME');
  });

  it('setPaused shows it and hides it again', () => {
    const doc = fakeDoc();
    const hud = createHud(doc);
    const el = pauseElOf(doc, hud);
    expect(el.classes.has('show')).toBe(true);
    hud.setPaused(false);
    expect(el.classes.has('show')).toBe(false);
  });

  it('style.css dims the whole screen above the HUD, below the start scrim', () => {
    const rule = css.match(/#pause\s*\{[^}]*\}/)[0];
    expect(rule).toMatch(/position:\s*fixed/);
    expect(rule).toMatch(/inset:\s*0/);
    expect(rule).toMatch(/z-index:\s*9/); // over the HUD (5) and #fade (8), under #start (10)
    expect(rule).toMatch(/opacity:\s*0\s*;/); // up to the .show class to lift it
    expect(rule).toMatch(/pointer-events:\s*none/); // and it must not eat clicks while down
    expect(rule).toMatch(/transition:\s*opacity/); // the dim arrives, it does not snap
    const a = parseFloat(rule.match(/rgba\([^)]*?,\s*([\d.]+)\s*\)/)[1]);
    expect(a).toBeGreaterThan(0.2);
    expect(a).toBeLessThan(1); // a dim over the frozen town, not a blackout
  });

  it('takes the click back once it is up', () => {
    const rule = css.match(/#pause\.show\s*\{[^}]*\}/)[0];
    expect(rule).toMatch(/opacity:\s*1/);
    expect(rule).toMatch(/pointer-events:\s*auto/);
  });
});

describe('main.js wires it to the browser', () => {
  it('Esc and a window blur pause, the overlay click resumes', () => {
    expect(main).toMatch(/e\.code === 'Escape'/);
    expect(main).toMatch(/addEventListener\('blur',\s*\(\)\s*=>\s*pause\(true\)\)/);
    expect(main).toMatch(/hud\.pauseEl\.addEventListener\('click',\s*\(\)\s*=>\s*pause\(false\)\)/);
  });

  it('suspends the audio down and wakes it up again', () => {
    expect(main).toMatch(/audio\.suspend\(\)/);
    expect(main).toMatch(/audio\.resume\(\)/);
  });

  it('restarts the frame clock on resume, so the first frame back is a normal one', () => {
    expect(main).toMatch(/audio\.resume\(\);\s*last = performance\.now\(\)/);
  });

  it('skips the whole step while paused, and only runs during the game', () => {
    expect(main).toMatch(/if \(world\.paused\) \{/);
    expect(main).toMatch(/!running \|\| world\.paused === on/);
  });
});
