import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Spawning git on Windows runners is slow enough to trip the 5s default.
    testTimeout: 30_000,
    // As CI runs: a test that turns an instant into a date gives the same date on every machine.
    env: { TZ: 'UTC' },
  },
});
