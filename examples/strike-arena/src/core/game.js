// The simulation root: plain data plus one step function. Locomotion, look, loadout,
// firing and damage all happen here and nowhere else, and every moment they produce is
// pushed onto world.events for the presentation layer to consume. No Three.js, no DOM,
// no clock reads — dt plus the seeded rng make a tick fully reproducible.
import { CONFIG } from '../config.js';
import MAP_DATA, { getColliders } from './mapData.js';
import { makeBox } from './aabb.js';
import { applyLook, createPlayer, fallDamage, stepPlayer } from './movement.js';
import { createLoadout, loadoutTick, reloadTick, refillLoadout, startReload, switchWeapon, tryFire } from './weapons.js';
import { addBloom, computeSpread, decayBloom, recoilOffset, sampleSpreadDir } from './spread.js';
import { applyDamage, castHitscan } from './raycast.js';
import { botFire, botHitboxes, botThink, createBot, damageBot } from './bots.js';
import { createRounds, roundTick } from './rounds.js';
import { botStuckTick, needsRecovery, recoverPlayer } from './safety.js';
import { mulberry32 } from './rng.js';

// The same clamp movement.applyLook enforces; recoil writes pitch directly, so it has to
// re-apply it rather than let a long burst push the view past straight up.
const PITCH_LIMIT = Math.PI / 2;

// A static shootable target — practice ranges and tests. It carries exactly the
// {id, head, body} box shape castHitscan reads, plus the hp/alive a shooter expects from
// one. `pos` is the foot position.
export function createDummy(id, pos, config = CONFIG) {
  const b = config.BOTS;
  return {
    id,
    pos: { x: pos.x, y: pos.y, z: pos.z },
    hp: b.health,
    maxHp: b.health,
    alive: true,
    body: makeBox(
      { x: pos.x, y: pos.y + b.bodyHeight / 2, z: pos.z },
      { x: b.bodyWidth, y: b.bodyHeight, z: b.bodyWidth },
    ),
    head: makeBox(
      { x: pos.x, y: pos.y + b.bodyHeight + b.headSize / 2, z: pos.z },
      { x: b.headSize, y: b.headSize, z: b.headSize },
    ),
  };
}

export function createWorld(config = CONFIG, mapData = MAP_DATA, seed = 1) {
  const loadout = createLoadout(config.WEAPONS);
  // Bloom is the per-weapon spread a firing streak stacks up. It lives on the weapon
  // state because switching weapons must not carry it over.
  for (const state of Object.values(loadout.weapons)) state.bloom = 0;

  const round = createRounds(config);

  return {
    config,
    mapData,
    rng: mulberry32(seed),
    time: 0,
    events: [],
    player: createPlayer(mapData.spawnZones.T.spawns[0]),
    loadout,
    colliders: getColliders(),
    bots: createBots(mapData, config),
    round,
    // The round machine owns the score; this is its object rather than a copy, so the
    // presentation layer can read the score off the world without drifting behind it.
    score: round.score,
    scoped: false,
    fov: config.MAP.fov,
    spread: 0, // current fire cone half-angle, what the crosshair is drawn from
    stepDistance: 0, // metres walked since the last footstep event
  };
}

// One bot per CT spawn, capped by config.
function createBots(mapData, config) {
  return mapData.spawnZones.CT.spawns
    .slice(0, config.BOTS.count)
    .map((p, i) => createBot(`bot_${i + 1}`, p, config));
}

// Round reset: the player and every bot go back to their spawn with full health, the
// loadout comes back to its config ammo, and dead bots stand up again. The bot objects
// themselves survive, so a corpse the renderer is still fading keeps its identity and
// its rng, and the next round does not play out identical to this one.
export function resetRound(world) {
  world.player = createPlayer(world.mapData.spawnZones.T.spawns[0]);
  refillLoadout(world.loadout);
  world.scoped = false;
  world.spread = 0;

  const spawns = world.mapData.spawnZones.CT.spawns;
  world.bots.forEach((bot, i) => resetBot(bot, spawns[i % spawns.length], world.config));
  return world;
}

