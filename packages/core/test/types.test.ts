import { describe, expect, it } from 'vitest';
import {
  HARD_PROHIBITIONS,
  PROVENANCES,
  assertSameProvenance,
  canonicalQuoteSchema,
  countProvenance,
  decisionSchema,
  isLiveProvenance,
  paymentAttemptSchema,
  paymentCaseSchema,
  paymentOutcomeSchema,
  paymentPolicySchema,
  riskEvidenceSchema,
  riskProfileSchema,
  ruleSchema,
  spendReservationSchema,
  unsealedPolicySchema,
} from '../src/index.js';
import {
  PAY_TO_SAFE,
  T0,
  T1,
  USDC,
  attemptInput,
  caseInput,
  decisionInput,
  evidenceInput,
  profileInput,
  quoteInput,
  unsealedPolicyInput,
} from './fixtures.js';

const rejects = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) =>
  expect(schema.safeParse(value).success).toBe(false);

describe('quote schema', () => {
  it('lowercases addresses and normalises the resource URL', () => {
    const q = canonicalQuoteSchema.parse(quoteInput({ asset: USDC, payTo: PAY_TO_SAFE.toUpperCase().replace('0X', '0x'), resourceUrl: 'http://LOCALHOST:4021/a b' }));
    expect(q.asset).toBe(USDC.toLowerCase());
    expect(q.payTo).toBe(PAY_TO_SAFE.toLowerCase());
    expect(q.resourceUrl).toBe('http://localhost:4021/a%20b');
  });

  it('rejects float or numeric amounts and unknown keys (strict)', () => {
    rejects(canonicalQuoteSchema, quoteInput({ amountAtomic: 0.05 }));
    rejects(canonicalQuoteSchema, quoteInput({ amountAtomic: '0.05' }));
    rejects(canonicalQuoteSchema, { ...quoteInput(), extra: 1 });
  });
});

describe('profile and policy schemas', () => {
  it('requires the complete hard-prohibition set exactly once (INV-015)', () => {
    expect(riskProfileSchema.safeParse(profileInput()).success).toBe(true);
    for (const missing of HARD_PROHIBITIONS) {
      rejects(riskProfileSchema, profileInput({ hardProhibitions: HARD_PROHIBITIONS.filter((h) => h !== missing) }));
    }
    rejects(riskProfileSchema, profileInput({ hardProhibitions: [...HARD_PROHIBITIONS, 'EVIDENCE_BLOCK'] }));
  });

  it('pins the network to Base Sepolia (INV-006)', () => {
    rejects(riskProfileSchema, profileInput({ network: 'eip155:8453' }));
  });

  it('requires capAtomic exactly for CAP rules', () => {
    rejects(ruleSchema, { ruleId: 'r', description: '', when: [], then: { action: 'CAP' } });
    rejects(ruleSchema, { ruleId: 'r', description: '', when: [], then: { action: 'PAY', capAtomic: '1' } });
    expect(ruleSchema.safeParse({ ruleId: 'r', description: '', when: [], then: { action: 'CAP', capAtomic: '20000' } }).success).toBe(true);
  });

  it('rejects a default action that pays, duplicate rule ids and a non-increasing parent version', () => {
    rejects(unsealedPolicySchema, unsealedPolicyInput({ defaultAction: 'PAY' }));
    rejects(unsealedPolicySchema, unsealedPolicyInput({ defaultAction: 'CAP' }));
    const rule = { ruleId: 'R1', description: '', when: [], then: { action: 'PAY' } };
    rejects(unsealedPolicySchema, unsealedPolicyInput({ rules: [rule, rule] }));
    rejects(unsealedPolicySchema, unsealedPolicyInput({ policyVersion: 2, parentVersion: 2 }));
    expect(unsealedPolicySchema.safeParse(unsealedPolicyInput({ policyVersion: 2, parentVersion: 1 })).success).toBe(true);
  });

  it('a sealed policy needs a hash', () => {
    rejects(paymentPolicySchema, unsealedPolicyInput());
  });
});

describe('evidence schema', () => {
  it('sets unavailable exactly when the tier is UNAVAILABLE', () => {
    rejects(riskEvidenceSchema, evidenceInput({ tier: 'UNAVAILABLE', unavailable: null }));
    rejects(riskEvidenceSchema, evidenceInput({ tier: 'CLEAR', unavailable: 'TIMEOUT' }));
    expect(riskEvidenceSchema.safeParse(evidenceInput({ tier: 'UNAVAILABLE', unavailable: 'TIMEOUT' })).success).toBe(true);
  });
});

// INV-009: every decision records version, evidence, quote hash, action and reasons.
describe('decision schema', () => {
  it('accepts a complete eligible PAY decision', () => {
    expect(decisionSchema.safeParse(decisionInput()).success).toBe(true);
  });

  it.each(['policyVersion', 'evidenceId', 'quoteHash', 'action', 'policyHash'])('rejects a decision missing %s', (field) => {
    const d: Record<string, unknown> = decisionInput();
    delete d[field];
    rejects(decisionSchema, d);
  });

  it('requires at least one reason code', () => {
    rejects(decisionSchema, decisionInput({ reasons: [] }));
  });

  it.each(['HOLD', 'DENY', 'ASK_HUMAN'])('a %s decision can never be signer-eligible (INV-002)', (action) => {
    rejects(decisionSchema, decisionInput({ action, signerEligible: true }));
  });

  it('an eligible decision needs authorisedMaxAtomic; expiry must follow decision time', () => {
    rejects(decisionSchema, decisionInput({ authorisedMaxAtomic: null }));
    rejects(decisionSchema, decisionInput({ expiresAt: T1 }));
  });
});

