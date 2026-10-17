import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.js';
import MAP_DATA from '../src/core/mapData.js';
import { makeBox } from '../src/core/aabb.js';
import { damageBot } from '../src/core/bots.js';
import { createWorld, stepGame } from '../src/core/game.js';

const DT = CONFIG.LOOP.step;
const B = CONFIG.BOTS;
const { pistol } = CONFIG.WEAPONS;
const botGun = CONFIG.WEAPONS[B.weapon];
const T_SPAWN = MAP_DATA.spawnZones.T.spawns[0];
const CT_SPAWNS = MAP_DATA.spawnZones.CT.spawns;

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

const step = (world, overrides = {}) => run(world, 1, () => overrides);
const of = (events, type) => events.filter((e) => e.type === type);
const click = () => ({ fire: true, pressed: { fire: true } });

// Step until an event type shows up, so no test hard-codes how many ticks the
// intermission takes.
function runUntil(world, type, maxFrames = 600) {
  const events = [];
  for (let i = 0; i < maxFrames; i++) {
    step(world);
    events.push(...world.events);
    if (events.some((e) => e.type === type)) return events;
  }
  throw new Error(`${type} never fired in ${maxFrames} frames`);
}

// The player where createWorld puts him — the T spawn, looking down the mid lane — with
// five ticks to settle onto the floor.
function parked(seed = 7) {
  const world = createWorld(CONFIG, MAP_DATA, seed);
  run(world, 5);
  return world;
}

// Stand a bot with its feet at `pos`, box and all, so its hitboxes and the movement
// resolver agree about where it is.
function placeBot(bot, pos) {
  bot.pos = { x: pos.x, y: pos.y, z: pos.z };
  bot.box = makeBox(
    { x: pos.x, y: pos.y + B.bodyHeight / 2, z: pos.z },
    { x: B.bodyWidth, y: B.bodyHeight, z: B.bodyWidth },
  );
  return bot;
}

const feetOf = (box) => ({ x: (box.min.x + box.max.x) / 2, y: box.min.y, z: (box.min.z + box.max.z) / 2 });
const killAllBots = (world) => world.bots.forEach((bot) => damageBot(bot, Infinity, world));

// The CT spawn on the mid lane, i.e. the one straight down the barrel of the T spawn.
const midLaneBot = (world) => world.bots[2];

describe('round start', () => {
  it('opens playing with five bots at the CT spawns against the player at T', () => {
    const world = createWorld(CONFIG, MAP_DATA, 3);

    expect(world.round.phase).toBe('playing');
    expect(world.round.timer).toBe(0);
    expect(world.score).toEqual({ player: 0, bots: 0 });

    expect(world.bots).toHaveLength(B.count);
    world.bots.forEach((bot, i) => {
      expect(bot.alive).toBe(true);
      expect(bot.hp).toBe(B.health);
      expect(bot.state).toBe('patrol');
      expect(bot.pos).toEqual(CT_SPAWNS[i]);
    });

    const feet = feetOf(world.player.box);
    expect(feet.x).toBeCloseTo(T_SPAWN.x);
    expect(feet.y).toBeCloseTo(T_SPAWN.y);
    expect(feet.z).toBeCloseTo(T_SPAWN.z);
    expect(world.player.health).toBe(CONFIG.PLAYER.maxHealth);
  });
});

describe('round end', () => {
  it('ends the round won and scores the player once the last bot is down', () => {
    const world = parked();
    const last = midLaneBot(world);

    for (const bot of world.bots) if (bot !== last) damageBot(bot, Infinity, world);
    expect(of(step(world), 'roundEnd')).toHaveLength(0);
    expect(world.round.phase).toBe('playing');

    damageBot(last, Infinity, world);
    const ends = of(step(world), 'roundEnd');

    expect(ends).toHaveLength(1);
    expect(ends[0].result).toBe('won');
    expect(world.round.phase).toBe('won');
    expect(world.score).toEqual({ player: 1, bots: 0 });
  });

  it('ends the round lost and scores the bots when the player dies', () => {
    const world = parked();
    world.player.health = 0;

    const ends = of(step(world), 'roundEnd');
    expect(ends).toHaveLength(1);
    expect(ends[0].result).toBe('lost');
    expect(world.score).toEqual({ player: 0, bots: 1 });
  });

  it('starts a new round after the intermission with everyone back at the spawns', () => {
    const world = parked();
    run(world, 30, () => ({ forward: true })); // walk off the spawn point
    const walked = feetOf(world.player.box);
    expect(walked.z).toBeLessThan(T_SPAWN.z);

    world.player.health = 37;
    world.loadout.weapons.pistol.mag = 4;
    world.loadout.weapons.pistol.reserve = 11;
    world.loadout.weapons.rifle.mag = 1;
    killAllBots(world);

    const events = runUntil(world, 'newRound');
    const ended = of(events, 'roundEnd')[0];
    const fresh = of(events, 'newRound')[0];

    expect(ended.result).toBe('won');
    // Quantised to the fixed step: the countdown is a running subtraction, so it lands
    // within one tick of the configured intermission.
    expect(Math.abs(fresh.t - ended.t - CONFIG.ROUNDS.intermission)).toBeLessThan(DT);
    expect(world.round.phase).toBe('playing');
    expect(world.round.timer).toBe(0);

    const feet = feetOf(world.player.box);
    expect(feet.x).toBeCloseTo(T_SPAWN.x, 6);
    expect(feet.y).toBeCloseTo(T_SPAWN.y, 6);
    expect(feet.z).toBeCloseTo(T_SPAWN.z, 6);
    expect(world.player.health).toBe(CONFIG.PLAYER.maxHealth);

    for (const id of world.loadout.ids) {
      expect(world.loadout.weapons[id].mag).toBe(CONFIG.WEAPONS[id].magSize);
      expect(world.loadout.weapons[id].reserve).toBe(CONFIG.WEAPONS[id].reserveAmmo);
      expect(world.loadout.weapons[id].reloading).toBe(false);
    }

    world.bots.forEach((bot, i) => {
      expect(bot.alive).toBe(true);
      expect(bot.hp).toBe(B.health);
      expect(bot.state).toBe('patrol');
      expect(bot.removable).toBe(false);
      expect(bot.pos).toEqual(CT_SPAWNS[i]);
    });
  });

  it('keeps playing after the reset, so the next round can be won again', () => {
    const world = parked();
    killAllBots(world);
    runUntil(world, 'newRound');

    expect(world.score).toEqual({ player: 1, bots: 0 });
    killAllBots(world);
    const events = runUntil(world, 'roundEnd');

    expect(of(events, 'roundEnd')[0].result).toBe('won');
    expect(world.score.player).toBe(2);
  });
});

