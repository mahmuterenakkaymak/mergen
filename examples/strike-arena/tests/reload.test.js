import { describe, expect, it } from 'vitest';
import { WEAPONS } from '../src/config.js';
import {
  createLoadout,
  createWeaponState,
  loadoutTick,
  refillLoadout,
  reloadTick,
  startReload,
  switchWeapon,
  tryFire,
} from '../src/core/weapons.js';

const { pistol, rifle, sniper } = WEAPONS;

// TICK is a power of two so a reload boundary lands exactly on a frame; DT is the real
// 60 Hz step the game runs on.
const TICK = 1 / 64;
const DT = 1 / 60;

const click = () => ({ triggerPressed: true, triggerHeld: true });

// Ticks until reloadTick / loadoutTick reports completion, or -1 if it never does.
function ticksToReload(state, def, dt, max = 10000) {
  for (let i = 1; i <= max; i++) if (reloadTick(state, def, dt)) return i;
  return -1;
}

function ticksToDraw(loadout, dt, max = 10000) {
  for (let i = 1; i <= max; i++) if (loadoutTick(loadout, dt)) return i;
  return -1;
}

describe('startReload', () => {
  it('arms a reload on a partially empty magazine', () => {
    const s = createWeaponState(pistol);
    s.mag = 4;
    expect(startReload(s, pistol)).toBe(true);
    expect(s.reloading).toBe(true);
    expect(s.reloadRemaining).toBe(pistol.reloadTime);
    expect(s.mag).toBe(4);
    expect(s.reserve).toBe(pistol.reserveAmmo);
  });

  it('is blocked when the reserve is empty (brief AT7)', () => {
    const s = createWeaponState(pistol);
    s.mag = 0;
    s.reserve = 0;
    expect(startReload(s, pistol)).toBe(false);
    expect(s.reloading).toBe(false);
    expect(reloadTick(s, pistol, TICK)).toBe(false);
    expect(s.mag).toBe(0);
  });

  it('is blocked when the magazine is already full', () => {
    const s = createWeaponState(rifle);
    expect(startReload(s, rifle)).toBe(false);
    expect(s.reloading).toBe(false);
    expect(s.mag).toBe(rifle.magSize);
    expect(s.reserve).toBe(rifle.reserveAmmo);
  });

  it('is blocked while a reload is already running', () => {
    const s = createWeaponState(sniper);
    s.mag = 1;
    expect(startReload(s, sniper)).toBe(true);
    expect(startReload(s, sniper)).toBe(false);
    expect(s.reloadRemaining).toBe(sniper.reloadTime);
  });
});

describe('reloadTick', () => {
  it('takes exactly reloadTime — not a tick earlier, not a tick later', () => {
    const frames = Math.round(pistol.reloadTime / TICK);
    const s = createWeaponState(pistol);
    s.mag = 0;
    startReload(s, pistol);

    for (let i = 1; i < frames; i++) {
      expect(reloadTick(s, pistol, TICK)).toBe(false);
      expect(s.reloading).toBe(true);
      expect(s.mag).toBe(0);
    }
    expect(reloadTick(s, pistol, TICK)).toBe(true);
    expect(s.reloading).toBe(false);
  });

  it('takes reloadTime at the real 60 Hz step, within the frame that crosses it', () => {
    const s = createWeaponState(rifle);
    s.mag = 0;
    startReload(s, rifle);
    const done = ticksToReload(s, rifle, DT);
    expect(done).toBeGreaterThan(0);
    expect(Math.abs(done - rifle.reloadTime / DT)).toBeLessThanOrEqual(1);
  });

  it('moves min(need, reserve) from the reserve into the magazine', () => {
    const s = createWeaponState(rifle);
    s.mag = 3;
    s.reserve = 40;
    startReload(s, rifle);
    expect(ticksToReload(s, rifle, TICK)).toBeGreaterThan(0);
    expect(s.mag).toBe(rifle.magSize);
    expect(s.reserve).toBe(40 - (rifle.magSize - 3));
  });

  it('comes up short instead of inventing ammo when the reserve runs dry', () => {
    const s = createWeaponState(sniper);
    s.mag = 0;
    s.reserve = 2;
    startReload(s, sniper);
    expect(ticksToReload(s, sniper, TICK)).toBeGreaterThan(0);
    expect(s.mag).toBe(2);
    expect(s.reserve).toBe(0);
    expect(startReload(s, sniper)).toBe(false);
  });

  it('conserves total ammo across a reload', () => {
    const s = createWeaponState(pistol);
    s.mag = 5;
    const total = s.mag + s.reserve;
    startReload(s, pistol);
    ticksToReload(s, pistol, TICK);
    expect(s.mag + s.reserve).toBe(total);
  });

  it('does nothing when no reload is running', () => {
    const s = createWeaponState(pistol);
    s.mag = 1;
    expect(reloadTick(s, pistol, TICK)).toBe(false);
    expect(s.mag).toBe(1);
    expect(s.reserve).toBe(pistol.reserveAmmo);
    expect(s.reloadRemaining ?? 0).toBe(0);
  });

  it('blocks firing until it finishes, then fires again (brief AT7)', () => {
    const s = createWeaponState(pistol);
    s.mag = 1;
    startReload(s, pistol);

    expect(tryFire(s, pistol, click(), 0)).toEqual({ fired: false, dry: false });
    ticksToReload(s, pistol, DT);
    expect(s.mag).toBe(pistol.magSize);
    expect(tryFire(s, pistol, click(), 0).fired).toBe(true);
  });
});

