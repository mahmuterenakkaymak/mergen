// Minimap: pure world→map transform (testable in Node) + a canvas panel that paints
// the town once onto a static layer and redraws only the live dots and arrow per frame.
import { CONFIG } from '../config.js';

const MAP_SIZE = 168; // panel side (css px)
const MAP_PAD = 10;   // keeps map content clear of the rounded panel edge
const CORNER = 16;    // panel corner radius (css px)

const css = (hex) => '#' + hex.toString(16).padStart(6, '0');

// Maps world x,z into a size×size panel, the bounds centred and inset by pad.
// World +z grows down the panel, so north (−z) is up.
export function worldToMap(bounds, size = MAP_SIZE, pad = MAP_PAD) {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxZ - bounds.minZ;
  const scale = (size - pad * 2) / Math.max(w, h);
  const offX = pad + (size - pad * 2 - w * scale) / 2;
  const offZ = pad + (size - pad * 2 - h * scale) / 2;
  return {
    scale,
    toMap(x, z) {
      return { x: offX + (x - bounds.minX) * scale, y: offZ + (z - bounds.minZ) * scale };
    },
  };
}

// Canvas rotation for the player arrow. The arrow is drawn pointing along local +y,
// i.e. world +z (heading 0), and +z maps to +y, so the rotation is −heading.
export function arrowAngle(heading) {
  return -heading;
}

// Town once, on its own canvas: roads as the grid lines, then parks, ponds, buildings.
function drawStaticLayer(doc, town, map, size, dpr) {
  const c = doc.createElement('canvas');
  c.width = c.height = Math.round(size * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);

  const b = town.bounds;
  g.strokeStyle = '#98a2b3';
  g.lineWidth = CONFIG.road * map.scale;
  g.beginPath();
  for (const r of town.roads) {
    const v = map.toMap(r, b.minZ);
    const e = map.toMap(r, b.maxZ);
    g.moveTo(v.x, v.y);
    g.lineTo(e.x, e.y);
    const h0 = map.toMap(b.minX, r);
    const h1 = map.toMap(b.maxX, r);
    g.moveTo(h0.x, h0.y);
    g.lineTo(h1.x, h1.y);
  }
  g.stroke();

  for (const bl of town.blocks) {
    if (!bl.park) continue;
    const p = map.toMap(bl.x, bl.z);
    g.fillStyle = css(CONFIG.colors.lawn);
    g.fillRect(p.x, p.y, bl.w * map.scale, bl.h * map.scale);
  }
  g.fillStyle = css(CONFIG.colors.pond);
  for (const p of town.ponds) {
    const m = map.toMap(p.x, p.z);
    g.beginPath();
    g.arc(m.x, m.y, p.r * map.scale, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#6b7686';
  for (const bl of town.buildings) {
    const m = map.toMap(bl.x, bl.z);
    g.fillRect(m.x, m.y, bl.w * map.scale, bl.d * map.scale);
  }
  return c;
}

export function createMinimap(doc, town) {
  const size = MAP_SIZE;
  const map = worldToMap(town.bounds, size, MAP_PAD);
  const dpr = Math.min(doc.defaultView?.devicePixelRatio || 1, 2);

  const canvas = doc.createElement('canvas');
  canvas.id = 'minimap';
  canvas.className = 'hud';
  canvas.width = canvas.height = Math.round(size * dpr);
  canvas.style.width = canvas.style.height = `${size}px`;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);

  const staticLayer = drawStaticLayer(doc, town, map, size, dpr);

  return {
    el: canvas,
    update(world) {
      g.clearRect(0, 0, size, size);
      g.beginPath();
      g.roundRect(1, 1, size - 2, size - 2, CORNER);
      g.fillStyle = 'rgba(11, 18, 30, 0.62)';
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      g.stroke();
      g.drawImage(staticLayer, 0, 0, size, size);

      for (const p of world.peds) {
        const m = map.toMap(p.x, p.z);
        g.fillStyle = css(p.color);
        g.beginPath();
        g.arc(m.x, m.y, 1.6, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#e5484d';
      for (const t of world.traffic) {
        const m = map.toMap(t.x, t.z);
        g.beginPath();
        g.arc(m.x, m.y, 2.6, 0, Math.PI * 2);
        g.fill();
      }

      const c = map.toMap(world.car.x, world.car.z);
      g.save();
      g.translate(c.x, c.y);
      g.rotate(arrowAngle(world.car.heading));
      g.beginPath();
      g.moveTo(0, 7.5);
      g.lineTo(-5, -5.5);
      g.lineTo(0, -2.5);
      g.lineTo(5, -5.5);
      g.closePath();
      g.fillStyle = '#ffffff';
      g.lineWidth = 1.2;
      g.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      g.fill();
      g.stroke();
      g.restore();
    },
  };
}
