// Pure chase-orbit camera: yaw is an offset from directly behind the car, so the
// view follows the car's heading; drag orbits around it, and the offset eases back
// to 0 (behind the car) 1.5 s after the drag stops. No Three.js here.
import { CONFIG } from './config.js';
import { clamp, damp, lerp, wrapAngle } from './util/math.js';
import { createRng } from './util/rng.js';

const C = CONFIG.cam;
const FOLLOW_K = 7; // prototype's exp follow rate (1/s)
const RETURN_DELAY = 1.5; // s after the last drag before the orbit eases back
// ASSUMPTION: the prototype has no ease-back (world-fixed yaw), so its rate has no
// config.js key; 2.5/s settles in ~1 s — a glide, not a snap.
const RETURN_K = 2.5;
// ASSUMPTION: config.js (T01) has no shake keys, so the prototype's inline shake
// numbers live here: metres of jitter per axis at full shake, 4.5/s exp decay.
const SHAKE_AMP = { x: 0.35, y: 0.25, z: 0.35 };
const SHAKE_K = 4.5;
const SHAKE_MIN = 0.001; // below this the jitter is invisible; stop drawing from the rng
// ASSUMPTION: config.js has no occlusion keys, so the pull-in margin — the metres kept
// clear of the wall face so the near plane never clips into it — lives here.
const OCC_MARGIN = 0.8;

export function createCamState() {
  return {
    yaw: 0, // orbit offset from directly behind the car (rad)
    pitch: C.pitch0,
    dist: C.dist,
    sinceDrag: Infinity, // s since the last orbit drag
    x: 0,
    y: 0,
    z: 0,
    ready: false, // first computePose snaps instead of flying from the origin
    fov: C.fov, // widens toward fovMax with speed (updateFov)
    shake: 0, // 0..1 impact energy, decayed by computePose
    shakeRng: createRng(CONFIG.seed).fork('camshake'),
  };
}

// speed: m/s, either sign — the view widens fov → fovMax as the car nears maxSpeed.
export function updateFov(cam, speed, dt) {
  const ratio = clamp(Math.abs(speed) / CONFIG.car.maxSpeed, 0, 1);
  cam.fov = damp(cam.fov, C.fov + ratio * (C.fovMax - C.fov), FOLLOW_K, dt);
  return cam.fov;
}

// Impact energy (damage/collision tasks); computePose shakes it out over ~1 s.
export function addShake(cam, amount) {
  cam.shake = clamp(cam.shake + amount, 0, 1);
}

// orbit: {yaw, pitch} from takeOrbit (rad), {zoom} from takeZoom (metres, + = out).
export function applyOrbit(cam, { yaw = 0, pitch = 0, zoom = 0 }) {
  cam.yaw = wrapAngle(cam.yaw + yaw);
  cam.pitch = clamp(cam.pitch + pitch, C.pitchMin, C.pitchMax);
  cam.dist = clamp(cam.dist + zoom, C.minDist, C.maxDist);
  if (yaw !== 0 || pitch !== 0) cam.sinceDrag = 0;
}

// Ray-vs-building slab test: the distance along the unit ray o + t·d to where it enters a
// building's footprint [x, x+w] × [z, z+d] from the ground up to its roof, or Infinity when
// it misses — including when it passes over the roof or the building is behind o.
// ASSUMPTION: town.aabbs are XZ-only and also carry tree trunks, so occlusion reads
// town.buildings instead: neither a trunk nor a roof the camera is above should dive the view.
function rayBuilding(o, d, b) {
  let lo = -Infinity;
  let hi = Infinity;
  const clip = (p, v, mn, mx) => {
    if (Math.abs(v) < 1e-9) return p >= mn && p <= mx; // parallel: inside this slab or gone
    let t0 = (mn - p) / v;
    let t1 = (mx - p) / v;
    if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
    if (t0 > hi || t1 < lo) return false;
    lo = Math.max(lo, t0);
    hi = Math.min(hi, t1);
    return true;
  };
  if (!clip(o.x, d.x, b.x, b.x + b.w)) return Infinity;
  if (!clip(o.z, d.z, b.z, b.z + b.d)) return Infinity;
  if (!clip(o.y, d.y, 0, b.height)) return Infinity;
  if (hi < 0) return Infinity;
  return lo > 0 ? lo : 0; // 0: the aim point is already inside the building
}

// The nearest building the aim→camera ray runs into, as a distance along the ray
// (Infinity when the view is clear).
function firstOcclusion(o, d, buildings) {
  let best = Infinity;
  for (const b of buildings) {
    const t = rayBuilding(o, d, b);
    if (t < best) best = t;
  }
  return best;
}

