// Round flow: playing -> won/lost -> ROUNDS.intermission seconds -> new round.
// The caller decides nothing about timing and this module decides nothing about bots or
// the player: it is handed the two round conditions each step and returns the events the
// round machine produced, so it stays as testable as the weapon and spread modules.
import { CONFIG } from '../config.js';

// `phase` is 'playing' while the round clock runs, then 'won' or 'lost' for the rest of
// the round — that ended state IS the intermission, counted down in
// `intermissionRemaining` so the HUD can show the banner and its timer together.
export function createRounds(config = CONFIG) {
  return {
    config,
    phase: 'playing',
    timer: 0,
    intermissionRemaining: 0,
    score: { player: 0, bots: 0 },
  };
}

// Advance the round machine one step and return the events it produced: 'roundEnd' on the
// tick the round is decided, 'newRound' on the tick the next one starts.
//
// Any truthy `botsAlive` / `playerAlive` counts as alive, so the caller can pass a live
// bot count or a boolean without either being read wrong.
export function roundTick(state, { botsAlive, playerAlive } = {}, dt) {
  if (state.phase === 'playing') return playTick(state, botsAlive, playerAlive, dt);
  return intermissionTick(state, dt);
}

function playTick(state, botsAlive, playerAlive, dt) {
  state.timer += dt;

  const result = decide(botsAlive, playerAlive);
  if (!result) return [];

  state.phase = result;
  state.score[result === 'won' ? 'player' : 'bots'] += 1;
  state.intermissionRemaining = state.config.ROUNDS.intermission;
  return [{ type: 'roundEnd', result }];
}

function intermissionTick(state, dt) {
  state.intermissionRemaining -= dt;
  if (state.intermissionRemaining > 0) return [];

  state.intermissionRemaining = 0;
  state.phase = 'playing';
  state.timer = 0;
  return [{ type: 'newRound' }];
}

// A player who dies on the same tick as their last kill did not survive the round, so
// death outranks an empty bot list rather than the other way round.
function decide(botsAlive, playerAlive) {
  if (!playerAlive) return 'lost';
  if (!botsAlive) return 'won';
  return null;
}