function resetBot(bot, spawn, config) {
  const b = config.BOTS;

  bot.pos = { x: spawn.x, y: spawn.y, z: spawn.z };
  bot.box = makeBox(
    { x: spawn.x, y: spawn.y + b.bodyHeight / 2, z: spawn.z },
    { x: b.bodyWidth, y: b.bodyHeight, z: b.bodyWidth },
  );
  bot.vel = { x: 0, y: 0, z: 0 };
  bot.yaw = 0;
  bot.hp = b.health;
  bot.maxHp = b.health;
  bot.alive = true;
  bot.state = 'patrol';

  // Navigation and perception start over, and so does the shot cycle: a bot that had the
  // player ranged at the moment the round ended does not carry that into the next one.
  bot.node = null;
  bot.from = null;
  bot.target = null;
  bot.coverId = null;
  bot.lastSeen = null;
  bot.hpSeen = b.health;
  bot.legDist = Infinity;
  bot.stuckFor = 0;
  bot.deathTime = null;
  bot.removable = false;
  bot.readyAt = null;
  bot.nextShotAt = 0;
  bot.aimTime = 0;
}

// Every event carries the game time it happened at, so consumers (audio, effects, kill
// feed) can order or delay things without knowing the step size.
function emit(world, event) {
  event.t = world.time;
  world.events.push(event);
  return event;
}

// Advance the world one fixed step. `input` is an input.js snapshot; the frame-scoped
// fields it carries (mouse delta, wheel notches, key edges) are consumed here, so a
// frame that runs several steps applies each of them exactly once.
export function stepGame(world, input, dt) {
  world.events.length = 0;
  world.time += dt;

  // A dead player and a round that has already been decided both sit the rest of it out.
  // The input is dropped rather than buffered, so a click or key held through the death
  // is not waiting to happen on the respawn tick.
  const live = world.player.health > 0 && world.round.phase === 'playing';

  if (live) {
    applyLook(world.player, input.mouseX, input.mouseY, 1);
    applyActionInput(world, input);
    stepLocomotion(world, input, dt);
    stepWeapons(world, input, dt);
  }
  world.fov = world.scoped ? activeDef(world).scopeFov ?? world.config.MAP.fov : world.config.MAP.fov;

  stepBots(world, live, dt);
  stepSafety(world, dt);
  stepRound(world, dt);

  consumeFrameInput(input);
  return world.events;
}

// --- safety --------------------------------------------------------------

// Runs last, after everything that moves has moved: a player who has left the arena for good
// goes back to the spawn and a bot that has stopped getting anywhere is re-routed rather than
// left pushing into the same crate all round. A player above the arena is not recovered — he
// is falling, and the fall is the point.
function stepSafety(world, dt) {
  const player = world.player;
  if (needsRecovery(player, world.mapData.bounds, world.colliders)) {
    recoverPlayer(player, world.mapData.spawnZones.T.spawns[0]);
  }

  for (const bot of world.bots) {
    botStuckTick(bot, dt, world.config, world.mapData.waypoints);
  }
}

// --- bots and rounds -------------------------------------------------------

// Bots keep thinking while the player is dead or the intermission runs — corpses age and
// fade either way — but they only shoot a live player in a live round.
//
// botFire applies its own damage to the player, so the wound is read back off his health
// to put the shooter's position on the playerDamaged event the damage indicator needs.
function stepBots(world, live, dt) {
  for (const bot of world.bots) {
    botThink(bot, world, dt);
    if (!live || !bot.alive) continue;

    const healthBefore = world.player.health;
    botFire(bot, world, dt);
    const damage = healthBefore - world.player.health;
    if (damage <= 0) continue;

    emit(world, {
      type: 'playerDamaged',
      victim: 'player',
      source: bot.id,
      sourcePos: { x: bot.pos.x, y: bot.pos.y, z: bot.pos.z },
      damage,
    });
  }
}