// target: {x, y, z, heading} — the car's aim point plus heading, so yaw is relative to it.
// buildings: optional town.buildings. When one sits between the car and the camera the pose
// slides in along the aim→camera line to just before it, so the view shows the car and not
// a wall; the follow smooths the slide, and minDist/2 keeps it out of the car's face.
// The pose the follow aims at: the orbit offset off the target, shortened when a building
// stands between them.
function aimPose(cam, target, buildings) {
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const yawW = target.heading + Math.PI + cam.yaw; // π puts the camera behind the car
  // The aim→camera offset is exactly cam.dist long, so a pull-in is a scale on it: the
  // nearer pose stays on the same line and the glide follows it, never cutting a corner
  // through the wall.
  let sx = Math.sin(yawW) * cp;
  let sy = sp;
  let sz = Math.cos(yawW) * cp;
  if (buildings) {
    const hit = firstOcclusion(target, { x: sx, y: sy, z: sz }, buildings);
    if (hit < cam.dist) {
      const pull = Math.max(hit - OCC_MARGIN, C.minDist * 0.5) / cam.dist;
      sx *= pull;
      sy *= pull;
      sz *= pull;
    }
  }
  return {
    x: target.x + sx * cam.dist,
    y: Math.max(0.9, target.y + sy * cam.dist),
    z: target.z + sz * cam.dist,
  };
}

// The chase target a world offers. aimPose reads target.heading, so anything handed to it
// — the follow, the start swoop — has to carry the heading or the pose comes out NaN.
export function chaseTarget(world) {
  return { x: world.car.x, y: CONFIG.cam.height, z: world.car.z, heading: world.car.heading };
}

export function computePose(cam, target, dt, buildings) {
  cam.sinceDrag += dt;
  if (cam.sinceDrag > RETURN_DELAY) {
    cam.yaw = damp(cam.yaw, 0, RETURN_K, dt);
  }
  const want = aimPose(cam, target, buildings);
  if (!cam.ready) {
    cam.x = want.x;
    cam.y = want.y;
    cam.z = want.z;
    cam.ready = true;
  } else {
    cam.x = damp(cam.x, want.x, FOLLOW_K, dt);
    cam.y = damp(cam.y, want.y, FOLLOW_K, dt);
    cam.z = damp(cam.z, want.z, FOLLOW_K, dt);
  }
  let jx = 0,
    jy = 0,
    jz = 0;
  if (cam.shake > SHAKE_MIN) {
    const r = cam.shakeRng;
    jx = r.range(-1, 1) * cam.shake * SHAKE_AMP.x;
    jy = r.range(-1, 1) * cam.shake * SHAKE_AMP.y;
    jz = r.range(-1, 1) * cam.shake * SHAKE_AMP.z;
    cam.shake *= Math.exp(-SHAKE_K * dt);
  }
  // Jitter rides on top of the followed pose, so it never feeds back into cam.x/y/z;
  // the ground clamp is re-applied because the shake can push the pose underground.
  return { x: cam.x + jx, y: Math.max(0.9, cam.y + jy), z: cam.z + jz };
}

// ASSUMPTION: config.js has no swoop key, so the start's duration lives here next to the
// other camera rates the config never got.
export const SWOOP_SECONDS = 1.2;

// easeInOutCubic: soft off the mark and a soft landing, and strictly rising in between,
// so the swoop never reverses on its way down.
function ease(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// The cinematic start. t: 0..1 through SWOOP_SECONDS; `from` the attract pose (it carries
// its own lookAt), cam/target the chase state the sim is about to drive. At t=0 the answer
// is exactly `from`, at t=1 exactly the pose computePose snaps to on its first frame, so
// handing the camera back at the end of the swoop shows no seam.
export function swoopPose(t, from, cam, target, buildings) {
  const k = ease(clamp(t, 0, 1));
  const to = aimPose(cam, target, buildings);
  // Land exactly on the chase pose: lerp at k=1 can miss by a float ulp and the hand-over would jitter.
  if (k >= 1) return { x: to.x, y: to.y, z: to.z, lookAt: { x: target.x, y: target.y, z: target.z } };
  return {
    x: lerp(from.x, to.x, k),
    y: lerp(from.y, to.y, k),
    z: lerp(from.z, to.z, k),
    lookAt: {
      x: lerp(from.lookAt.x, target.x, k),
      y: lerp(from.lookAt.y, target.y, k),
      z: lerp(from.lookAt.z, target.z, k),
    },
  };
}
