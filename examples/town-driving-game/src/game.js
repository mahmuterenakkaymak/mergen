// Sim orchestration: one step = car physics + town collision + camera follow + events.
// Views read world.car / world.pose / world.events; nothing here touches Three.js or
// the DOM, so the whole loop runs under Node in tests.
import { CONFIG } from './config.js';
import { clamp, wrapAngle } from './util/math.js';
import { createCar, stepCar } from './car.js';
import { resolveWorld, resolveCircleCircle } from './collision.js';
import { generateTown } from './town.js';
import { makeTraffic, stepTraffic } from './traffic.js';
import { makePeds, stepPeds, startlePeds } from './peds.js';
import { createDamage, applyImpact, repair } from './damage.js';
import { createParticles, burstSparks, stepParticles } from './fx/particles.js';
import { createSkids, emitSkids } from './fx/skids.js';
import { createRng } from './util/rng.js';
import { createCamState, addShake, applyOrbit, updateFov, computePose } from './camera.js';

const MAX_DT = 0.05; // a frame hitch may not move the car further than a slow frame
const MIN_IMPACT = 1; // m/s: grinding a wall re-adds ~0.2 m/s per step; below this it's not a hit
const MIN_THUD = 5; // m/s closing speed under which a traffic bump is a nudge, not a hit
const SPARKS = 14; // sparks thrown up by a car-on-car hit
const SPARK_Y = 0.6; // m: mid-door-panel, the height two cars actually meet at
// The player is the heavier body, so a hit shoves an AI car aside instead of spinning
// its own car out.
const PLAYER_MASS = 1.5;
const AI_MASS = 1;
const STUCK_SPEED = 0.5; // m/s: at or below this, a buried throttle is going nowhere
const STUCK_SECONDS = 2.5; // ...held past this, and the game offers a way out
const FADE_OUT = 0.2; // s the rescue takes the screen to black
const FADE_IN = 0.45; // s the new view takes to fade back in
const HORN_BACK_DIST = 15; // m: an AI car this close ahead answers a blast
const HORN_BACK_CONE = 0.9; // rad half-angle of the arc it has to sit inside
const HORN_BACK_PITCH = 0.72; // its horn, under the player's own two-tone
const HORN_BACK_COOLDOWN = 2; // s before another blast gets an answer

export function createGame(cfg = CONFIG) {
  // ASSUMPTION: createGame generates the town from cfg.seed itself (PLAN: world = { town, ... }), so the car spawns at town.spawn, replacing T18's origin spawn.
  const town = generateTown(cfg.seed, cfg);
  const rng = createRng(cfg.seed);
  return {
    cfg,
    town,
    car: createCar(town.spawn),
    traffic: makeTraffic(rng.fork('traffic'), town, cfg),
    peds: makePeds(rng.fork('peds'), town, cfg),
    damage: createDamage(),
    particles: createParticles(cfg.fx.particles),
    skids: createSkids(cfg.fx.skids),
    fxRng: rng.fork('fx'),
    cam: createCamState(),
    pose: null, // camera pose of the last step, read by the render view
    events: [], // sim -> view channel, emptied at the start of every step
    hornHeld: false,
    honkBackT: 0, // s until a car may answer the next blast
    resetHeld: false,
    stuckT: 0, // s of held throttle spent not moving
    stuckShown: false, // one ask per stuck spell
    fade: 0, // rescue overlay opacity the view paints, 0..1
    fadePhase: 0, // 0 clear, 1 going to black, 2 coming back
    paused: false, // Esc / window blur: the world holds until something clears it
  };
}

