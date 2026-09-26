import { describe, expect, it } from 'vitest';
import { paymentAttemptSchema } from '@risksir/core';
import type { PaymentCase } from '@risksir/core';
import { reconcileAttempt } from '../src/reconcile/reconcile.js';
import type { ChainReader } from '../src/reconcile/reconcile.js';
import { ORG, PAY_TO, T_START, makeWorld } from './helpers/world.js';
import type { World } from './helpers/world.js';

const TX = `0x${'ab'.repeat(32)}` as const;

/** Signs, then turns the attempt into an ambiguous settlement (signed, facilitator response lost), reservation reconciling. */
async function ambiguousWorld(): Promise<World> {
  const w = makeWorld();
  await w.attemptSigner.signTypedData(w.typedData());
  const at = new Date(w.clock.ms + 1000).toISOString();
  w.store.saveOutcome({ outcomeId: 'o-1', attemptId: w.attemptId, settlementStatus: 'ambiguous', txHash: null, facilitatorRef: null, deliveryStatus: 'unknown', httpStatus: null, observedAt: at });
  const signed = w.store.getAttempt(w.attemptId);
  w.store.saveAttempt(paymentAttemptSchema.parse({ ...signed, status: 'submitted', submittedAt: at }));
  w.store.saveAttempt(paymentAttemptSchema.parse({ ...w.store.getAttempt(w.attemptId), status: 'ambiguous', failure: { code: 'SIGNER_REFUSED', message: 'lost response' } }));
  w.store.markReconciling(w.attemptId);
  return w;
}

const chain = (over: Partial<ChainReader> = {}): ChainReader => ({
  authorizationUsed: async () => false,
  findAuthorizationTx: async () => null,
  latestBlockTimestamp: async () => Math.floor(T_START / 1000),
  ...over,
});

const budgetLeft = (w: World) => w.store.periodBudgetRemaining({ orgId: ORG, periodCapAtomic: '500000', periodSeconds: 86400, nowIso: new Date(w.clock.ms).toISOString() });

// T-020 (store side): illegal transitions are rejected and nothing is persisted.
describe('the store enforces the state machines', () => {
  it('rejects illegal attempt transitions and keeps the stored state', () => {
    const w = makeWorld();
    const attempt = w.store.getAttempt(w.attemptId);
    for (const status of ['created', 'quoted', 'screened', 'settled', 'submitted', 'ambiguous'] as const) {
      expect(() => w.store.saveAttempt(paymentAttemptSchema.parse({ ...attempt, status })), `decided -> ${status}`).toThrow(/illegal attempt transition/);
    }
    expect(w.store.getAttempt(w.attemptId)?.status).toBe('decided');
  });

  it('terminal attempt states cannot be left', () => {
    const w = makeWorld();
    const failed = paymentAttemptSchema.parse({ ...w.store.getAttempt(w.attemptId), status: 'failed', failure: { code: 'SIGNER_REFUSED', message: 'x' } });
    w.store.saveAttempt(failed);
    expect(() => w.store.saveAttempt(paymentAttemptSchema.parse({ ...failed, status: 'decided' }))).toThrow(/illegal attempt transition/);
  });

  it('a stored decision is immutable apart from its status', () => {
    const w = makeWorld();
    const d = w.store.getDecision(w.decisionId) as NonNullable<ReturnType<World['store']['getDecision']>>;
    expect(() => w.store.saveDecision({ ...d, action: 'HOLD', signerEligible: false, authorisedMaxAtomic: null })).toThrow(/immutable/);
    expect(() => w.store.saveDecision({ ...d, quoteHash: `0x${'00'.repeat(32)}` })).toThrow(/immutable/);
    expect(() => w.store.saveDecision({ ...d, status: 'consumed' })).not.toThrow();
    expect(() => w.store.saveDecision({ ...d, status: 'open' })).toThrow(/illegal decision transition/);
  });

  it('reservation transitions are enforced: committed and released are terminal', () => {
    const w = makeWorld();
    w.store.commitReservation(w.attemptId, '50000');
    expect(() => w.store.releaseReservation(w.attemptId)).toThrow(/illegal reservation transition/);
    const v = makeWorld();
    v.store.releaseReservation(v.attemptId);
    expect(() => v.store.commitReservation(v.attemptId, '50000')).toThrow(/illegal reservation transition/);
  });

  it('one reservation per attempt (a duplicate is refused)', () => {
    const w = makeWorld();
    const again = w.store.reserve({ reservationId: 'res-2', orgId: ORG, attemptId: w.attemptId, amountAtomic: '1', periodCapAtomic: '500000', periodSeconds: 86400, nowIso: new Date(w.clock.ms).toISOString(), ttlSeconds: 60 });
    expect(again).toEqual({ ok: false, reason: 'RESERVATION_FAILED' });
  });
});

