import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createPlayer } from '../src/core/movement.js';
import { createBot } from '../src/core/bots.js';
import { getColliders, MAP_DATA } from '../src/core/mapData.js';
import { botStuckTick, isEmbedded, isOutOfBounds, recoverPlayer } from '../src/core/safety.js';
import { createWorld, stepGame } from '../src/core/game.js';

const FRAME = CONFIG.LOOP.step;
const STUCK = CONFIG.BOTS.stuckTime;
const BOUNDS = MAP_DATA.bounds;
const SPAWN = MAP_DATA.spawnZones.T.spawns[0];
const HALF = CONFIG.MOVEMENT.playerWidth / 2;
const WAYPOINTS = MAP_DATA.waypoints;

// The arena is 40 x 28 m with the floor at y = 0; these are known-good spots to move a
// body to: the top of the mid_west crate and the inner face of the east wall.
const CRATE_TOP = { x: -4, y: 1, z: 0 };
const EAST_WALL = BOUNDS.max.x;

// Translate a body so its feet land on (x, y, z), leaving its size alone.
function place(entity, x, y, z) {
  const b = entity.box;
  const dx = x - (b.min.x + b.max.x) / 2;
  const dy = y - b.min.y;
  const dz = z - (b.min.z + b.max.z) / 2;
  for (const p of [b.min, b.max]) {
    p.x += dx;
    p.y += dy;
    p.z += dz;
  }
  if (entity.pos) {
    entity.pos.x = x;
    entity.pos.y = y;
    entity.pos.z = z;
  }
  return entity;
}

const feet = (entity) => ({
  x: (entity.box.min.x + entity.box.max.x) / 2,
  y: entity.box.min.y,
  z: (entity.box.min.z + entity.box.max.z) / 2,
});

const idle = () => ({ mouseX: 0, mouseY: 0, wheel: 0, pressed: {} });

// A bot mid-patrol on the leg ct -> mid_n, somewhere the two ends are far apart so a
// stuck leg has metres of distance to fail to close.
function patrolBot() {
  const bot = createBot('bot_1', { x: 0, y: 0, z: -12 }, CONFIG);
  bot.node = 'ct';
  bot.from = 'ct';
  bot.target = 'mid_n';
  place(bot, -14, 0, -10);
  return bot;
}

const tick = (bot, n = 1) => {
  let skipped = false;
  for (let i = 0; i < n; i++) skipped = botStuckTick(bot, FRAME, CONFIG, WAYPOINTS) || skipped;
  return skipped;
};

describe('isOutOfBounds', () => {
  it('lets a player stand anywhere inside the arena', () => {
    for (const spot of [SPAWN, { x: 0, y: 0, z: 0 }, { x: -19, y: 0, z: 13 }, CRATE_TOP]) {
      expect(isOutOfBounds(place(createPlayer(SPAWN), spot.x, spot.y, spot.z), BOUNDS)).toBe(false);
    }
  });

  it('counts a box flush with a wall as inside', () => {
    // resolveMove clamps the player exactly onto the bound, so flush has to be legal or
    // every wall-hug would be a teleport.
    expect(isOutOfBounds(place(createPlayer(SPAWN), EAST_WALL - HALF, 0, 0), BOUNDS)).toBe(false);
  });

  it('catches a player below the floor', () => {
    expect(isOutOfBounds(place(createPlayer(SPAWN), 0, -3, 12), BOUNDS)).toBe(true);
  });

  it('catches a player outside each wall', () => {
    const player = createPlayer(SPAWN);
    expect(isOutOfBounds(place(player, 25, 0, 0), BOUNDS)).toBe(true);
    expect(isOutOfBounds(place(player, -25, 0, 0), BOUNDS)).toBe(true);
    expect(isOutOfBounds(place(player, 0, 0, 18), BOUNDS)).toBe(true);
    expect(isOutOfBounds(place(player, 0, 0, -18), BOUNDS)).toBe(true);
  });

  it('catches a player above the ceiling', () => {
    expect(isOutOfBounds(place(createPlayer(SPAWN), 0, 9, 0), BOUNDS)).toBe(true);
  });
});

