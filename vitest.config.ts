import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Hooks that talk to the OS scheduler (uninstall) can take ~12s per call on Windows; the 10s default is too tight.
    hookTimeout: 120_000,
  },
});
