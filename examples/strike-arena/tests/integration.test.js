// The whole core running together: one world, sixty simulated seconds, a player who never
// touches a key. Nothing here tests new behaviour — every rule it leans on is already
// covered in isolation elsewhere. What this checks is that they hold when they run at the
// same time and at speed: five bots thinking, shooting, dying and coming back, rounds
// ending and resetting, over three thousand six hundred steps.
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.js';
import MAP_DATA, { BOUNDS } from '../src/core/mapData.js';
import { createWorld, stepGame } from '../src/core/game.js';

const DT = CONFIG.LOOP.step;
const STEPS_PER_SECOND = Math.round(1 / DT);
const T_SPAWN = MAP_DATA.spawnZones.T.spawns[0];
const EPS = 1e-6;

// A scripted idle input: every key up, both mouse axes zero. stepGame consumes the
// frame-scoped fields off the object it is handed, so each step gets a fresh one exactly
// as a real input.js snapshot would.
function idleInput() {
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
  };
}

const feetOf = (box) => ({ x: (box.min.x + box.max.x) / 2, y: box.min.y, z: (box.min.z + box.max.z) / 2 });
const inside = (box) =>
  box.min.x >= BOUNDS.min.x - EPS &&
  box.max.x <= BOUNDS.max.x + EPS &&
  box.min.y >= BOUNDS.min.y - EPS &&
  box.max.y <= BOUNDS.max.y + EPS &&
  box.min.z >= BOUNDS.min.z - EPS &&
  box.max.z <= BOUNDS.max.z + EPS;
const finite = (p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

// Run `seconds` of fixed steps and report what the minute looked like: every event it
// produced, plus the list of rule violations seen along the way. Checked per tick rather
// than at the end, because a bot that leaves the arena and comes back would otherwise
// leave no trace.
function simulate(seconds, seed = 1) {
  const world = createWorld(CONFIG, MAP_DATA, seed);
  const events = [];
  const violations = [];
  let corpse = null; // where the player was put down, to check he is not moved while dead
  // State on the step the first new round begins: the state at t=60 depends on bot difficulty
  // (after the 2026-10-16 tuning the player can be dead again by then).
  let firstNewRound = null;

  for (let i = 0; i < seconds * STEPS_PER_SECOND; i++) {
    stepGame(world, idleInput(), DT);
    events.push(...world.events);
    if (!firstNewRound && world.events.some((e) => e.type === 'newRound')) {
      firstNewRound = {
        phase: world.round.phase,
        timer: world.round.timer,
        health: world.player.health,
        bots: world.bots.map((b) => ({ alive: b.alive, hp: b.hp, state: b.state })),
      };
    }

    for (const bot of world.bots) {
      if (!inside(bot.box)) violations.push(`${bot.id} outside the arena at t=${world.time.toFixed(2)}`);
      if (!finite(bot.pos)) violations.push(`${bot.id} position not finite at t=${world.time.toFixed(2)}`);
    }
    if (!finite(feetOf(world.player.box))) {
      violations.push(`player position not finite at t=${world.time.toFixed(2)}`);
    }

    const dead = world.player.health <= 0;
    if (dead) {
      // Two things the HUD's death overlay depends on: a dead round is an ended round,
      // and a dead player stays where he fell — there is no spectate camera to move him.
      if (world.round.phase === 'playing') violations.push(`died mid-round at t=${world.time.toFixed(2)}`);
      const feet = feetOf(world.player.box);
      if (corpse && (feet.x !== corpse.x || feet.y !== corpse.y || feet.z !== corpse.z)) {
        violations.push(`dead player moved at t=${world.time.toFixed(2)}`);
      }
      corpse = feet;
    } else if (corpse) {
      // The reset that lifted the overlay also has to put him back at the T spawn.
      const feet = feetOf(world.player.box);
      if (Math.abs(feet.x - T_SPAWN.x) > 1e-6 || Math.abs(feet.z - T_SPAWN.z) > 1e-6) {
        violations.push(`respawned away from the T spawn at t=${world.time.toFixed(2)}`);
      }
      if (world.player.health !== CONFIG.PLAYER.maxHealth) {
        violations.push(`respawned at ${world.player.health} hp at t=${world.time.toFixed(2)}`);
      }
      corpse = null;
    }
  }

  return { world, events, violations, firstNewRound };
}

const of = (events, type) => events.filter((e) => e.type === type);

// One minute of simulation shared by the whole file: it is the same deterministic run, and
// three thousand six hundred steps of five bots is not cheap enough to repeat per test.
let session = null;
const minute = () => (session ??= simulate(60));

describe('a full minute of play', () => {
  it('steps the whole sixty seconds without throwing', () => {
    const { world, violations } = minute();

    expect(violations).toEqual([]);
    expect(world.time).toBeCloseTo(60, 4);
  });

  it('keeps every bot inside the arena the whole time', () => {
    const { world } = minute();

    expect(world.bots).toHaveLength(CONFIG.BOTS.count);
    for (const bot of world.bots) expect(inside(bot.box)).toBe(true);
  });

  it('has the bots shooting a player who never shoots back', () => {
    const { world, events } = minute();

    expect(of(events, 'botShot').length).toBeGreaterThan(0);
    expect(of(events, 'shot')).toHaveLength(0); // idle input: not one player shot all minute
    expect(of(events, 'hit')).toHaveLength(0); // and so not one confirmed player hit

    const wounds = of(events, 'playerDamaged');
    expect(wounds.length).toBeGreaterThan(0);
    for (const wound of wounds) {
      expect(wound.victim).toBe('player');
      expect(wound.source).toMatch(/^bot_/);
      expect(wound.damage).toBeGreaterThan(0);
      expect(finite(wound.sourcePos)).toBe(true);
    }
  });

  it('kills the player with bot fire and ends the round lost', () => {
    const { events } = minute();
    const ends = of(events, 'roundEnd');

    expect(ends.length).toBeGreaterThan(0);
    // The player never fires, so losing is the only result a round can have here.
    for (const end of ends) expect(end.result).toBe('lost');
    expect(of(events, 'damage').length).toBe(of(events, 'playerDamaged').length);
  });

  it('runs the round transition and brings everyone back for the next one', () => {
    const { world, events, firstNewRound } = minute();

    expect(of(events, 'newRound').length).toBeGreaterThan(0);
    expect(firstNewRound.phase).toBe('playing');
    expect(firstNewRound.timer).toBe(0); // the round clock counts up from a fresh 0
    expect(firstNewRound.health).toBe(CONFIG.PLAYER.maxHealth);
    expect(world.score).toEqual({ player: 0, bots: of(events, 'roundEnd').length });

    for (const bot of firstNewRound.bots) {
      expect(bot.alive).toBe(true);
      expect(bot.hp).toBe(CONFIG.BOTS.health);
      expect(bot.state).not.toBe('dead');
    }
  });
});
