/**
 * Resets the local demo state (M-011): `pnpm demo:reset [--force] [--new-session]`.
 * Moves data/risksir.db to data/backup/, then installs policy v1 and seeds the labelled dataset. No network calls.
 * `--new-session` also clears the live spend and Intercepta call counters: only do that when a human starts a new agent
 * session (OPERATIONAL_GUARDRAILS sections 4 and 5). Stop the owner API and any demo first.
 */
import { join } from 'node:path';
import { DEMO_ORG_ID, DEMO_SERVICE_BASE } from '@risksir/core';
import { ResetRefusedError, resetDemoState } from '../demo/reset.js';
import { REPO_ROOT } from '../live/world.js';

try {
  const r = resetDemoState({
    dataDir: join(REPO_ROOT, 'data'),
    datasetRoot: REPO_ROOT,
    serviceBase: DEMO_SERVICE_BASE,
    orgId: DEMO_ORG_ID,
    force: process.argv.includes('--force'),
    newSession: process.argv.includes('--new-session'),
  });
  console.log(JSON.stringify({ ...r, backedUp: r.backedUp?.slice(REPO_ROOT.length) ?? null }));
} catch (err) {
  if (err instanceof ResetRefusedError) {
    console.error(`reset refused: ${err.message}`);
    process.exit(2);
  }
  throw err;
}
