// `pnpm test:live` entry point. Live tests spend Intercepta calls and testnet funds,
// so they never run by accident (OPERATIONAL_GUARDRAILS section 4-5, TEST_PLAN section 2).
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

if (process.env.LIVE !== '1') {
  console.error('test:live refused: set LIVE=1 to run live checks (limits: OPERATIONAL_GUARDRAILS section 4-5).');
  process.exit(1);
}

const vitestBin = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const extra = process.argv.slice(2).filter((a) => a !== '--');
const result = spawnSync(process.execPath, [vitestBin, 'run', '--config', 'vitest.live.config.ts', ...extra], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(result.status ?? 1);
