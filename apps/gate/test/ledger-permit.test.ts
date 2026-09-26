import { describe, expect, it } from 'vitest';
import { ORG, makeWorld } from './helpers/world.js';
import { Store } from '../src/store/store.js';
import { signingPermitSchema } from '@risksir/core';

const DAY = 86_400;
const T0 = '2026-09-26T10:00:00.000Z';
const NEXT_DAY = '2026-09-27T10:00:00.000Z';

const reserve = (store: Store, attemptId: string, amount: string, cap = '500000', nowIso = T0) =>
  store.reserve({ reservationId: `res-${attemptId}`, orgId: ORG, attemptId, amountAtomic: amount, periodCapAtomic: cap, periodSeconds: DAY, nowIso, ttlSeconds: 300 });
const remaining = (store: Store, cap = '500000', nowIso = T0) => store.periodBudgetRemaining({ orgId: ORG, periodCapAtomic: cap, periodSeconds: DAY, nowIso });

// T-035 (AC-036, INV-007, ADR-021): the reservation rows are the only spend ledger.
describe('spend ledger: reservation rows only', () => {
  it('used = reserved + reconciling + committed; committed is not counted twice; released is excluded', () => {
    const store = new Store(':memory:');
    expect(remaining(store)).toBe(500000n);
    reserve(store, 'a', '100000');
    reserve(store, 'b', '150000');
    reserve(store, 'c', '50000');
    expect(remaining(store)).toBe(200000n); // 500000 - 300000

    store.commitReservation('a', '100000'); // settled: still counted once
    expect(remaining(store)).toBe(200000n);

    store.markReconciling('b'); // ambiguous: still held
    expect(remaining(store)).toBe(200000n);

    store.releaseReservation('c'); // confirmed non-settlement frees the budget
    expect(remaining(store)).toBe(250000n);
  });

  it('remaining excludes the attempt being decided: it has no reservation yet', () => {
    const store = new Store(':memory:');
    reserve(store, 'other', '200000');
    expect(remaining(store)).toBe(300000n);
    expect(store.getReservationForAttempt('me')).toBeNull();
    expect(reserve(store, 'me', '300000')).toMatchObject({ ok: true });
    expect(remaining(store)).toBe(0n);
  });

  it('the reservation transaction re-checks used + amount <= cap, and a failure means no reservation', () => {
    const store = new Store(':memory:');
    expect(reserve(store, 'a', '60000', '100000').ok).toBe(true);
    expect(reserve(store, 'b', '40000', '100000').ok).toBe(true); // exactly the cap
    expect(reserve(store, 'c', '1', '100000')).toEqual({ ok: false, reason: 'PERIOD_CAP_EXCEEDED' });
    expect(store.getReservationForAttempt('c')).toBeNull();
    store.releaseReservation('a');
    expect(reserve(store, 'c', '60000', '100000').ok).toBe(true); // freed budget can be reserved again
  });

  it('a stale read cannot overspend: the check is repeated inside the insert transaction', () => {
    const store = new Store(':memory:');
    const seen = remaining(store, '100000'); // both deciders see the full budget
    expect(seen).toBe(100000n);
    expect(reserve(store, 'a', '80000', '100000').ok).toBe(true);
    expect(reserve(store, 'b', '80000', '100000')).toEqual({ ok: false, reason: 'PERIOD_CAP_EXCEEDED' });
  });

  it('period windows are separate: a new day has the full cap again', () => {
    const store = new Store(':memory:');
    reserve(store, 'a', '500000');
    expect(remaining(store)).toBe(0n);
    expect(remaining(store, '500000', NEXT_DAY)).toBe(500000n);
    expect(reserve(store, 'b', '500000', '500000', NEXT_DAY).ok).toBe(true);
  });

  it('a settled payment must equal the reserved amount for the exact scheme', () => {
    const store = new Store(':memory:');
    reserve(store, 'a', '50000');
    expect(() => store.commitReservation('a', '50001')).toThrow(/must equal the reserved amount/);
    expect(store.getReservationForAttempt('a')?.status).toBe('reserved');
    expect(store.commitReservation('a', '50000').status).toBe('committed');
  });
});

