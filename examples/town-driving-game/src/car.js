// Kinematic arcade car: velocity vector + heading, plain data (no Three.js/DOM).
// T06/T07 cover throttle, brake/reverse and steering; handbrake (T08) extends stepCar.
import { CONFIG } from './config.js';
import { clamp, damp } from './util/math.js';

const C = CONFIG.car;
// ASSUMPTION: prototype's inline yaw rate (rad/s at full steer + full authority) has no config.js key; kept here.
const YAW_RATE = 1.9;
// ASSUMPTION: prototype's 1.35x handbrake yaw multiplier and slip>4.5 skid threshold are inline there; no config.js keys.
const HAND_YAW = 0.35; // extra yaw rate fraction while handbraking (drift)
const SKID_SLIP = 4.5; // m/s lateral speed above which the car is skidding
// Flat accel hits maxSpeed in maxSpeed/accel = 2.77 s; the brief wants 3-4 s, so thrust fades with speed.
// THRUST_MIN > 0 keeps a little push at the cap so the clamp below lands exactly on maxSpeed in finite time.
const THRUST_K = 8; // exponent of the throttle taper
const THRUST_MIN = 0.18; // thrust fraction remaining at maxSpeed
// Body lean (T45): the chassis springs toward its weight-transfer angle instead of snapping
// to it, so it rocks once and settles. ASSUMPTION: feel-only numbers, no config.js key.
const LEAN_W = 13; // spring natural frequency (rad/s), ~2 Hz body rock
const LEAN_Z = 0.45; // damping ratio: one small overshoot, then level
const PITCH_GAIN = 0.0075; // rad of pitch per m/s² of longitudinal accel
const PITCH_MAX = 0.075; // rad, small enough that the body never lifts off its bumpers
const ROLL_GAIN = 0.004; // rad of roll per m/s² of lateral accel
const ROLL_MAX = 0.09; // rad

// Semi-implicit spring-damper step toward `target`; returns the new [angle, angularVel].
function leanStep(pos, vel, target, dt) {
  const v = vel + (-LEAN_W * LEAN_W * (pos - target) - 2 * LEAN_Z * LEAN_W * vel) * dt;
  return [pos + v * dt, v];
}

export function createCar(spawn) {
  return {
    x: spawn.x,
    z: spawn.z,
    heading: spawn.heading ?? 0,
    vx: 0,
    vz: 0,
    speed: 0, // signed forward speed (vel · heading), read by HUD/camera/audio views
    steer: 0, // smoothed front-wheel angle (rad), read by carMesh steer pivots
    slip: 0, // lateral speed (m/s), read by squeal audio + skid marks
    skidding: false,
    braking: false, // true while the brake bites at speed, read by carMesh tail lights
    // Chassis lean (rad), in the mesh's own axes: +pitch = nose down (brake dive),
    // +roll = left side up (the outside of a left turn lifts). Read by carMesh.
    pitch: 0,
    pitchVel: 0,
    roll: 0,
    rollVel: 0,
  };
}

export function stepCar(car, controls, dt) {
  const thr = controls.throttle;
  const brk = controls.brake;
  const hb = controls.handbrake;
  const prevSpeed = car.speed; // last frame's, for the longitudinal accel below

  // Steering: smoothed angle, speed-scaled authority (no pivot at standstill), sign flips in reverse.
  car.steer = damp(car.steer, controls.steer * C.steerMax, C.steerSpeed * 3, dt);
  const hfx = Math.sin(car.heading);
  const hfz = Math.cos(car.heading);
  const dirSign = car.vx * hfx + car.vz * hfz >= 0 ? 1 : -1;
  const authority = Math.min(1, Math.hypot(car.vx, car.vz) / C.refSpeed);
  const yawRate = car.steer * authority * YAW_RATE * (1 + HAND_YAW * hb) * dirSign;
  car.heading += yawRate * dt;

  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);

  if (thr > 0) {
    const thrust = Math.max(THRUST_MIN, 1 - Math.pow(Math.hypot(car.vx, car.vz) / C.maxSpeed, THRUST_K));
    car.vx += fx * C.accel * thrust * thr * dt;
    car.vz += fz * C.accel * thrust * thr * dt;
  }
  car.braking = false;
  if (brk > 0) {
    const vf = car.vx * fx + car.vz * fz;
    if (vf > 0.5) {
      car.braking = true;
      car.vx -= fx * C.brake * brk * dt;
      car.vz -= fz * C.brake * brk * dt;
    } else if (vf > -C.reverseMax) {
      car.vx -= fx * C.accel * 0.6 * brk * dt;
      car.vz -= fz * C.accel * 0.6 * brk * dt;
    }
  }

  if (hb > 0) {
    const s = damp(1, 0, C.handDrag * hb, dt); // extra drag, frame-rate independent
    car.vx *= s;
    car.vz *= s;
  }

  let sp = Math.hypot(car.vx, car.vz);
  if (thr > 0) {
    if (sp > C.maxSpeed) {
      const s = C.maxSpeed / sp;
      car.vx *= s;
      car.vz *= s;
    }
  } else if (brk <= 0) {
    if (sp > 0.01) {
      const ns = Math.max(0, sp - (C.rollResist + C.drag * sp) * dt);
      car.vx *= ns / sp;
      car.vz *= ns / sp;
      sp = ns;
    }
    if (sp < 0.4) {
      car.vx = 0;
      car.vz = 0;
    }
  }

  // Lateral grip: bleed sideways velocity; handbrake lowers grip => drift.
  const rx = Math.cos(car.heading);
  const rz = -Math.sin(car.heading);
  const vl = car.vx * rx + car.vz * rz;
  const nv = damp(vl, 0, C.grip + (C.handGrip - C.grip) * hb, dt);
  car.vx += (nv - vl) * rx;
  car.vz += (nv - vl) * rz;

  car.x += car.vx * dt;
  car.z += car.vz * dt;
  car.speed = car.vx * fx + car.vz * fz;
  car.slip = Math.abs(nv);
  car.skidding = (hb > 0 && Math.abs(car.speed) > 5) || car.slip > SKID_SLIP;

  // Weight transfer: pitch off the longitudinal accel, roll off the centripetal one
  // (yaw rate x forward speed, the lateral accel of a steady turn). Signs are the mesh's,
  // so accelerating lifts the nose (-x) and a left turn lifts the left side (+z).
  const longAccel = dt > 0 ? (car.speed - prevSpeed) / dt : 0;
  [car.pitch, car.pitchVel] = leanStep(car.pitch, car.pitchVel, clamp(-PITCH_GAIN * longAccel, -PITCH_MAX, PITCH_MAX), dt);
  [car.roll, car.rollVel] = leanStep(car.roll, car.rollVel, clamp(ROLL_GAIN * yawRate * car.speed, -ROLL_MAX, ROLL_MAX), dt);
}
