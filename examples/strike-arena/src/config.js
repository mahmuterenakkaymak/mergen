// Single source of truth for every tunable number in Strike Arena.
// Units: meters, seconds, radians (except *_Deg fields). Y-up, yaw 0 looks toward -Z.
// Core modules must import their numbers from here — no magic numbers in src/core/.

// Player locomotion. Speeds are horizontal target speeds (m/s); accel/friction are
// exponential-approach rates, so accel applies while a key is held and friction
// bleeds speed when it is not.
export const MOVEMENT = {
  walkSpeed: 3.2, // Shift held — quiet, accurate
  runSpeed: 5.6, // default
  crouchSpeed: 1.7, // C/Ctrl held
  accel: 55, // approach rate toward the target speed
  friction: 11, // approach rate toward 0 when no input
  gravity: 22, // downward acceleration magnitude, applied on -Y
  jumpSpeed: 6.6, // vertical takeoff speed -> ~1.0 m apex, clears 1 m crates
  playerWidth: 0.6, // collision box is square in XZ
  playerHeight: 1.8,
  crouchHeight: 1.2,
  eyeHeight: 1.65, // camera offset above the box bottom, standing
  crouchEyeHeight: 1.1,
};

// Falling. Falls up to safeHeight are free; beyond that damagePerMeter applies.
export const FALL = {
  safeHeight: 3.0,
  damagePerMeter: 12,
};

// Weapons. fireRate is the MINIMUM SECONDS BETWEEN SHOTS (not rounds/second).
// spread is in radians (half-angle of the fire cone); walkMult/crouchMult scale the
// total spread down while walking/crouching; bloom grows by bloomPerShot per shot and
// decays by bloomDecay per second back toward the base value. drawTime is how long a
// weapon takes to come up after a switch — nothing fires while it runs.
export const WEAPONS = {
  pistol: {
    name: 'Pistol',
    slot: 1,
    fireMode: 'semi', // one shot per trigger press
    damage: 26,
    fireRate: 0.15,
    magSize: 15,
    reserveAmmo: 60,
    reloadTime: 1.5,
    drawTime: 0.4,
    spread: {
      base: 0.0035,
      move: 0.01, // added at full run speed
      air: 0.03, // added while airborne
      walkMult: 0.6,
      crouchMult: 0.65,
      bloomPerShot: 0.0022,
      bloomDecay: 0.02,
    },
    headshotMult: 2.5,
    range: 45,
  },
  rifle: {
    name: 'Rifle',
    slot: 2,
    fireMode: 'auto', // fires while the trigger is held
    damage: 24,
    fireRate: 0.095,
    magSize: 30,
    reserveAmmo: 120,
    reloadTime: 2.4,
    drawTime: 0.6,
    spread: {
      base: 0.006,
      move: 0.016,
      air: 0.045,
      walkMult: 0.7,
      crouchMult: 0.7,
      bloomPerShot: 0.0032,
      bloomDecay: 0.012,
    },
    headshotMult: 2.2,
    range: 70,
    // Fixed per-shot camera kick [pitch, yaw] in radians; repeats past its end while
    // the trigger stays held, and recovers to zero once released.
    recoilPattern: [
      [0.011, 0.0],
      [0.014, 0.002],
      [0.013, -0.003],
      [0.015, 0.004],
      [0.016, -0.002],
      [0.015, 0.005],
      [0.017, -0.005],
      [0.016, 0.003],
      [0.018, -0.004],
      [0.019, 0.0],
    ],
    // Seconds without a shot after which the pattern restarts at entry 0, so a new burst
    // climbs like the first one instead of resuming where the last one stopped. Must stay
    // well above fireRate, or a held trigger would reset between every shot.
    recoilReset: 0.5,
  },
  sniper: {
    name: 'Sniper',
    slot: 3,
    fireMode: 'semi',
    damage: 90,
    fireRate: 1.45,
    magSize: 5,
    reserveAmmo: 25,
    reloadTime: 3.2,
    drawTime: 0.9,
    spread: {
      base: 0.0015,
      move: 0.03,
      air: 0.075,
      walkMult: 0.5,
      crouchMult: 0.5,
      bloomPerShot: 0.006,
      bloomDecay: 0.004,
    },
    headshotMult: 1.7, // 90 * 1.7 -> a scoped headshot is lethal
    range: 150,
    lockout: 1.6, // bolt-cycle delay after each shot, no firing during it
    scopeFov: 22, // deg while scoped (CONFIG.MAP.fov is the hip-fire fov)
  },
};

