import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      include: ['src/services/**/*.ts', 'src/discord/**/*.ts'],
      exclude: ['**/*.test.ts', '**/types.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