describe('isEmbedded', () => {
  it('is false for a player resting on the floor', () => {
    expect(isEmbedded(createPlayer(SPAWN), getColliders())).toBe(false);
  });

  it('is false for a player standing on a crate', () => {
    // The crate top is a collider he sits flush against: contact is not embedding.
    expect(isEmbedded(place(createPlayer(SPAWN), CRATE_TOP.x, CRATE_TOP.y, CRATE_TOP.z), getColliders())).toBe(false);
  });

  it('is false for a player pressed against a wall', () => {
    expect(isEmbedded(place(createPlayer(SPAWN), EAST_WALL - HALF, 0, 0), getColliders())).toBe(false);
  });

  it('is true for a player inside a crate', () => {
    const player = place(createPlayer(SPAWN), CRATE_TOP.x, 0.5, CRATE_TOP.z);
    expect(isEmbedded(player, getColliders())).toBe(true);
    // ...and that crate is well inside the arena, so this is the bounds check missing it.
    expect(isOutOfBounds(player, BOUNDS)).toBe(false);
  });

  it('is true for a player inside a wall', () => {
    expect(isEmbedded(place(createPlayer(SPAWN), EAST_WALL + 0.3, 0, 0), getColliders())).toBe(true);
  });
});

describe('recoverPlayer', () => {
  it('puts the player back at the spawn with zero velocity', () => {
    const player = place(createPlayer(SPAWN), 40, -20, 40);
    player.vel = { x: 900, y: -50, z: 900 };
    recoverPlayer(player, SPAWN);

    expect(feet(player)).toEqual(SPAWN);
    expect(player.vel).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('keeps the aim and the health', () => {
    const player = place(createPlayer(SPAWN), 0, -5, 12);
    player.yaw = 1.2;
    player.pitch = -0.4;
    player.health = 17;
    recoverPlayer(player, SPAWN);

    expect(player.yaw).toBe(1.2);
    expect(player.pitch).toBe(-0.4);
    expect(player.health).toBe(17);
  });

  it('leaves no fall pending, so the recovery is not a landing', () => {
    const player = place(createPlayer(SPAWN), 0, 40, 12);
    player.fallStart = 40;
    player.onGround = false;
    recoverPlayer(player, SPAWN);

    expect(player.fallStart).toBeNull();
    expect(player.onGround).toBe(false);
  });

  it('keeps a crouched player crouched', () => {
    const player = place(createPlayer(SPAWN), 30, 0, 12);
    player.crouching = true;
    player.eyeY = CONFIG.MOVEMENT.crouchEyeHeight;
    recoverPlayer(player, SPAWN);

    expect(player.box.max.y - player.box.min.y).toBeCloseTo(CONFIG.MOVEMENT.crouchHeight, 10);
    expect(player.eyeY).toBe(CONFIG.MOVEMENT.crouchEyeHeight);
  });
});

describe('botStuckTick', () => {
  it('skips to a new waypoint once a leg has made no progress for stuckTime', () => {
    const bot = patrolBot();
    let elapsed = 0;
    let skipped = false;
    while (!skipped && elapsed < STUCK * 4) {
      elapsed += FRAME;
      skipped = botStuckTick(bot, FRAME, CONFIG, WAYPOINTS);
    }

    expect(skipped).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(STUCK);
    expect(elapsed).toBeLessThan(STUCK + FRAME * 2);

    // The leg is over: it leaves from the waypoint it gave up on, heading for one of that
    // waypoint's links and never back to the node it came from.
    expect(bot.node).toBe('mid_n');
    expect(bot.from).toBe('ct');
    const wp = WAYPOINTS.find((n) => n.id === 'mid_n');
    expect(wp.links).toContain(bot.target);
    expect(bot.target).not.toBe('mid_n');
    expect(bot.target).not.toBe('ct');
  });

  it('gives the leg the whole stuckTime before skipping', () => {
    const bot = patrolBot();
    expect(tick(bot, Math.floor((STUCK - 0.5) / FRAME))).toBe(false);
    expect(bot.target).toBe('mid_n');
    expect(bot.node).toBe('ct');
  });

  it('leaves a bot that keeps closing the distance alone', () => {
    const bot = patrolBot();
    const wp = WAYPOINTS.find((n) => n.id === 'mid_n');
    for (let i = 0; i < Math.floor((STUCK * 4) / FRAME); i++) {
      const d = Math.hypot(bot.pos.x - wp.pos.x, bot.pos.z - wp.pos.z);
      const k = 0.01 / d; // a slow but real crawl toward the waypoint
      bot.pos.x += (wp.pos.x - bot.pos.x) * k;
      bot.pos.z += (wp.pos.z - bot.pos.z) * k;
      expect(botStuckTick(bot, FRAME, CONFIG, WAYPOINTS)).toBe(false);
    }
    expect(bot.target).toBe('mid_n');
    expect(bot.node).toBe('ct');
  });

  it('starts the clock over on a new leg', () => {
    const bot = patrolBot();
    tick(bot, Math.floor((STUCK - 0.5) / FRAME));
    bot.target = 'west_n'; // patrolStep handed it a new waypoint
    expect(tick(bot, Math.floor((STUCK - 0.5) / FRAME))).toBe(false);
    expect(bot.target).toBe('west_n');
  });

  it('leaves a normal bot untouched', () => {
    const bot = patrolBot();
    const before = { target: bot.target, node: bot.node, from: bot.from, state: bot.state };
    tick(bot, 10);
    expect(bot).toMatchObject(before);
  });

  it('does not re-route a bot that is not patrolling', () => {
    // Engage and cover walk at the player or a cover point, not at a waypoint, so the
    // distance to bot.target says nothing there.
    const bot = patrolBot();
    bot.state = 'engage';
    expect(tick(bot, Math.floor((STUCK * 2) / FRAME))).toBe(false);
    expect(bot.target).toBe('mid_n');
  });

  it('ignores a dead bot and a bot with no waypoint', () => {
    const dead = patrolBot();
    dead.alive = false;
    expect(tick(dead, Math.floor((STUCK * 2) / FRAME))).toBe(false);
    expect(dead.target).toBe('mid_n');

    const idleBot = patrolBot();
    idleBot.target = null;
    expect(tick(idleBot, Math.floor((STUCK * 2) / FRAME))).toBe(false);
    expect(idleBot.node).toBe('ct');
  });
});

describe('stepGame safety pass', () => {
  it('puts a player outside the arena back at the spawn', () => {
    const world = createWorld();
    world.bots = [];
    place(world.player, 40, -5, 40);
    world.player.vel = { x: 30, y: -10, z: 30 };

    stepGame(world, idle(), FRAME);

    expect(feet(world.player)).toEqual(SPAWN);
    expect(world.player.vel).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('pulls a player out of a wall', () => {
    const world = createWorld();
    world.bots = [];
    place(world.player, EAST_WALL + 0.3, 0, 0);

    stepGame(world, idle(), FRAME);

    expect(feet(world.player)).toEqual(SPAWN);
  });

  it('leaves a player standing in the arena alone, tick after tick', () => {
    const world = createWorld();
    world.bots = [];
    const start = feet(world.player);

    for (let i = 0; i < 600; i++) stepGame(world, idle(), FRAME);

    expect(feet(world.player)).toEqual(start);
    expect(world.player.health).toBe(CONFIG.PLAYER.maxHealth);
    expect(isEmbedded(world.player, world.colliders)).toBe(false);
  });
});