// The round machine reads the two win conditions and owns the clock; the only thing the
// world adds is what happens when it says the next round has started.
function stepRound(world, dt) {
  const events = roundTick(
    world.round,
    {
      botsAlive: world.bots.some((bot) => bot.alive),
      playerAlive: world.player.health > 0,
    },
    dt,
  );

  for (const event of events) {
    emit(world, event);
    if (event.type === 'newRound') resetRound(world);
  }
}

// Advance one rendered frame: consume the frame delta from the fixed-timestep `loop`,
// run the steps it owes, and return their events concatenated.
//
// A frame that owes no step must not read the input at all. Snapshotting and calling
// endFrame() there would clear the mouse delta, the wheel notch and the key/click edges
// before any step has seen them — which at 120-144 Hz is every other frame, and at 60 Hz
// whatever a jitter frame brings. Left untouched, that input simply waits for the next
// frame that does step.
export function runFrame(world, input, loop, frameDt) {
  const { steps } = loop.advance(frameDt);
  if (steps < 1) return [];

  // One snapshot for the whole frame: stepGame consumes the frame-scoped fields off it,
  // so a catch-up frame cannot apply the same click twice.
  const snap = input.snapshot();
  const events = [];
  for (let i = 0; i < steps; i++) {
    stepGame(world, snap, world.config.LOOP.step);
    events.push(...world.events);
  }
  input.endFrame();
  return events;
}

function activeDef(world) {
  return world.loadout.defs[world.loadout.active];
}

function activeState(world) {
  return world.loadout.weapons[world.loadout.active];
}

// --- input ---------------------------------------------------------------

function applyActionInput(world, input) {
  const pressed = input.pressed ?? {};

  if (pressed.slot1) selectWeapon(world, 1);
  else if (pressed.slot2) selectWeapon(world, 2);
  else if (pressed.slot3) selectWeapon(world, 3);
  else if (input.wheel) selectWeapon(world, input.wheel > 0 ? 'next' : 'prev');

  if (pressed.reload && startReload(activeState(world), activeDef(world))) {
    emit(world, { type: 'reloadStart', weapon: world.loadout.active });
  }

  // A scope is a toggle rather than hold-to-aim: the sniper's bolt cycle leaves the
  // right button free between shots.
  if (pressed.ads && activeDef(world).scopeFov) world.scoped = !world.scoped;
}

function selectWeapon(world, slot) {
  if (!switchWeapon(world.loadout, slot)) return;
  world.scoped = false; // only the sniper scopes, and it is no longer what is in hand
  emit(world, { type: 'switch', weapon: world.loadout.active });
}

// Frame-scoped input must take effect once per frame, not once per fixed step.
function consumeFrameInput(input) {
  input.mouseX = 0;
  input.mouseY = 0;
  input.wheel = 0;
  if (input.pressed) for (const key of Object.keys(input.pressed)) input.pressed[key] = false;
}

// --- movement ------------------------------------------------------------

function stepLocomotion(world, input, dt) {
  const player = world.player;
  const result = stepPlayer(player, input, dt, world.colliders);

  if (result.landed !== null) {
    const damage = fallDamage(result.landed, world.config.FALL);
    if (!world.config.PLAYER.godMode) player.health = Math.max(0, player.health - damage);
    emit(world, { type: 'land', height: result.landed, damage });
  }

  emitFootsteps(world, result.onGround, dt);
}

// Steps are spaced by distance, not by a timer, so the rate follows the actual speed.
// Config has no stride length; one body-width is the stand-in.
function emitFootsteps(world, onGround, dt) {
  const M = world.config.MOVEMENT;
  const speed = Math.hypot(world.player.vel.x, world.player.vel.z);

  if (!onGround || speed <= 0) {
    world.stepDistance = 0;
    return;
  }

  world.stepDistance += speed * dt;
  const stride = M.playerWidth;
  if (world.stepDistance < stride) return;

  world.stepDistance -= stride;
  emit(world, {
    type: 'footstep',
    speedRatio: speed / M.runSpeed,
    crouched: world.player.crouching,
  });
}

// --- weapons -------------------------------------------------------------

