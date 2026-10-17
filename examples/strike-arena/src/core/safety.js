// The safety net for the two ways a body can leave the game: the player ends up outside
// the arena or inside a wall (a collision edge case, a backgrounded-tab delta spike, a map
// edit), and a bot stops closing on its waypoint and walks into the same crate for the rest
// of the round. Both are post-tick invariants — nothing here moves anything on purpose, it
// only checks where a step left things and puts them back where they belong.
import { CONFIG, MOVEMENT } from '../config.js';
import { MAP_DATA } from './mapData.js';
import { boxFromMinMax } from './aabb.js';

// resolveMove clamps a box flush against the floor or a wall, and a flush clamp lands a few
// ULP inside the surface, so both checks need a margin: float noise must not read as
// "fell through the map" and teleport the player to spawn every tick.
const BOUNDS_TOL = 1e-3;
const SKIN = 1e-4;
// Metres of closing that count as real progress — the same epsilon patrolStep uses.
const PROGRESS_EPS = 1e-3;

// True once the player has left the playable volume: sunk below the floor plane, above the
// ceiling, or past any of the four walls. A box flush with a bound is still inside.
export function isOutOfBounds(player, bounds) {
  const b = player.box;
  return (
    b.min.y < bounds.min.y - BOUNDS_TOL ||
    b.max.y > bounds.max.y + BOUNDS_TOL ||
    b.min.x < bounds.min.x - BOUNDS_TOL ||
    b.max.x > bounds.max.x + BOUNDS_TOL ||
    b.min.z < bounds.min.z - BOUNDS_TOL ||
    b.max.z > bounds.max.z + BOUNDS_TOL
  );
}

// Whether the tick has to put the player back, which is a policy and not the geometry above:
// a body that has gone up past the ceiling is on a ballistic path back down, and recovering
// him there swallows the fall — and the fall damage that goes with it. So this is
// isOutOfBounds without its ceiling edge, plus embedding: through the floor, past a wall or
// inside a collider is the state a player cannot leave on his own.
export function needsRecovery(player, bounds, colliders = []) {
  const b = player.box;
  const gone =
    b.min.y < bounds.min.y - BOUNDS_TOL ||
    b.min.x < bounds.min.x - BOUNDS_TOL ||
    b.max.x > bounds.max.x + BOUNDS_TOL ||
    b.min.z < bounds.min.z - BOUNDS_TOL ||
    b.max.z > bounds.max.z + BOUNDS_TOL;
  return gone || isEmbedded(player, colliders);
}

// True while the player box is inside a collider by more than the skin. Resting contact is
// not embedding: the floor and every crate top are colliders he stands flush against.
export function isEmbedded(player, colliders = []) {
  return colliders.some((c) => penetrates(player.box, c));
}

// Skinned overlap. aabb.js keeps its own version private and exports only the exact
// `intersects`, which a body resting on a crate defeats by ~1e-16.
function penetrates(a, b) {
  return (
    a.min.x < b.max.x - SKIN && a.max.x > b.min.x + SKIN &&
    a.min.y < b.max.y - SKIN && a.max.y > b.min.y + SKIN &&
    a.min.z < b.max.z - SKIN && a.max.z > b.min.z + SKIN
  );
}

// Put the player back on his feet at `spawn` (a foot position) with no velocity. The aim
// and the health are his own to keep — recovery is a position fix, not a respawn — and the
// fall is cleared so teleporting out of a pit does not arrive as fall damage.
export function recoverPlayer(player, spawn) {
  const M = MOVEMENT;
  const h = player.crouching ? M.crouchHeight : M.playerHeight;
  const w = M.playerWidth;

  player.box = boxFromMinMax(
    { x: spawn.x - w / 2, y: spawn.y, z: spawn.z - w / 2 },
    { x: spawn.x + w / 2, y: spawn.y + h, z: spawn.z + w / 2 },
  );
  player.vel = { x: 0, y: 0, z: 0 };
  player.onGround = false;
  player.fallStart = null;
  player.eyeY = player.crouching ? M.crouchEyeHeight : M.eyeHeight;
  return player;
}

// One tick of the bot watchdog: watch how close the bot gets to the waypoint it is walking
// to, and once it has given up `stuckTime` worth of seconds on it, route on from that
// waypoint's node instead of waiting out the round. Returns true on the tick it skips.
//
// Only patrol walks waypoint to waypoint — engage and cover head at a point that is not a
// waypoint, so progress toward `bot.target` would mean nothing there.
export function botStuckTick(bot, dt, config = CONFIG, waypoints = MAP_DATA.waypoints) {
  const b = config.BOTS;
  if (!bot.alive || bot.state !== 'patrol' || !bot.target) return resetWatch(bot);

  // A new leg — reached, re-routed or handed over by patrolStep — starts the clock over.
  if (bot.safetyTarget !== bot.target) {
    bot.safetyTarget = bot.target;
    bot.safetyDist = Infinity;
    bot.safetyFor = 0;
  }

  const wp = waypoints.find((n) => n.id === bot.target);
  if (!wp) return resetWatch(bot);

  const dist = flatDist(bot.pos, wp.pos);
  if (dist < bot.safetyDist - PROGRESS_EPS) {
    bot.safetyDist = dist;
    bot.safetyFor = 0;
    return false;
  }

  bot.safetyFor += dt;
  if (bot.safetyFor < b.stuckTime) return false;

  skipWaypoint(bot, wp);
  resetWatch(bot);
  return true;
}

// Give up on the leg and leave from the waypoint's node, exactly as patrolStep does when
// its own leg timer runs out.
function skipWaypoint(bot, wp) {
  bot.from = bot.node;
  bot.node = wp.id;
  bot.target = pickLink(wp, bot.from, bot.rng);
  // patrolStep keeps a second set of leg counters; clear them so the new leg is measured
  // from scratch there too.
  bot.legDist = Infinity;
  bot.stuckFor = 0;
}

// Mirrors pickLink in bots.js (private there): a skip has to choose the way patrolStep
// would have, or the bot doubles back into the corner it just failed to get around.
function pickLink(node, exclude, rng) {
  const links = node?.links ?? [];
  const pool = links.filter((id) => id !== exclude);
  const list = pool.length ? pool : links;
  if (!list.length) return null;
  return list[Math.floor(rng() * list.length) % list.length];
}

function resetWatch(bot) {
  bot.safetyTarget = null;
  bot.safetyDist = Infinity;
  bot.safetyFor = 0;
  return false;
}

const flatDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