// T-036 (INV-027, INV-017): the signing permit lifecycle.
describe('signing permit lifecycle', () => {
  it('only one permit can be armed for an attempt at a time; a new one is allowed after the old one is consumed or revoked', () => {
    const w = makeWorld();
    const first = w.store.getLatestPermit(w.attemptId)!;
    const second = signingPermitSchema.parse({ ...first, permitId: 'permit-2' });
    expect(() => w.store.armPermit(second)).toThrow(/already exists/);
    w.store.revokePermit(w.permitId);
    expect(w.store.armPermit(second).permitId).toBe('permit-2');
    expect(w.store.getArmedPermit(w.attemptId)?.permitId).toBe('permit-2');
  });

  it('a permit is armed only as armed, and a consumed or revoked permit can never be revived', () => {
    const w = makeWorld();
    const p = w.store.getLatestPermit(w.attemptId)!;
    expect(() => w.store.armPermit({ ...p, permitId: 'permit-x', status: 'consumed' })).toThrow(/armed/);
    w.store.revokePermit(w.permitId);
    // a revoked permit can no longer be consumed by the signer ledger, and stays revoked
    expect(w.store.recordSignerCall({ attemptId: w.attemptId, decisionId: w.decisionId, permitId: w.permitId, at: new Date(w.clock.ms).toISOString() })).toBe(false);
    expect(w.store.getLatestPermit(w.attemptId)?.status).toBe('revoked');
    expect(w.store.getDecision(w.decisionId)?.status).toBe('open');
  });

  it('activating another policy version revokes armed permits, supersedes their decisions and audits it (INV-017)', () => {
    const w = makeWorld();
    const v1 = w.store.getPolicy(ORG, 1)!;
    w.store.putPolicy(ORG, { ...v1, policyVersion: 2, parentVersion: 1, policyHash: `0x${'ab'.repeat(32)}` });
    w.store.setActivePolicy(ORG, 2, 'tr-2', new Date(w.clock.ms).toISOString());
    expect(w.store.getLatestPermit(w.attemptId)?.status).toBe('revoked');
    expect(w.store.getDecision(w.decisionId)?.status).toBe('superseded');
    // re-activating the same version changes nothing further
    expect(() => w.store.setActivePolicy(ORG, 2, 'tr-2b', new Date(w.clock.ms).toISOString())).not.toThrow();
  });

  it('a permit is bound to the attempt, decision, quote hash and policy version it was armed for', () => {
    const w = makeWorld();
    const p = w.store.getLatestPermit(w.attemptId)!;
    expect(p).toMatchObject({ attemptId: w.attemptId, decisionId: w.decisionId, policyVersion: 1, status: 'armed' });
    expect(p.quoteHash).toBe(w.store.getDecision(w.decisionId)?.quoteHash);
    expect(p.expiresAt).toBe(w.store.getDecision(w.decisionId)?.expiresAt); // expires with the decision
  });
});

describe('approvals', () => {
  const approval = (over: Record<string, unknown> = {}) => ({
    approvalId: 'appr-1',
    attemptId: 'att-1',
    quoteHash: `0x${'ab'.repeat(32)}` as const,
    policyVersion: 1,
    maxAmountAtomic: '50000',
    approvedAt: T0,
    expiresAt: '2026-09-26T10:10:00.000Z',
    status: 'active' as const,
    ...over,
  });

  it('records an approval once, audits it, and moves it active -> consumed or expired only', () => {
    const store = new Store(':memory:');
    store.saveApproval(approval());
    expect(() => store.saveApproval(approval())).toThrow(/already exists/);
    expect(store.listAudit().at(-1)).toMatchObject({ type: 'ApprovalRecorded', actor: 'owner' });
    store.consumeApproval('appr-1');
    expect(() => store.expireApproval('appr-1')).toThrow(/illegal approval transition/);
    expect(() => store.consumeApproval('appr-1')).not.toThrow(); // same-state save is idempotent
    expect(store.getApproval('appr-1')?.status).toBe('consumed');
  });

  it('refuses to record an approval that is not active', () => {
    const store = new Store(':memory:');
    expect(() => store.saveApproval(approval({ status: 'consumed' }))).toThrow(/active/);
  });

  it('only an attempt awaiting approval can expire', () => {
    const w = makeWorld();
    expect(() => w.store.expireAttempt(w.attemptId, 'APPROVAL_EXPIRED', T0)).toThrow(/only an attempt awaiting approval/);
  });
});
