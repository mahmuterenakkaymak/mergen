// A rendered frame that owes no fixed step must leave the input alone. Snapshotting and
// calling endFrame() on such a frame clears the mouse delta, the wheel notch and the
// key/click edges before any step has read them — at 120-144 Hz that is every other frame.
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.js';
import MAP_DATA from '../src/core/mapData.js';
import { createWorld, runFrame } from '../src/core/game.js';
import { createFixedLoop } from '../src/core/loop.js';
import { switchWeapon } from '../src/core/weapons.js';

// Stands in for input.js: frame-scoped state accumulates between frames and is only
// cleared by endFrame(), which is exactly the contract runFrame must respect.
function createFakeInput() {
  const state = { mouseX: 0, mouseY: 0, wheel: 0, fire: false };
  const calls = { snapshots: 0, endFrames: 0 };

  return {
    calls,
    move(dx, dy = 0) {
      state.mouseX += dx;
      state.mouseY += dy;
    },
    click() {
      state.fire = true;
    },
    snapshot() {
      calls.snapshots += 1;
      return {
        wheel: state.wheel,
        mouseX: state.mouseX,
        mouseY: state.mouseY,
        fire: state.fire,
        pressed: { fire: state.fire },
      };
    },
    endFrame() {
      calls.endFrames += 1;
      state.mouseX = 0;
      state.mouseY = 0;
      state.wheel = 0;
      state.fire = false;
    },
  };
}

const STEP = CONFIG.LOOP.step;
const SEMI_WEAPON = Object.keys(CONFIG.WEAPONS).find((id) => CONFIG.WEAPONS[id].fireMode === 'semi');

describe('runFrame input delivery', () => {
  it('a 0-step frame returns no events and leaves the input untouched', () => {
    const world = createWorld(CONFIG, MAP_DATA, 1);
    const loop = createFixedLoop();
    const input = createFakeInput();

    input.move(90, 10);
    expect(runFrame(world, input, loop, STEP / 10)).toEqual([]);
    expect(input.calls).toEqual({ snapshots: 0, endFrames: 0 });
    expect(world.time).toBe(0);
  });

  it('a mouse delta delivered before a 0-step frame still turns the view on the next stepping frame', () => {
    const world = createWorld(CONFIG, MAP_DATA, 1);
    const loop = createFixedLoop();
    const input = createFakeInput();

    input.move(120);
    runFrame(world, input, loop, STEP / 10); // owes nothing: must not swallow the delta
    expect(world.player.yaw).toBe(0);

    runFrame(world, input, loop, STEP);
    expect(world.player.yaw).not.toBe(0);
    expect(input.calls.endFrames).toBe(1);
  });

  it('a semi-auto click before a 0-step frame fires once on the next stepping frame', () => {
    const world = createWorld(CONFIG, MAP_DATA, 1);
    const loop = createFixedLoop();
    const input = createFakeInput();

    switchWeapon(world.loadout, CONFIG.WEAPONS[SEMI_WEAPON].slot);
    world.loadout.drawRemaining = 0; // this test is about delivery, not the draw clock

    const magBefore = world.loadout.weapons[SEMI_WEAPON].mag;
    input.click();
    runFrame(world, input, loop, STEP / 10);
    expect(world.loadout.weapons[SEMI_WEAPON].mag).toBe(magBefore);

    const events = runFrame(world, input, loop, STEP);
    expect(events.filter((e) => e.type === 'shot' && e.weapon === SEMI_WEAPON)).toHaveLength(1);
    expect(world.loadout.weapons[SEMI_WEAPON].mag).toBe(magBefore - 1);
  });

  it('applies one frame of input once, not once per catch-up step', () => {
    const yawTurned = (steps) => {
      const world = createWorld(CONFIG, MAP_DATA, 1);
      const input = createFakeInput();
      input.move(200);
      runFrame(world, input, createFixedLoop(), steps * STEP);
      return world.player.yaw;
    };

    expect(yawTurned(2)).toBeCloseTo(yawTurned(1), 12);
  });
});
