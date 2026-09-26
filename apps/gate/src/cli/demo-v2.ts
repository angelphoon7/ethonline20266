/**
 * Layer 4 live proof (M-010, SPEC section 22 scenes 4 and 5): `LIVE=1 pnpm demo:v2`.
 *
 *   1. the owner labels the incident case as bad
 *   2. candidates A, B and C are created and replayed over the labelled dataset; B is approved, bound to its report
 *   3. a NEW x402 attempt for the first-time counterparty (ALT): a fresh LIVE Intercepta screen, and v2 changes the decision
 *      (CAP below the quote: zero signer calls, no settlement)
 *   4. a known counterparty (SAFE) with the same evidence tier still pays under v2 (Layer 2)
 *   5. rollback to v1, then a NEW ALT attempt (fresh live screen) is paid again under v1
 *
 * Preconditions are checked before any spend and every step is asserted: an unexpected decision stops the run
 * immediately. Live limits (OPERATIONAL_GUARDRAILS section 4/5) apply: at most two settlements of 0.05 USDC and three live
 * Intercepta calls. `--no-pay` runs steps 1 to 3 only (one screen, no settlement). Base Sepolia only; never prints secrets.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO_ORG_ID, DEMO_SERVICE_BASE, atomicToUsdcString, demoCandidates, demoPolicyV1, demoProfile } from '@risksir/core';
import { CHAIN } from '../chain.js';
import { INTERCEPTA_CALL_LIMIT } from '../intercepta/index.js';
import { LiveSession, formatBanner } from '../live/session.js';
import { REPO_ROOT, createLiveWorld, requireLive, summariseResult } from '../live/world.js';
import { approveCandidate, createCandidate, installInitialPolicy, replayCandidate, rollbackPolicy } from '../policy/index.js';
import { loadDataset } from '../dataset/load.js';
import { payerPublicAddress } from '../signer/public.js';
import { Store } from '../store/store.js';
import type { AttemptResult } from '../x402/gate.js';

requireLive();
const noPay = process.argv.includes('--no-pay');
const INCIDENT_CASE = 'cv-01-incident-80000';

const fail = (msg: string): never => {
  console.error(`STOP: ${msg}`);
  process.exit(2);
};
const step = (n: number, title: string) => console.log(`\n=== ${n}. ${title}`);

const store = new Store(join(REPO_ROOT, 'data', 'risksir.db'));
const world = createLiveWorld(store, DEMO_ORG_ID);
const orgId = DEMO_ORG_ID;

// ---- preconditions (no network, no spend) ---------------------------------------------------------------------------
if (store.getActivePolicyVersion(orgId) === null) installInitialPolicy(store, orgId, demoPolicyV1(demoProfile(DEMO_SERVICE_BASE)));
if (store.getActivePolicyVersion(orgId) !== 1) fail(`policy v${store.getActivePolicyVersion(orgId)} is active, not v1. Start from a v1 state (the reset script lands in M-011).`);
for (const c of loadDataset(REPO_ROOT)) if (!store.getCase(c.caseId)) store.saveCase(c);
if (!store.getCase(INCIDENT_CASE)) fail(`incident case ${INCIDENT_CASE} is missing from the dataset`);

const altPay = world.payTo('alt');
const safePay = world.payTo('safe');
if (!altPay || !safePay) fail('SELLER_PAY_TO_ALT and SELLER_PAY_TO_SAFE must both be set');
const altAmount = world.priceAtomic('alt');
const safeAmount = world.priceAtomic('safe');
const planned = noPay ? 0n : altAmount + safeAmount;
const plannedScreens = noPay ? 1 : 3;

const callsUsed = (() => {
  const p = join(REPO_ROOT, 'data', 'intercepta-calls.json');
  try {
    return existsSync(p) ? Number((JSON.parse(readFileSync(p, 'utf8')) as { used?: number }).used ?? 0) : 0;
  } catch {
    return INTERCEPTA_CALL_LIMIT;
  }
})();
if (callsUsed + plannedScreens > INTERCEPTA_CALL_LIMIT) fail(`Intercepta call budget: ${callsUsed} used of ${INTERCEPTA_CALL_LIMIT}, this run needs ${plannedScreens}`);
const s = world.session.state();
console.log(formatBanner({ network: CHAIN.network, payerPublicAddress: payerPublicAddress(), payTo: `${altPay} (ALT) and ${safePay} (SAFE)`, amountAtomic: planned, count: noPay ? 0 : 2, session: s }));
console.log(`  intercepta:     ${plannedScreens} live calls planned (${callsUsed}/${INTERCEPTA_CALL_LIMIT} used so far)`);
if (!noPay) {
  const refusal = new LiveSession(join(REPO_ROOT, 'data', 'live-session.json')).check(altAmount + safeAmount);
  if (refusal) fail(refusal);
}

const seller = await world.startSeller();
const evidence: Record<string, unknown> = { run: new Date().toISOString(), network: CHAIN.network, provenance: 'real_live', noPay };
const results: Record<string, ReturnType<typeof summariseResult>> = {};
const run = async (key: string, path: 'report/alt' | 'report/safe'): Promise<AttemptResult> => {
  const r = await world.gate.run({ agentId: 'agent-1', taskId: `demo-v2-${key}`, url: `${world.serviceBase}${path}`, service: 'report' });
  results[key] = summariseResult(r);
  console.log(JSON.stringify(results[key], null, 2));
  return r;
};
const expect = (cond: boolean, msg: string) => {
  if (!cond) fail(msg);
};

try {
  step(1, 'Owner labels the incident case as bad (Trigger C)');
  const at = () => new Date().toISOString();
  store.appendLabel(INCIDENT_CASE, { label: 'bad', labelledBy: 'owner', rationale: 'incident: paid a first-time counterparty for an 80000-atomic quote and got no delivery', at: at() });
  console.log(`labelled ${INCIDENT_CASE} = bad (label history kept, never relabelled provenance)`);

  step(2, 'Create candidates A, B, C, replay them over the labelled dataset, approve B');
  const base = store.getActivePolicy(orgId)!;
  const made = demoCandidates(base).map((c) => ({ key: c.key, candidate: createCandidate(store, orgId, { rules: c.policy.rules, defaultAction: c.policy.defaultAction, rationale: c.rationale, originatingCaseIds: [INCIDENT_CASE], generatedBy: 'owner' }) }));
  const reports = made.map((m) => ({ key: m.key, candidateId: m.candidate.candidateId, report: replayCandidate(store, orgId, m.candidate.candidateId) }));
  for (const r of reports) {
    console.log(`candidate ${r.key} report ${r.report.reportHash}`);
    console.log('  ' + r.report.metrics.map((m) => `${m.name} ${m.numerator}/${m.denominator}`).join(' | '));
  }
  console.log(`provenance mix: ${JSON.stringify(reports[0]!.report.provenanceMix)} (replay metrics are counterfactual on labelled cases, not real prevented losses)`);
  const chosen = reports.find((r) => r.key === 'B')!;
  const approved = approveCandidate(store, orgId, chosen.candidateId, chosen.report.reportHash, 'owner');
  expect(store.getActivePolicyVersion(orgId) === approved.policyVersion, 'approval did not activate the new version');
  console.log(`owner approved candidate B bound to report ${chosen.report.reportHash} -> active policy v${approved.policyVersion} (${approved.policyHash})`);
  evidence.candidates = reports.map((r) => ({ key: r.key, candidateId: r.candidateId, reportHash: r.report.reportHash, metrics: r.report.metrics, provenanceMix: r.report.provenanceMix }));
  evidence.approved = { candidate: 'B', reportHash: chosen.report.reportHash, policyVersion: approved.policyVersion, policyHash: approved.policyHash };

  step(3, 'NEW attempt for the first-time counterparty (ALT) under v2: fresh live Intercepta screen');
  const v2Alt = await run('v2_alt', 'report/alt');
  expect(v2Alt.evidence?.provenance === 'real_live', 'the v2 attempt did not use a real_live screen');
  expect(v2Alt.decision?.policyVersion === 2, `decided under v${v2Alt.decision?.policyVersion}, not v2`);
  expect(v2Alt.decision?.action === 'CAP' && v2Alt.decision.signerEligible === false, `expected CAP below the quote, got ${v2Alt.decision?.action}`);
  expect(v2Alt.attempt.signerCalls === 0 && v2Alt.outcome === null, 'v2 changed the decision but the signer was called or a settlement exists');
  console.log('=> v2 changed the decision on a freshly screened attempt: CAP below the quote, signer calls: 0');

  if (!noPay) {
    step(4, 'Same evidence tier, known counterparty (SAFE) under v2 still pays (Layer 2)');
    const v2Safe = await run('v2_safe', 'report/safe');
    expect(v2Safe.decision?.policyVersion === 2 && v2Safe.decision.action === 'PAY', `expected PAY under v2 for a known counterparty, got ${v2Safe.decision?.action}`);
    expect(v2Safe.attempt.signerCalls === 1 && v2Safe.outcome?.settlementStatus === 'settled', 'the known-counterparty payment did not settle with one signer call');

    step(5, 'Rollback to v1, then a NEW ALT attempt under a fresh live screen');
    const rolled = rollbackPolicy(store, orgId, 1, 'owner');
    expect(store.getActivePolicyVersion(orgId) === 1, 'rollback did not restore v1');
    console.log(`rolled back: active policy v1 (${rolled.policyHash}); v2 kept in history`);
    const v1Alt = await run('v1_alt_after_rollback', 'report/alt');
    expect(v1Alt.decision?.policyVersion === 1 && v1Alt.decision.action === 'PAY', `expected PAY under v1 after rollback, got ${v1Alt.decision?.action}`);
    expect(v1Alt.attempt.signerCalls === 1 && v1Alt.outcome?.settlementStatus === 'settled', 'the post-rollback payment did not settle with one signer call');
  }

  evidence.results = results;
  evidence.interceptaRawResponses = world.recorded.map((p) => p.slice(REPO_ROOT.length).replaceAll('\\', '/'));
  evidence.policyVersions = store.listPolicyVersions(orgId).map((v) => ({ policyVersion: v.policyVersion, policyHash: v.policyHash, status: v.status, approvedReportHash: v.approvedReportHash, approvedBy: v.approvedBy }));
  evidence.signerCallsTotal = Object.values(results).map((r) => ({ attemptId: r.attemptId, policyVersion: r.policyVersion, action: r.decision?.action, signerCalls: r.signerCalls }));
  const ids = new Set(Object.values(results).map((r) => r.attemptId));
  evidence.audit = store.listAudit().filter((e) => (e.refs.attemptId && ids.has(e.refs.attemptId)) || e.type === 'PolicyApproved' || e.type === 'PolicyActivated' || e.type === 'PolicyRolledBack' || e.type === 'IncidentLabelled' || e.type === 'RegressionCompleted').map((e) => ({ seq: e.seq, type: e.type, at: e.at, refs: e.refs }));
  const out = join(REPO_ROOT, 'docs', 'evidence', `M-010_v2_run${noPay ? '_nopay' : ''}.json`);
  writeFileSync(out, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`\nDONE. evidence written to ${out.slice(REPO_ROOT.length)}. session: ${JSON.stringify({ ...world.session.state(), totalAtomic: atomicToUsdcString(world.session.state().totalAtomic) })}`);
} finally {
  await seller.close();
  store.close();
}