describe('createLoadout', () => {
  it('has one state per weapon, ordered by slot, with slot 1 active', () => {
    const loadout = createLoadout(WEAPONS);
    expect(loadout.ids).toEqual(['pistol', 'rifle', 'sniper']);
    expect(Object.keys(loadout.weapons).sort()).toEqual(loadout.ids);
    expect(WEAPONS[loadout.active].slot).toBe(1);
    expect(loadout.drawRemaining).toBe(0);
  });

  it('starts every weapon at full magazine and full reserve', () => {
    const loadout = createLoadout(WEAPONS);
    for (const id of loadout.ids) {
      expect(loadout.weapons[id].mag).toBe(WEAPONS[id].magSize);
      expect(loadout.weapons[id].reserve).toBe(WEAPONS[id].reserveAmmo);
      expect(loadout.weapons[id].reloading).toBe(false);
    }
  });
});

describe('switchWeapon', () => {
  it('selects a weapon by its config slot', () => {
    const loadout = createLoadout(WEAPONS);
    expect(switchWeapon(loadout, 2)).toBe(true);
    expect(loadout.active).toBe('rifle');
    expect(switchWeapon(loadout, 3)).toBe(true);
    expect(loadout.active).toBe('sniper');
  });

  it('cycles with next and prev, wrapping at both ends', () => {
    const loadout = createLoadout(WEAPONS);
    const seen = [loadout.active];
    for (const _ of loadout.ids) {
      switchWeapon(loadout, 'next');
      seen.push(loadout.active);
    }
    expect(seen).toEqual(['pistol', 'rifle', 'sniper', 'pistol']);

    switchWeapon(loadout, 'prev');
    expect(loadout.active).toBe('sniper');
  });

  it('applies the incoming weapon draw time', () => {
    const loadout = createLoadout(WEAPONS);
    switchWeapon(loadout, 'next');
    expect(loadout.drawRemaining).toBe(rifle.drawTime);
    switchWeapon(loadout, 3);
    expect(loadout.drawRemaining).toBe(sniper.drawTime);
  });

  it('cancels the reload of the weapon left behind and moves no ammo', () => {
    const loadout = createLoadout(WEAPONS);
    switchWeapon(loadout, 2);
    const left = loadout.weapons.rifle;
    left.mag = 5;
    startReload(left, rifle);

    switchWeapon(loadout, 1);
    expect(loadout.active).toBe('pistol');
    expect(left.reloading).toBe(false);
    expect(left.mag).toBe(5);
    expect(left.reserve).toBe(rifle.reserveAmmo);
  });

  it('ignores a re-select of the active slot, keeping the reload alive', () => {
    const loadout = createLoadout(WEAPONS);
    const active = loadout.weapons.pistol;
    active.mag = 2;
    startReload(active, pistol);

    expect(switchWeapon(loadout, 1)).toBe(false);
    expect(loadout.active).toBe('pistol');
    expect(active.reloading).toBe(true);
    expect(loadout.drawRemaining).toBe(0);
  });

  it('ignores a slot no weapon has', () => {
    const loadout = createLoadout(WEAPONS);
    expect(switchWeapon(loadout, 4)).toBe(false);
    expect(switchWeapon(loadout, 0)).toBe(false);
    expect(loadout.active).toBe('pistol');
  });
});

describe('loadoutTick', () => {
  it('runs the draw time down to exactly zero', () => {
    const loadout = createLoadout(WEAPONS);
    switchWeapon(loadout, 'next');
    const frames = Math.ceil(rifle.drawTime / TICK);

    for (let i = 1; i < frames; i++) expect(loadoutTick(loadout, TICK)).toBe(false);
    expect(loadout.drawRemaining).toBeGreaterThan(0);
    expect(loadoutTick(loadout, TICK)).toBe(true);
    expect(loadout.drawRemaining).toBe(0);
  });

  it('is idle while nothing is being drawn', () => {
    const loadout = createLoadout(WEAPONS);
    expect(loadoutTick(loadout, DT)).toBe(false);
    expect(loadout.drawRemaining).toBe(0);

    // A finished draw stays finished instead of going negative.
    switchWeapon(loadout, 3);
    ticksToDraw(loadout, DT);
    expect(loadout.drawRemaining).toBe(0);
    expect(loadoutTick(loadout, DT)).toBe(false);
  });
});

describe('refillLoadout', () => {
  it('brings every weapon back to config ammo, including the ones not in hand (brief AT14)', () => {
    const loadout = createLoadout(WEAPONS);
    for (const id of loadout.ids) {
      loadout.weapons[id].mag = 1;
      loadout.weapons[id].reserve = 0;
    }
    switchWeapon(loadout, 2);
    loadoutTick(loadout, DT / 2);

    refillLoadout(loadout);

    for (const id of loadout.ids) {
      expect(loadout.weapons[id].mag).toBe(WEAPONS[id].magSize);
      expect(loadout.weapons[id].reserve).toBe(WEAPONS[id].reserveAmmo);
    }
    expect(loadout.drawRemaining).toBe(0);
  });

  it('drops a reload that was still running when the round ended', () => {
    const loadout = createLoadout(WEAPONS);
    const sniperState = loadout.weapons.sniper;
    switchWeapon(loadout, 3);
    sniperState.mag = 0;
    sniperState.reserve = 4;
    startReload(sniperState, sniper);

    refillLoadout(loadout);

    expect(sniperState.reloading).toBe(false);
    expect(sniperState.mag).toBe(sniper.magSize);
    expect(sniperState.reserve).toBe(sniper.reserveAmmo);
    expect(loadout.active).toBe('sniper');
  });
});
