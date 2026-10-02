import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/**/src/**/*.test.ts', 'packages/**/src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    environment: 'node',
    restoreMocks: true,
    clearMocks: true,
  },
});