// INV-019: signer timestamp ordering.
describe('attempt schema', () => {
  it('accepts an attempt with no signer call and no signer timestamp', () => {
    expect(paymentAttemptSchema.safeParse(attemptInput()).success).toBe(true);
  });

  it('accepts a signed attempt whose signer timestamp follows the Intercepta return', () => {
    expect(
      paymentAttemptSchema.safeParse(attemptInput({ status: 'signed', signerCalls: 1, signerInvokedAt: '2026-09-26T10:00:06.000Z' })).success,
    ).toBe(true);
  });

  it('rejects a signer timestamp at or before the Intercepta return, or without a return', () => {
    rejects(paymentAttemptSchema, attemptInput({ signerCalls: 1, signerInvokedAt: T1 }));
    rejects(paymentAttemptSchema, attemptInput({ signerCalls: 1, signerInvokedAt: T0 }));
    rejects(paymentAttemptSchema, attemptInput({ signerCalls: 1, signerInvokedAt: T1, interceptaReturnedAt: null }));
  });

  it('keeps signerCalls and signerInvokedAt consistent', () => {
    rejects(paymentAttemptSchema, attemptInput({ signerCalls: 2 }));
    rejects(paymentAttemptSchema, attemptInput({ signerCalls: 0, signerInvokedAt: '2026-09-26T10:00:06.000Z' }));
  });
});

describe('reservation and outcome schemas', () => {
  const reservation = {
    reservationId: 'res-1',
    orgId: 'org-1',
    attemptId: 'att-1',
    periodKey: 20000,
    amountAtomic: '50000',
    status: 'reserved',
    createdAt: T0,
    expiresAt: T1,
    committedAtomic: null,
  };
  it('a committed reservation needs committedAtomic', () => {
    expect(spendReservationSchema.safeParse(reservation).success).toBe(true);
    rejects(spendReservationSchema, { ...reservation, status: 'committed' });
    expect(spendReservationSchema.safeParse({ ...reservation, status: 'committed', committedAtomic: '50000' }).success).toBe(true);
  });

  it('records settlement and delivery separately; a settled outcome needs a tx hash (INV-014)', () => {
    const outcome = {
      outcomeId: 'o-1',
      attemptId: 'att-1',
      settlementStatus: 'settled',
      txHash: `0x${'ef'.repeat(32)}`,
      facilitatorRef: null,
      deliveryStatus: 'not_received',
      httpStatus: 500,
      observedAt: T1,
    };
    expect(paymentOutcomeSchema.safeParse(outcome).success).toBe(true);
    rejects(paymentOutcomeSchema, { ...outcome, txHash: null });
    expect(paymentOutcomeSchema.safeParse({ ...outcome, settlementStatus: 'ambiguous', txHash: null }).success).toBe(true);
  });
});

// T-016 (INV-012, INV-020): provenance and label revisions.
describe('provenance and case labels', () => {
  it('lists exactly the four labels', () => {
    expect([...PROVENANCES]).toEqual(['real_live', 'sponsor_fixture', 'controlled_variant', 'synthetic']);
  });

  it('survives a zod parse and a JSON round trip unchanged', () => {
    for (const provenance of PROVENANCES) {
      const evidence = evidenceInput({ provenance });
      const parsed = paymentCaseSchema.parse(caseInput({ provenance, evidence }));
      const again = paymentCaseSchema.parse(JSON.parse(JSON.stringify(parsed)));
      expect(again.provenance).toBe(provenance);
      expect(again.evidence.provenance).toBe(provenance);
    }
  });

  it('rejects an unknown or missing provenance label', () => {
    rejects(paymentCaseSchema, caseInput({ provenance: 'live' }));
    const c: Record<string, unknown> = { ...caseInput() };
    delete c.provenance;
    rejects(paymentCaseSchema, c);
  });

  it('never lets non-live evidence be presented in a real_live case', () => {
    rejects(paymentCaseSchema, caseInput({ provenance: 'real_live', evidence: evidenceInput({ provenance: 'synthetic' }) }));
    expect(paymentCaseSchema.safeParse(caseInput({ provenance: 'real_live', evidence: evidenceInput({ provenance: 'real_live' }) })).success).toBe(true);
  });

  it('refuses relabelling', () => {
    expect(() => assertSameProvenance('synthetic', 'real_live', 'case-1')).toThrow(/immutable/);
    expect(() => assertSameProvenance('real_live', 'real_live', 'case-1')).not.toThrow();
  });

  it('only real_live counts as live', () => {
    expect(PROVENANCES.filter(isLiveProvenance)).toEqual(['real_live']);
  });

  it('counts a provenance mix', () => {
    expect(countProvenance([{ provenance: 'synthetic' }, { provenance: 'synthetic' }, { provenance: 'real_live' }])).toEqual({
      real_live: 1,
      sponsor_fixture: 0,
      controlled_variant: 0,
      synthetic: 2,
    });
  });

  it('keeps label revisions append-only, numbered 1..n, ending in the current label (INV-020)', () => {
    const rev = (revision: number, label: 'good' | 'bad' | 'unknown') => ({ revision, label, labelledBy: 'owner', rationale: 'r', at: T1 });
    expect(
      paymentCaseSchema.safeParse(caseInput({ label: 'bad', labelRevisions: [rev(1, 'unknown'), rev(2, 'bad')] })).success,
    ).toBe(true);
    rejects(paymentCaseSchema, caseInput({ label: 'bad', labelRevisions: [rev(1, 'unknown'), rev(3, 'bad')] }));
    rejects(paymentCaseSchema, caseInput({ label: 'good', labelRevisions: [rev(1, 'unknown'), rev(2, 'bad')] }));
    rejects(paymentCaseSchema, caseInput({ labelRevisions: [] }));
  });
});
