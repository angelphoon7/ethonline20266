/**
 * Live demo runner (M-004/M-005): `LIVE=1 tsx --env-file=.env apps/gate/src/cli/demo.ts pass|block`.
 * Starts the local seller in-process (127.0.0.1 only), screens the selected payTo with the LIVE Intercepta API,
 * decides under the active policy, and only an approved attempt reaches the protected signer. Prints the OPERATIONAL_
 * GUARDRAILS section 4 banner first and aborts if a limit would be exceeded. Never prints secrets.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAIN } from '../chain.js';
import { SCENARIOS, runBuyerTask, scenarioTask } from '../agent/runner.js';
import type { ScenarioName } from '../agent/runner.js';
import { FileBudget, QUICK_SCAN_MAPPING_VERSION, quickScanMapper, screenAddress, writeRecordedResponse } from '../intercepta/index.js';
import { LiveSession, formatBanner } from '../live/session.js';
import { createProtectedSigner, payerPublicAddress } from '../signer/public.js';
import { Store } from '../store/store.js';
import { createGate } from '../x402/gate.js';
import { DEMO_ORG_ID, demoPolicyV1, demoProfile, usdcStringToAtomic } from '@risksir/core';
import { createSellerApp, routesFromEnv } from '@risksir/seller';

if (process.env.LIVE !== '1') {
  console.error('demo refused: set LIVE=1 (live Intercepta calls and testnet payments, see OPERATIONAL_GUARDRAILS).');
  process.exit(1);
}
const name = process.argv[2] as ScenarioName | undefined;
if (!name || !(name in SCENARIOS)) {
  console.error(`usage: demo <${Object.keys(SCENARIOS).join('|')}>`);
  process.exit(1);
}

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const dataDir = join(root, 'data');
mkdirSync(dataDir, { recursive: true });
const recordedDir = join(root, 'fixtures', 'intercepta', 'recorded');

const port = Number(process.env.SELLER_PORT ?? 4021);
const serviceBase = `http://127.0.0.1:${port}/paid/`;
const routes = routesFromEnv(process.env);
const variant = SCENARIOS[name].path.split('/')[1] as 'safe' | 'risky' | 'alt';
const route = routes.find((r) => r.variant === variant);
if (!route) {
  console.error(`SELLER_PAY_TO for the ${variant} variant is not set`);
  process.exit(1);
}
const amountAtomic = usdcStringToAtomic(route.price.replace('$', ''));

const store = new Store(join(dataDir, 'risksir.db'));
if (store.getActivePolicyVersion(DEMO_ORG_ID) === null) {
  store.putPolicy(DEMO_ORG_ID, demoPolicyV1(demoProfile(serviceBase)));
  store.setActivePolicy(DEMO_ORG_ID, 1, 'seed-v1', new Date().toISOString());
}

const session = new LiveSession(join(dataDir, 'live-session.json'));
const payer = payerPublicAddress();
console.log(formatBanner({ network: CHAIN.network, payerPublicAddress: payer, payTo: route.payTo, amountAtomic, count: 1, session: session.state() }));
const refusal = session.check(amountAtomic);
if (name !== 'block' && refusal) {
  console.error(`ABORT: ${refusal}`);
  process.exit(2);
}

const budget = new FileBudget(join(dataDir, 'intercepta-calls.json'));
const signer = createProtectedSigner({
  store,
  now: () => new Date(),
  extraCheck: ({ amountAtomic: a }) => session.check(a),
  onSigned: ({ attemptId }) => {
    const amount = store.getAttempt(attemptId)?.quote?.amountAtomic;
    if (amount) session.recordSigned(BigInt(amount));
  },
});

const gate = createGate({
  orgId: DEMO_ORG_ID,
  store,
  signer,
  log: (line) => console.log(line),
  screen: async (address) => {
    const result = await screenAddress(address, {
      baseUrl: process.env.INTERCEPTA_BASE_URL,
      apiKey: process.env.INTERCEPTA_API_KEY,
      mapper: quickScanMapper,
      provenance: 'real_live',
      mappingVersion: QUICK_SCAN_MAPPING_VERSION,
      budget,
    });
    if (result.raw) console.log(`recorded ${writeRecordedResponse(recordedDir, result.raw).slice(root.length)}`);
    return result;
  },
});

const server = createSellerApp({ facilitatorUrl: process.env.X402_FACILITATOR_URL ?? 'https://x402.org/facilitator', routes }).listen(port, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));

try {
  const result = await runBuyerTask(gate, scenarioTask(name, serviceBase));
  const { attempt, decision, evidence, outcome } = result;
  console.log(
    JSON.stringify(
      {
        scenario: name,
        attemptId: attempt.attemptId,
        status: attempt.status,
        policyVersion: attempt.policyVersion,
        quote: attempt.quote && { network: attempt.quote.network, asset: attempt.quote.asset, amountAtomic: attempt.quote.amountAtomic, payTo: attempt.quote.payTo, resourceUrl: attempt.quote.resourceUrl },
        evidence: evidence && { provenance: evidence.provenance, tier: evidence.tier, providerScore: evidence.providerScore, reasons: evidence.reasons, capturedAt: evidence.capturedAt },
        decision: decision && { action: decision.action, reasons: decision.reasons.map((r) => r.code), signerEligible: decision.signerEligible },
        interceptaReturnedAt: attempt.interceptaReturnedAt,
        signerInvokedAt: attempt.signerInvokedAt,
        signerCalls: attempt.signerCalls,
        settlement: outcome?.settlementStatus ?? 'none',
        delivery: outcome?.deliveryStatus ?? null,
        txHash: outcome?.txHash ?? null,
        basescan: outcome?.txHash ? CHAIN.basescanTx(outcome.txHash) : null,
      },
      null,
      2,
    ),
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  store.close();
}