// T-022 (AC-027, INV-014): an ambiguous settlement keeps its reservation until the chain says otherwise.
describe('reconciliation of an ambiguous settlement', () => {
  it('the signer ledger stores the authorisation (payer, nonce, validBefore) needed to reconcile', async () => {
    const w = await ambiguousWorld();
    const auth = w.store.getSignerAuthorization(w.attemptId);
    expect(auth?.from).toBe(w.signer.address.toLowerCase());
    expect(auth?.nonce).toBe(`0x${'11'.repeat(32)}`);
    expect(auth?.validBefore).toBe(BigInt(Math.floor(w.clock.ms / 1000) + w.quote.maxTimeoutSeconds));
  });

  it('an ambiguous attempt holds its reservation and budget, and nothing re-signs', async () => {
    const w = await ambiguousWorld();
    expect(w.store.getReservationForAttempt(w.attemptId)?.status).toBe('reconciling');
    expect(await budgetLeft(w)).toBe(450000n);
    expect(w.signerCalls()).toBe(1);
  });

  it('nonce used on chain: settles, commits the reservation, records the tx hash and a SettlementObserved event', async () => {
    const w = await ambiguousWorld();
    const status = await reconcileAttempt(w.store, chain({ authorizationUsed: async () => true, findAuthorizationTx: async () => TX }), w.attemptId, { now: () => new Date(w.clock.ms + 5000) });
    expect(status).toBe('settled');
    expect(w.store.getAttempt(w.attemptId)).toMatchObject({ status: 'settled' });
    expect(w.store.getOutcomeForAttempt(w.attemptId)).toMatchObject({ settlementStatus: 'settled', txHash: TX, deliveryStatus: 'unknown' });
    expect(w.store.getReservationForAttempt(w.attemptId)).toMatchObject({ status: 'committed', committedAtomic: '50000' });
    expect(await budgetLeft(w)).toBe(450000n); // still counted as spent
    expect(w.store.listAudit().at(-1)).toMatchObject({ type: 'SettlementObserved', refs: { attemptId: w.attemptId, txHash: TX } });
  });

  it('nonce used but the tx is outside the searched range: stays pending, reservation kept', async () => {
    const w = await ambiguousWorld();
    const status = await reconcileAttempt(w.store, chain({ authorizationUsed: async () => true }), w.attemptId);
    expect(status).toBe('pending');
    expect(w.store.getReservationForAttempt(w.attemptId)?.status).toBe('reconciling');
    expect(w.store.getAttempt(w.attemptId)?.status).toBe('ambiguous');
  });

  it('nonce unused and the authorisation is still valid: pending, reservation kept, never released', async () => {
    const w = await ambiguousWorld();
    const validBefore = Number(w.store.getSignerAuthorization(w.attemptId)?.validBefore);
    const status = await reconcileAttempt(w.store, chain({ latestBlockTimestamp: async () => validBefore - 1 }), w.attemptId);
    expect(status).toBe('pending');
    expect(w.store.getReservationForAttempt(w.attemptId)?.status).toBe('reconciling');
    expect(await budgetLeft(w)).toBe(450000n);
  });

  it('nonce unused at exactly validBefore is still pending (the authorisation may execute in that second)', async () => {
    const w = await ambiguousWorld();
    const validBefore = Number(w.store.getSignerAuthorization(w.attemptId)?.validBefore);
    expect(await reconcileAttempt(w.store, chain({ latestBlockTimestamp: async () => validBefore }), w.attemptId)).toBe('pending');
  });

  it('nonce unused after validBefore on chain time: it can never settle, so the reservation is released and the budget freed', async () => {
    const w = await ambiguousWorld();
    const validBefore = Number(w.store.getSignerAuthorization(w.attemptId)?.validBefore);
    const status = await reconcileAttempt(w.store, chain({ latestBlockTimestamp: async () => validBefore + 1 }), w.attemptId, { now: () => new Date(w.clock.ms + 90_000) });
    expect(status).toBe('not_settled');
    expect(w.store.getAttempt(w.attemptId)).toMatchObject({ status: 'failed' });
    expect(w.store.getOutcomeForAttempt(w.attemptId)).toMatchObject({ settlementStatus: 'failed', txHash: null });
    expect(w.store.getReservationForAttempt(w.attemptId)?.status).toBe('released');
    expect(await budgetLeft(w)).toBe(500000n);
  });

  it('uses chain time, not the local clock: a local clock far in the future does not release an unexpired authorisation', async () => {
    const w = await ambiguousWorld();
    const validBefore = Number(w.store.getSignerAuthorization(w.attemptId)?.validBefore);
    const status = await reconcileAttempt(w.store, chain({ latestBlockTimestamp: async () => validBefore - 10 }), w.attemptId, { now: () => new Date(w.clock.ms + 10 * 86_400_000) });
    expect(status).toBe('pending');
  });

  it('skips attempts that are not ambiguous and leaves them untouched', async () => {
    const w = makeWorld();
    expect(await reconcileAttempt(w.store, chain({ authorizationUsed: async () => true, findAuthorizationTx: async () => TX }), w.attemptId)).toBe('skipped');
    expect(w.store.getAttempt(w.attemptId)?.status).toBe('decided');
  });

  it('applyReconciliation refuses a non-ambiguous attempt', () => {
    const w = makeWorld();
    expect(() => w.store.applyReconciliation(w.attemptId, { kind: 'not_settled', at: new Date(w.clock.ms).toISOString() }, () => 'o')).toThrow(/ambiguous/);
    expect(w.store.getReservationForAttempt(w.attemptId)?.status).toBe('reserved');
  });
});

