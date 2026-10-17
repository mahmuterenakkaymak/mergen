// Bot AI: perception, navigation, shooting and death. A bot patrols the waypoint graph,
// engages when the player walks into its view cone with a clear line, shoots him with a
// seeded aim error, breaks for cover when something starts hurting it, and leaves a
// corpse behind that the round recycles once its lifetime runs out.
//
// Every bot carries its own seeded rng: waypoint choices, reaction delays and aim error
// have to stay reproducible no matter how many shots the player has already pulled from
// world.rng this tick.
import { CONFIG } from '../config.js';
import { makeBox, resolveMove } from './aabb.js';
import { applyDamage, castHitscan } from './raycast.js';
import { sampleSpreadDir } from './spread.js';
import { mulberry32 } from './rng.js';

const DEG = Math.PI / 180;

// mulberry32 takes a 32-bit integer, so the bot's id is folded into the seed.
function idSeed(id) {
  const s = String(id);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// `spawn` is a foot position, the same convention as the dummies in game.js.
export function createBot(id, spawn, config = CONFIG) {
  const b = config.BOTS;
  const pos = { x: spawn.x, y: spawn.y, z: spawn.z };

  return {
    id,
    pos,
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    hp: b.health,
    maxHp: b.health,
    alive: true,
    state: 'patrol',
    box: makeBox(
      { x: pos.x, y: pos.y + b.bodyHeight / 2, z: pos.z },
      { x: b.bodyWidth, y: b.bodyHeight, z: b.bodyWidth },
    ),
    node: null, // waypoint it is standing at / left from
    from: null, // waypoint it came from, so it does not immediately double back
    target: null, // waypoint it is walking to
    coverId: null,
    lastSeen: null,
    hpSeen: b.health, // lets the next think notice a drop in hp
    legDist: Infinity, // best distance to the target seen this leg
    stuckFor: 0,
    rng: mulberry32(idSeed(id)),
  };
}

// The shape castHitscan takes as a target: a body box from the feet up and a head box
// sitting on it, so a head ray never also reads as a body hit. Dead bots return null,
// which is what keeps a corpse out of the firing path.
export function botHitboxes(bot, config = CONFIG) {
  if (!bot.alive) return null;
  const b = config.BOTS;
  const p = bot.pos;

  return {
    id: bot.id,
    body: makeBox(
      { x: p.x, y: p.y + b.bodyHeight / 2, z: p.z },
      { x: b.bodyWidth, y: b.bodyHeight, z: b.bodyWidth },
    ),
    head: makeBox(
      { x: p.x, y: p.y + b.bodyHeight + b.headSize / 2, z: p.z },
      { x: b.headSize, y: b.headSize, z: b.headSize },
    ),
  };
}

// Straight line between two points, blocked by any wall box. `dir` may be a raw aim
// vector — castHitscan normalises it and measures t in metres, so the range is exactly
// the distance between the endpoints.
export function hasLineOfSight(from, to, walls = []) {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const dist = Math.hypot(d.x, d.y, d.z);
  if (!(dist > 0)) return true;
  return castHitscan(from, d, dist, walls, []) === null;
}

// Advance one bot one fixed step. Reads the world, moves itself, never touches the
// player or another bot's state.
export function botThink(bot, world, dt) {
  if (!bot.alive) {
    bot.state = 'dead';
    // The corpse outlives the bot by corpseLifetime so the fade-out has something to
    // fade; past that it is flagged for removal and stops occupying a round slot.
    if (!bot.removable && world.time - (bot.deathTime ?? 0) >= world.config.ROUNDS.corpseLifetime) {
      bot.removable = true;
    }
    return bot;
  }

  const hurt = bot.hp < bot.hpSeen;
  bot.hpSeen = bot.hp;
  const spotted = canSee(bot, world);
  if (spotted) bot.lastSeen = playerFeet(world.player);

  if (hurt) {
    const cover = pickCoverPoint(bot, world);
    if (cover) {
      bot.state = 'cover';
      bot.coverId = cover.id;
    }
  } else if (bot.state === 'patrol' && spotted) {
    bot.state = 'engage';
  }

  if (bot.state === 'cover') {
    if (coverStep(bot, world, dt)) {
      bot.coverId = null;
      bot.state = spotted ? 'engage' : 'patrol';
    }
  } else if (bot.state === 'engage') {
    engageStep(bot, world, dt, spotted);
  } else {
    patrolStep(bot, world, dt);
  }

  return bot;
}

// --- perception ----------------------------------------------------------

function canSee(bot, world) {
  const cfg = world.config.BOTS;
  const from = botEye(bot, cfg);
  const to = playerEye(world.player, world.config);

  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const flat = Math.hypot(dx, dz);
  if (flat > cfg.viewDistance) return false;

  // Outside the cone the player is simply not there, however close.
  const f = { x: -Math.sin(bot.yaw), z: -Math.cos(bot.yaw) };
  const cos = flat > 1e-6 ? (f.x * dx + f.z * dz) / flat : 1;
  if (Math.acos(Math.min(1, Math.max(-1, cos))) > (cfg.viewFovDeg * DEG) / 2) return false;

  return hasLineOfSight(from, to, world.colliders);
}

// --- states --------------------------------------------------------------

// Walk the graph: one straight leg at a time, and at the far end pick a linked node
// that is not the one just left.
function patrolStep(bot, world, dt) {
  const cfg = world.config.BOTS;
  const nodes = world.mapData.waypoints ?? [];
  if (!nodes.length) return;

  if (!bot.target) {
    if (!bot.node) bot.node = nearestNode(bot, nodes).id;
    bot.target = pickLink(findNode(nodes, bot.node), null, bot.rng);
    if (!bot.target) return;
    bot.legDist = Infinity;
    bot.stuckFor = 0;
  }

  const wp = findNode(nodes, bot.target);
  if (!wp) {
    bot.target = null;
    return;
  }

  const dist = stepTowards(bot, wp.pos, cfg.walkSpeed, dt, world);
  if (dist <= cfg.bodyWidth) return advance(bot, wp.id, nodes);

  // No progress for stuckTime means the leg is not happening (a crate in the way, a
  // corner it cannot slide out of): give up on it and route on from its end node.
  if (dist < bot.legDist - 1e-3) {
    bot.legDist = dist;
    bot.stuckFor = 0;
  } else if ((bot.stuckFor += dt) >= cfg.stuckTime) {
    advance(bot, wp.id, nodes);
  }
}

function advance(bot, reachedId, nodes) {
  bot.from = bot.node;
  bot.node = reachedId;
  bot.target = pickLink(findNode(nodes, reachedId), bot.from, bot.rng);
  bot.legDist = Infinity;
  bot.stuckFor = 0;
}

// Close to the preferred band, hold inside it, back off below it. While the player is
// out of sight the bot finishes walking to where it last saw them, then gives up.
function engageStep(bot, world, dt, spotted) {
  const cfg = world.config.BOTS;

  if (spotted) {
    const p = playerFeet(world.player);
    bot.yaw = yawTowards(bot.pos, p);
    const dist = flatDist(bot.pos, p);
    if (dist > cfg.preferredRangeMax) stepTowards(bot, p, cfg.runSpeed, dt, world);
    else if (dist < cfg.preferredRangeMin) {
      stepTowards(bot, { x: 2 * bot.pos.x - p.x, z: 2 * bot.pos.z - p.z }, cfg.runSpeed, dt, world);
    }
    return;
  }

  if (!bot.lastSeen) {
    bot.state = 'patrol';
    return;
  }
  const dist = stepTowards(bot, bot.lastSeen, cfg.runSpeed, dt, world);
  if (dist <= cfg.bodyWidth) {
    bot.lastSeen = null;
    bot.state = 'patrol';
  }
}

// Back up to the cover point it chose, then look over the crate from there.
function coverStep(bot, world, dt) {
  const cfg = world.config.BOTS;
  const point = (world.mapData.coverPoints ?? []).find((c) => c.id === bot.coverId);
  if (!point) {
    bot.coverId = null;
    bot.state = 'patrol';
    return true;
  }

  const dist = stepTowards(bot, point.pos, cfg.runSpeed, dt, world);
  if (dist > cfg.bodyWidth) return false;

  bot.yaw = point.facing ?? bot.yaw;
  return true;
}

// The nearest cover point, preferring ones the player is not standing right on top of.
// LOS is deliberately not part of the choice: crates are 1 m tall and eyes are at
// 1.6 m, so almost every cover point in this arena still sees the player.
function pickCoverPoint(bot, world) {
  const cfg = world.config.BOTS;
  const points = world.mapData.coverPoints ?? [];
  if (!points.length) return null;

  const p = playerFeet(world.player);
  const room = points.filter((c) => flatDist(c.pos, p) >= cfg.preferredRangeMin);
  const pool = room.length ? room : points;

  return pool.reduce((best, c) => (flatDist(c.pos, bot.pos) < flatDist(best.pos, bot.pos) ? c : best), pool[0]);
}

// --- shooting and death ---------------------------------------------------

// botFire reads the clock from world.time, the same way the player's weapons do, so it
// has to run after the tick has advanced it — which is exactly what stepGame does.
// Firing needs no weapon state of its own: bots do not pick guns up, reload or run dry,
// so the definition in config is the whole magazine.

// Same contract as the emit() in core/game.js — every event carries the game time it
// happened at. Duplicated instead of imported because game.js imports this module.
function emit(world, event) {
  event.t = world.time;
  world.events.push(event);
  return event;
}

// Wound a bot. Returns the damage it actually took (health never goes below zero) and
// hands over to killBot on the blow that empties it. The next think sees the drop in
// hpSeen and breaks for cover on its own.
export function damageBot(bot, amount, world) {
  if (!bot.alive || !(amount > 0)) return 0;

  const applied = Math.min(bot.hp, amount);
  bot.hp -= applied;
  if (bot.hp <= 0) killBot(bot, world);
  return applied;
}

// Dying is a state change, not a removal: the body stays in world.bots until the round
// recycles it, which is what lets the renderer topple and fade it.
export function killBot(bot, world) {
  if (!bot.alive) return bot;

  bot.alive = false;
  bot.hp = 0;
  bot.state = 'dead';
  bot.deathTime = world.time;
  bot.removable = false;
  bot.vel = { x: 0, y: 0, z: 0 };
  return bot;
}

// One bot's shot cycle: hold the player in view for a seeded reaction delay, then keep
// time with the weapon's fireRate and put each round into a seeded cone that tightens
// while the target is held. Returns the botShot event, or null for a tick with no shot.
export function botFire(bot, world, dt) {
  if (!bot.alive) return null;

  const cfg = world.config.BOTS;
  const def = world.config.WEAPONS[cfg.weapon];

  // Out of sight, the engagement clock restarts: coming back costs a fresh reaction
  // delay and a wide aim again. The weapon's own cooldown survives the blink.
  if (!canSee(bot, world)) {
    bot.readyAt = null;
    bot.aimTime = 0;
    return null;
  }

  if (bot.readyAt == null) bot.readyAt = world.time + roll(cfg.reactionTimeMin, cfg.reactionTimeMax, bot.rng);
  bot.aimTime = (bot.aimTime ?? 0) + dt;
  if (world.time < bot.readyAt || world.time < (bot.nextShotAt ?? 0)) return null;

  const cone = aimError(bot, cfg);
  const origin = botEye(bot, cfg);
  const dir = sampleSpreadDir(aimAt(origin, playerChest(world.player, world.config)), cone, bot.rng);
  const hit = castHitscan(origin, dir, def.range, world.colliders, [playerTarget(world.player)]);

  // Where the round stops: the wall or the player it hit, otherwise the end of its
  // flight. The renderer draws the tracer to this point, and only the core's own hitscan
  // knows it — a wall stop, unlike the player's shot, emits no event of its own.
  const end = hit
    ? { x: hit.point.x, y: hit.point.y, z: hit.point.z }
    : {
        x: origin.x + dir.x * def.range,
        y: origin.y + dir.y * def.range,
        z: origin.z + dir.z * def.range,
      };

  bot.nextShotAt = world.time + def.fireRate;
  const event = emit(world, {
    type: 'botShot',
    botId: bot.id,
    pos: { x: bot.pos.x, y: bot.pos.y, z: bot.pos.z },
    origin,
    dir,
    cone,
    weapon: cfg.weapon,
    end,
    endNormal: hit?.kind === 'wall' ? hit.normal : null,
  });

  if (hit && hit.kind === 'body') {
    const damage = applyDamage(hit, def);
    if (!world.config.PLAYER.godMode) world.player.health = Math.max(0, world.player.health - damage);
    emit(world, { type: 'damage', target: 'player', source: bot.id, damage, point: hit.point });
  }

  return event;
}

// The fire cone, in radians half-angle: aimErrorMax the instant the player is acquired,
// shrinking at aimErrorShrink per second on target down to aimErrorMin. A bot that
// keeps its eyes on you becomes dangerous; one that keeps losing you never does.
function aimError(bot, cfg) {
  return Math.max(cfg.aimErrorMin, cfg.aimErrorMax - cfg.aimErrorShrink * (bot.aimTime ?? 0));
}

const roll = (min, max, rng) => min + (max - min) * rng();

// Raw aim vector, not normalised: sampleSpreadDir and castHitscan both normalise, so
// the caller keeps the length for free.
const aimAt = (from, to) => ({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z });

// Centre mass: the middle of the player box, so aim error has the torso to miss into
// rather than the top of the head.
function playerChest(player, config) {
  const feet = playerFeet(player);
  const top = player.box ? player.box.max.y : feet.y + config.MOVEMENT.playerHeight;
  return { x: feet.x, y: (feet.y + top) / 2, z: feet.z };
}

// The player as a hitscan target: one box, no head box. Headshots stay the player's own
// privilege, so a bot's best hit is a body hit.
const playerTarget = (player) => ({ id: 'player', body: player.box, head: null });

// --- movement ------------------------------------------------------------

// Bots move with the player's own resolver, so they slide along walls instead of
// sticking and can never end a step inside a collider. Gravity is applied because the
// resolver only clamps downward movement, and a bot shoved off the floor would
// otherwise hover there for the rest of the round.
function stepTowards(bot, dest, speed, dt, world) {
  const dx = dest.x - bot.pos.x;
  const dz = dest.z - bot.pos.z;
  const flat = Math.hypot(dx, dz);
  if (flat > 1e-6) bot.yaw = yawTowards(bot.pos, dest);

  bot.vel.y -= world.config.MOVEMENT.gravity * dt;
  const scale = flat > 0 ? Math.min(speed * dt, flat) / flat : 0;
  const result = resolveMove(bot.box, { x: dx * scale, y: bot.vel.y * dt, z: dz * scale }, world.colliders);

  bot.box = result.box;
  if (result.onGround) bot.vel.y = 0;
  syncPos(bot);
  return flat;
}

function syncPos(bot) {
  const b = bot.box;
  bot.pos.x = (b.min.x + b.max.x) / 2;
  bot.pos.y = b.min.y;
  bot.pos.z = (b.min.z + b.max.z) / 2;
}

// --- small helpers -------------------------------------------------------

function pickLink(node, exclude, rng) {
  const links = node?.links ?? [];
  const pool = links.filter((id) => id !== exclude);
  if (!pool.length) return links.length ? links[0] : null;
  return pool[Math.floor(rng() * pool.length) % pool.length];
}

function nearestNode(bot, nodes) {
  return nodes.reduce((best, n) => (flatDist(bot.pos, n.pos) < flatDist(bot.pos, best.pos) ? n : best), nodes[0]);
}

const findNode = (nodes, id) => nodes.find((n) => n.id === id) ?? null;

// yaw 0 looks toward -Z, matching aimDir in game.js.
const yawTowards = (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
const flatDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

const botEye = (bot, cfg) => ({ x: bot.pos.x, y: bot.pos.y + cfg.eyeHeight, z: bot.pos.z });

function playerFeet(player) {
  const b = player.box;
  if (!b) {
    const p = player.pos ?? player;
    return { x: p.x, y: p.y, z: p.z };
  }
  return { x: (b.min.x + b.max.x) / 2, y: b.min.y, z: (b.min.z + b.max.z) / 2 };
}

function playerEye(player, config) {
  const feet = playerFeet(player);
  return { x: feet.x, y: feet.y + (player.eyeY ?? config.MOVEMENT.eyeHeight), z: feet.z };
}
