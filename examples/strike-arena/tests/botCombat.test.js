import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.js';
import MAP_DATA, { getColliders } from '../src/core/mapData.js';
import { createPlayer } from '../src/core/movement.js';
import { botFire, botHitboxes, botThink, createBot, damageBot, hasLineOfSight, killBot } from '../src/core/bots.js';

const DT = CONFIG.LOOP.step;
const B = CONFIG.BOTS;
const W = CONFIG.WEAPONS[B.weapon];
const LIFETIME = CONFIG.ROUNDS.corpseLifetime;

// The slice of the world part 2 reads: a clock, walls, a player and an event list.
function makeWorld(playerPos, overrides = {}) {
  return {
    config: CONFIG,
    mapData: MAP_DATA,
    colliders: getColliders(),
    player: createPlayer(playerPos),
    events: [],
    time: 0,
    ...overrides,
  };
}

// stepGame advances world.time before anything reads it, so a tick is: clock first, then
// the bot's turn. Firing is driven on its own here — these tests are about the shot, not
// about where a long patrol left the bot.
function fireTick(bot, world, dt = DT) {
  world.time += dt;
  const before = world.events.length;
  botFire(bot, world, dt);
  return world.events.slice(before);
}

function tick(bot, world, dt = DT) {
  world.time += dt;
  const before = world.events.length;
  botThink(bot, world, dt);
  botFire(bot, world, dt);
  return world.events.slice(before);
}

// A bot in the open mid lane with the player straight ahead down +Z (yaw PI looks that
// way): inside the view cone, inside view distance, nothing in between.
const duel = (world, id, z = -9) => {
  const bot = createBot(id, { x: 0, y: 0, z });
  bot.yaw = Math.PI;
  return bot;
};

const shots = (events) => events.filter((e) => e.type === 'botShot');
const botEye = (bot) => ({ x: bot.pos.x, y: bot.pos.y + B.eyeHeight, z: bot.pos.z });

const playerEye = (player) => ({
  x: (player.box.min.x + player.box.max.x) / 2,
  y: player.box.min.y + (player.eyeY ?? CONFIG.MOVEMENT.eyeHeight),
  z: (player.box.min.z + player.box.max.z) / 2,
});

const aimAt = (from, to) => ({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z });

const angleBetween = (a, b) => {
  const cos =
    (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z));
  return Math.acos(Math.min(1, Math.max(-1, cos)));
};