const sampleCase = (over: Partial<PaymentCase> = {}): PaymentCase => ({
  caseId: 'case-1',
  orgId: ORG,
  provenance: 'controlled_variant',
  attemptId: null,
  fixtureId: 'fx-1',
  quote: { amountAtomic: '80000', payTo: PAY_TO as `0x${string}`, network: 'eip155:84532', asset: '0x036cbd53842c5426634e7929541ec2318f3dcf7e', resourceUrl: 'http://localhost:4021/paid/report/safe', service: 'report' },
  context: { firstTimeCounterparty: true, periodBudgetRemainingAtomic: '500000' },
  evidence: { evidenceId: 'ev-c1', rawId: null, provenance: 'controlled_variant', address: PAY_TO as `0x${string}`, tier: 'CLEAR', providerScore: 0, reasons: [], unavailable: null, capturedAt: '2026-09-26T10:00:00.000Z', mappingVersion: 'test-0' },
  recorded: null,
  label: 'unknown',
  labelRevisions: [{ revision: 1, label: 'unknown', labelledBy: 'seed_script', rationale: 'seed', at: '2026-09-26T10:00:00.000Z' }],
  createdAt: '2026-09-26T10:00:00.000Z',
  ...over,
});

// T-031 (AC-015, INV-020): labels are appended, never overwritten; provenance never changes.
describe('cases and label revisions', () => {
  it('appends label revisions and keeps the full history; the current label is the latest', () => {
    const w = makeWorld();
    w.store.saveCase(sampleCase());
    const bad = w.store.appendLabel('case-1', { label: 'bad', labelledBy: 'owner', rationale: 'merchant did not deliver', at: '2026-09-26T11:00:00.000Z' });
    expect(bad.label).toBe('bad');
    expect(bad.labelRevisions.map((r) => [r.revision, r.label, r.labelledBy])).toEqual([[1, 'unknown', 'seed_script'], [2, 'bad', 'owner']]);
    const good = w.store.appendLabel('case-1', { label: 'good', labelledBy: 'owner', rationale: 'reviewed again', at: '2026-09-26T12:00:00.000Z' });
    expect(good.labelRevisions).toHaveLength(3);
    expect(good.labelRevisions[1]).toMatchObject({ label: 'bad', rationale: 'merchant did not deliver' }); // earlier revision intact
    expect(w.store.getCase('case-1')?.label).toBe('good');
  });

  it('records an IncidentLabelled audit event for every label change', () => {
    const w = makeWorld();
    w.store.saveCase(sampleCase());
    w.store.appendLabel('case-1', { label: 'bad', labelledBy: 'owner', rationale: 'r', at: '2026-09-26T11:00:00.000Z' });
    expect(w.store.listAudit().filter((e) => e.type === 'IncidentLabelled')).toHaveLength(1);
    expect(w.store.listAudit().at(-1)).toMatchObject({ actor: 'owner', refs: { caseId: 'case-1' } });
  });

  it('keeps provenance through persistence, and never lets a case be overwritten or relabelled', () => {
    const w = makeWorld();
    w.store.saveCase(sampleCase({ provenance: 'sponsor_fixture', evidence: { ...sampleCase().evidence, provenance: 'sponsor_fixture' } }));
    expect(w.store.getCase('case-1')?.provenance).toBe('sponsor_fixture');
    expect(() => w.store.saveCase(sampleCase({ provenance: 'real_live', evidence: { ...sampleCase().evidence, provenance: 'real_live' } }))).toThrow(/already exists/);
    w.store.appendLabel('case-1', { label: 'bad', labelledBy: 'owner', rationale: 'r', at: '2026-09-26T11:00:00.000Z' });
    expect(w.store.getCase('case-1')?.provenance).toBe('sponsor_fixture');
    expect(w.store.listCases(ORG).map((c) => c.provenance)).toEqual(['sponsor_fixture']);
  });

  it('refuses a real_live case backed by non-live evidence, and an unknown case id', () => {
    const w = makeWorld();
    expect(() => w.store.saveCase(sampleCase({ provenance: 'real_live' }))).toThrow(); // evidence is controlled_variant
    expect(() => w.store.appendLabel('missing', { label: 'bad', labelledBy: 'owner', rationale: 'r', at: '2026-09-26T11:00:00.000Z' })).toThrow(/not found/);
  });
});
