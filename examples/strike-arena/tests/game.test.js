import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.js';
import MAP_DATA from '../src/core/mapData.js';
import { createPlayer } from '../src/core/movement.js';
import { createWorld, stepGame } from '../src/core/game.js';
import { botHitboxes, createBot } from '../src/core/bots.js';

const DT = CONFIG.LOOP.step;
const { pistol, rifle, sniper } = CONFIG.WEAPONS;

// A full input.js snapshot; stepGame consumes the frame-scoped fields, so every step in
// these tests gets its own object.
function makeInput(overrides = {}) {
  return {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    walk: false,
    crouch: false,
    reload: false,
    fire: false,
    ads: false,
    wheel: 0,
    mouseX: 0,
    mouseY: 0,
    pressed: {},
    ...overrides,
  };
}

// Run `frames` fixed steps and return every event they produced, in order.
function run(world, frames, inputAt = () => ({})) {
  const events = [];
  for (let i = 0; i < frames; i++) {
    stepGame(world, makeInput(inputAt(i)), DT);
    events.push(...world.events);
  }
  return events;
}

const step1 = (world, overrides = {}) => run(world, 1, () => overrides);
const of = (events, type) => events.filter((e) => e.type === type);

// M3 spawns live bots that would shoot a parked player mid-test. Keep them alive — an
// empty bot list hands the round to the player, and a decided round freezes the tick —
// but park them far outside their view distance, where they patrol harmlessly and never
// take a shot.
function neutraliseBots(world) {
  world.bots = world.bots.map((bot, i) =>
    createBot(bot.id, { x: 1000 + i * 2, y: 0, z: 1000 }, CONFIG),
  );
}

// One world with the player parked at a spot, looking along `yaw`, settled onto the
// ground (the spawn tick emits a zero-height landing).
function parkedAt(pos, { yaw = 0, pitch = 0, seed = 7 } = {}) {
  const world = createWorld(CONFIG, MAP_DATA, seed);
  world.player = createPlayer(pos);
  world.player.yaw = yaw;
  world.player.pitch = pitch;
  neutraliseBots(world);
  run(world, 5);
  return world;
}

// A live bot standing in the player's firing line, built the way the world builds its
// own (createBot sets pos and box from the foot position). It faces -Z, away from the
// parked player, so it never returns fire; the neutralised bots keep the round playing.
function addBotTarget(world, id, pos) {
  const bot = createBot(id, pos, CONFIG);
  world.bots.push(bot);
  return bot;
}

const eye = (world) => {
  const b = world.player.box;
  return { x: (b.min.x + b.max.x) / 2, y: b.min.y + world.player.eyeY, z: (b.min.z + b.max.z) / 2 };
};

const click = () => ({ fire: true, pressed: { fire: true } });
const hold = () => ({ fire: true });

describe('createWorld', () => {
  it('starts from the map and config: player at the T spawn, pistol in hand, bots standing', () => {
    const world = createWorld(CONFIG, MAP_DATA, 3);
    const spawn = MAP_DATA.spawnZones.T.spawns[0];
    const b = world.player.box;

    expect(world.player.health).toBe(CONFIG.PLAYER.maxHealth);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(spawn.x);
    expect(b.min.y).toBeCloseTo(spawn.y);
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(spawn.z);

    expect(world.loadout.active).toBe('pistol');
    expect(world.loadout.weapons.pistol.mag).toBe(pistol.magSize);
    expect(world.time).toBe(0);
    expect(world.events).toEqual([]);
    expect(world.scoped).toBe(false);
    expect(world.fov).toBe(CONFIG.MAP.fov);
    expect(world.colliders.length).toBeGreaterThan(0);

    expect(world.bots.length).toBeGreaterThan(0);
    for (const bot of world.bots) {
      expect(bot.alive).toBe(true);
      expect(bot.hp).toBe(CONFIG.BOTS.health);
      // castHitscan reads each bot as {id, head, body} boxes via botHitboxes.
      const boxes = botHitboxes(bot, CONFIG);
      expect(boxes.head.max.y).toBeCloseTo(boxes.body.max.y + CONFIG.BOTS.headSize);
    }
  });

  it('clears the event list every tick instead of accumulating', () => {
    const world = parkedAt({ x: 0, y: 0, z: 12 });
    expect(world.events).toEqual([]);
    expect(step1(world)).toEqual([]);
    expect(world.events).toEqual([]);
  });
});

