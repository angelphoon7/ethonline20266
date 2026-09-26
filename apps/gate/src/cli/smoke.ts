/**
 * Demo preflight (M-011): `LIVE=1 pnpm demo:smoke`. Spends NO funds. Checks, in order: environment variable names (never
 * values), local state, the seller's 402 for each route, the facilitator, the payer balance, the session limits and, with
 * LIVE=1, one live Intercepta screen of the SAFE address (one call of the 1000-call budget). Exit code 1 if any check FAILs.
 */
import { join } from 'node:path';
import { DEMO_ORG_ID, DEMO_SERVICE_BASE } from '@risksir/core';
import { balanceCheck, classifyState, limitsCheck, worst } from '../demo/smoke.js';
import type { Check } from '../demo/smoke.js';
import { FileBudget, QUICK_SCAN_MAPPING_VERSION, quickScanMapper, screenAddress, writeRecordedResponse } from '../intercepta/index.js';
import { LiveSession } from '../live/session.js';
import { REPO_ROOT } from '../live/world.js';
import { readWalletStatus } from '../signer/public.js';
import { Store } from '../store/store.js';
import { createSellerApp, routesFromEnv } from '@risksir/seller';

const live = process.env.LIVE === '1';
const checks: Check[] = [];
const add = (name: string, status: Check['status'], detail: string) => {
  checks.push({ name, status, detail });
  console.log(`${status.padEnd(4)} ${name}: ${detail}`);
};

const REQUIRED = ['INTERCEPTA_API_KEY', 'INTERCEPTA_BASE_URL', 'BASE_SEPOLIA_RPC_URL', 'X402_FACILITATOR_URL', 'SELLER_PAY_TO_SAFE', 'SELLER_PAY_TO_RISKY', 'SELLER_PAY_TO_ALT', 'OWNER_CONSOLE_TOKEN'];
const missing = REQUIRED.filter((n) => !process.env[n]);
add('environment', missing.length ? 'FAIL' : 'PASS', missing.length ? `not set: ${missing.join(', ')}` : `${REQUIRED.length} variables set (names only; the payer key is checked by the balance read below, and by scripts/env-status.sh)`);

// local state
const dbPath = join(REPO_ROOT, 'data', 'risksir.db');
const routes = routesFromEnv(process.env);
const store = new Store(dbPath);
const safe = routes.find((r) => r.variant === 'safe')?.payTo;
const alt = routes.find((r) => r.variant === 'alt')?.payTo;
const state = classifyState({
  activePolicyVersion: store.getActivePolicyVersion(DEMO_ORG_ID),
  caseCount: store.listCases(DEMO_ORG_ID).length,
  safeKnown: safe ? !store.isFirstTimeCounterparty(DEMO_ORG_ID, safe) : false,
  altKnown: alt ? !store.isFirstTimeCounterparty(DEMO_ORG_ID, alt) : false,
});
add('local state', state.status, state.detail);
store.close();

// the seller's 402 (an already running seller is probed as is; otherwise one is started on 127.0.0.1 for the check)
const port = Number(process.env.SELLER_PORT ?? 4021);
const base = `http://127.0.0.1:${port}`;
let server: ReturnType<ReturnType<typeof createSellerApp>['listen']> | null = null;
const reachable = await fetch(`${base}/paid/report/safe`).then(() => true, () => false);
if (!reachable) {
  server = createSellerApp({ facilitatorUrl: process.env.X402_FACILITATOR_URL ?? 'https://x402.org/facilitator', routes }).listen(port, '127.0.0.1');
  await new Promise((resolve) => server?.once('listening', resolve));
}
try {
  for (const r of routes) {
    const res = await fetch(`${base}/paid/report/${r.variant}`).catch(() => null);
    const header = res?.headers.get('payment-required');
    const body = res ? await res.text().catch(() => '') : '';
    const decoded = header ? Buffer.from(header, 'base64').toString('utf8') : '';
    const seen = `${decoded}${body}`.toLowerCase();
    const ok = res?.status === 402 && seen.includes(r.payTo.toLowerCase());
    add(`seller 402 (${r.variant})`, ok ? 'PASS' : 'FAIL', ok ? `HTTP 402 quoting payTo ${r.payTo} at ${r.price}` : `expected HTTP 402 quoting ${r.payTo}, got ${res?.status ?? 'no response'}`);
  }
} finally {
  if (server) await new Promise((resolve) => server?.close(resolve));
}

// facilitator
if (process.env.X402_FACILITATOR_URL) {
  const res = await fetch(`${process.env.X402_FACILITATOR_URL.replace(/\/$/, '')}/supported`).catch(() => null);
  const text = res ? await res.text().catch(() => '') : '';
  const ok = res?.status === 200 && text.includes('eip155:84532');
  add('facilitator', ok ? 'PASS' : 'FAIL', ok ? 'GET /supported lists eip155:84532' : `GET /supported: ${res?.status ?? 'no response'}`);
}

// payer balance (public reads only)
if (process.env.BASE_SEPOLIA_RPC_URL) {
  try {
    const w = await readWalletStatus(process.env.BASE_SEPOLIA_RPC_URL);
    const b = balanceCheck(w.usdcAtomic, w.ethWei);
    add('payer balance', b.status, `${b.detail} (payer ${w.payer})`);
  } catch (err) {
    add('payer balance', 'FAIL', `wallet read failed (RPC down, or the payer key is not configured): ${(err as Error).message.slice(0, 120)}`);
  }
}

// limits
const budget = new FileBudget(join(REPO_ROOT, 'data', 'intercepta-calls.json'));
const l = limitsCheck(new LiveSession(join(REPO_ROOT, 'data', 'live-session.json')).state(), budget.used(), live ? 1 : 0);
add('session limits', l.status, l.detail);

// live Intercepta
if (!live) {
  add('live Intercepta', 'SKIP', 'set LIVE=1 to make one live screen (spends 1 of the 1000 calls)');
} else if (safe) {
  const r = await screenAddress(safe, { baseUrl: process.env.INTERCEPTA_BASE_URL, apiKey: process.env.INTERCEPTA_API_KEY, mapper: quickScanMapper, provenance: 'real_live', mappingVersion: QUICK_SCAN_MAPPING_VERSION, budget });
  if (r.raw) console.log(`     recorded ${writeRecordedResponse(join(REPO_ROOT, 'fixtures', 'intercepta', 'recorded'), r.raw).slice(REPO_ROOT.length)}`);
  const ok = r.evidence.tier !== 'UNAVAILABLE';
  add('live Intercepta', ok ? 'PASS' : 'FAIL', ok ? `SAFE screened: tier ${r.evidence.tier}, score ${r.evidence.providerScore}, ${r.raw?.latencyMs} ms, HTTP ${r.raw?.httpStatus}` : `unavailable (${r.evidence.unavailable}); the demo would HOLD. Retry once or use the failure demo`);
}

const overall = worst(checks);
console.log(`\nSMOKE ${overall}: ${checks.filter((c) => c.status === 'PASS').length} passed, ${checks.filter((c) => c.status === 'FAIL').length} failed, ${checks.filter((c) => c.status === 'SKIP').length} skipped (base ${DEMO_SERVICE_BASE})`);
if (overall === 'FAIL') process.exitCode = 1;
