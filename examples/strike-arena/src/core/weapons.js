// Weapon firing state: plain data plus one gate function. `now` is absolute game time in
// seconds passed in by the caller, so the core never reads a clock and tests stay exact.

export function createWeaponState(def) {
  return {
    mag: def.magSize,
    reserve: def.reserveAmmo,
    reloading: false,
    reloadEnd: 0, // when an in-progress reload finishes
    nextShotAt: 0, // fireRate gate
    lockoutUntil: 0, // bolt-action gate; only the sniper sets it past its fireRate
    shotsFired: 0, // lifetime shot count, for the HUD and stats
    burstShots: 0, // shots since the recoil pattern last recovered; indexes the pattern
    lastShotAt: -Infinity, // game time of the most recent shot; the gap recovery waits on
  };
}

// Returns {fired, dry}. A semi weapon consumes the triggerPressed edge, so holding the
// mouse yields exactly one shot; an auto weapon only needs triggerHeld.
export function tryFire(state, def, { triggerHeld = false, triggerPressed = false } = {}, now) {
  const result = { fired: false, dry: false };

  if (state.reloading) return result;
  if (now < state.lockoutUntil || now < state.nextShotAt) return result;

  const wantsShot = def.fireMode === 'auto' ? triggerHeld : triggerPressed;
  if (!wantsShot) return result;

  if (state.mag <= 0) {
    // The click is still gated by fireRate, otherwise holding an auto trigger on an
    // empty mag would emit a dryFire event every frame.
    state.nextShotAt = now + def.fireRate;
    result.dry = true;
    return result;
  }

  // The recoil pattern restarts once the trigger has been off for recoilReset seconds.
  // Measuring the gap between shots instead of a per-tick timer keeps an idle weapon free.
  if (now - state.lastShotAt > (def.recoilReset ?? 0)) state.burstShots = 0;

  state.lastShotAt = now;
  state.burstShots += 1;
  state.mag -= 1;
  state.shotsFired += 1;
  state.nextShotAt = now + def.fireRate;
  state.lockoutUntil = now + (def.lockout ?? 0);
  result.fired = true;
  return result;
}

// Reload. The countdown lives on the state as `reloadRemaining` seconds, because
// reloadTick is handed dt rather than the game clock — the core still never reads one.

// False when the reload cannot start: already reloading, an empty reserve, or a magazine
// that is already full.
export function startReload(state, def) {
  if (state.reloading) return false;
  if (state.reserve <= 0) return false;
  if (state.mag >= def.magSize) return false;

  state.reloading = true;
  state.reloadRemaining = def.reloadTime;
  return true;
}

// True on the tick that completes the reload, so the caller can emit reloadEnd. A reload
// with less reserve than the magazine needs comes up short instead of inventing ammo.
export function reloadTick(state, def, dt) {
  if (!state.reloading) return false;

  state.reloadRemaining -= dt;
  if (state.reloadRemaining > 0) return false;

  const taken = Math.min(def.magSize - state.mag, state.reserve);
  state.mag += taken;
  state.reserve -= taken;
  state.reloading = false;
  state.reloadRemaining = 0;
  return true;
}

// An interrupted reload simply stops — the ammo it was going to move never left the reserve.
function cancelReload(state) {
  state.reloading = false;
  state.reloadRemaining = 0;
}

// The weapons the player carries. `weapons` holds one state per weapon id, `ids` is
// slot-ascending (what 'next'/'prev' cycle through) and `defs` is the config map, kept so
// switching and refilling read their numbers from config instead of from callers.
export function createLoadout(weapons) {
  const ids = Object.keys(weapons).sort((a, b) => weapons[a].slot - weapons[b].slot);
  const states = {};
  for (const id of ids) states[id] = createWeaponState(weapons[id]);

  return {
    defs: weapons,
    weapons: states,
    ids,
    active: ids[0], // id of the weapon in the active slot
    drawRemaining: 0, // > 0 while the active weapon is being drawn; nothing fires
  };
}

// slot is a config slot number, or 'next' / 'prev' to cycle (wrapping at the ends).
// Returns true when the weapon actually changed: the outgoing weapon's reload is
// cancelled and the incoming one starts its draw time. Re-selecting the active slot is a
// no-op, so a stray keypress never drops a reload in progress.
export function switchWeapon(loadout, slot) {
  const id = resolveSlot(loadout, slot);
  if (!id || id === loadout.active) return false;

  cancelReload(loadout.weapons[loadout.active]);
  loadout.active = id;
  loadout.drawRemaining = loadout.defs[id].drawTime;
  return true;
}

function resolveSlot(loadout, slot) {
  if (slot === 'next' || slot === 'prev') {
    const n = loadout.ids.length;
    const i = loadout.ids.indexOf(loadout.active);
    const step = slot === 'next' ? 1 : -1;
    return loadout.ids[(i + step + n) % n];
  }
  return loadout.ids.find((id) => loadout.defs[id].slot === slot) ?? null;
}

// True on the tick the draw finishes, so the caller can emit a ready cue.
export function loadoutTick(loadout, dt) {
  if (loadout.drawRemaining <= 0) return false;

  loadout.drawRemaining -= dt;
  if (loadout.drawRemaining > 0) return false;

  loadout.drawRemaining = 0;
  return true;
}

// Round start: every weapon back to its config ammo, reloads dropped, draw timer cleared.
export function refillLoadout(loadout) {
  for (const id of loadout.ids) {
    const def = loadout.defs[id];
    const state = loadout.weapons[id];
    state.mag = def.magSize;
    state.reserve = def.reserveAmmo;
    cancelReload(state);
  }
  loadout.drawRemaining = 0;
}