describe('firing at a bot', () => {
  // Player at the T spawn, bot 8 m down the mid lane, aim held on its torso.
  const range = () => {
    const world = parkedAt({ x: 0, y: 0, z: 12 }, { pitch: -0.115 });
    const bot = addBotTarget(world, 'torso', { x: 0, y: 0, z: 4 });
    return { world, bot };
  };

  it('emits a hit event and lowers the bot hp by the body damage', () => {
    const { world, bot } = range();
    const events = step1(world, click());

    const shot = of(events, 'shot');
    expect(shot).toHaveLength(1);
    expect(shot[0].weapon).toBe('pistol');
    expect(shot[0].origin.y).toBeCloseTo(eye(world).y, 6);

    const hits = of(events, 'hit');
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('body');
    expect(hits[0].targetId).toBe('torso');
    expect(hits[0].damage).toBe(pistol.damage);
    expect(hits[0].killed).toBe(false);

    expect(bot.hp).toBe(CONFIG.BOTS.health - pistol.damage);
    expect(world.loadout.weapons.pistol.mag).toBe(pistol.magSize - 1);
    expect(of(events, 'wallImpact')).toHaveLength(0);
  });

  it('scores a headshot through the head box at the headshot multiplier', () => {
    const world = parkedAt({ x: 0, y: 0, z: 12 }); // level aim sits on the head band
    const bot = addBotTarget(world, 'head', { x: 0, y: 0, z: 4 });

    const hits = of(step1(world, click()), 'hit');
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('head');
    expect(hits[0].damage).toBeCloseTo(pistol.damage * pistol.headshotMult, 6);
    expect(bot.hp).toBeCloseTo(CONFIG.BOTS.health - pistol.damage * pistol.headshotMult, 6);
  });

  it('kills the bot on the shot that empties its hp and stops hitting it afterwards', () => {
    const world = parkedAt({ x: 0, y: 0, z: 12 }, { pitch: -0.115 });
    const bot = addBotTarget(world, 'dead', { x: 0, y: 0, z: 4 });
    bot.hp = 1;

    const events = step1(world, click());
    expect(of(events, 'hit')[0].killed).toBe(true);
    expect(bot.alive).toBe(false);
    expect(bot.hp).toBe(0);

    // A dead bot is no longer in the way: the shot flies past it to the wall/void.
    const after = step1(world, click());
    expect(of(after, 'hit')).toHaveLength(0);
  });

  it('spends the magazine without ever firing on an empty one, and reports dryFire', () => {
    const world = parkedAt({ x: 0, y: 0, z: 12 });
    world.loadout.weapons.pistol.mag = 0;

    const events = step1(world, click());
    expect(of(events, 'shot')).toHaveLength(0);
    expect(of(events, 'dryFire')).toHaveLength(1);
    expect(world.loadout.weapons.pistol.mag).toBe(0);
    expect(world.loadout.weapons.pistol.reserve).toBe(pistol.reserveAmmo);
  });
});

describe('cover', () => {
  // East corridor looking west: the divider wall stands between the player and the bot.
  it('reports a wallImpact only when a wall is in front of the bot', () => {
    const world = parkedAt({ x: 11, y: 0, z: 0 }, { yaw: Math.PI / 2 });
    const bot = addBotTarget(world, 'behind_wall', { x: 7, y: 0, z: 0 });

    const events = step1(world, click());

    expect(of(events, 'hit')).toHaveLength(0);
    expect(bot.hp).toBe(CONFIG.BOTS.health);
    expect(bot.alive).toBe(true);

    const impacts = of(events, 'wallImpact');
    expect(impacts).toHaveLength(1);
    // The wall's east face is at x = 9.5 and the shot travels along -X.
    expect(impacts[0].point.x).toBeCloseTo(9.5, 3);
    expect(impacts[0].normal).toEqual({ x: 1, y: 0, z: 0 });
  });
});

