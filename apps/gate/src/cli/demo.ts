/**
 * Live demo runner (M-004/M-005): `LIVE=1 tsx --env-file=.env apps/gate/src/cli/demo.ts pass|block|v2`.
 * Starts the local seller in-process (127.0.0.1 only), screens the selected payTo with the LIVE Intercepta API,
 * decides under the active policy, and only an approved attempt reaches the protected signer. Prints the OPERATIONAL_
 * GUARDRAILS section 4 banner first and aborts if a limit would be exceeded. Never prints secrets.
 * (`v2` here is the single ALT scenario under whichever policy is active; the full Layer 4 loop is `demo-v2.ts`.)
 */
import { join } from 'node:path';
import { CHAIN } from '../chain.js';
import { SCENARIOS, runBuyerTask, scenarioTask } from '../agent/runner.js';
import type { ScenarioName } from '../agent/runner.js';
import { REPO_ROOT, createLiveWorld, requireLive, summariseResult } from '../live/world.js';
import { formatBanner } from '../live/session.js';
import { payerPublicAddress } from '../signer/public.js';
import { Store } from '../store/store.js';
import { DEMO_ORG_ID, demoPolicyV1, demoProfile } from '@risksir/core';

requireLive();
const name = process.argv[2] as ScenarioName | undefined;
if (!name || !(name in SCENARIOS)) {
  console.error(`usage: demo <${Object.keys(SCENARIOS).join('|')}>`);
  process.exit(1);
}

const store = new Store(join(REPO_ROOT, 'data', 'risksir.db'));
const world = createLiveWorld(store, DEMO_ORG_ID);
if (store.getActivePolicyVersion(DEMO_ORG_ID) === null) {
  store.putPolicy(DEMO_ORG_ID, demoPolicyV1(demoProfile(world.serviceBase)));
  store.setActivePolicy(DEMO_ORG_ID, 1, 'seed-v1', new Date().toISOString());
}

const variant = SCENARIOS[name].path.split('/')[1] as 'safe' | 'risky' | 'alt';
const payTo = world.payTo(variant);
if (!payTo) {
  console.error(`SELLER_PAY_TO for the ${variant} variant is not set`);
  process.exit(1);
}
const amountAtomic = world.priceAtomic(variant);
console.log(formatBanner({ network: CHAIN.network, payerPublicAddress: payerPublicAddress(), payTo, amountAtomic, count: 1, session: world.session.state() }));
const refusal = world.session.check(amountAtomic);
if (name !== 'block' && refusal) {
  console.error(`ABORT: ${refusal}`);
  process.exit(2);
}

const seller = await world.startSeller();
try {
  const result = await runBuyerTask(world.gate, scenarioTask(name, world.serviceBase));
  console.log(JSON.stringify({ scenario: name, ...summariseResult(result) }, null, 2));
} finally {
  await seller.close();
  store.close();
}