function stepWeapons(world, input, dt) {
  const loadout = world.loadout;
  const id = loadout.active;
  const def = loadout.defs[id];
  const state = loadout.weapons[id];

  state.bloom = decayBloom(state.bloom, def, dt);

  // The crosshair tracks the cone every tick, not only on a shot, so it is already
  // opening as the run continues and closing again once the streak stops.
  world.spread = computeSpread({
    def,
    speedRatio: Math.hypot(world.player.vel.x, world.player.vel.z) / world.config.MOVEMENT.runSpeed,
    onGround: world.player.onGround,
    crouched: world.player.crouching,
    walking: !!input.walk && !world.player.crouching,
    bloom: state.bloom,
    scoped: world.scoped,
  });

  // The draw time runs on its own clock and gates everything else: no reload, no shot.
  if (loadout.drawRemaining > 0) {
    loadoutTick(loadout, dt);
    return;
  }

  if (reloadTick(state, def, dt)) emit(world, { type: 'reloadEnd', weapon: id });

  const { fired, dry } = tryFire(
    state,
    def,
    { triggerHeld: !!input.fire, triggerPressed: !!input.pressed?.fire },
    world.time,
  );

  if (dry) emit(world, { type: 'dryFire', weapon: id });
  if (fired) fire(world, id, def, state);
}

function fire(world, id, def, state) {
  const player = world.player;
  const spread = world.spread;

  const origin = eyePoint(player);
  const dir = sampleSpreadDir(aimDir(player), spread, world.rng);
  const hit = castHitscan(origin, dir, def.range, world.colliders, botTargets(world));

  state.bloom = addBloom(state.bloom, def);
  // The burst counter, not the lifetime one: a fresh trigger pull climbs the pattern from
  // entry 0 again (weapons.js resets it once the trigger has been off for recoilReset).
  applyRecoil(world, def, state.burstShots - 1);

  emit(world, { type: 'shot', weapon: id, origin, dir, spread, scoped: world.scoped });

  if (!hit) return;
  if (hit.kind === 'wall') {
    emit(world, { type: 'wallImpact', weapon: id, point: hit.point, normal: hit.normal });
    return;
  }

  const damage = applyDamage(hit, def);
  const bot = world.bots.find((b) => b.id === hit.targetId);
  if (bot) damageBot(bot, damage, world);
  const killed = !!bot && !bot.alive;

  emit(world, {
    type: 'hit',
    kind: hit.kind,
    weapon: id,
    targetId: hit.targetId,
    damage,
    point: hit.point,
    killed,
  });

  if (killed) {
    emit(world, { type: 'kill', victim: bot.id, weapon: id, headshot: hit.kind === 'head', point: hit.point });
  }
}

// Alive bots as hitscan targets: botHitboxes hands back null for a corpse, which is what
// takes a dead bot out of the firing path without the shot knowing anything about rounds.
function botTargets(world) {
  return world.bots.map((bot) => botHitboxes(bot, world.config)).filter(Boolean);
}

// Recoil moves the view directly. T26 (core/feel) turns this into a kick that recovers
// once the trigger comes off; until then the shot pattern simply stays in the aim.
function applyRecoil(world, def, shotIndex) {
  const { pitch, yaw } = recoilOffset(def, shotIndex);
  if (!pitch && !yaw) return;

  const player = world.player;
  const clamped = Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, player.pitch + pitch));
  player.pitch = clamped;
  player.yaw += yaw;
}

// --- geometry helpers ----------------------------------------------------

// yaw 0 looks toward -Z and positive pitch looks up, matching movement.js.
function aimDir(player) {
  const cp = Math.cos(player.pitch);
  return {
    x: -Math.sin(player.yaw) * cp,
    y: Math.sin(player.pitch),
    z: -Math.cos(player.yaw) * cp,
  };
}

function eyePoint(player) {
  const b = player.box;
  return {
    x: (b.min.x + b.max.x) / 2,
    y: b.min.y + player.eyeY,
    z: (b.min.z + b.max.z) / 2,
  };
}
