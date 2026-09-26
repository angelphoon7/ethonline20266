import { defineConfig } from 'vitest/config';

/** Live tests only. Reached through `LIVE=1 pnpm test:live` (scripts/live-guard.mjs); never part of `pnpm verify`. */
export default defineConfig({
  test: {
    include: ['apps/**/test/**/*.live.test.ts', 'packages/**/test/**/*.live.test.ts'],
    exclude: ['**/node_modules/**'],
    testTimeout: 120_000,
    fileParallelism: false,
  },
});