// controls: toControls() output plus { horn } (H held) and { reset } (R held) and the
// optional per-frame camera { orbit } / { zoom } from takeOrbit/takeZoom — the sim's only input.
export function stepGame(world, controls, dt) {
  const step = clamp(dt, 0, MAX_DT);
  world.events.length = 0;
  if (world.paused) return world; // frozen: no physics, no actors, no events, no camera

  const horn = !!controls.horn;
  if (horn && !world.hornHeld) {
    world.events.push({ type: 'horn' });
    hornReaction(world);
  }
  world.hornHeld = horn;
  world.honkBackT = Math.max(0, world.honkBackT - step);

  // R, taken as an edge (as with horn) so holding it through a frame hitch is one rescue,
  // not one per frame. It only starts the fade here; the car itself moves once the screen
  // is black, in stepRescue.
  const reset = !!controls.reset;
  if (reset && !world.resetHeld) world.fadePhase = 1;
  world.resetHeld = reset;

  const car = world.car;
  stepCar(car, controls, step);

  // Traffic first: resolveWorld then gets the last word on the walls, so a shove from
  // an AI car can never leave the player inside a building or outside the bounds.
  stepTraffic(world.traffic, car, step);
  collideTraffic(world);

  const hit = resolveWorld(car, world.town, step, world.cfg.car.radius);
  if (hit && hit.impact >= MIN_IMPACT) wallHit(world, hit.impact, hit.contact);

  // resolveWorld's bounds clamp only moves the car; drop the velocity pointing out of
  // bounds so a perimeter slam doesn't leave it revving at full speed against the wall,
  // and report what the wall took as an impact — the perimeter is a solid like any other.
  const b = world.town.bounds;
  const r = world.cfg.car.radius;
  let cx = car.x, cz = car.z; // contact point, on the wall face the car is pressed against
  let wx = 0, wz = 0; // outward speed the wall removed, per axis
  if (car.x <= b.minX + r) {
    wx = Math.max(0, -car.vx); car.vx = Math.max(0, car.vx); cx = b.minX;
  } else if (car.x >= b.maxX - r) {
    wx = Math.max(0, car.vx); car.vx = Math.min(0, car.vx); cx = b.maxX;
  }
  if (car.z <= b.minZ + r) {
    wz = Math.max(0, -car.vz); car.vz = Math.max(0, car.vz); cz = b.minZ;
  } else if (car.z >= b.maxZ - r) {
    wz = Math.max(0, car.vz); car.vz = Math.min(0, car.vz); cz = b.maxZ;
  }
  const wall = Math.hypot(wx, wz);
  if (wall >= MIN_IMPACT) wallHit(world, wall, { x: cx, z: cz });

  // Collision removed velocity stepCar had already folded into speed; refresh it for the views.
  car.speed = car.vx * Math.sin(car.heading) + car.vz * Math.cos(car.heading);

  // The rescue moves the car between the physics and the views, so on the frame it lands
  // it the camera, the walkers and the skids all read the new pose, never the old one.
  stepRescue(world, step);
  checkStuck(world, controls, step);

  // The street is alive: walkers pace the pavements (their watchOut events join this
  // frame's) and a slide lays skid marks for the fx view to draw.
  for (const e of stepPeds(world.peds, car, step)) world.events.push(e);
  emitSkids(world.skids, car);

  stepParticles(world.particles, step);

  const cam = world.cam;
  applyOrbit(cam, {
    yaw: controls.orbit?.yaw ?? 0,
    pitch: controls.orbit?.pitch ?? 0,
    zoom: controls.zoom ?? 0,
  });
  updateFov(cam, world.car.speed, step);
  world.pose = computePose(cam, {
    x: world.car.x,
    y: world.cfg.cam.height,
    z: world.car.z,
    heading: world.car.heading,
  }, step, world.town.buildings);
  return world;
}

// Esc or a window blur: the session holds. The view owns when this is raised (main.js
// watches the DOM) and what it costs — the dim overlay and the suspended audio — while the
// sim just stops moving. ASSUMPTION: pause is state the view sets, not a control the sim
// reads per frame, so it can be raised between frames and outlives the tab being hidden.
export function setPaused(world, on) {
  world.paused = !!on;
  return world.paused;
}

