// Entry point: wiring only. Builds the renderer/scene/views, then runs one RAF loop
// that reads input, steps the pure sim and pushes world state into the views. No logic
// here worth testing — the sim, camera, HUD and audio are each covered by their own module.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createGame, stepGame, stepAmbient, setPaused } from './game.js';
import { swoopPose, SWOOP_SECONDS, chaseTarget } from './camera.js';
import { createInputState, toControls, attachInput, takeOrbit, takeZoom, endFrame } from './input.js';
import { createScene, followSun } from './render/scene.js';
import { buildCarMesh, updateCarMesh, setLamps } from './render/carMesh.js';
import { buildTownMeshes } from './render/townMeshes.js';
import { buildPedMesh, updatePedMesh, buildTrafficPool, updateTrafficPool } from './render/actorMeshes.js';
import { facadeSpec, makeFacadeTexture, makeStripeTexture } from './render/textures.js';
import { buildFxView, syncParticles, syncSkids } from './fx/fxView.js';
import { puffSmoke } from './fx/particles.js';
import { createRng } from './util/rng.js';
import { createHud, createToastQueue, createVignette, eventsToHud, createTopSpeed, createHint } from './hud/hud.js';
import { createMinimap } from './hud/minimap.js';
import { toKmh, gearLetter, tweenNumber } from './hud/format.js';
import { createAudio } from './audio/audio.js';
import { engineParams, squealLevel } from './audio/engineModel.js';
import { createStartScreen, attractPose } from './ui/startScreen.js';

const MAX_DT = 0.05; // a frame hitch may not jump the visuals further than a slow frame
const HOOD = 1.5; // m ahead of the car centre the bonnet sits — where the smoke leaves
const HOOD_Y = 0.9; // m
const SMOKE_EVERY = 0.08; // s between puffs: one per frame would fill the pool in under a second

// carMesh reads damage off the car it shows (its ASSUMPTION); the sim keeps it in
// world.damage. One reused view object, like actorMeshes.js does for the AI cars.
const VIEW = {};

// The town grid starts at the origin, so its middle is the bounds midpoint rather
// than {0, 0}, which is a corner of it.
export function townCentre(town) {
  const b = town.bounds;
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
}

// One facade texture per palette colour, painted from a seeded spec so the same seed
// lights the same windows. Both makers return null without a document, which leaves
// the buildings on their flat palette colour and the wall on plain red.
function buildTextures(seed) {
  const rng = createRng(seed).fork('facades');
  return {
    facades: CONFIG.palette.map((base) => makeFacadeTexture(facadeSpec(rng, base))),
    stripe: makeStripeTexture(),
  };
}

