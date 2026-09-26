import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/gate/test/**/*.test.ts',
      'apps/seller/test/**/*.test.ts',
      'test/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/*.live.test.ts'],
  },
});
