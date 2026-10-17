import { describe, expect, it } from 'vitest';
import { CONFIG, ROUNDS } from '../src/config.js';
import { createRounds, roundTick } from '../src/core/rounds.js';

// TICK is a power of two so the intermission boundary lands exactly on a frame; DT is the
// real 60 Hz step the game runs on.
const TICK = 1 / 64;
const DT = 1 / 60;

const LIVE = { botsAlive: true, playerAlive: true };
const BOTS_DEAD = { botsAlive: false, playerAlive: true };
const PLAYER_DEAD = { botsAlive: true, playerAlive: false };
const BOTH_DEAD = { botsAlive: false, playerAlive: false };

// Run n steps, collecting every event they produced.
function step(state, cond, n, dt = TICK) {
  const events = [];
  for (let i = 0; i < n; i++) events.push(...roundTick(state, cond, dt));
  return events;
}

const endWith = (cond, dt = TICK) => {
  const state = createRounds();
  const events = roundTick(state, cond, dt);
  return { state, events };
};

describe('createRounds', () => {
  it('starts round 1 live, with a zeroed clock and score', () => {
    const state = createRounds();
    expect(state.phase).toBe('playing');
    expect(state.timer).toBe(0);
    expect(state.intermissionRemaining).toBe(0);
    expect(state.score).toEqual({ player: 0, bots: 0 });
  });

  it('counts the round timer up while both sides live, and emits nothing (brief AT10)', () => {
    const state = createRounds();
    expect(step(state, LIVE, 10)).toEqual([]);
    expect(state.phase).toBe('playing');
    expect(state.timer).toBeCloseTo(10 * TICK, 12);
  });

  it('runs the timer at the real 60 Hz step', () => {
    const state = createRounds();
    step(state, LIVE, 60, DT);
    expect(state.timer).toBeCloseTo(1, 10);
  });
});

describe('round end', () => {
  it('all bots dead -> won and the player score +1 (brief AT10)', () => {
    const { state, events } = endWith(BOTS_DEAD);
    expect(events).toEqual([{ type: 'roundEnd', result: 'won' }]);
    expect(state.phase).toBe('won');
    expect(state.score).toEqual({ player: 1, bots: 0 });
  });

  it('player dead -> lost and the bot score +1 (brief AT10)', () => {
    const { state, events } = endWith(PLAYER_DEAD);
    expect(events).toEqual([{ type: 'roundEnd', result: 'lost' }]);
    expect(state.phase).toBe('lost');
    expect(state.score).toEqual({ player: 0, bots: 1 });
  });

  it('a player who dies on the tick of their last kill loses the round', () => {
    const { state, events } = endWith(BOTH_DEAD);
    expect(events).toEqual([{ type: 'roundEnd', result: 'lost' }]);
    expect(state.score).toEqual({ player: 0, bots: 1 });
  });

  it('scores a round once, however long the banner stays up', () => {
    const { state } = endWith(BOTS_DEAD);
    expect(step(state, BOTS_DEAD, 10)).toEqual([]);
    expect(state.score).toEqual({ player: 1, bots: 0 });
  });

  it('stops the round clock the moment the round ends', () => {
    const state = createRounds();
    step(state, LIVE, 30);
    // The tick that ends the round is still a live tick, so the clock stops after it.
    roundTick(state, BOTS_DEAD, TICK);
    const frozen = state.timer;
    step(state, BOTS_DEAD, 30);
    expect(state.timer).toBe(frozen);
  });

  it('reads a live bot count as well as a boolean', () => {
    const state = createRounds();
    expect(roundTick(state, { botsAlive: 3, playerAlive: true }, TICK)).toEqual([]);
    expect(roundTick(state, { botsAlive: 0, playerAlive: 1 }, TICK)).toEqual([
      { type: 'roundEnd', result: 'won' },
    ]);
  });
});

describe('intermission and newRound', () => {
  it('fires newRound exactly ROUNDS.intermission seconds after the round ends (brief AT10)', () => {
    const { state } = endWith(BOTS_DEAD);
    const frames = ROUNDS.intermission / TICK;

    for (let i = 1; i < frames; i++) {
      expect(roundTick(state, BOTS_DEAD, TICK)).toEqual([]);
      expect(state.phase).not.toBe('playing');
    }
    expect(roundTick(state, BOTS_DEAD, TICK)).toEqual([{ type: 'newRound' }]);
    expect(state.phase).toBe('playing');
    expect(state.intermissionRemaining).toBe(0);
  });

  it('counts the intermission down for the HUD banner', () => {
    const { state } = endWith(PLAYER_DEAD);
    expect(state.intermissionRemaining).toBe(ROUNDS.intermission);
    step(state, PLAYER_DEAD, 2);
    expect(state.intermissionRemaining).toBeCloseTo(ROUNDS.intermission - 2 * TICK, 12);
  });

  it('takes its length from config instead of a hard-coded 3 s', () => {
    const config = structuredClone(CONFIG);
    config.ROUNDS.intermission = 1;
    const state = createRounds(config);

    roundTick(state, PLAYER_DEAD, TICK);
    expect(step(state, PLAYER_DEAD, 1 / TICK - 1)).toEqual([]);
    expect(step(state, PLAYER_DEAD, 1)).toEqual([{ type: 'newRound' }]);
  });

  it('starts the new round within one frame of 3 s at the real 60 Hz step', () => {
    const { state } = endWith(BOTS_DEAD, DT);
    let elapsed = 0;
    for (let i = 0; i < 1000; i++) {
      elapsed += DT;
      if (roundTick(state, BOTS_DEAD, DT).length) break;
    }
    expect(Math.abs(elapsed - ROUNDS.intermission)).toBeLessThanOrEqual(DT);
  });

  it('resets the timer for the new round and scores the next one on top (brief AT10)', () => {
    const state = createRounds();
    step(state, LIVE, 90); // 1.4 s of round 1
    roundTick(state, BOTS_DEAD, TICK);
    expect(step(state, BOTS_DEAD, ROUNDS.intermission / TICK)).toEqual([{ type: 'newRound' }]);
    expect(state.timer).toBe(0);

    step(state, LIVE, 10);
    expect(state.timer).toBeCloseTo(10 * TICK, 12);
    expect(roundTick(state, PLAYER_DEAD, TICK)).toEqual([{ type: 'roundEnd', result: 'lost' }]);
    expect(state.score).toEqual({ player: 1, bots: 1 });
  });

  it('keeps cycling rounds without losing the score', () => {
    const state = createRounds();
    const full = ROUNDS.intermission / TICK;
    const results = [];

    for (const cond of [BOTS_DEAD, PLAYER_DEAD, BOTS_DEAD]) {
      results.push(roundTick(state, cond, TICK)[0].result);
      expect(step(state, cond, full)).toEqual([{ type: 'newRound' }]);
      expect(state.phase).toBe('playing');
    }
    expect(results).toEqual(['won', 'lost', 'won']);
    expect(state.score).toEqual({ player: 2, bots: 1 });
  });
});
