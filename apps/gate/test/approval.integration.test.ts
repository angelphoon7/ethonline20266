import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Approval, PaymentPolicy, Tier } from '@risksir/core';
import { demoCandidates, demoPolicyV1, demoProfile } from '@risksir/core';
import { fixtureScreen, makeClock, makeGateWorld } from './helpers/gateWorld.js';
import { startRawSeller, startRealSeller, startStubFacilitator, usdcRequirement } from './helpers/servers.js';
import type { RawSeller, Running, StubFacilitator } from './helpers/servers.js';

const SAFE = `0x${'11'.repeat(20)}`;
const ORG = 'org-exampleco';

let facilitator: StubFacilitator;
let seller: Running;
let base: string;

beforeAll(async () => {
  facilitator = await startStubFacilitator();
  seller = await startRealSeller(facilitator.url, [{ variant: 'safe', payTo: SAFE, price: '$0.05' }]);
  base = `${seller.url}/paid/`;
});
afterAll(async () => {
  await seller.close();
  await facilitator.close();
});

/** Candidate C as the active policy: a first-time counterparty paying at least 0.03 USDC needs a human (ASK_HUMAN). */
const askHumanPolicy = (serviceBase: string): PaymentPolicy => demoCandidates(demoPolicyV1(demoProfile(serviceBase)))[2]!.policy;

/** A screen that returns one tier per call: [first, second, ...]; the last entry repeats. */
function sequencedScreen(tiers: Tier[], clock: { now: () => Date }) {
  let n = 0;
  const calls: string[] = [];
  const screen = async (address: string) => {
    const tier = tiers[Math.min(n, tiers.length - 1)] as Tier;
    n += 1;
    calls.push(address);
    return fixtureScreen({ [address.toLowerCase()]: tier }, clock).screen(address);
  };
  return { screen, calls };
}

function approvalFor(w: ReturnType<typeof makeGateWorld>, attemptId: string, over: Partial<Approval> = {}): Approval {
  const attempt = w.store.getAttempt(attemptId)!;
  const at = w.clock.now();
  return {
    approvalId: 'appr-1',
    attemptId,
    quoteHash: attempt.quoteHash!,
    policyVersion: attempt.policyVersion!,
    maxAmountAtomic: attempt.quote!.amountAtomic,
    approvedAt: at.toISOString(),
    expiresAt: new Date(at.getTime() + 600_000).toISOString(),
    status: 'active',
    ...over,
  };
}

async function parked(over: { serviceBase?: string; tiers?: Tier[]; policy?: PaymentPolicy } = {}) {
  const serviceBase = over.serviceBase ?? base;
  const clock = makeClock();
  const screen = sequencedScreen(over.tiers ?? ['CLEAR'], clock);
  const w = makeGateWorld({ serviceBase, screen: screen.screen, clock, policy: over.policy ?? askHumanPolicy(serviceBase) });
  const task = w.task('report/safe', serviceBase);
  const first = await w.gate.run(task);
  return { w, screen, task, first, clock };
}

// T-033 (AC-033, INV-002, INV-028): an ASK_HUMAN attempt waits, and only a valid approval resumes it.
describe('ASK_HUMAN parks the attempt in awaiting_approval', () => {
  it('records a pending decision, zero signer calls, no reservation or permit, and an approval window', async () => {
    const before = { ...facilitator.calls };
    const { w, first, screen } = await parked();
    expect(first.awaitingApproval).toBe(true);
    expect(first.attempt).toMatchObject({ status: 'awaiting_approval', signerCalls: 0, signerInvokedAt: null });
    expect(first.decision).toMatchObject({ action: 'ASK_HUMAN', signerEligible: false, status: 'open' });
    expect(first.decision?.reasons.map((r) => r.code)).toEqual(['RULE_MATCHED', 'APPROVAL_PENDING']);
    expect(Date.parse(first.attempt.awaitingApprovalUntil!) - Date.parse(first.attempt.decidedAt!)).toBe(600_000);
    expect(screen.calls).toHaveLength(1);
    expect(w.store.getReservationForAttempt(first.attempt.attemptId)).toBeNull();
    expect(w.store.getLatestPermit(first.attempt.attemptId)).toBeNull();
    expect(facilitator.calls.settle - before.settle).toBe(0);
  });
});

