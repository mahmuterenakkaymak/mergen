// Browser bootstrap: renderer, scene, world and the fixed-timestep loop. All gameplay
// rules live in src/core/game.js — this file feeds it input, then mirrors the resulting
// world onto the camera, the viewmodel and the HUD. Presentation never writes back.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import MAP_DATA from './core/mapData.js';
import { createWorld } from './core/game.js';
import { createFixedLoop } from './core/loop.js';
import { createFpsMeter } from './core/fps.js';
import { crosshairRadius } from './core/spread.js';
import { createCameraKick, createMouseSway, damageIndicatorAngle, landingDip, scopeFov, viewBob } from './core/feel.js';
import { createInput } from './input.js';
import { createSession } from './session.js';
import { createScene } from './render/scene.js';
import { createBotSync } from './render/botSync.js';
import { createEffects } from './render/effects.js';
import { createViewmodels } from './render/viewmodel.js';
import { createHud } from './ui/hud.js';
import { createMenu } from './ui/menu.js';
import { createAudio } from './audio/audio.js';

const mount = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = CONFIG.MAP.shadows;
mount.appendChild(renderer.domElement);

const { scene, camera } = createScene(MAP_DATA);

// The gun is a child of the camera, and a camera only renders its children once it is
// itself in the scene graph.
const viewmodels = createViewmodels();
camera.add(viewmodels.root);
scene.add(camera);

// Playtest switch: http://localhost:5174/?god -> the player takes hits but never loses health.
if (new URLSearchParams(location.search).has('god')) CONFIG.PLAYER.godMode = true;
const world = createWorld(CONFIG, MAP_DATA, Date.now());
const input = createInput(window);
const loop = createFixedLoop();
const fps = createFpsMeter();
const hud = createHud(document.getElementById('hud'));
const botSync = createBotSync(scene);
const effects = createEffects(scene);

// The AudioContext is built by the first unlock() rather than here: a context created
// outside a user gesture is born suspended, and Start is the gesture.
const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
const audio = createAudio(() => new AudioContextCtor());

// The menu's callbacks are DOM handlers, so none of them can run before the session below
// has been assigned.
const menu = createMenu(document.getElementById('menu'), {
  onStart: () => session.start(),
  onResume: () => session.resume(),
  onSensitivity: (value) => session.setSensitivity(value),
});

// The session owns the pointer lock too: it is the one that knows whether the game is
// running, and a lock taken behind the pause overlay would be a mouse the player cannot find.
const session = createSession({
  world,
  input,
  loop,
  menu,
  audio,
  effects,
  lockTarget: renderer.domElement,
});
session.setSensitivity(menu.sensitivity); // whatever a previous session left in localStorage

// Feel state: the motions the core deliberately does not simulate. All of it is layered
// on top of the simulated camera, and none of it moves the aim — a shot still flies where
// the crosshair was, not where the screen happens to be mid-kick.
const kick = createCameraKick();
const sway = createMouseSway();
let bobTime = 0;
let bob = { x: 0, y: 0 };
let landDip = 0;
let camFov = world.fov;
let lastYaw = world.player.yaw;
let lastPitch = world.player.pitch;

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const boxMid = (box, axis) => (box.min[axis] + box.max[axis]) / 2;

// Reload progress for the viewmodel pose and the HUD bar: 0 at rest, 1 as it comes up.
const reloadProgress = (state, def) => (state.reloading ? 1 - state.reloadRemaining / def.reloadTime : 0);

let lastFrame = performance.now();

function frame(now) {
  const dt = (now - lastFrame) / 1000;
  lastFrame = now;
  fps.sample(dt);

  // The session owns the pause, so a menu being up means no step and no events. Inside it,
  // runFrame only reads the input on frames that actually step, so nothing is dropped when
  // the monitor renders faster than the simulation runs.
  const events = session.step(dt);

  for (const event of events) handleEvent(event);

  updateFeel(dt);
  effects.update(dt);
  syncCamera(dt);
  botSync.sync(world, dt);
  syncViewmodel();
  syncHud();

  renderer.render(scene, camera);
}