describe('rifle sustained fire', () => {
  it('empties the whole magazine at fireRate while the trigger is held, then goes dry', () => {
    const world = parkedAt({ x: 0, y: 0, z: 12 });
    const events = run(world, 400, (i) => (i === 0 ? { ...hold(), pressed: { slot2: true } } : hold()));

    const state = world.loadout.weapons.rifle;
    const shots = of(events, 'shot');

    expect(world.loadout.active).toBe('rifle');
    expect(shots).toHaveLength(rifle.magSize);
    expect(state.mag).toBe(0);
    // Nothing reloads on its own: the reserve is untouched until the player presses R.
    expect(state.reserve).toBe(rifle.reserveAmmo);
    expect(of(events, 'reloadStart')).toHaveLength(0);

    // One shot per fireRate window, quantised to the fixed step.
    for (let i = 1; i < shots.length; i++) {
      const gap = shots[i].t - shots[i - 1].t;
      expect(gap).toBeGreaterThanOrEqual(rifle.fireRate - 1e-9);
      expect(gap).toBeLessThan(rifle.fireRate + DT);
    }

    expect(of(events, 'dryFire').length).toBeGreaterThan(0);
  });

  it('lifts the view by the recoil pattern while the burst runs', () => {
    const world = parkedAt({ x: 0, y: 0, z: 12 });
    const before = world.player.pitch;
    run(world, 40, (i) => (i === 0 ? { ...hold(), pressed: { slot2: true } } : hold()));
    expect(world.player.pitch).toBeGreaterThan(before);
  });

  it('restarts the recoil pattern for a new burst instead of continuing the last one', () => {
    const world = parkedAt({ x: 0, y: 0, z: 12 });
    run(world, 1, () => ({ pressed: { slot2: true } }));
    run(world, Math.ceil(rifle.drawTime / DT) + 1); // nothing fires until the draw is off

    const state = world.loadout.weapons.rifle;
    const pattern = rifle.recoilPattern;
    // Pitch gained by one shot: the view only moves on the shot itself, so the difference
    // is exactly the pattern entry that shot was indexed with.
    const kick = () => {
      const before = world.player.pitch;
      run(world, 1, hold);
      return world.player.pitch - before;
    };
    const recovered = () => run(world, Math.ceil(rifle.recoilReset / DT) + 2);

    const first = kick();
    recovered();
    const nextBurst = kick();

    // Regression: the second burst used to resume at pattern entry 1.
    expect(nextBurst).toBeCloseTo(first, 12);
    expect(nextBurst).toBeCloseTo(pattern[0][0], 12);

    // A gap shorter than recoilReset is still the same burst, so it keeps climbing.
    run(world, Math.ceil(rifle.fireRate / DT) + 1);
    expect(kick()).toBeCloseTo(pattern[1][0], 12);

    expect(state.shotsFired).toBe(3); // the lifetime counter keeps counting across bursts
    expect(state.burstShots).toBe(2);
  });
});

describe('loadout input', () => {
  it('switches on the slot keys, emits one switch event and starts the draw time', () => {
    const world = parkedAt({ x: 0, y: 0, z: 12 });

    const events = step1(world, { pressed: { slot2: true } });
    const switches = of(events, 'switch');
    expect(switches).toHaveLength(1);
    expect(switches[0].weapon).toBe('rifle');
    expect(world.loadout.active).toBe('rifle');
    // The switch tick is also the first tick of the draw, so one step is already spent.
    expect(world.loadout.drawRemaining).toBeCloseTo(rifle.drawTime - DT, 6);

    // Re-selecting the active slot is a no-op.
    expect(of(step1(world, { pressed: { slot2: true } }), 'switch')).toHaveLength(0);
  });

  it('cycles with the wheel in both directions', () => {
    const world = parkedAt({ x: 0, y: 0, z: 12 });

    expect(of(step1(world, { wheel: 1 }), 'switch')[0].weapon).toBe('rifle');
    expect(of(step1(world, { wheel: 1 }), 'switch')[0].weapon).toBe('sniper');
    expect(of(step1(world, { wheel: -1 }), 'switch')[0].weapon).toBe('rifle');
  });

  it('cannot fire while the weapon is still being drawn', () => {
    const world = parkedAt({ x: 0, y: 0, z: 12 });
    step1(world, { pressed: { slot2: true } });

    const events = run(world, 5, click);
    expect(of(events, 'shot')).toHaveLength(0);
    expect(world.loadout.weapons.rifle.mag).toBe(rifle.magSize);
  });

  it('reloads on R: reloadStart, then reloadEnd after reloadTime with the ammo moved', () => {
    const world = parkedAt({ x: 0, y: 0, z: 12 });
    step1(world, click());
    expect(world.loadout.weapons.pistol.mag).toBe(pistol.magSize - 1);

    const started = step1(world, { pressed: { reload: true } });
    expect(of(started, 'reloadStart')).toHaveLength(1);
    expect(world.loadout.weapons.pistol.reloading).toBe(true);

    const events = run(world, Math.ceil(pistol.reloadTime / DT) + 5);
    expect(of(events, 'reloadEnd')).toHaveLength(1);

    const state = world.loadout.weapons.pistol;
    expect(state.reloading).toBe(false);
    expect(state.mag).toBe(pistol.magSize);
    expect(state.reserve).toBe(pistol.reserveAmmo - 1);
  });

  it('does not start a reload with a full magazine', () => {
    const world = parkedAt({ x: 0, y: 0, z: 12 });
    expect(of(step1(world, { pressed: { reload: true } }), 'reloadStart')).toHaveLength(0);
  });
});

