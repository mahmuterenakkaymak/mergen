import { describe, it, expect } from 'vitest';

// main.js is wiring: it touches WebGL, the DOM and RAF, none of which exist in Node.
// The contract we can check headlessly is that importing it is side-effect-free (no
// top-level document/window access, every import resolves) and that boot is exported.
describe('main.js wiring', () => {
  it('imports in Node without touching the DOM and exports boot', async () => {
    expect(typeof document).toBe('undefined');
    const m = await import('../src/main.js');
    expect(typeof m.boot).toBe('function');
  });
});
