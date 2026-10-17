// Keeps one humanoid model per bot in step with world.bots: created on first sight,
// reused across rounds (the core hands back the same bot objects), toppled and faded from
// the corpse's own age, detached once core flags the corpse removable. Reads world state
// only — the simulation never learns that a model exists.
import { createBotModel, animateBot, setDeathPose, setFade } from './botModel.js';

const FALL_TIME = 0.4; // s from standing to flat, so the fade keeps the rest of the lifetime
const STRIDE = 6; // rad of walk cycle per metre travelled

export function createBotSync(scene) {
  const entries = new Map(); // botId -> { model, phase, dead }

  function sync(world, dt) {
    const cfg = world.config;
    const lifetime = cfg.ROUNDS.corpseLifetime;
    const fadeTime = cfg.BOTS.corpseFadeTime;
    const kept = new Set();

    for (const bot of world.bots) {
      // A removable corpse — like a bot that has dropped out of world.bots — has no model.
      if (bot.removable) continue;
      kept.add(bot.id);

      let entry = entries.get(bot.id);
      if (!entry) {
        entry = { model: createBotModel(), phase: 0, dead: false };
        scene.add(entry.model);
        entries.set(bot.id, entry);
      }
      const { model } = entry;

      // Root at the feet, yaw 0 toward -Z: the same conventions core/bots.js uses.
      model.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
      model.rotation.y = bot.yaw;

      if (bot.alive) {
        if (entry.dead) {
          // A new round: the corpse from the last one stands back up.
          setDeathPose(model, 0);
          setFade(model, 1);
          entry.phase = 0;
          entry.dead = false;
        }
        const speed = Math.hypot(bot.vel.x, bot.vel.z);
        entry.phase += speed * dt * STRIDE;
        animateBot(model, { speed, phase: entry.phase });
      } else {
        entry.dead = true;
        const age = Math.max(0, world.time - (bot.deathTime ?? world.time));
        setDeathPose(model, age / FALL_TIME);
        // Alpha runs 1 -> 0 across the last corpseFadeTime seconds of the lifetime.
        setFade(model, (lifetime - age) / fadeTime);
      }
    }

    for (const id of entries.keys()) {
      if (kept.has(id)) continue;
      scene.remove(entries.get(id).model);
      entries.delete(id);
    }

    return entries.size;
  }

  return { sync, get: (id) => entries.get(id)?.model ?? null };
}
