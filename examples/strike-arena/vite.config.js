import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node', // DOM tests opt in with `// @vitest-environment jsdom`
    passWithNoTests: true,
  },
});