export const BOTS = {
  count: 3, // 5 rifles at once killed the player in well under a second (playtest 2026-10-16)
  health: 100,
  walkSpeed: 2.6, // patrol
  runSpeed: 4.4, // engaged, closing to preferred range
  bodyWidth: 0.6,
  bodyHeight: 1.45, // box from the feet up
  headSize: 0.3, // cubic head box sitting on top of the body box
  eyeHeight: 1.6,
  viewDistance: 45,
  viewFovDeg: 100, // total cone; outside it the bot does not see the player
  reactionTimeMin: 0.5, // seeded delay between spotting and first shot - time to duck or shoot first
  reactionTimeMax: 0.9,
  // At 0.008 rad a settled bot lands every shot on a motionless target 20 m away — the cone
  // is ±16 cm against a 60 cm chest — and one rifle put the player down in 1.4 s.
  aimErrorMin: 0.05, // cone half-angle once settled on target (rad)
  aimErrorMax: 0.12, // cone half-angle right after acquiring (rad)
  aimErrorShrink: 0.01, // rad/s toward aimErrorMin while the target is held
  preferredRangeMin: 6,
  preferredRangeMax: 14,
  stuckTime: 2.5, // no progress for this long -> skip to the next waypoint
  corpseFadeTime: 1.0, // fade-out duration at the end of the corpse lifetime
  weapon: 'rifle',
};

export const ROUNDS = {
  intermission: 3, // seconds of won/lost before the next round
  corpseLifetime: 5, // seconds a corpse stays before removal
};

export const PLAYER = {
  maxHealth: 100,
  godMode: false, // true = damage events still fire (indicator, sound) but health never drops; ?god in the URL turns it on
};

export const HUD = {
  hitmarkerTime: 0.2, // seconds the hitmarker stays up — at 0.15 it was gone in 9 frames, under a burst
  killFeedSize: 4,
  killFeedLife: 5,
  damageIndicatorTime: 1.2,
  bannerTime: 3,
  lowHealthAt: 40, // below this the vignette fades in
  crosshairLength: 9, // px per line
  crosshairGapScale: 1, // multiplies the computed crosshair radius
};

export const MAP = {
  fov: 90, // deg, hip-fire vertical field of view
  maxMeshes: 4, // arena must merge into at most this many meshes
  shadows: false,
  fogNear: 40,
  fogFar: 140,
  skyColor: 0x0d1117,
  floorColor: 0x2f3437,
  wallColor: 0x454c52,
  crateColor: 0x6b5b3e,
  trimColor: 0x8a933c,
};

export const AUDIO = {
  // A shot stacks four layers that each peak near full scale and a firefight overlaps them,
  // so the sum clipped at 0.6.
  masterVolume: 0.5,
  refDistance: 4, // panner distance model (inverse)
  maxDistance: 120,
  rolloffFactor: 1.2,
  // Per-weapon synth recipe for the shot generator (T23).
  shots: {
    pistol: {
      noiseGain: 0.5,
      noiseDecay: 0.09,
      clickGain: 0.35,
      lowpassHz: 2600,
      thumpStartHz: 180,
      thumpEndHz: 60,
      thumpGain: 0.4,
      duration: 0.18,
    },
    rifle: {
      noiseGain: 0.62,
      noiseDecay: 0.07,
      clickGain: 0.45,
      lowpassHz: 3200,
      thumpStartHz: 150,
      thumpEndHz: 48,
      thumpGain: 0.5,
      duration: 0.16,
    },
    sniper: {
      noiseGain: 0.8,
      noiseDecay: 0.22,
      clickGain: 0.6,
      lowpassHz: 1800,
      thumpStartHz: 110,
      thumpEndHz: 34,
      thumpGain: 0.75,
      duration: 0.42,
    },
  },
};

