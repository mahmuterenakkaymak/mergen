import { describe, it, expect } from 'vitest';
import {
  CONFIG,
  MOVEMENT,
  FALL,
  WEAPONS,
  BOTS,
  ROUNDS,
  PLAYER,
  HUD,
  MAP,
  AUDIO,
  EFFECTS,
  LOOP,
  MENU,
  validateConfig,
} from '../src/config.js';

const WEAPON_KEYS = [
  'name',
  'slot',
  'fireMode',
  'damage',
  'fireRate',
  'magSize',
  'reserveAmmo',
  'reloadTime',
  'spread',
  'headshotMult',
  'range',
];

const SPREAD_KEYS = ['base', 'move', 'air', 'walkMult', 'crouchMult', 'bloomPerShot', 'bloomDecay'];

const weaponIds = Object.keys(WEAPONS);

describe('weapon definitions', () => {
  it('defines pistol, rifle and sniper', () => {
    expect(weaponIds).toEqual(expect.arrayContaining(['pistol', 'rifle', 'sniper']));
  });

  it.each(weaponIds)('%s has every required stat', (id) => {
    const def = WEAPONS[id];
    for (const key of WEAPON_KEYS) {
      expect(def, `${id}.${key}`).toHaveProperty(key);
    }
    for (const key of SPREAD_KEYS) {
      expect(def.spread, `${id}.spread.${key}`).toHaveProperty(key);
      expect(typeof def.spread[key], `${id}.spread.${key} must be a number`).toBe('number');
    }
    expect(typeof def.name).toBe('string');
    expect(['semi', 'auto']).toContain(def.fireMode);
    expect(def.fireRate).toBeGreaterThan(0);
    expect(def.magSize).toBeGreaterThan(0);
    expect(def.reloadTime).toBeGreaterThan(0);
    expect(def.range).toBeGreaterThan(0);
  });

  it.each(weaponIds)('%s headshotMult is greater than 1', (id) => {
    expect(WEAPONS[id].headshotMult).toBeGreaterThan(1);
  });

  it('gives every weapon a unique positive slot', () => {
    const slots = weaponIds.map((id) => WEAPONS[id].slot);
    expect(new Set(slots).size).toBe(slots.length);
    for (const slot of slots) expect(slot).toBeGreaterThan(0);
  });

  it('keeps spread multipliers as reductions', () => {
    for (const id of weaponIds) {
      const s = WEAPONS[id].spread;
      expect(s.walkMult).toBeGreaterThan(0);
      expect(s.walkMult).toBeLessThanOrEqual(1);
      expect(s.crouchMult).toBeGreaterThan(0);
      expect(s.crouchMult).toBeLessThanOrEqual(1);
    }
  });

  it('gives the rifle a recoil pattern of [pitch, yaw] pairs', () => {
    const pattern = WEAPONS.rifle.recoilPattern;
    expect(Array.isArray(pattern)).toBe(true);
    expect(pattern.length).toBeGreaterThan(0);
    for (const pair of pattern) {
      expect(pair).toHaveLength(2);
      expect(typeof pair[0]).toBe('number');
      expect(typeof pair[1]).toBe('number');
    }
  });

  it('gives the rifle a recoil recovery window longer than its fireRate', () => {
    // Shorter than fireRate and a held trigger would restart the pattern between shots.
    expect(WEAPONS.rifle.recoilReset).toBeGreaterThan(WEAPONS.rifle.fireRate);
  });

  it('gives the sniper a lockout and a scope fov', () => {
    expect(WEAPONS.sniper.lockout).toBeGreaterThanOrEqual(0);
    expect(WEAPONS.sniper.scopeFov).toBeGreaterThan(0);
    expect(WEAPONS.sniper.scopeFov).toBeLessThan(MAP.fov);
  });
});

describe('other sections', () => {
  it('exposes the sections the rest of the game reads', () => {
    expect(CONFIG).toMatchObject({ MOVEMENT, FALL, WEAPONS, BOTS, ROUNDS, PLAYER, HUD, MAP, AUDIO, EFFECTS, LOOP, MENU });
  });

  it('keeps movement numbers positive and crouch below stand height', () => {
    expect(MOVEMENT.crouchSpeed).toBeLessThan(MOVEMENT.runSpeed);
    expect(MOVEMENT.walkSpeed).toBeLessThan(MOVEMENT.runSpeed);
    expect(MOVEMENT.crouchHeight).toBeLessThan(MOVEMENT.playerHeight);
    expect(MOVEMENT.eyeHeight).toBeLessThanOrEqual(MOVEMENT.playerHeight);
    expect(MOVEMENT.crouchEyeHeight).toBeLessThanOrEqual(MOVEMENT.crouchHeight);
  });

  it('runs the loop at a fixed 60 Hz with a 0.25 s frame cap', () => {
    expect(LOOP.step).toBeCloseTo(1 / 60, 12);
    expect(LOOP.maxFrame).toBe(0.25);
  });

  it('uses the round timings the brief asks for', () => {
    expect(ROUNDS.intermission).toBe(3);
    expect(ROUNDS.corpseLifetime).toBe(5);
  });
});

describe('validateConfig', () => {
  it('reports no errors for the shipped config', () => {
    expect(validateConfig(CONFIG)).toEqual([]);
  });

  it('reports missing weapon stats', () => {
    const broken = structuredClone(CONFIG);
    delete broken.WEAPONS.pistol.magSize;
    delete broken.WEAPONS.rifle.spread.bloomPerShot;
    const errors = validateConfig(broken);
    expect(errors.some((e) => e.includes('WEAPONS.pistol.magSize'))).toBe(true);
    expect(errors.some((e) => e.includes('WEAPONS.rifle.spread.bloomPerShot'))).toBe(true);
  });

  it('rejects a headshotMult of 1 or less', () => {
    const broken = structuredClone(CONFIG);
    broken.WEAPONS.sniper.headshotMult = 1;
    expect(validateConfig(broken).some((e) => e.includes('WEAPONS.sniper.headshotMult'))).toBe(true);
  });

  it('rejects an unknown fireMode and a missing rifle recoil pattern', () => {
    const broken = structuredClone(CONFIG);
    broken.WEAPONS.rifle.fireMode = 'burst';
    delete broken.WEAPONS.rifle.recoilPattern;
    const errors = validateConfig(broken);
    expect(errors.some((e) => e.includes('fireMode'))).toBe(true);
    expect(errors.some((e) => e.includes('recoilPattern'))).toBe(true);
  });

  it('rejects a missing or non-positive rifle recoilReset', () => {
    const missing = structuredClone(CONFIG);
    delete missing.WEAPONS.rifle.recoilReset;
    expect(validateConfig(missing).some((e) => e.includes('WEAPONS.rifle.recoilReset'))).toBe(true);

    const zero = structuredClone(CONFIG);
    zero.WEAPONS.rifle.recoilReset = 0;
    expect(validateConfig(zero).some((e) => e.includes('WEAPONS.rifle.recoilReset'))).toBe(true);
  });

  it('collects several problems at once instead of stopping at the first', () => {
    const broken = structuredClone(CONFIG);
    broken.MOVEMENT.gravity = -1;
    broken.LOOP.step = 0;
    broken.ROUNDS.intermission = undefined;
    expect(validateConfig(broken).length).toBeGreaterThanOrEqual(3);
  });
});
