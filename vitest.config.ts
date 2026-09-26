import { defineConfig } from 'vitest/config';

export default defineConfig({
  // JSX for the console tests (component tests opt into jsdom with a `@vitest-environment jsdom` docblock).
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/gate/test/**/*.test.ts',
      'apps/seller/test/**/*.test.ts',
      'apps/console/test/**/*.test.{ts,tsx}',
      'test/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/*.live.test.ts'],
  },
});
