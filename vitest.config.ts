import { defineConfig } from 'vitest/config';

export default defineConfig({
  // JSX for the console tests (component tests opt into jsdom with a `@vitest-environment jsdom` docblock).
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    // a cold checkout runs many workers at once: the first jsdom render was measured at 7.2 s (default limit 5 s)
    testTimeout: 20_000,
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/gate/test/**/*.test.ts',
      'apps/seller/test/**/*.test.ts',
      'apps/console/test/**/*.test.{ts,tsx}',
      'apps/site/test/**/*.test.{ts,tsx}',
      'test/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/*.live.test.ts'],
  },
});
