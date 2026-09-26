/**
 * The one failure demo (M-011): an Intercepta TIMEOUT produces HOLD with zero signer calls. `pnpm demo:failure`.
 * The timeout is SIMULATED (a fetch that times out, evidence provenance `synthetic`, no live call, no spend, no payment);
 * a real timeout was observed live once (fixtures/intercepta/recorded/2026-09-26T15-45-44-474Z_*). Say so when showing it.
 */
import { join } from 'node:path';
import { DEMO_ORG_ID, DEMO_SERVICE_BASE, demoPolicyV1, demoProfile } from '@risksir/core';
import { scenarioTask } from '../agent/runner.js';
import { QUICK_SCAN_MAPPING_VERSION, quickScanMapper, screenAddress } from '../intercepta/index.js';
import { REPO_ROOT, summariseResult } from '../live/world.js';
import { installInitialPolicy } from '../policy/index.js';
import { createProtectedSigner } from '../signer/public.js';
import { Store } from '../store/store.js';
import { createGate } from '../x402/gate.js';
import { createSellerApp, routesFromEnv } from '@risksir/seller';

const store = new Store(join(REPO_ROOT, 'data', 'risksir.db'));
if (store.getActivePolicyVersion(DEMO_ORG_ID) === null) installInitialPolicy(store, DEMO_ORG_ID, demoPolicyV1(demoProfile(DEMO_SERVICE_BASE)));

const timingOut = (async () => {
  throw new DOMException('simulated Intercepta timeout', 'TimeoutError');
}) as unknown as typeof fetch;

const gate = createGate({
  orgId: DEMO_ORG_ID,
  store,
  signer: createProtectedSigner({ store, now: () => new Date() }),
  log: (line) => console.log(line),
  screen: (address) =>
    screenAddress(address, { baseUrl: 'https://simulated.invalid', apiKey: 'simulated', mapper: quickScanMapper, provenance: 'synthetic', mappingVersion: QUICK_SCAN_MAPPING_VERSION, fetchImpl: timingOut }),
});

const port = Number(process.env.SELLER_PORT ?? 4021);
const server = createSellerApp({ facilitatorUrl: process.env.X402_FACILITATOR_URL ?? 'https://x402.org/facilitator', routes: routesFromEnv(process.env) }).listen(port, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
try {
  const result = await gate.run(scenarioTask('pass', `http://127.0.0.1:${port}/paid/`));
  console.log('SIMULATED Intercepta timeout (provenance: synthetic; nothing live, nothing paid):');
  console.log(JSON.stringify(summariseResult(result), null, 2));
  if (result.attempt.signerCalls !== 0 || result.decision?.action !== 'HOLD') {
    console.error('UNEXPECTED: an unavailable screen must give HOLD with zero signer calls');
    process.exitCode = 2;
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  store.close();
}
