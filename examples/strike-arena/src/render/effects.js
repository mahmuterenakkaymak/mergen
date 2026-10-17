// Combat VFX, entirely pooled: muzzle flashes (additive sprite + a short point light),
// impact sparks, bullet tracers and bullet-hole decals. Nothing here reads world state —
// handleEvents() reacts to the per-tick event list and update(dt) ages what it spawned, so
// once the pools are warm a firefight allocates nothing.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

// Presentation-only constants; the tunable lifetimes and caps live in CONFIG.EFFECTS.
const FLASH_OFFSET = 0.45; // m ahead of the eye the flash sits
const FLASH_LIFT = -0.06; // m below the eye, so it reads as a barrel muzzle
const FLASH_SCALE = 0.34; // m
const FLASH_LIGHT_DISTANCE = 9; // m the point light reaches
const MAX_FLASHES = 4; // flashTime is ~3 frames, so 1-2 are live in practice
const TRACER_START = 0.6; // m ahead of the eye a tracer begins (clears the near plane)
const TRACER_MAX = 60; // m cap on tracer length
const SPARK_MIN_SPEED = 1.4; // m/s
const SPARK_MAX_SPEED = 4.6; // m/s
const SPARK_SIZE = 0.035; // m
const SPARK_GRAVITY = 16; // m/s^2 — lighter than MOVEMENT.gravity so sparks arc
const DECAL_LIFT = 0.004; // m off the wall face, so the quad does not z-fight with it
const DECAL_ROLL = 0.7; // rad of roll added per decal, so holes are not identical