describe('approval resume (fresh screen, re-evaluation, PAY only)', () => {
  it('a valid approval: current 402 with the same quote, a FRESH live screen, re-evaluation under the current policy, one signature, settlement', async () => {
    const { w, first, screen, task } = await parked();
    const id = first.attempt.attemptId;
    w.store.saveApproval(approvalFor(w, id));

    const resumed = await w.gate.resumeWithApproval(id, 'appr-1', task);

    expect(screen.calls).toHaveLength(2); // one screen when parked, a fresh one on resume
    expect(resumed.attempt).toMatchObject({ status: 'settled', signerCalls: 1 });
    expect(resumed.decision).toMatchObject({ action: 'PAY', signerEligible: true, approvalId: 'appr-1', status: 'consumed' });
    expect(resumed.decision?.reasons.map((r) => r.code)).toEqual(['RULE_MATCHED', 'HUMAN_APPROVED']);
    expect(w.store.getApproval('appr-1')?.status).toBe('consumed');
    expect(w.store.getLatestPermit(id)).toMatchObject({ status: 'consumed', policyVersion: 2 });
    expect(w.store.getDecision(first.decision!.decisionId)?.status).toBe('superseded'); // the pending decision was superseded
    expect(Date.parse(resumed.attempt.interceptaReturnedAt!)).toBeLessThan(Date.parse(resumed.attempt.signerInvokedAt!)); // INV-019 on the resumed screen
    expect(resumed.outcome).toMatchObject({ settlementStatus: 'settled', deliveryStatus: 'received' });
    expect(w.store.listAudit().map((e) => e.type)).toEqual(expect.arrayContaining(['ApprovalRecorded', 'PermitArmed', 'SignerInvoked']));
  });

  it('a BLOCK on the fresh screen is DENY despite the approval (hard prohibitions are never overridable)', async () => {
    const { w, first, task } = await parked({ tiers: ['CLEAR', 'BLOCK'] });
    const id = first.attempt.attemptId;
    w.store.saveApproval(approvalFor(w, id));
    const resumed = await w.gate.resumeWithApproval(id, 'appr-1', task);
    expect(resumed.decision).toMatchObject({ action: 'DENY', signerEligible: false });
    expect(resumed.decision?.reasons[0]?.code).toBe('EVIDENCE_BLOCK');
    expect(resumed.attempt).toMatchObject({ status: 'failed', signerCalls: 0 });
    expect(w.store.getApproval('appr-1')?.status).toBe('active'); // never consumed
    expect(w.store.getLatestPermit(id)).toBeNull();
  });

  it('an UNAVAILABLE fresh screen is HOLD despite the approval', async () => {
    const { w, first, task } = await parked({ tiers: ['CLEAR', 'UNAVAILABLE'] });
    const id = first.attempt.attemptId;
    w.store.saveApproval(approvalFor(w, id));
    const resumed = await w.gate.resumeWithApproval(id, 'appr-1', task);
    expect(resumed.decision).toMatchObject({ action: 'HOLD', signerEligible: false });
    expect(resumed.attempt).toMatchObject({ status: 'failed', signerCalls: 0 });
  });

  it('an approval that does not cover the amount leaves the attempt awaiting approval with a new pending decision', async () => {
    const { w, first, task } = await parked();
    const id = first.attempt.attemptId;
    w.store.saveApproval(approvalFor(w, id, { maxAmountAtomic: '49999' }));
    const resumed = await w.gate.resumeWithApproval(id, 'appr-1', task);
    expect(resumed.awaitingApproval).toBe(true);
    expect(resumed.decision).toMatchObject({ action: 'ASK_HUMAN', signerEligible: false });
    expect(resumed.attempt).toMatchObject({ status: 'awaiting_approval', signerCalls: 0 });
    expect(w.store.getDecision(first.decision!.decisionId)?.status).toBe('superseded');
    expect(w.store.getLatestPermit(id)).toBeNull();
  });

  it('a mutated resumed quote fails the attempt and signs nothing (INV-005)', async () => {
    const raw: RawSeller = await startRawSeller([usdcRequirement({ payTo: SAFE })]);
    try {
      const { w, first, task } = await parked({ serviceBase: `${raw.url}/` });
      expect(first.awaitingApproval).toBe(true);
      const id = first.attempt.attemptId;
      w.store.saveApproval(approvalFor(w, id));
      raw.setAccepts([usdcRequirement({ payTo: SAFE, amount: '60000' })]); // the seller changes the price
      const resumed = await w.gate.resumeWithApproval(id, 'appr-1', task);
      expect(resumed.attempt).toMatchObject({ status: 'failed', signerCalls: 0 });
      expect(resumed.attempt.failure?.code).toBe('QUOTE_MUTATED');
      expect(raw.paymentHeaders()).toBe(0);
    } finally {
      await raw.close();
    }
  });
});