// Attract mode: the town keeps living behind the start screen. AI cars run their loops with
// no player to yield to and walkers keep pacing, while the car stays parked where it
// spawned. ASSUMPTION: the parked car goes to stepPeds as-is (speed 0), so it startles
// nobody, and the events stepPeds returns are dropped — the views read the actors, not the
// event channel, so attract mode raises no sound, toast or damage.
export function stepAmbient(world, dt) {
  const step = clamp(dt, 0, MAX_DT);
  stepTraffic(world.traffic, null, step);
  stepPeds(world.peds, world.car, step);
}

// The street answers a blast: walkers within earshot flinch aside (peds.js), and the nearest
// AI car dead ahead toots back on a lower pitch. One answer per blast, and the cooldown keeps
// a held horn from turning the whole block into a chase scene.
// ASSUMPTION: "ahead" is a cone about the car's heading and only the nearest car in it
// answers — the rest of the street stays quiet.
function hornReaction(world) {
  startlePeds(world.peds, world.car);
  if (world.honkBackT > 0) return;

  const car = world.car;
  let near = Infinity;
  for (const c of world.traffic) {
    const dx = c.x - car.x, dz = c.z - car.z;
    const d = Math.hypot(dx, dz);
    if (d > HORN_BACK_DIST || d >= near) continue;
    if (Math.abs(wrapAngle(Math.atan2(dx, dz) - car.heading)) > HORN_BACK_CONE) continue;
    near = d;
  }
  if (near === Infinity) return;

  world.honkBackT = HORN_BACK_COOLDOWN;
  world.events.push({ type: 'hornBack', pitch: HORN_BACK_PITCH });
}

// A wall costs the same as any other solid: paint, shake, sparks, and an impact event
// dressed with what damage.js worked out, so the HUD and audio read it the way they read
// a car-on-car thud.
// ASSUMPTION: sparks and paint start at damage.js's 6 m/s floor; MIN_IMPACT (T67) only
// decides what is a hit worth a sound, so a scrape at 2 m/s thuds without leaving marks.
function wallHit(world, speed, contact) {
  const d = applyImpact(world.damage, { speed });
  if (d) {
    addShake(world.cam, d.shake);
    burstSparks(world.particles, world.fxRng, contact.x, SPARK_Y, contact.z, SPARKS);
  }
  world.events.push({
    type: 'impact',
    speed,
    contact,
    vignette: d ? d.vignette : 0,
    overheat: d ? d.overheat : false,
  });
}

// Throttle buried and the car going nowhere: after STUCK_SECONDS the game stops expecting
// the player to work out that a nose against a wall needs R and offers to do it. One ask
// per stuck spell — the timer and the flag both clear the moment the car rolls or the
// throttle comes off, so getting stuck again later asks again.
function checkStuck(world, controls, step) {
  if (!controls.throttle || Math.abs(world.car.speed) >= STUCK_SPEED) {
    world.stuckT = 0;
    world.stuckShown = false;
    return;
  }
  world.stuckT += step;
  if (world.stuckT >= STUCK_SECONDS && !world.stuckShown) {
    world.stuckShown = true;
    world.events.push({ type: 'stuck' });
  }
}

// The rescue is a cut, not a teleport the player watches: the screen goes to black, the car
// reappears once it is, and the fade lifts. world.fade is that overlay opacity, timed by
// the sim so it runs (and is tested) without a browser; main.js paints it onto the overlay.
function stepRescue(world, step) {
  if (world.fadePhase === 1) {
    world.fade = Math.min(1, world.fade + step / FADE_OUT);
    if (world.fade < 1) return;
    doReset(world);
    world.fadePhase = 2;
  } else if (world.fadePhase === 2) {
    world.fade = Math.max(0, world.fade - step / FADE_IN);
    if (world.fade === 0) world.fadePhase = 0;
  }
}

