import { describe, expect, it } from 'vitest';
import { WEAPONS } from '../src/config.js';
import { createWeaponState, tryFire } from '../src/core/weapons.js';

const DT = 1 / 60;
const { pistol, rifle, sniper } = WEAPONS;

// A real click is pressed AND held on its first frame.
const click = () => ({ triggerPressed: true, triggerHeld: true });
const heldOnly = () => ({ triggerPressed: false, triggerHeld: true });
const released = () => ({ triggerPressed: false, triggerHeld: false });

// Run `frames` frames at a fixed 60 Hz clock and collect what tryFire reported.
function frames(count, def, state, inputAt) {
  const shots = [];
  const dries = [];
  for (let i = 0; i < count; i++) {
    const now = i * DT;
    const r = tryFire(state, def, inputAt(i), now);
    if (r.fired) shots.push(now);
    if (r.dry) dries.push(now);
  }
  return { shots, dries };
}

const hold = (count, firstFrameClick = true) => (i) => (i === 0 && firstFrameClick ? click() : heldOnly());

describe('createWeaponState', () => {
  it('starts from the weapon definition', () => {
    const s = createWeaponState(rifle);
    expect(s.mag).toBe(rifle.magSize);
    expect(s.reserve).toBe(rifle.reserveAmmo);
    expect(s.reloading).toBe(false);
    expect(s.nextShotAt).toBe(0);
    expect(s.lockoutUntil).toBe(0);
    expect(s.shotsFired).toBe(0);
  });
});

describe('semi fire mode', () => {
  it('fires once per press, not once per frame while held', () => {
    const s = createWeaponState(pistol);
    expect(tryFire(s, pistol, click(), 0).fired).toBe(true);

    // 1 s of holding the trigger after that click adds nothing.
    const { shots } = frames(Math.round(1 / DT), pistol, s, heldOnly);
    expect(shots).toHaveLength(0);
    expect(s.mag).toBe(pistol.magSize - 1);

    // A fresh press after the fireRate gate fires again.
    expect(tryFire(s, pistol, click(), pistol.fireRate + 0.05).fired).toBe(true);
    expect(s.mag).toBe(pistol.magSize - 2);
  });

  it('ignores a second press that lands inside the fireRate window', () => {
    const s = createWeaponState(pistol);
    expect(tryFire(s, pistol, click(), 0).fired).toBe(true);
    const r = tryFire(s, pistol, click(), pistol.fireRate / 2);
    expect(r.fired).toBe(false);
    expect(r.dry).toBe(false);
    expect(s.mag).toBe(pistol.magSize - 1);
  });
});

describe('auto fire mode', () => {
  it('fires on the first held frame, then at fireRate while the trigger stays down', () => {
    const s = createWeaponState(rifle);
    const { shots } = frames(Math.round(1 / DT), rifle, s, hold(Math.round(1 / DT)));

    // One second of sustained fire is 1/fireRate shots, +/- the frame quantisation.
    expect(shots.length).toBeGreaterThanOrEqual(Math.floor(1 / rifle.fireRate));
    expect(shots.length).toBeLessThanOrEqual(Math.ceil(1 / rifle.fireRate) + 1);
    expect(shots[0]).toBe(0);

    for (let i = 1; i < shots.length; i++) {
      const gap = shots[i] - shots[i - 1];
      expect(gap).toBeGreaterThanOrEqual(rifle.fireRate - 1e-9);
      expect(gap).toBeLessThan(rifle.fireRate + DT);
    }
  });

  it('consumes exactly one round per shot and stops when the trigger is released', () => {
    const s = createWeaponState(rifle);
    const { shots } = frames(30, rifle, s, hold(30));
    expect(s.mag).toBe(rifle.magSize - shots.length);
    expect(shots.length).toBeGreaterThan(0);

    const after = frames(120, rifle, s, released);
    expect(after.shots).toHaveLength(0);
    expect(s.mag).toBe(rifle.magSize - shots.length);
  });
});

describe('sniper lockout', () => {
  it('has a lockout longer than its fireRate, so lockout is what gates the next shot', () => {
    expect(sniper.lockout).toBeGreaterThan(sniper.fireRate);
  });

  it('blocks every shot until def.lockout seconds after the previous one', () => {
    const s = createWeaponState(sniper);
    expect(tryFire(s, sniper, click(), 0).fired).toBe(true);
    expect(s.mag).toBe(sniper.magSize - 1);

    // Past fireRate but inside the bolt cycle: no shot, no dry click, no ammo moved.
    const mid = (sniper.fireRate + sniper.lockout) / 2;
    const blocked = tryFire(s, sniper, click(), mid);
    expect(blocked).toEqual({ fired: false, dry: false });
    expect(s.mag).toBe(sniper.magSize - 1);
    expect(tryFire(s, sniper, click(), sniper.lockout - DT).fired).toBe(false);

    expect(tryFire(s, sniper, click(), sniper.lockout).fired).toBe(true);
    expect(s.mag).toBe(sniper.magSize - 2);
  });

  it('allows exactly one shot per lockout cycle even with the trigger clicked every frame', () => {
    const s = createWeaponState(sniper);
    const { shots } = frames(Math.round((sniper.lockout * 3) / DT), sniper, s, click);
    expect(shots).toHaveLength(3);
    expect(shots[1] - shots[0]).toBeGreaterThanOrEqual(sniper.lockout);
    expect(shots[2] - shots[1]).toBeGreaterThanOrEqual(sniper.lockout);
    expect(s.mag).toBe(sniper.magSize - 3);
  });
});

describe('empty magazine', () => {
  it('reports dry without consuming ammo', () => {
    const s = createWeaponState(pistol);
    s.mag = 0;
    const r = tryFire(s, pistol, click(), 0);
    expect(r).toEqual({ fired: false, dry: true });
    expect(s.mag).toBe(0);
    expect(s.reserve).toBe(pistol.reserveAmmo);
  });

  it('never takes ammo from the reserve on its own, even while an auto trigger is held', () => {
    const s = createWeaponState(rifle);
    s.mag = 0;
    const count = Math.round(1 / DT);
    const { shots, dries } = frames(count, rifle, s, hold(count));
    expect(shots).toHaveLength(0);
    expect(dries.length).toBeGreaterThan(0);
    expect(dries.length).toBeLessThan(count); // rate-limited, not one per frame
    expect(s.mag).toBe(0);
    expect(s.reserve).toBe(rifle.reserveAmmo);
  });

  it('stays at zero with an empty reserve instead of going negative', () => {
    const s = createWeaponState(sniper);
    s.mag = 0;
    s.reserve = 0;
    expect(tryFire(s, sniper, click(), 0).dry).toBe(true);
    expect(tryFire(s, sniper, click(), sniper.lockout + 1).dry).toBe(true);
    expect(s.mag).toBe(0);
    expect(s.reserve).toBe(0);
  });
});

describe('reload gate', () => {
  it('cannot fire while reloading, semi or auto', () => {
    const semi = createWeaponState(pistol);
    semi.reloading = true;
    expect(tryFire(semi, pistol, click(), 0)).toEqual({ fired: false, dry: false });
    expect(semi.mag).toBe(pistol.magSize);

    const auto = createWeaponState(rifle);
    auto.reloading = true;
    const { shots, dries } = frames(60, rifle, auto, hold(60));
    expect(shots).toHaveLength(0);
    expect(dries).toHaveLength(0);
    expect(auto.mag).toBe(rifle.magSize);
  });
});
