import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';

// God mode is a playtest switch: off by default, and validateConfig must still accept the config.
describe('PLAYER.godMode', () => {
  it('is off by default', () => {
    expect(CONFIG.PLAYER.godMode).toBe(false);
  });
});
