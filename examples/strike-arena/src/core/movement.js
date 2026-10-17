// Player physics: look, locomotion (accel/friction, run/walk/crouch speeds),
// jump, gravity, crouch box changes and fall tracking. Pure module — no Three.js, no DOM.
import { FALL, MOVEMENT, PLAYER } from '../config.js';
import { boxFromMinMax, intersects, resolveMove } from './aabb.js';

const LOOK_GAIN = 0.0022; // radians per pixel of mouse delta at sensitivity 1
const PITCH_LIMIT = Math.PI / 2;

function boxWithHeight(box, height) {
  return boxFromMinMax(
    { x: box.min.x, y: box.min.y, z: box.min.z },
    { x: box.max.x, y: box.min.y + height, z: box.max.z },
  );
}

// spawn is the foot position {x, y, z}.
export function createPlayer(spawn) {
  const w = MOVEMENT.playerWidth;
  const h = MOVEMENT.playerHeight;
  return {
    box: boxFromMinMax(
      { x: spawn.x - w / 2, y: spawn.y, z: spawn.z - w / 2 },
      { x: spawn.x + w / 2, y: spawn.y + h, z: spawn.z + w / 2 },
    ),
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    onGround: false,
    crouching: false,
    fallStart: null, // box-bottom y the current descent began from, null while grounded
    eyeY: MOVEMENT.eyeHeight,
    health: PLAYER.maxHealth,
  };
}

// dx/dy are raw mouse-pixel deltas; positive pitch looks up.
export function applyLook(player, dx, dy, sensitivity = 1) {
  player.yaw -= dx * LOOK_GAIN * sensitivity;
  const pitch = player.pitch - dy * LOOK_GAIN * sensitivity;
  player.pitch = Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, pitch));
  return player;
}

// input: { forward, back, left, right, jump, walk, crouch } booleans.
// Returns { landed, onGround, hitWall, hitCeiling }; landed is the fall height in
// meters on the tick the player touches down, null otherwise.
export function stepPlayer(player, input, dt, colliders = []) {
  const M = MOVEMENT;

  if (input.crouch && !player.crouching) {
    player.crouching = true;
    player.box = boxWithHeight(player.box, M.crouchHeight);
  } else if (!input.crouch && player.crouching) {
    const standing = boxWithHeight(player.box, M.playerHeight);
    if (!colliders.some((c) => intersects(standing, c))) {
      player.crouching = false;
      player.box = standing;
    }
  }

  const speed = player.crouching ? M.crouchSpeed : input.walk ? M.walkSpeed : M.runSpeed;

  const fwd = { x: -Math.sin(player.yaw), z: -Math.cos(player.yaw) };
  const right = { x: Math.cos(player.yaw), z: -Math.sin(player.yaw) };
  let wx =
    (input.forward ? fwd.x : 0) - (input.back ? fwd.x : 0) +
    (input.right ? right.x : 0) - (input.left ? right.x : 0);
  let wz =
    (input.forward ? fwd.z : 0) - (input.back ? fwd.z : 0) +
    (input.right ? right.z : 0) - (input.left ? right.z : 0);
  const wishLen = Math.hypot(wx, wz);
  if (wishLen > 0) {
    wx /= wishLen;
    wz /= wishLen;
  }

  if (wishLen > 0) {
    const k = 1 - Math.exp(-M.accel * dt);
    player.vel.x += (wx * speed - player.vel.x) * k;
    player.vel.z += (wz * speed - player.vel.z) * k;
  } else {
    const f = Math.exp(-M.friction * dt);
    player.vel.x *= f;
    player.vel.z *= f;
  }

  const wasOnGround = player.onGround;
  if (!wasOnGround) player.vel.y -= M.gravity * dt;
  if (input.jump && wasOnGround) {
    player.vel.y = M.jumpSpeed;
    player.onGround = false;
  }
  if (!player.onGround && player.vel.y < 0 && player.fallStart === null) {
    player.fallStart = player.box.min.y;
  }

  const result = resolveMove(
    player.box,
    { x: player.vel.x * dt, y: player.vel.y * dt, z: player.vel.z * dt },
    colliders,
  );
  player.box = result.box;
  player.onGround = result.onGround;
  if (result.onGround && player.vel.y < 0) player.vel.y = 0;
  if (result.hitCeiling && player.vel.y > 0) player.vel.y = 0;

  let landed = null;
  if (!wasOnGround && result.onGround) {
    landed = player.fallStart === null ? 0 : Math.max(0, player.fallStart - player.box.min.y);
  }
  if (result.onGround) player.fallStart = null;

  player.eyeY = player.crouching ? M.crouchEyeHeight : M.eyeHeight;

  return { landed, onGround: result.onGround, hitWall: result.hitWall, hitCeiling: result.hitCeiling };
}

export function fallDamage(height, fall = FALL) {
  if (height <= fall.safeHeight) return 0;
  return (height - fall.safeHeight) * fall.damagePerMeter;
}
