// Damage model: impact speed -> damage points, camera shake, vignette flash, smoke.
// Pure over a plain state object. Views read state.damage / state.smoking; the caller
// feeds the returned shake to camera.addShake and the vignette flash to the HUD, which
// own their own decay and caps.
import { clamp } from './util/math.js';

const MIN_HIT = 6; // m/s: at or below this a bump costs nothing
const DMG_PER_MS = 1.6; // damage points per m/s above MIN_HIT
const SHAKE_PER_MS = 0.045; // shake per m/s of impact
const FLASH_PER_DMG = 0.03; // vignette flash per damage point
const OVERHEAT_AT = 60; // damage where the engine smokes and warns, once until repaired

export function createDamage() {
  return { damage: 0, smoking: false, warned: false };
}

// impact: an `impact` event off the sim ({ speed } in m/s).
// ASSUMPTION: applyImpact takes the impact event rather than a bare speed — events are the sim's only channel (PLAN).
// Returns what the hit added { damage, shake, vignette, overheat }, or null when it wasn't a hit.
export function applyImpact(state, impact) {
  const speed = Math.abs(impact.speed);
  if (speed <= MIN_HIT) return null;

  const damage = (speed - MIN_HIT) * DMG_PER_MS;
  state.damage = clamp(state.damage + damage, 0, 100);
  state.smoking = state.damage > OVERHEAT_AT;

  const overheat = !state.warned && state.smoking;
  if (overheat) state.warned = true;

  return {
    damage,
    shake: speed * SHAKE_PER_MS,
    vignette: damage * FLASH_PER_DMG,
    overheat,
  };
}

export function repair(state) {
  state.damage = 0;
  state.smoking = false;
  state.warned = false;
}