export const EFFECTS = {
  flashTime: 0.05,
  flashLightPower: 3,
  tracerLife: 0.09,
  maxTracers: 24,
  sparkCount: 10,
  sparkLife: 0.45,
  maxSparks: 240,
  decalSize: 0.06,
  maxDecals: 64,
};

// Camera and viewmodel feel: the small motions layered ON TOP of the simulated camera
// (the core already owns aim, recoil and eye height). Offsets are meters in view space
// (x right, y up), angles radians.
//
// The scope sweep speed is derived from the one transition that has to look right, so
// hip-fire -> scope takes SCOPE_TRANSITION seconds and anything shorter is faster.
const SCOPE_TRANSITION = 0.12;

export const FEEL = {
  bobFrequency: 2.1, // full-speed bob cycles per second
  bobUp: 0.045, // m of vertical bob at full run speed, standing
  bobSide: 0.024, // m of side-to-side bob at full run speed
  crouchBobMult: 0.45, // crouching shrinks the bob
  swayTurn: 0.35, // m of lag offset per radian turned in a frame
  swayMax: 0.035, // m the sway lag is clamped to
  swayLag: 14, // 1/s approach rate toward the sway target and back to rest
  kickRecover: 11, // 1/s rate a shot kick decays at
  kickMax: 0.06, // rad of accumulated kick a frame may hold
  kickEpsilon: 1e-4, // rad below which a kick counts as fully recovered
  shotKick: { pistol: 0.01, rifle: 0.012, sniper: 0.045 }, // rad of extra camera punch per shot
  landDipPerMeter: 0.05, // m the camera sinks per meter fallen
  landDipMax: 0.22, // m the landing dip is clamped to
  landDipRecover: 9, // 1/s rate the landing dip eases back out
  scopeTransition: SCOPE_TRANSITION, // s the hip -> scope fov change takes
  scopeFovSpeed: (MAP.fov - WEAPONS.sniper.scopeFov) / SCOPE_TRANSITION, // deg/s
};

// Simulation loop: fixed 60 Hz steps, frame delta clamped so a backgrounded tab
// cannot stall the loop in a spiral of catch-up steps.
export const LOOP = {
  step: 1 / 60,
  maxFrame: 0.25,
};

export const MENU = {
  storageKey: 'strike-arena.sensitivity',
  defaultSensitivity: 1,
  minSensitivity: 0.2,
  maxSensitivity: 3,
};

// Aggregate view used by the rest of the code as CONFIG.<SECTION>.<key>.
export const CONFIG = { MOVEMENT, FALL, WEAPONS, BOTS, ROUNDS, PLAYER, HUD, MAP, AUDIO, EFFECTS, FEEL, LOOP, MENU };

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

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isPos = (v) => isNum(v) && v > 0;

