import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.js';
import MAP_DATA, { getColliders } from '../src/core/mapData.js';
import { intersects } from '../src/core/aabb.js';
import { createPlayer } from '../src/core/movement.js';
import { botHitboxes, botThink, createBot, hasLineOfSight } from '../src/core/bots.js';

const DT = CONFIG.LOOP.step;
const B = CONFIG.BOTS;

// Far enough that no bot can ever see the player, so the patrol tests are only about
// walking and never about a fight starting.
const NO_PLAYER = { x: 0, y: 0, z: 400 };

// The slice of the world botThink reads. createWorld grows these fields in T16; a bot
// must not care about anything else.
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

const think = (bot, world, steps) => {
  for (let i = 0; i < steps; i++) botThink(bot, world, DT);
};

const flatDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const waypoint = (id) => MAP_DATA.waypoints.find((w) => w.id === id);
const botEye = (bot) => ({ x: bot.pos.x, y: bot.pos.y + B.eyeHeight, z: bot.pos.z });

const playerEye = (player) => ({
  x: (player.box.min.x + player.box.max.x) / 2,
  y: player.box.min.y + (player.eyeY ?? CONFIG.MOVEMENT.eyeHeight),
  z: (player.box.min.z + player.box.max.z) / 2,
});

describe('createBot and botHitboxes', () => {
  it('spawns alive at the spawn point, colliding as a body box with a head box on top', () => {
    const bot = createBot('bot_1', { x: -4, y: 0, z: -12 });

    expect(bot.alive).toBe(true);
    expect(bot.hp).toBe(B.health);
    expect(bot.state).toBe('patrol');
    expect(bot.pos).toEqual({ x: -4, y: 0, z: -12 });
    expect(bot.box.min.y).toBeCloseTo(0, 6);
    expect(bot.box.max.y).toBeCloseTo(B.bodyHeight, 6);

    const boxes = botHitboxes(bot);
    expect(boxes.id).toBe('bot_1');
    expect(boxes.body.min.x).toBeCloseTo(-4 - B.bodyWidth / 2, 6);
    expect(boxes.body.max.x).toBeCloseTo(-4 + B.bodyWidth / 2, 6);
    expect(boxes.head.min.y).toBeCloseTo(B.bodyHeight, 6);
    expect(boxes.head.max.y).toBeCloseTo(B.bodyHeight + B.headSize, 6);
  });

  it('has no hitboxes once it is dead', () => {
    const bot = createBot('bot_2', { x: 0, y: 0, z: 0 });
    expect(botHitboxes(bot)).not.toBeNull();

    bot.alive = false;
    expect(botHitboxes(bot)).toBeNull();
    expect(botThink(bot, makeWorld(NO_PLAYER), DT).state).toBe('dead');
  });
});

describe('hasLineOfSight', () => {
  it('is blocked by a wall and clear over the same line without one', () => {
    const world = makeWorld({ x: 0, y: 0, z: 0 });
    const from = { x: -14, y: B.eyeHeight, z: 0 };
    const to = playerEye(world.player);

    expect(flatDist(from, to)).toBeLessThan(B.viewDistance);
    expect(hasLineOfSight(from, to, [])).toBe(true);
    expect(hasLineOfSight(from, to, world.colliders)).toBe(false);
  });
});

describe('patrol', () => {
  it('walks the waypoint it picked and then routes on to a linked one', () => {
    const world = makeWorld(NO_PLAYER);
    const bot = createBot('bot_3', { x: -14, y: 0, z: 0 });

    botThink(bot, world, DT);
    expect(bot.node).toBe('west_c');
    expect(waypoint('west_c').links).toContain(bot.target);

    const leg = waypoint(bot.target);
    const before = flatDist(bot.pos, leg.pos);
    think(bot, world, 40);

    expect(bot.state).toBe('patrol');
    expect(flatDist(bot.pos, leg.pos)).toBeLessThan(before - 1);

    think(bot, world, 300);
    expect(['west_s', 'west_n']).toContain(bot.node);
    expect(waypoint(bot.node).links).toContain(bot.target);
    expect(bot.target).not.toBe('west_c');
  });

  it('keeps patrolling while a wall stands between it and the player', () => {
    const world = makeWorld({ x: 0, y: 0, z: 0 });
    const bot = createBot('bot_4', { x: -14, y: 0, z: 0 });
    bot.yaw = -Math.PI / 2; // looking along +X: the player is dead ahead, behind the divider

    const from = botEye(bot);
    const to = playerEye(world.player);
    expect(hasLineOfSight(from, to, [])).toBe(true);
    expect(hasLineOfSight(from, to, world.colliders)).toBe(false);

    think(bot, world, 60);
    expect(bot.state).toBe('patrol');
    expect(bot.pos.x).toBeCloseTo(-14, 1); // never charged the wall
  });

  it('engages the moment the same player is in the open', () => {
    const world = makeWorld({ x: -14, y: 0, z: -8 }); // same corridor, nothing in between
    const bot = createBot('bot_5', { x: -14, y: 0, z: 0 }); // yaw 0 looks toward -Z

    botThink(bot, world, DT);
    expect(bot.state).toBe('engage');
  });
});

describe('engage', () => {
  it('closes on the player and stops at the preferred range', () => {
    const world = makeWorld({ x: 0, y: 0, z: 9 });
    const bot = createBot('bot_6', { x: 0, y: 0, z: -9 });
    bot.yaw = Math.PI; // the player is behind it, down the open mid lane

    const player = { x: 0, z: 9 };
    const before = flatDist(bot.pos, player);
    expect(before).toBeGreaterThan(B.preferredRangeMax);

    botThink(bot, world, DT);
    expect(bot.state).toBe('engage');

    think(bot, world, 240);
    const after = flatDist(bot.pos, player);
    expect(after).toBeLessThan(before - 3);
    expect(after).toBeLessThanOrEqual(B.preferredRangeMax + 1e-6);
    expect(after).toBeGreaterThanOrEqual(B.preferredRangeMin);
  });

  it('breaks for cover after taking damage', () => {
    const world = makeWorld({ x: 0, y: 0, z: 9 });
    const bot = createBot('bot_7', { x: 0, y: 0, z: -9 });
    bot.yaw = Math.PI;

    botThink(bot, world, DT);
    expect(bot.state).toBe('engage');

    bot.hp -= 30;
    botThink(bot, world, DT);
    expect(bot.state).toBe('cover');
    expect(bot.coverId).toBeTruthy();

    const cover = MAP_DATA.coverPoints.find((c) => c.id === bot.coverId);
    const before = flatDist(bot.pos, cover.pos);
    think(bot, world, 60);
    expect(flatDist(bot.pos, cover.pos)).toBeLessThan(before - 0.5);
  });
});

describe('collision', () => {
  it('never ends a step inside a collider over a long patrol', () => {
    const world = makeWorld(NO_PLAYER);
    const bot = createBot('bot_8', { x: 0, y: 0, z: -11 });
    const colliders = world.colliders;
    let travelled = 0;
    let previous = { ...bot.pos };

    for (let i = 0; i < 3000; i++) {
      botThink(bot, world, DT);
      for (const c of colliders) expect(intersects(bot.box, c)).toBe(false);

      travelled += flatDist(previous, bot.pos);
      previous = { ...bot.pos };
    }

    expect(travelled).toBeGreaterThan(20);
    expect(bot.pos.y).toBeCloseTo(0, 3); // still on the floor, not floating or sunk
    expect(Math.abs(bot.pos.x)).toBeLessThan(19.8);
    expect(Math.abs(bot.pos.z)).toBeLessThan(13.8);
  });
});