describe('sniper scope', () => {
  const withSniper = () => {
    const world = parkedAt({ x: 0, y: 0, z: 12 });
    world.loadout.active = 'sniper';
    world.loadout.drawRemaining = 0;
    return world;
  };

  it('toggles on the right mouse button and swaps the fov', () => {
    const world = withSniper();

    step1(world, { pressed: { ads: true } });
    expect(world.scoped).toBe(true);
    expect(world.fov).toBe(sniper.scopeFov);

    step1(world, { pressed: { ads: true } });
    expect(world.scoped).toBe(false);
    expect(world.fov).toBe(CONFIG.MAP.fov);
  });

  it('ignores the scope button on weapons that have no scope', () => {
    const world = parkedAt({ x: 0, y: 0, z: 12 });
    step1(world, { pressed: { ads: true } });
    expect(world.scoped).toBe(false);
    expect(world.fov).toBe(CONFIG.MAP.fov);
  });

  it('comes out of the scope when the weapon changes under it', () => {
    const world = withSniper();
    step1(world, { pressed: { ads: true } });
    expect(world.scoped).toBe(true);

    step1(world, { pressed: { slot1: true } });
    expect(world.scoped).toBe(false);
    expect(world.fov).toBe(CONFIG.MAP.fov);
  });

  it('scopes down the spread, so a scoped shot is tighter than a hip shot', () => {
    const hip = createWorld(CONFIG, MAP_DATA, 11);
    hip.loadout.active = 'sniper';
    const scoped = createWorld(CONFIG, MAP_DATA, 11);
    scoped.loadout.active = 'sniper';

    run(hip, 1);
    run(scoped, 1, () => ({ pressed: { ads: true } }));
    expect(scoped.spread).toBeLessThan(hip.spread);
  });
});

describe('movement events', () => {
  it('emits footsteps while walking and none while standing still', () => {
    const world = parkedAt({ x: 0, y: 0, z: 12 });
    expect(of(run(world, 30), 'footstep')).toHaveLength(0);

    const steps = of(run(world, 60, () => ({ forward: true })), 'footstep');
    expect(steps.length).toBeGreaterThan(3);
    expect(steps.every((e) => e.speedRatio > 0)).toBe(true);
  });

  it('emits a land event after a jump with no damage inside the safe height', () => {
    const world = parkedAt({ x: 0, y: 0, z: 12 });
    const events = run(world, 120, (i) => (i === 0 ? { jump: true } : {}));

    const lands = of(events, 'land');
    expect(lands.length).toBeGreaterThanOrEqual(1);
    const landing = lands[lands.length - 1];
    expect(landing.height).toBeGreaterThan(0.5);
    expect(landing.height).toBeLessThan(CONFIG.FALL.safeHeight);
    expect(landing.damage).toBe(0);
    expect(world.player.health).toBe(CONFIG.PLAYER.maxHealth);
  });

  it('takes fall damage past the safe height on the tick it lands', () => {
    const world = parkedAt({ x: 0, y: 0, z: 12 });
    const height = CONFIG.FALL.safeHeight + 7;
    world.player.box.min.y += height;
    world.player.box.max.y += height;
    world.player.vel.y = 0;

    const events = run(world, 400);
    const lands = of(events, 'land');
    expect(lands).toHaveLength(1);
    expect(lands[0].height).toBeGreaterThan(CONFIG.FALL.safeHeight);
    expect(lands[0].damage).toBeCloseTo(
      (lands[0].height - CONFIG.FALL.safeHeight) * CONFIG.FALL.damagePerMeter,
      3,
    );
    expect(world.player.health).toBeCloseTo(CONFIG.PLAYER.maxHealth - lands[0].damage, 6);
  });

  it('applies look from the mouse delta and consumes it so extra steps do not double-turn', () => {
    const world = parkedAt({ x: 0, y: 0, z: 12 });
    const before = world.player.yaw;

    stepGame(world, makeInput({ mouseX: 100 }), DT);
    expect(world.player.yaw).not.toBe(before);

    const turned = world.player.yaw;
    stepGame(world, makeInput({ mouseX: 0 }), DT);
    expect(world.player.yaw).toBe(turned);
  });
});

describe('determinism', () => {
  it('produces the same shot directions from the same seed', () => {
    const shotDir = (seed) => {
      const world = parkedAt({ x: 0, y: 0, z: 12 }, { seed });
      return of(step1(world, click()), 'shot')[0].dir;
    };

    expect(shotDir(42)).toEqual(shotDir(42));
    expect(shotDir(42)).not.toEqual(shotDir(43));
  });
});
