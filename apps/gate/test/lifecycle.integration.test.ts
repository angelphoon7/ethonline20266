import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_SERVICE_BASE, demoCandidates, demoPolicyV1, demoProfile, sealPolicy } from '@risksir/core';
import { loadDataset } from '../src/dataset/index.js';
import { approveCandidate, createCandidate, replayCandidate, rollbackPolicy } from '../src/policy/index.js';
import { fixtureScreen, makeClock, makeGateWorld } from './helpers/gateWorld.js';
import { startRealSeller, startStubFacilitator } from './helpers/servers.js';
import type { Running, StubFacilitator } from './helpers/servers.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const ORG = 'org-exampleco';
const SAFE = `0x${'11'.repeat(20)}`;
const ALT = `0x${'33'.repeat(20)}`;

let facilitator: StubFacilitator;
let seller: Running;
beforeAll(async () => {
  facilitator = await startStubFacilitator();
  seller = await startRealSeller(facilitator.url, [
    { variant: 'safe', payTo: SAFE, price: '$0.05' },
    { variant: 'alt', payTo: ALT, price: '$0.05' },
  ]);
});
afterAll(async () => {
  await seller.close();
  await facilitator.close();
});

// T-050 (AC-012, AC-013, AC-014, AC-020): an approved v2 changes a NEW attempt's decision under a fresh screen; rollback restores v1.
describe('policy evolution end to end (offline: real local x402 seller, stub facilitator, fixture evidence)', () => {
  it('v1 pays a first-time counterparty; after B is approved the same kind of attempt is capped below the quote; a known counterparty still pays; rollback restores v1', async () => {
    const serviceBase = `${seller.url}/paid/`;
    const v1 = sealPolicy({
      policyVersion: 1,
      parentVersion: null,
      profile: { ...demoProfile(DEMO_SERVICE_BASE), allowedServices: [DEMO_SERVICE_BASE, serviceBase] },
      rules: demoPolicyV1().rules,
      defaultAction: 'HOLD',
    });
    const clock = makeClock();
    const screen = fixtureScreen({ [SAFE]: 'CLEAR', [ALT]: 'CLEAR' }, clock);
    const w = makeGateWorld({ serviceBase, screen: screen.screen, clock, policy: v1 });
    for (const c of loadDataset(root)) w.store.saveCase(c);
    const deps = { now: clock.now };
    const settledBefore = () => facilitator.settled.length;

    // 1. v1: a first-time counterparty at 0.05 USDC is paid
    const first = await w.gate.run(w.task('report/safe'));
    expect(first.decision).toMatchObject({ action: 'PAY', policyVersion: 1 });
    expect(first.attempt).toMatchObject({ status: 'settled', signerCalls: 1 });

    // 2. the owner labels the incident, two candidates are replayed, B is approved bound to its report
    w.store.appendLabel('cv-01-incident-80000', { label: 'bad', labelledBy: 'owner', rationale: 'incident: no delivery', at: clock.now().toISOString() });
    const rules = (i: number) => demoCandidates(v1)[i]!.policy.rules;
    const a = createCandidate(w.store, ORG, { rules: rules(0), defaultAction: 'HOLD', rationale: 'blunt', originatingCaseIds: ['cv-01-incident-80000'], generatedBy: 'owner' }, deps);
    const b = createCandidate(w.store, ORG, { rules: rules(1), defaultAction: 'HOLD', rationale: 'balanced', originatingCaseIds: ['cv-01-incident-80000'], generatedBy: 'owner' }, deps);
    replayCandidate(w.store, ORG, a.candidateId, deps);
    const rb = replayCandidate(w.store, ORG, b.candidateId, deps);
    approveCandidate(w.store, ORG, b.candidateId, rb.reportHash, 'owner', deps);
    expect(w.store.getActivePolicyVersion(ORG)).toBe(2);

    // 3. a NEW first-time attempt: fresh live-style screen, and v2 changes the decision (CAP below the quote, zero signer calls)
    const screensBefore = screen.calls.length;
    const paid = settledBefore();
    const capped = await w.gate.run(w.task('report/alt'));
    expect(screen.calls.length - screensBefore).toBe(1); // a fresh screen, not a cached pass
    expect(screen.calls.at(-1)).toBe(ALT);
    expect(capped.decision).toMatchObject({ action: 'CAP', signerEligible: false, policyVersion: 2 });
    expect(capped.decision?.reasons.map((r) => r.code)).toEqual(['RULE_MATCHED', 'CAP_BELOW_QUOTE']);
    expect(capped.attempt).toMatchObject({ status: 'failed', signerCalls: 0, signerInvokedAt: null });
    expect(settledBefore()).toBe(paid);

    // 4. same evidence tier, different context (a known counterparty): still paid under v2
    const known = await w.gate.run(w.task('report/safe'));
    expect(known.decision).toMatchObject({ action: 'PAY', policyVersion: 2 });
    expect(known.attempt).toMatchObject({ status: 'settled', signerCalls: 1 });

    // 5. rollback: v1 governs the next new attempt again
    rollbackPolicy(w.store, ORG, 1, 'owner', deps);
    expect(w.store.getActivePolicyVersion(ORG)).toBe(1);
    const again = await w.gate.run(w.task('report/alt'));
    expect(again.decision).toMatchObject({ action: 'PAY', policyVersion: 1 });
    expect(again.attempt).toMatchObject({ status: 'settled', signerCalls: 1 });
    expect(screen.calls.at(-1)).toBe(ALT);
    expect(w.store.getPolicy(ORG, 2)).not.toBeNull(); // v2 is kept in history
  });
});