// Soft radial glow for the flash, drawn once into a canvas (no image assets). Null where
// there is no canvas — under node the sprite falls back to a flat additive quad.
function createGlowTexture() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,222,158,0.7)');
  grad.addColorStop(1, 'rgba(255,170,70,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

// Free slot first, then grow to the cap, then recycle whatever is oldest — a burst that
// outruns its pool drops the effect rather than the frame budget.
function takeSlot(pool, cap, make) {
  for (const entry of pool) if (!entry.active) return entry;
  if (pool.length < cap) {
    const entry = make();
    pool.push(entry);
    return entry;
  }
  let oldest = pool[0];
  for (const entry of pool) if (entry.age > oldest.age) oldest = entry;
  return oldest;
}

export function createEffects(scene) {
  const E = CONFIG.EFFECTS;
  const glow = createGlowTexture();

  const root = new THREE.Group();
  root.name = 'effects';
  scene.add(root);

  // ---- muzzle flashes: pooled sprite + point light, hidden as one object ----

  const flashes = [];
  let flashSpin = 0;

  function makeFlash() {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glow,
        color: 0xffd9a3,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    sprite.scale.setScalar(FLASH_SCALE);
    const obj = new THREE.Group();
    obj.add(sprite, new THREE.PointLight(0xffc178, 0, FLASH_LIGHT_DISTANCE));
    obj.visible = false;
    root.add(obj);
    return { obj, sprite, light: obj.children[1], age: 0, active: false };
  }

  function setFlash(entry, k) {
    entry.sprite.material.opacity = k;
    // An invisible object is skipped entirely, so intensity 0 is the belt to that brace.
    entry.light.intensity = E.flashLightPower * k;
  }

  function spawnFlash(origin, dir) {
    const entry = takeSlot(flashes, MAX_FLASHES, makeFlash);
    entry.obj.position.set(
      origin.x + dir.x * FLASH_OFFSET,
      origin.y + dir.y * FLASH_OFFSET + FLASH_LIFT,
      origin.z + dir.z * FLASH_OFFSET,
    );
    entry.sprite.material.rotation = (flashSpin += DECAL_ROLL) % Math.PI;
    entry.age = 0;
    entry.active = true;
    entry.obj.visible = true;
    setFlash(entry, 1);
  }

  function tickFlash(entry, dt) {
    entry.age += dt;
    const k = 1 - entry.age / E.flashTime;
    if (k <= 0) {
      entry.active = false;
      entry.obj.visible = false;
      setFlash(entry, 0);
      return;
    }
    setFlash(entry, k);
  }

  // ---- impact sparks: one Points cloud, alive slots packed at the front of the buffer ----

  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(E.maxSparks * 3), 3));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(E.maxSparks * 3), 3));
  const sparkPoints = new THREE.Points(
    sparkGeo,
    new THREE.PointsMaterial({
      size: SPARK_SIZE,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  // The buffer is a pool, not a shape — its bounds say nothing about where sparks are.
  sparkPoints.frustumCulled = false;
  root.add(sparkPoints);

  const sparkSlots = Array.from({ length: E.maxSparks }, () => ({
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    age: 0,
    alive: false,
  }));
  let sparkCursor = 0;
  const sparkColor = new THREE.Color(0xffc46a);

  // Random direction, pushed along the surface normal so sparks spray away from the wall.
  function burstVelocity(normal, speed) {
    const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
    if (v.lengthSq() < 1e-6) v.set(0, 1, 0);
    v.normalize();
    if (normal) {
      if (v.dot(normal) < 0) v.negate();
      v.add(normal).normalize();
    }
    return v.multiplyScalar(speed);
  }

  function emitSparks(point, normal) {
    for (let i = 0; i < E.sparkCount; i++) {
      // The cursor wraps onto the oldest sparks, which is what holds the pool to its cap.
      const slot = sparkSlots[sparkCursor];
      sparkCursor = (sparkCursor + 1) % sparkSlots.length;
      const v = burstVelocity(normal, SPARK_MIN_SPEED + Math.random() * (SPARK_MAX_SPEED - SPARK_MIN_SPEED));
      slot.x = point.x;
      slot.y = point.y;
      slot.z = point.z;
      slot.vx = v.x;
      slot.vy = v.y;
      slot.vz = v.z;
      slot.age = 0;
      slot.alive = true;
    }
  }

  function updateSparks(dt) {
    const pos = sparkGeo.attributes.position.array;
    const col = sparkGeo.attributes.color.array;
    let n = 0;
    for (const s of sparkSlots) {
      if (!s.alive) continue;
      s.age += dt;
      if (s.age >= E.sparkLife) {
        s.alive = false;
        continue;
      }
      s.vy -= SPARK_GRAVITY * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      // Additive blending, so dimming the colour is the fade.
      const k = 1 - s.age / E.sparkLife;
      const i = n * 3;
      pos[i] = s.x;
      pos[i + 1] = s.y;
      pos[i + 2] = s.z;
      col[i] = sparkColor.r * k;
      col[i + 1] = sparkColor.g * k;
      col[i + 2] = sparkColor.b * k;
      n++;
    }
    sparkGeo.setDrawRange(0, n);
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.color.needsUpdate = true;
  }

  // ---- tracers: pooled 2-point lines that fade out over tracerLife ----

  const tracers = [];
  let lastTracer = null;

  function makeTracer() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({
        color: 0xffd08a,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    line.frustumCulled = false;
    line.visible = false;
    root.add(line);
    return { line, age: 0, active: false, sx: 0, sy: 0, sz: 0, dx: 0, dy: 0, dz: -1 };
  }

  function setTracerEnd(entry, x, y, z) {
    const a = entry.line.geometry.attributes.position.array;
    a[0] = entry.sx;
    a[1] = entry.sy;
    a[2] = entry.sz;
    a[3] = x;
    a[4] = y;
    a[5] = z;
    entry.line.geometry.attributes.position.needsUpdate = true;
  }

  function hideTracer(entry) {
    entry.active = false;
    entry.line.visible = false;
    if (lastTracer === entry) lastTracer = null;
  }

  function spawnTracer(origin, dir, range) {
    const entry = takeSlot(tracers, E.maxTracers, makeTracer);
    const start = Math.min(TRACER_START, range);
    const end = Math.min(range, TRACER_MAX);
    entry.sx = origin.x + dir.x * start;
    entry.sy = origin.y + dir.y * start;
    entry.sz = origin.z + dir.z * start;
    entry.dx = dir.x;
    entry.dy = dir.y;
    entry.dz = dir.z;
    setTracerEnd(entry, origin.x + dir.x * end, origin.y + dir.y * end, origin.z + dir.z * end);
    entry.age = 0;
    entry.active = true;
    entry.line.visible = true;
    entry.line.material.opacity = 1;
    lastTracer = entry;
  }

  // A tracer that hit something stops there instead of flying through the wall behind it.
  function shortenTracer(point) {
    const entry = lastTracer;
    if (!entry || !entry.active) return;
    const len = (point.x - entry.sx) * entry.dx + (point.y - entry.sy) * entry.dy + (point.z - entry.sz) * entry.dz;
    if (len <= 0) hideTracer(entry);
    else setTracerEnd(entry, entry.sx + entry.dx * len, entry.sy + entry.dy * len, entry.sz + entry.dz * len);
    lastTracer = null;
  }

  function tickTracer(entry, dt) {
    entry.age += dt;
    const k = 1 - entry.age / E.tracerLife;
    if (k <= 0) {
      hideTracer(entry);
      return;
    }
    entry.line.material.opacity = k;
  }

  // ---- bullet holes: one shared quad, reused through a ring buffer ----

  const decalGeo = new THREE.PlaneGeometry(E.decalSize, E.decalSize);
  const decalMat = new THREE.MeshBasicMaterial({
    color: 0x0b0b0c,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const decals = new Array(E.maxDecals).fill(null);
  let decalCursor = 0;
  let decalRoll = 0;

  function spawnDecal(point, normal) {
    let entry = decals[decalCursor];
    if (!entry) {
      const mesh = new THREE.Mesh(decalGeo, decalMat);
      root.add(mesh);
      entry = { mesh };
      decals[decalCursor] = entry;
    }
    entry.mesh.position.set(
      point.x + normal.x * DECAL_LIFT,
      point.y + normal.y * DECAL_LIFT,
      point.z + normal.z * DECAL_LIFT,
    );
    // PlaneGeometry faces +Z, so looking up the normal lays the quad on the surface.
    entry.mesh.lookAt(entry.mesh.position.x + normal.x, entry.mesh.position.y + normal.y, entry.mesh.position.z + normal.z);
    entry.mesh.rotateZ((decalRoll += DECAL_ROLL) % (Math.PI * 2));
    decalCursor = (decalCursor + 1) % decals.length;
  }

  // ---- events / frame ----

  const weaponRange = (id) => CONFIG.WEAPONS[id]?.range ?? TRACER_MAX;

  function handleEvents(events) {
    if (!events) return;
    for (const ev of events) {
      switch (ev.type) {
        case 'shot':
        case 'botShot':
          spawnFlash(ev.origin, ev.dir);
          spawnTracer(ev.origin, ev.dir, weaponRange(ev.weapon));
          // A bot's hitscan is already resolved in the core, so its tracer ends where the
          // round did. The player's own shot is shortened instead by the wallImpact or
          // hit event that follows it through this same loop.
          if (ev.end) {
            shortenTracer(ev.end);
            if (ev.endNormal) {
              emitSparks(ev.end, ev.endNormal);
              spawnDecal(ev.end, ev.endNormal);
            }
          }
          break;
        case 'wallImpact':
          emitSparks(ev.point, ev.normal);
          spawnDecal(ev.point, ev.normal);
          shortenTracer(ev.point);
          break;
        case 'hit':
          // A body hit sprays sparks but leaves no hole, and it ends the tracer too.
          emitSparks(ev.point, null);
          shortenTracer(ev.point);
          break;
        default:
          break;
      }
    }
  }

  function update(dt) {
    for (const entry of flashes) if (entry.active) tickFlash(entry, dt);
    for (const entry of tracers) if (entry.active) tickTracer(entry, dt);
    updateSparks(dt);
  }

  function stats() {
    let sparks = 0;
    for (const s of sparkSlots) if (s.alive) sparks++;
    return {
      flashes: flashes.reduce((n, f) => n + (f.active ? 1 : 0), 0),
      tracers: tracers.reduce((n, t) => n + (t.active ? 1 : 0), 0),
      sparks,
      decals: decals.filter(Boolean).length,
    };
  }

  // Pool internals for tests and wiring; the game loop never reads them.
  const debug = { flashes, tracers, sparks: sparkSlots, decals, sparkPoints };

  return { root, handleEvents, update, stats, debug };
}