// Every road centre line runs along one axis, so the nearest point of the network lies on
// the nearest centre line of one axis or the other: keep the car's own coordinate along
// that road and take the centre across from it.
// ASSUMPTION: "nearest road centre" is that projection, and "facing along it" is the way
// the car was already heading, so a rescue never turns it around.
function nearestRoadSpot(town, x, z, heading) {
  let bx = town.roads[0], bz = town.roads[0];
  let dx = Math.abs(x - bx), dz = Math.abs(z - bz);
  for (const c of town.roads) {
    if (Math.abs(x - c) < dx) { dx = Math.abs(x - c); bx = c; }
    if (Math.abs(z - c) < dz) { dz = Math.abs(z - c); bz = c; }
  }
  // heading 0 faces +z (car.js), so the x = bx line runs along z and the z = bz one along x.
  return dx <= dz
    ? { x: bx, z, heading: Math.cos(heading) >= 0 ? 0 : Math.PI }
    : { x, z: bz, heading: Math.sin(heading) >= 0 ? Math.PI / 2 : -Math.PI / 2 };
}

// R: back on the road the car was closest to, facing along it, with no velocity and no
// damage. Views read it back off world.car / world.damage; the toast comes from the
// `reset` event (hud.js).
function doReset(world) {
  const s = nearestRoadSpot(world.town, world.car.x, world.car.z, world.car.heading);
  const car = world.car;
  car.x = s.x;
  car.z = s.z;
  car.heading = s.heading;
  car.vx = 0;
  car.vz = 0;
  car.speed = 0;
  car.steer = 0;
  car.slip = 0;
  car.skidding = false;
  car.braking = false;
  repair(world.damage);
  world.events.push({ type: 'reset' });
}

// Player vs AI car, both circles of the car radius, pushed apart along the centre line
// by resolveCircleCircle (the heavier player shoves an AI car further). AI cars are
// kinematic — heading + speed, no velocity to hand back — so a hit stops the one it
// lands on and takes the closing speed off the player, who keeps the tangential slide:
// the same rule the town walls use, and what stops the two cars re-hitting each other
// every frame while they are in contact.
// ASSUMPTION: a car-on-car hit is its own `thud` event rather than the wall's `impact`,
// so the views can voice/dress it separately (task names damage, shake, sparks, thud).
function collideTraffic(world) {
  const r = world.cfg.car.radius;
  const car = world.car;

  for (const c of world.traffic) {
    const a = { pos: { x: car.x, z: car.z }, vel: { x: car.vx, z: car.vz }, r, mass: PLAYER_MASS };
    const b = {
      pos: { x: c.x, z: c.z },
      vel: { x: Math.sin(c.heading) * c.speed, z: Math.cos(c.heading) * c.speed },
      r,
      mass: AI_MASS,
    };
    const hit = resolveCircleCircle(a, b);
    if (!hit) continue;

    car.x = a.pos.x; car.z = a.pos.z;
    c.x = b.pos.x; c.z = b.pos.z;

    const nx = hit.normal.x, nz = hit.normal.z; // player -> AI car
    const closing = car.vx * nx + car.vz * nz;
    if (closing > 0) {
      car.vx -= nx * closing;
      car.vz -= nz * closing;
    }
    if (hit.impact > 0) c.speed = 0;
    if (hit.impact <= MIN_THUD) continue;

    // damage.js keeps its own 6 m/s floor, so a 5-6 m/s bump thuds and sparks free of charge.
    const d = applyImpact(world.damage, { speed: hit.impact }) ?? { shake: 0, vignette: 0, overheat: false };
    addShake(world.cam, d.shake);
    burstSparks(world.particles, world.fxRng, hit.contact.x, SPARK_Y, hit.contact.z, SPARKS);
    world.events.push({
      type: 'thud',
      speed: hit.impact,
      contact: hit.contact,
      shake: d.shake,
      vignette: d.vignette,
      overheat: d.overheat,
    });
  }
}