describe('input while dead or between rounds', () => {
  it('drops movement, look and trigger input once the player is dead', () => {
    const world = parked();
    world.player.health = 0;

    const yaw = world.player.yaw;
    const mag = world.loadout.weapons.pistol.mag;
    const events = run(world, 10, () => ({ forward: true, ...click(), mouseX: 200 }));

    const feet = feetOf(world.player.box);
    expect(feet.x).toBeCloseTo(T_SPAWN.x, 6);
    expect(feet.z).toBeCloseTo(T_SPAWN.z, 6);
    expect(world.player.yaw).toBe(yaw);
    expect(world.loadout.weapons.pistol.mag).toBe(mag);
    expect(of(events, 'shot')).toHaveLength(0);
    expect(of(events, 'footstep')).toHaveLength(0);
  });

  it('drops input through the intermission of a round the player survived', () => {
    const world = parked();
    killAllBots(world);
    expect(of(run(world, 1), 'roundEnd')[0].result).toBe('won');

    const yaw = world.player.yaw;
    const mag = world.loadout.weapons.pistol.mag;
    const events = run(world, 30, () => ({ forward: true, ...click(), mouseX: 200 }));

    expect(of(events, 'shot')).toHaveLength(0);
    expect(of(events, 'footstep')).toHaveLength(0);
    expect(of(events, 'switch')).toHaveLength(0);
    expect(world.player.yaw).toBe(yaw);
    expect(world.loadout.weapons.pistol.mag).toBe(mag);
    expect(feetOf(world.player.box).z).toBeCloseTo(T_SPAWN.z, 6);
  });
});

describe('kills and wounds', () => {
  it('emits kill with the victim, the weapon and the headshot flag', () => {
    const world = parked();
    const bot = placeBot(midLaneBot(world), { x: 0, y: 0, z: 4 });
    bot.hp = 1;

    const events = step(world, click());

    const hits = of(events, 'hit');
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('head'); // level aim at 1.65 m sits in the head band
    expect(hits[0].targetId).toBe(bot.id);
    expect(hits[0].killed).toBe(true);

    const kills = of(events, 'kill');
    expect(kills).toHaveLength(1);
    expect(kills[0].victim).toBe(bot.id);
    expect(kills[0].weapon).toBe('pistol');
    expect(kills[0].headshot).toBe(true);

    expect(bot.alive).toBe(false);
    expect(bot.state).toBe('dead');
    expect(bot.hp).toBe(0);
    expect(of(events, 'roundEnd')).toHaveLength(0); // four bots are still up

    // A corpse is no longer in the line of fire: the next shot reaches the wall.
    const after = run(world, 12, click);
    expect(of(after, 'hit')).toHaveLength(0);
    expect(of(after, 'wallImpact').length).toBeGreaterThan(0);
  });

  it('wins the round on the tick the last bot falls to a player shot', () => {
    const world = parked();
    const last = placeBot(midLaneBot(world), { x: 0, y: 0, z: 4 });
    last.hp = 1;
    for (const bot of world.bots) if (bot !== last) damageBot(bot, Infinity, world);

    const events = step(world, click());

    expect(of(events, 'kill')[0].victim).toBe(last.id);
    const ends = of(events, 'roundEnd');
    expect(ends).toHaveLength(1);
    expect(ends[0].result).toBe('won');
    expect(world.score.player).toBe(1);
  });

  it('takes damage from a bot and reports where the shot came from', () => {
    // 8 m up the mid lane: inside the bot's preferred range, so it holds its ground and
    // keeps the player in its cone instead of backing off and losing sight of him.
    const world = parked();
    const bot = placeBot(midLaneBot(world), { x: 0, y: 0, z: 4 });
    bot.yaw = Math.PI; // looking back down the lane at the player
    // One shooter, so the damage and the reported source can be read exactly.
    for (const other of world.bots) if (other !== bot) damageBot(other, Infinity, world);

    const events = [];
    let wound = null;
    let shooterPos = null;
    for (let i = 0; i < 300 && world.player.health > 0; i++) {
      events.push(...step(world));
      const first = of(events, 'playerDamaged')[0];
      if (first && !wound) {
        wound = first;
        shooterPos = { ...bot.pos };
      }
    }

    expect(wound).not.toBeNull();
    expect(wound.victim).toBe('player');
    expect(wound.source).toBe(bot.id);
    expect(wound.damage).toBe(botGun.damage);
    expect(wound.sourcePos).toEqual(shooterPos);

    expect(world.player.health).toBe(0);
    expect(of(events, 'roundEnd')[0].result).toBe('lost');
    expect(world.score).toEqual({ player: 0, bots: 1 });
  });
});
