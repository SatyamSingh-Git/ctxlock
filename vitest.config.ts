import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Spawning git on Windows runners is slow enough to trip the 5s default.
    testTimeout: 30_000,
  },
});
