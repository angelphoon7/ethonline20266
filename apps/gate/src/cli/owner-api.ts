/**
 * Starts the owner HTTP API on localhost only (OPERATIONAL_GUARDRAILS section 9). The bearer token comes from
 * OWNER_CONSOLE_TOKEN and is never printed. Run: pnpm owner-api
 * Scenario running and approval resume need the live gate; they are wired with the live demo in M-010, so those two
 * routes answer 501 / `resumed: false` here.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_ORG_ID, DEMO_SERVICE_BASE, demoPolicyV1, demoProfile } from '@risksir/core';
import { createOwnerApi } from '../api/index.js';
import { installInitialPolicy } from '../policy/index.js';
import { Store } from '../store/store.js';

const token = process.env.OWNER_CONSOLE_TOKEN;
if (!token) {
  console.error('OWNER_CONSOLE_TOKEN is not set');
  process.exit(1);
}
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const store = new Store(join(root, 'data', 'risksir.db'));
if (store.getActivePolicyVersion(DEMO_ORG_ID) === null) installInitialPolicy(store, DEMO_ORG_ID, demoPolicyV1(demoProfile(DEMO_SERVICE_BASE)));

const port = Number(process.env.OWNER_PORT ?? 4100);
createOwnerApi({ store, orgId: DEMO_ORG_ID, ownerToken: token }).listen(port, '127.0.0.1', () => {
  console.log(`owner API listening on http://127.0.0.1:${port} (all /api routes require the bearer token)`);
});