export function boot(root = document.getElementById('game')) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  root.appendChild(renderer.domElement);

  const { scene } = createScene();
  const camera = new THREE.PerspectiveCamera(
    CONFIG.cam.fov, window.innerWidth / window.innerHeight, 0.1, 2000
  );

  const world = createGame();
  const carMesh = buildCarMesh();
  scene.add(carMesh.g);
  scene.add(buildTownMeshes(world.town, buildTextures(CONFIG.seed)).g);

  const trafficView = buildTrafficPool(world.traffic);
  scene.add(trafficView.g);
  const pedGroup = new THREE.Group();
  const pedViews = world.peds.map((p) => {
    const m = buildPedMesh(p.color);
    pedGroup.add(m.g);
    return m;
  });
  scene.add(pedGroup);
  const fxView = buildFxView(world.particles, world.skids);
  scene.add(fxView.g);

  const hud = createHud(document);
  const minimap = createMinimap(document, world.town);
  document.body.appendChild(minimap.el);
  const audio = createAudio();
  const toasts = createToastQueue();
  const vignette = createVignette();
  const topSpeed = createTopSpeed();
  const hint = createHint();

  const input = createInputState();
  attachInput(window, input);

  let running = false;
  let swoopT = -1; // s into the start swoop; -1 once the chase pose has the camera back
  let speedShown = 0;
  let simTime = 0; // monotonic seconds, for the HUD's throttled watchOut toast
  let lastWatchOut = -Infinity;
  let smokeT = 0;
  createStartScreen(document, {
    seed: CONFIG.seed,
    onStart: () => {
      document.body.classList.add('playing'); // reveals the HUD, which the CSS keeps hidden until then
      setLamps(carMesh, false); // the player has the wheel now: the tail goes back to meaning brakes
      audio.start(); // the start click is the gesture WebAudio needs
      audio.ignition(); // the starter turns over, then the engine settles to idle
      swoopT = 0; // the view starts coming down from the attract orbit
      running = true;
    },
  });

  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  let last = performance.now();

  // Pause: Esc or a window blur stops the session dead — the sim holds (game.js), WebAudio
  // is suspended so nothing hums behind the tab, and the dim asks for the click back.
  // ASSUMPTION: only the running game pauses; the attract orbit behind the start screen is
  // not a session the player could lose.
  const pause = (on) => {
    if (!running || world.paused === on) return;
    setPaused(world, on);
    hud.setPaused(on);
    if (on) {
      audio.suspend();
    } else {
      audio.resume();
      last = performance.now(); // the clock restarts here, so the first frame back is a normal one
    }
  };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') pause(true);
    else if (e.code === 'F1') hint.show(); // the faded hint strip comes back for another stretch
  });
  window.addEventListener('blur', () => pause(true));
  hud.pauseEl.addEventListener('click', () => pause(false));

  let attractT = 0;
  // Orbit the spawn, not the map's middle: the car spawns ~29 m off-centre, and the
  // attract orbit is the player's first look at the car they will drive.
  const attractAt = { x: world.town.spawn.x, z: world.town.spawn.z };

  function frame(now) {
    const dt = Math.min((now - last) / 1000, MAX_DT);
    last = now;

    const orbit = takeOrbit(input); // drained every frame so a pre-start drag never jumps the cam
    const zoom = takeZoom(input);

    // Frozen: nothing steps, but the frame still paints (the canvas is not kept between
    // paints) and still drains the orbit and the wheel, so a drag made during the pause
    // never lands on the first frame back.
    if (world.paused) {
      endFrame(input);
      renderer.render(scene, camera);
      requestAnimationFrame(frame);
      return;
    }

    // Every frame, so the town is already lit and shadowed behind the start screen.
    followSun(scene, world.car);

    if (running) {
      const controls = toControls(input);
      controls.horn = input.keys.has('KeyH') ? 1 : 0;
      controls.reset = input.keys.has('KeyR') ? 1 : 0; // the sim takes the edge from the level
      controls.orbit = orbit;
      controls.zoom = zoom;
      stepGame(world, controls, dt);
      simTime += dt;

      // Bonnet smoke while the engine cooks, on a timer rather than per frame.
      smokeT = world.damage.smoking ? smokeT + dt : 0;
      if (smokeT >= SMOKE_EVERY) {
        smokeT = 0;
        const h = world.car.heading;
        puffSmoke(world.particles, world.fxRng,
          world.car.x + Math.sin(h) * HOOD, HOOD_Y, world.car.z + Math.cos(h) * HOOD);
      }

      updateCarMesh(carMesh, Object.assign(VIEW, world.car, { damage: world.damage.damage }), dt);

      // Cinematic start: the view comes down from the attract orbit to the chase pose while
      // the overlay fades, and GO! lands with the camera.
      let view = world.pose;
      let aim = chaseTarget(world);
      if (swoopT >= 0) {
        swoopT += dt;
        if (swoopT < SWOOP_SECONDS) {
          view = swoopPose(swoopT / SWOOP_SECONDS, attractPose(attractT, attractAt),
            world.cam, aim, world.town.buildings);
          aim = view.lookAt;
        } else {
          swoopT = -1; // world.pose holds the same pose by now, so the hand-back shows no seam
          toasts.show('GO!');
        }
      }
      camera.position.set(view.x, view.y, view.z);
      camera.lookAt(aim.x, aim.y, aim.z);
      camera.fov = world.cam.fov;
      camera.updateProjectionMatrix();

      speedShown = tweenNumber(speedShown, toKmh(world.car.speed), dt);
      const kmh = Math.round(speedShown);
      hud.setSpeed(kmh, gearLetter(world.car.speed, controls.brake));
      topSpeed.update(kmh, dt);
      hud.setTop(topSpeed.value, topSpeed.record);
      hint.step(dt); // runs only while the session runs, so a pause does not eat the strip
      hud.setHint(hint.visible);
      hud.setDamage(world.damage.damage);

      const fx = eventsToHud(world.events, simTime, lastWatchOut);
      lastWatchOut = fx.lastWatchOut;
      vignette.flash(fx.vignette);
      for (const msg of fx.toasts) toasts.show(msg);
      vignette.step(dt);
      toasts.step(dt);
      hud.setVignette(vignette.amount);
      hud.setToast(toasts.text, toasts.visible);
      hud.setFade(world.fade); // the rescue's fade to black and back

      audio.setEngine(engineParams(
        Math.abs(world.car.speed) / CONFIG.car.maxSpeed,
        controls.throttle,
        squealLevel(world.car.slip, world.car.skidding),
      ));
      for (const e of world.events) {
        if (e.type === 'horn') audio.horn(1);
        else if (e.type === 'hornBack') audio.horn(e.pitch);
        else if (e.type === 'impact' || e.type === 'thud') audio.thud(e.speed);
      }
    } else {
      stepAmbient(world, dt); // the town is already alive behind the start screen
      // The parked car has to be *at* the spawn for the orbit to frame it: the mesh is
      // built at the origin and only the playing branch used to place it.
      updateCarMesh(carMesh, world.car, dt);
      setLamps(carMesh, true); // parked, not dead: the car lights its own lamps for the dusk shot
      attractT += dt;
      const p = attractPose(attractT, attractAt);
      camera.position.set(p.x, p.y, p.z);
      camera.lookAt(p.lookAt.x, p.lookAt.y, p.lookAt.z);
    }

    // Actors, FX and the minimap track the sim every frame, so the town is already
    // populated behind the start screen instead of popping in on the first click.
    updateTrafficPool(trafficView, world.traffic, dt);
    for (let i = 0; i < pedViews.length; i++) updatePedMesh(pedViews[i], world.peds[i]);
    syncParticles(fxView, world.particles);
    syncSkids(fxView, world.skids);
    minimap.update(world);

    endFrame(input);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

if (typeof document !== 'undefined') boot();