describe('botFire', () => {
  it('holds its fire while a wall stands between it and the player', () => {
    const blocked = makeWorld({ x: 0, y: 0, z: 0 });
    const open = makeWorld({ x: 0, y: 0, z: 0 }, { colliders: [] });
    const a = createBot('wall_1', { x: -14, y: 0, z: 0 });
    const b = createBot('wall_1', { x: -14, y: 0, z: 0 });
    a.yaw = -Math.PI / 2; // looking along +X, straight at the player
    b.yaw = -Math.PI / 2;

    const eye = botEye(a);
    expect(hasLineOfSight(eye, playerEye(blocked.player), [])).toBe(true);
    expect(hasLineOfSight(eye, playerEye(blocked.player), blocked.colliders)).toBe(false);

    const blockedEvents = [];
    const openEvents = [];
    for (let i = 0; i < 300; i++) {
      blockedEvents.push(...fireTick(a, blocked));
      openEvents.push(...fireTick(b, open));
    }

    // Same bot, same player, same clock: the divider is the only difference.
    expect(shots(blockedEvents)).toHaveLength(0);
    expect(shots(openEvents).length).toBeGreaterThan(0);
  });

  it('waits out a seeded reaction delay, then keeps time with the fireRate', () => {
    const world = makeWorld({ x: 0, y: 0, z: 9 });
    const bot = duel(world, 'react_1');

    const times = [];
    for (let i = 0; i < Math.ceil(4 / DT); i++) {
      if (shots(fireTick(bot, world)).length) times.push(world.time);
    }

    expect(times.length).toBeGreaterThan(20);
    expect(times[0]).toBeGreaterThanOrEqual(DT + B.reactionTimeMin - 1e-9);
    expect(times[0]).toBeLessThanOrEqual(DT + B.reactionTimeMax + DT + 1e-9);
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(W.fireRate - 1e-9);
    }
  });

  it('keeps the seeded aim error inside the config cone over 500 shots', () => {
    const world = makeWorld({ x: 0, y: 0, z: 9 });
    const bot = duel(world, 'aim_1');
    const chest = { x: 0, y: CONFIG.MOVEMENT.playerHeight / 2, z: 9 };

    const samples = [];
    for (let i = 0; samples.length < 500 && i < 20000; i++) {
      for (const shot of shots(fireTick(bot, world))) {
        samples.push({ error: angleBetween(shot.dir, aimAt(shot.origin, chest)), cone: shot.cone });
      }
    }
    expect(samples).toHaveLength(500);

    const errors = samples.map((s) => s.error);
    const cones = samples.map((s) => s.cone);
    for (const s of samples) {
      expect(s.cone).toBeGreaterThanOrEqual(B.aimErrorMin - 1e-12);
      expect(s.cone).toBeLessThanOrEqual(B.aimErrorMax + 1e-12);
      expect(s.error).toBeLessThanOrEqual(s.cone + 1e-9);
    }

    // The cone the shots land in is always inside the config band: wide while the bot is
    // new to the target, and settled exactly on the floor once it has held him.
    expect(cones[0]).toBeGreaterThan(B.aimErrorMin);
    expect(cones[cones.length - 1]).toBeCloseTo(B.aimErrorMin, 6);
    expect(Math.max(...errors)).toBeGreaterThan(B.aimErrorMin); // the cone really is being sampled
  });

  it('aims the same way twice from the same seed', () => {
    const run = () => {
      const world = makeWorld({ x: 0, y: 0, z: 9 });
      const bot = duel(world, 'seeded_1');
      const dirs = [];
      for (let i = 0; dirs.length < 20 && i < 2000; i++) {
        dirs.push(...shots(fireTick(bot, world)).map((s) => s.dir));
      }
      return dirs;
    };

    expect(run()).toEqual(run());
  });

  it('puts hits on the player and reports the damage', () => {
    const world = makeWorld({ x: 0, y: 0, z: 0 }, { colliders: [] });
    const bot = duel(world, 'shooter_1', -8);
    const health = world.player.health;

    const events = [];
    for (let i = 0; i < 600; i++) events.push(...fireTick(bot, world));

    const damage = events.filter((e) => e.type === 'damage');
    expect(damage.length).toBeGreaterThan(0);
    expect(damage[0].target).toBe('player');
    expect(damage[0].source).toBe('shooter_1');
    expect(damage[0].damage).toBe(W.damage);
    expect(world.player.health).toBeLessThan(health);
    expect(world.player.health).toBeGreaterThanOrEqual(0);
  });

  it('reports the point a wall stopped the round at', () => {
    // A crate between them: tall enough to cut the shot descending toward the player's
    // chest, short enough to leave the eye-to-eye line clear so the bot takes the shot.
    const crate = { min: { x: -1, y: 0, z: 1 }, max: { x: 1, y: 1.4, z: 2 } };
    const world = makeWorld({ x: 0, y: 0, z: 4 }, { colliders: [crate] });
    const bot = duel(world, 'stop_1', -2);
    bot.rng = () => 0; // dead-on aim at the chest, shortest reaction delay

    const events = [];
    for (let i = 0; events.length === 0 && i < 600; i++) events.push(...fireTick(bot, world));

    const shot = shots(events)[0];
    expect(shot).toBeTruthy();
    expect(shot.end.z).toBeCloseTo(1, 5); // the crate face, not the player 6 m out
    expect(shot.end.y).toBeCloseTo(1.25, 5);
    expect(events.some((e) => e.type === 'damage')).toBe(false);
  });
});

describe('death and corpses', () => {
  it('wounds a bot and kills it on the blow that empties it', () => {
    const world = makeWorld({ x: 0, y: 0, z: 400 });
    const bot = duel(world, 'hurt_1');

    expect(damageBot(bot, 40, world)).toBe(40);
    expect(bot.hp).toBe(B.health - 40);
    expect(bot.alive).toBe(true);
    expect(bot.state).not.toBe('dead');

    expect(damageBot(bot, B.health, world)).toBe(B.health - 40); // health never goes negative
    expect(bot.hp).toBe(0);
    expect(bot.alive).toBe(false);
    expect(bot.state).toBe('dead');
    expect(bot.deathTime).toBe(world.time);
    expect(damageBot(bot, 10, world)).toBe(0); // a corpse takes no more damage
  });

  it('takes a dead bot out of the fight: no movement, no fire, no hitboxes', () => {
    const world = makeWorld({ x: 0, y: 0, z: 9 });
    const bot = duel(world, 'dead_1');

    tick(bot, world);
    expect(bot.state).toBe('engage');

    killBot(bot, world);
    const pos = { ...bot.pos };
    const events = [];
    for (let i = 0; i < 180; i++) events.push(...tick(bot, world));

    expect(bot.alive).toBe(false);
    expect(bot.state).toBe('dead');
    expect(bot.pos).toEqual(pos);
    expect(botHitboxes(bot)).toBeNull();
    expect(shots(events)).toHaveLength(0);
    expect(events.filter((e) => e.type === 'damage')).toHaveLength(0);
  });

  it('flags the corpse only once its lifetime has run out', () => {
    const world = makeWorld({ x: 0, y: 0, z: 9 });
    const bot = duel(world, 'corpse_1');

    tick(bot, world);
    killBot(bot, world);
    expect(bot.deathTime).toBeCloseTo(world.time, 10);
    expect(bot.removable ?? false).toBe(false);

    for (let i = 0; i < Math.ceil(LIFETIME / DT) - 5; i++) tick(bot, world);
    expect(bot.removable ?? false).toBe(false);

    for (let i = 0; i < 10; i++) tick(bot, world);
    expect(bot.removable).toBe(true);
  });
});