describe('expiry of an attempt awaiting approval', () => {
  it('an expired approval makes the attempt expired (terminal) with zero signer calls', async () => {
    const { w, first, task, clock } = await parked();
    const id = first.attempt.attemptId;
    w.store.saveApproval(approvalFor(w, id, { expiresAt: new Date(clock.now().getTime() + 1000).toISOString() }));
    clock.offset.ms += 5000;
    const resumed = await w.gate.resumeWithApproval(id, 'appr-1', task);
    expect(resumed.attempt).toMatchObject({ status: 'expired', signerCalls: 0 });
    expect(resumed.attempt.failure?.code).toBe('APPROVAL_EXPIRED');
    expect(w.store.getApproval('appr-1')?.status).toBe('expired');
    expect(w.store.listAudit().map((e) => e.type)).toContain('AttemptExpired');
    await expect(w.gate.resumeWithApproval(id, 'appr-1', task)).rejects.toThrow(/not awaiting approval/); // terminal
  });

  it('the approval window elapsing without an approval expires the attempt', async () => {
    const { w, first, clock } = await parked();
    expect(w.gate.expireOverdue()).toEqual([]);
    clock.offset.ms += 601_000;
    expect(w.gate.expireOverdue()).toEqual([first.attempt.attemptId]);
    expect(w.store.getAttempt(first.attempt.attemptId)).toMatchObject({ status: 'expired', signerCalls: 0 });
  });

  it('a policy-version change while awaiting approval expires the attempt (INV-017)', async () => {
    const { w, first, task } = await parked();
    const id = first.attempt.attemptId;
    w.store.saveApproval(approvalFor(w, id));
    const v3 = { ...askHumanPolicy(base), policyVersion: 3, parentVersion: 2, policyHash: `0x${'cd'.repeat(32)}` as const };
    w.store.putPolicy(ORG, v3);
    w.store.setActivePolicy(ORG, 3, 'tr-3', w.clock.now().toISOString());
    expect(w.store.getAttempt(id)).toMatchObject({ status: 'expired', signerCalls: 0 });
    expect(w.store.getAttempt(id)?.failure?.code).toBe('POLICY_CHANGED');
    await expect(w.gate.resumeWithApproval(id, 'appr-1', task)).rejects.toThrow(/not awaiting approval/);
  });

  it('an approval made under another policy version expires the attempt on resume', async () => {
    const { w, first, task } = await parked();
    const id = first.attempt.attemptId;
    w.store.saveApproval(approvalFor(w, id, { policyVersion: 1 })); // approval bound to v1, active is v2
    const resumed = await w.gate.resumeWithApproval(id, 'appr-1', task);
    expect(resumed.attempt).toMatchObject({ status: 'expired', signerCalls: 0 });
    expect(resumed.attempt.failure?.code).toBe('POLICY_CHANGED');
  });
});

describe('an approval only applies to its own attempt', () => {
  it('rejects an approval bound to another attempt and a non-awaiting attempt', async () => {
    const { w, first, task } = await parked();
    const id = first.attempt.attemptId;
    w.store.saveApproval(approvalFor(w, id, { attemptId: 'att-other' }));
    await expect(w.gate.resumeWithApproval(id, 'appr-1', task)).rejects.toThrow(/does not bind this attempt/);
    const settled = await w.gate.run(w.task('report/safe')); // a fresh attempt is again ASK_HUMAN, not resumable by that approval
    expect(settled.attempt.status).toBe('awaiting_approval');
    await expect(w.gate.resumeWithApproval('missing', 'appr-1', task)).rejects.toThrow(/not awaiting approval/);
  });
});