// Advance the running feel values one rendered frame. Sway reads the radians the view
// moved since the last frame rather than the mouse delta, so it needs neither the look
// gain nor the sensitivity slider that produced the turn.
function updateFeel(dt) {
  const player = world.player;

  sway.update(dt, player.yaw - lastYaw, player.pitch - lastPitch);
  lastYaw = player.yaw;
  lastPitch = player.pitch;

  kick.update(dt);
  landDip *= Math.exp(-CONFIG.FEEL.landDipRecover * dt);
  if (landDip < 1e-4) landDip = 0;

  bobTime += dt;
  // Airborne has no footfalls, so no bob: the jump arc is already moving the eye.
  bob = player.onGround
    ? viewBob(bobTime, Math.hypot(player.vel.x, player.vel.z) / CONFIG.MOVEMENT.runSpeed, player.crouching)
    : { x: 0, y: 0 };
}

function syncCamera(dt) {
  const player = world.player;
  const box = player.box;
  // The bob is a view-space offset, so its sideways half goes along the player's right
  // axis (cos yaw, -sin yaw) rather than along world X.
  const side = bob.x * Math.cos(player.yaw);
  const sideZ = bob.x * -Math.sin(player.yaw);
  camera.position.set(boxMid(box, 'x') + side, box.min.y + player.eyeY + bob.y - landDip, boxMid(box, 'z') + sideZ);
  camera.rotation.set(player.pitch + kick.pitch, player.yaw + kick.yaw, 0);

  camFov = scopeFov(camFov, world.fov, dt);
  if (camera.fov !== camFov) {
    camera.fov = camFov;
    camera.updateProjectionMatrix();
  }
}

// Events are moments, so each one is a single call into the HUD, which owns the expiry
// timer that takes it back down. Anything that is a running value — health, ammo, the
// banner — rides the per-frame snapshot in syncHud instead.
function handleEvent(event) {
  switch (event.type) {
    case 'hit':
      hud.showHitmarker({ headshot: event.kind === 'head' });
      break;
    case 'kill':
      hud.showKill({
        killer: 'YOU',
        victim: event.victim,
        weapon: weaponName(event.weapon),
        headshot: event.headshot,
      });
      break;
    case 'playerDamaged':
      hud.showDamageIndicator({ angle: woundBearing(event.sourcePos) });
      break;
    case 'shot':
      // The core has already put the recoil into the aim; this is the punch the screen
      // takes on top of it, and it recovers on its own.
      kick.addKick(CONFIG.FEEL.shotKick[event.weapon] ?? 0, 0);
      break;
    case 'land':
      landDip = landingDip(event.height);
      break;
  }
}

// The kill feed reads "Rifle", not the config key the events carry.
const weaponName = (id) => world.loadout.defs[id]?.name ?? id;

// Bearing of the shooter in the player's own frame. A frame can carry several steps'
// worth of events, so this is the wound as the player is standing now rather than as he
// was when the shot landed — one frame at most, and the arc has no position to correct.
function woundBearing(sourcePos) {
  const box = world.player.box;
  return damageIndicatorAngle(
    { x: boxMid(box, 'x'), y: box.min.y, z: boxMid(box, 'z') },
    world.player.yaw,
    sourcePos,
  );
}

function syncViewmodel() {
  const id = world.loadout.active;
  if (viewmodels.active !== id) viewmodels.setActive(id);

  // The scope overlay covers the whole screen, so the gun itself comes down.
  viewmodels.root.visible = !world.scoped;
  // The root is the gun's rest pose, so the bob and the sway lag go straight onto it —
  // both are already view-space (x right, y up), being children of the camera.
  viewmodels.root.position.set(bob.x + sway.x, bob.y + sway.y, 0);
  viewmodels.setReload(id, reloadProgress(world.loadout.weapons[id], world.loadout.defs[id]));
}

function syncHud() {
  const id = world.loadout.active;
  const def = world.loadout.defs[id];
  const state = world.loadout.weapons[id];

  hud.update({
    health: world.player.health,
    weaponName: def.name,
    mag: state.mag,
    reserve: state.reserve,
    score: world.score,
    // The round clock, not the session clock: it comes back to 0:00 with the refill.
    roundTime: world.round.timer,
    // The ended phase IS the intermission, so the result and its countdown go up together,
    // and a dead player's health keeps the death overlay up until the reset lifts it.
    roundPhase: world.round.phase,
    roundCountdown: world.round.intermissionRemaining,
    fps: fps.fps,
    crosshairRadius: crosshairRadius(world.spread, world.fov, window.innerHeight),
    scoped: world.scoped,
    reloading: state.reloading,
    reloadProgress: reloadProgress(state, def),
  });
}

renderer.setAnimationLoop(frame);