// Structural + sanity check on a config object. Returns human-readable error strings;
// an empty array means the config is usable. Never throws, so a broken config reports
// every problem at once instead of the first one.
export function validateConfig(cfg = CONFIG) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object') return ['config: not an object'];

  const num = (value, path, check = isNum, label = 'a number') => {
    if (!check(value)) errors.push(`${path}: expected ${label}, got ${JSON.stringify(value)}`);
  };

  const m = cfg.MOVEMENT || {};
  num(m.walkSpeed, 'MOVEMENT.walkSpeed', isPos, 'a positive number');
  num(m.runSpeed, 'MOVEMENT.runSpeed', isPos, 'a positive number');
  num(m.crouchSpeed, 'MOVEMENT.crouchSpeed', isPos, 'a positive number');
  num(m.accel, 'MOVEMENT.accel', isPos, 'a positive number');
  num(m.friction, 'MOVEMENT.friction', isPos, 'a positive number');
  num(m.gravity, 'MOVEMENT.gravity', isPos, 'a positive number');
  num(m.jumpSpeed, 'MOVEMENT.jumpSpeed', isPos, 'a positive number');
  num(m.playerWidth, 'MOVEMENT.playerWidth', isPos, 'a positive number');
  num(m.playerHeight, 'MOVEMENT.playerHeight', isPos, 'a positive number');
  num(m.crouchHeight, 'MOVEMENT.crouchHeight', isPos, 'a positive number');
  num(m.eyeHeight, 'MOVEMENT.eyeHeight', isPos, 'a positive number');
  num(m.crouchEyeHeight, 'MOVEMENT.crouchEyeHeight', isPos, 'a positive number');
  if (isPos(m.crouchHeight) && isPos(m.playerHeight) && m.crouchHeight >= m.playerHeight) {
    errors.push(`MOVEMENT.crouchHeight (${m.crouchHeight}) must be below MOVEMENT.playerHeight (${m.playerHeight})`);
  }
  if (isPos(m.eyeHeight) && isPos(m.playerHeight) && m.eyeHeight > m.playerHeight) {
    errors.push(`MOVEMENT.eyeHeight (${m.eyeHeight}) must be at or below MOVEMENT.playerHeight (${m.playerHeight})`);
  }
  if (isPos(m.crouchEyeHeight) && isPos(m.crouchHeight) && m.crouchEyeHeight > m.crouchHeight) {
    errors.push(
      `MOVEMENT.crouchEyeHeight (${m.crouchEyeHeight}) must be at or below MOVEMENT.crouchHeight (${m.crouchHeight})`,
    );
  }

  const f = cfg.FALL || {};
  num(f.safeHeight, 'FALL.safeHeight', (v) => isNum(v) && v >= 0, 'a number >= 0');
  num(f.damagePerMeter, 'FALL.damagePerMeter', (v) => isNum(v) && v >= 0, 'a number >= 0');

  const weapons = cfg.WEAPONS;
  if (!weapons || typeof weapons !== 'object' || Array.isArray(weapons)) {
    errors.push('WEAPONS: expected an object of weapon definitions');
  } else {
    const slots = new Set();
    for (const [id, def] of Object.entries(weapons)) {
      const path = `WEAPONS.${id}`;
      if (!def || typeof def !== 'object') {
        errors.push(`${path}: expected an object`);
        continue;
      }
      for (const key of WEAPON_KEYS) {
        if (!(key in def)) errors.push(`${path}.${key}: missing`);
      }
      if (typeof def.name !== 'string' || !def.name) errors.push(`${path}.name: expected a non-empty string`);
      num(def.slot, `${path}.slot`, (v) => Number.isInteger(v) && v > 0, 'a positive integer');
      if (Number.isInteger(def.slot)) {
        if (slots.has(def.slot)) errors.push(`${path}.slot: ${def.slot} already used by another weapon`);
        slots.add(def.slot);
      }
      if (def.fireMode !== 'semi' && def.fireMode !== 'auto') {
        errors.push(`${path}.fireMode: expected 'semi' or 'auto', got ${JSON.stringify(def.fireMode)}`);
      }
      num(def.damage, `${path}.damage`, isPos, 'a positive number');
      num(def.fireRate, `${path}.fireRate`, isPos, 'a positive number');
      num(def.magSize, `${path}.magSize`, (v) => Number.isInteger(v) && v > 0, 'a positive integer');
      num(def.reserveAmmo, `${path}.reserveAmmo`, (v) => Number.isInteger(v) && v >= 0, 'an integer >= 0');
      num(def.reloadTime, `${path}.reloadTime`, isPos, 'a positive number');
      num(def.range, `${path}.range`, isPos, 'a positive number');
      num(def.headshotMult, `${path}.headshotMult`, (v) => isNum(v) && v > 1, 'a number > 1');

      const s = def.spread;
      if (!s || typeof s !== 'object') {
        errors.push(`${path}.spread: expected an object`);
      } else {
        for (const key of SPREAD_KEYS) {
          if (!(key in s)) errors.push(`${path}.spread.${key}: missing`);
        }
        num(s.base, `${path}.spread.base`, (v) => isNum(v) && v >= 0, 'a number >= 0');
        num(s.move, `${path}.spread.move`, (v) => isNum(v) && v >= 0, 'a number >= 0');
        num(s.air, `${path}.spread.air`, (v) => isNum(v) && v >= 0, 'a number >= 0');
        num(s.walkMult, `${path}.spread.walkMult`, (v) => isNum(v) && v > 0 && v <= 1, 'a number in (0, 1]');
        num(s.crouchMult, `${path}.spread.crouchMult`, (v) => isNum(v) && v > 0 && v <= 1, 'a number in (0, 1]');
        num(s.bloomPerShot, `${path}.spread.bloomPerShot`, (v) => isNum(v) && v >= 0, 'a number >= 0');
        num(s.bloomDecay, `${path}.spread.bloomDecay`, (v) => isNum(v) && v >= 0, 'a number >= 0');
      }

      // The rifle drives its recoil from a fixed pattern table.
      if (id === 'rifle') {
        const p = def.recoilPattern;
        if (!Array.isArray(p) || p.length === 0) {
          errors.push(`${path}.recoilPattern: expected a non-empty array of [pitch, yaw] pairs`);
        } else {
          p.forEach((pair, i) => {
            if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(isNum)) {
              errors.push(`${path}.recoilPattern[${i}]: expected [pitch, yaw] numbers`);
            }
          });
        }
        num(def.recoilReset, `${path}.recoilReset`, isPos, 'a positive number');
      }

      // The sniper needs a bolt lockout and a scope zoom.
      if (id === 'sniper') {
        num(def.lockout, `${path}.lockout`, (v) => isNum(v) && v >= 0, 'a number >= 0');
        num(def.scopeFov, `${path}.scopeFov`, (v) => isNum(v) && v > 0 && v < 180, 'a fov in degrees (0, 180)');
      }
    }
  }

  const b = cfg.BOTS;
  if (!b || typeof b !== 'object') {
    errors.push('BOTS: expected an object');
  } else {
    num(b.count, 'BOTS.count', (v) => Number.isInteger(v) && v > 0, 'a positive integer');
    num(b.health, 'BOTS.health', isPos, 'a positive number');
    num(b.walkSpeed, 'BOTS.walkSpeed', isPos, 'a positive number');
    num(b.runSpeed, 'BOTS.runSpeed', isPos, 'a positive number');
    num(b.bodyWidth, 'BOTS.bodyWidth', isPos, 'a positive number');
    num(b.bodyHeight, 'BOTS.bodyHeight', isPos, 'a positive number');
    num(b.headSize, 'BOTS.headSize', isPos, 'a positive number');
    num(b.eyeHeight, 'BOTS.eyeHeight', isPos, 'a positive number');
    num(b.viewDistance, 'BOTS.viewDistance', isPos, 'a positive number');
    num(b.viewFovDeg, 'BOTS.viewFovDeg', (v) => isNum(v) && v > 0 && v <= 360, 'a cone in degrees (0, 360]');
    num(b.reactionTimeMin, 'BOTS.reactionTimeMin', (v) => isNum(v) && v >= 0, 'a number >= 0');
    num(b.reactionTimeMax, 'BOTS.reactionTimeMax', (v) => isNum(v) && v >= 0, 'a number >= 0');
    num(b.aimErrorMin, 'BOTS.aimErrorMin', (v) => isNum(v) && v >= 0, 'a number >= 0');
    num(b.aimErrorMax, 'BOTS.aimErrorMax', (v) => isNum(v) && v >= 0, 'a number >= 0');
    num(b.aimErrorShrink, 'BOTS.aimErrorShrink', (v) => isNum(v) && v >= 0, 'a number >= 0');
    num(b.preferredRangeMin, 'BOTS.preferredRangeMin', (v) => isNum(v) && v >= 0, 'a number >= 0');
    num(b.preferredRangeMax, 'BOTS.preferredRangeMax', (v) => isNum(v) && v >= 0, 'a number >= 0');
    num(b.stuckTime, 'BOTS.stuckTime', isPos, 'a positive number');
    num(b.corpseFadeTime, 'BOTS.corpseFadeTime', isPos, 'a positive number');
    if (isNum(b.reactionTimeMin) && isNum(b.reactionTimeMax) && b.reactionTimeMin > b.reactionTimeMax) {
      errors.push(`BOTS.reactionTimeMin (${b.reactionTimeMin}) must be <= BOTS.reactionTimeMax (${b.reactionTimeMax})`);
    }
    if (isNum(b.aimErrorMin) && isNum(b.aimErrorMax) && b.aimErrorMin > b.aimErrorMax) {
      errors.push(`BOTS.aimErrorMin (${b.aimErrorMin}) must be <= BOTS.aimErrorMax (${b.aimErrorMax})`);
    }
    if (isNum(b.preferredRangeMin) && isNum(b.preferredRangeMax) && b.preferredRangeMin > b.preferredRangeMax) {
      errors.push(
        `BOTS.preferredRangeMin (${b.preferredRangeMin}) must be <= BOTS.preferredRangeMax (${b.preferredRangeMax})`,
      );
    }
    if (b.weapon && cfg.WEAPONS && !(b.weapon in cfg.WEAPONS)) {
      errors.push(`BOTS.weapon: ${JSON.stringify(b.weapon)} is not a weapon in WEAPONS`);
    }
  }

  const r = cfg.ROUNDS;
  if (!r || typeof r !== 'object') {
    errors.push('ROUNDS: expected an object');
  } else {
    num(r.intermission, 'ROUNDS.intermission', isPos, 'a positive number');
    num(r.corpseLifetime, 'ROUNDS.corpseLifetime', isPos, 'a positive number');
  }

  num((cfg.PLAYER || {}).maxHealth, 'PLAYER.maxHealth', isPos, 'a positive number');

  const h = cfg.HUD;
  if (!h || typeof h !== 'object') {
    errors.push('HUD: expected an object');
  } else {
    num(h.hitmarkerTime, 'HUD.hitmarkerTime', isPos, 'a positive number');
    num(h.killFeedSize, 'HUD.killFeedSize', (v) => Number.isInteger(v) && v > 0, 'a positive integer');
    num(h.killFeedLife, 'HUD.killFeedLife', isPos, 'a positive number');
    num(h.damageIndicatorTime, 'HUD.damageIndicatorTime', isPos, 'a positive number');
    num(h.bannerTime, 'HUD.bannerTime', isPos, 'a positive number');
    num(h.lowHealthAt, 'HUD.lowHealthAt', (v) => isNum(v) && v >= 0, 'a number >= 0');
    num(h.crosshairLength, 'HUD.crosshairLength', isPos, 'a positive number');
    num(h.crosshairGapScale, 'HUD.crosshairGapScale', isPos, 'a positive number');
  }

  const map = cfg.MAP;
  if (!map || typeof map !== 'object') {
    errors.push('MAP: expected an object');
  } else {
    num(map.fov, 'MAP.fov', (v) => isNum(v) && v > 0 && v < 180, 'a fov in degrees (0, 180)');
    num(map.maxMeshes, 'MAP.maxMeshes', (v) => Number.isInteger(v) && v > 0, 'a positive integer');
  }

  const a = cfg.AUDIO;
  if (!a || typeof a !== 'object') {
    errors.push('AUDIO: expected an object');
  } else {
    num(a.masterVolume, 'AUDIO.masterVolume', (v) => isNum(v) && v >= 0 && v <= 1, 'a number in [0, 1]');
    num(a.refDistance, 'AUDIO.refDistance', isPos, 'a positive number');
    num(a.maxDistance, 'AUDIO.maxDistance', isPos, 'a positive number');
    num(a.rolloffFactor, 'AUDIO.rolloffFactor', (v) => isNum(v) && v >= 0, 'a number >= 0');
    if (!a.shots || typeof a.shots !== 'object') {
      errors.push('AUDIO.shots: expected an object of per-weapon shot recipes');
    } else if (cfg.WEAPONS) {
      for (const id of Object.keys(cfg.WEAPONS)) {
        if (!a.shots[id]) errors.push(`AUDIO.shots.${id}: missing shot recipe`);
      }
    }
  }

  const e = cfg.EFFECTS;
  if (!e || typeof e !== 'object') {
    errors.push('EFFECTS: expected an object');
  } else {
    num(e.flashTime, 'EFFECTS.flashTime', isPos, 'a positive number');
    num(e.tracerLife, 'EFFECTS.tracerLife', isPos, 'a positive number');
    num(e.maxTracers, 'EFFECTS.maxTracers', (v) => Number.isInteger(v) && v > 0, 'a positive integer');
    num(e.sparkCount, 'EFFECTS.sparkCount', (v) => Number.isInteger(v) && v > 0, 'a positive integer');
    num(e.sparkLife, 'EFFECTS.sparkLife', isPos, 'a positive number');
    num(e.maxSparks, 'EFFECTS.maxSparks', (v) => Number.isInteger(v) && v > 0, 'a positive integer');
    num(e.decalSize, 'EFFECTS.decalSize', isPos, 'a positive number');
    num(e.maxDecals, 'EFFECTS.maxDecals', (v) => Number.isInteger(v) && v > 0, 'a positive integer');
  }

  const feel = cfg.FEEL;
  if (!feel || typeof feel !== 'object') {
    errors.push('FEEL: expected an object');
  } else {
    num(feel.bobFrequency, 'FEEL.bobFrequency', isPos, 'a positive number');
    num(feel.bobUp, 'FEEL.bobUp', (v) => isNum(v) && v >= 0, 'a number >= 0');
    num(feel.bobSide, 'FEEL.bobSide', (v) => isNum(v) && v >= 0, 'a number >= 0');
    num(feel.crouchBobMult, 'FEEL.crouchBobMult', (v) => isNum(v) && v > 0 && v <= 1, 'a number in (0, 1]');
    num(feel.swayTurn, 'FEEL.swayTurn', isPos, 'a positive number');
    num(feel.swayMax, 'FEEL.swayMax', isPos, 'a positive number');
    num(feel.swayLag, 'FEEL.swayLag', isPos, 'a positive number');
    num(feel.kickRecover, 'FEEL.kickRecover', isPos, 'a positive number');
    num(feel.kickMax, 'FEEL.kickMax', isPos, 'a positive number');
    num(feel.kickEpsilon, 'FEEL.kickEpsilon', isPos, 'a positive number');
    num(feel.landDipPerMeter, 'FEEL.landDipPerMeter', isPos, 'a positive number');
    num(feel.landDipMax, 'FEEL.landDipMax', isPos, 'a positive number');
    num(feel.landDipRecover, 'FEEL.landDipRecover', isPos, 'a positive number');
    num(feel.scopeTransition, 'FEEL.scopeTransition', isPos, 'a positive number');
    num(feel.scopeFovSpeed, 'FEEL.scopeFovSpeed', isPos, 'a positive number');
    if (!feel.shotKick || typeof feel.shotKick !== 'object') {
      errors.push('FEEL.shotKick: expected an object of per-weapon kick radians');
    } else if (cfg.WEAPONS) {
      for (const id of Object.keys(cfg.WEAPONS)) {
        num(feel.shotKick[id], `FEEL.shotKick.${id}`, (v) => isNum(v) && v >= 0, 'a number >= 0');
      }
    }
  }

  const l = cfg.LOOP;
  if (!l || typeof l !== 'object') {
    errors.push('LOOP: expected an object');
  } else {
    num(l.step, 'LOOP.step', isPos, 'a positive number');
    num(l.maxFrame, 'LOOP.maxFrame', isPos, 'a positive number');
    if (isPos(l.step) && isPos(l.maxFrame) && l.maxFrame < l.step) {
      errors.push(`LOOP.maxFrame (${l.maxFrame}) must be at least LOOP.step (${l.step})`);
    }
  }

  const menu = cfg.MENU;
  if (!menu || typeof menu !== 'object') {
    errors.push('MENU: expected an object');
  } else {
    if (typeof menu.storageKey !== 'string' || !menu.storageKey) {
      errors.push('MENU.storageKey: expected a non-empty string');
    }
    num(menu.defaultSensitivity, 'MENU.defaultSensitivity', isPos, 'a positive number');
    num(menu.minSensitivity, 'MENU.minSensitivity', isPos, 'a positive number');
    num(menu.maxSensitivity, 'MENU.maxSensitivity', isPos, 'a positive number');
    if (isPos(menu.minSensitivity) && isPos(menu.maxSensitivity) && menu.minSensitivity >= menu.maxSensitivity) {
      errors.push(`MENU.minSensitivity (${menu.minSensitivity}) must be below MENU.maxSensitivity (${menu.maxSensitivity})`);
    }
  }

  return errors;
}

export default CONFIG;
