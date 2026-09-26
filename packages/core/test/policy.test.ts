import { describe, expect, it } from 'vitest';
import { demoCandidates, demoPolicyV1, evaluate, evaluateFailClosed } from '../src/index.js';
import type { Action, EvaluateInput, ReasonCode } from '../src/index.js';
import { STALE, makeApproval, makeInput, policyWithRules } from './policy-helpers.js';

const codes = (r: { reasons: { code: ReasonCode }[] }) => r.reasons.map((x) => x.code);

// T-005 (AC-030): each of the five actions is reachable.
describe('five actions are reachable', () => {
  it('PAY', () => {
    const r = evaluate(makeInput());
    expect(r).toMatchObject({ action: 'PAY', signerEligible: true, authorisedMaxAtomic: '50000' });
    expect(r.reasons).toEqual([{ code: 'RULE_MATCHED', ruleId: 'R1' }]);
  });

  it('CAP', () => {
    const policy = policyWithRules([{ ruleId: 'C', description: '', when: [], then: { action: 'CAP', capAtomic: '60000' } }]);
    expect(evaluate(makeInput({ policy }))).toMatchObject({ action: 'CAP', signerEligible: true, authorisedMaxAtomic: '50000' });
  });

  it('HOLD', () => {
    const r = evaluate(makeInput({ policy: policyWithRules([]) }));
    expect(r).toMatchObject({ action: 'HOLD', signerEligible: false, authorisedMaxAtomic: null });
    expect(r.reasons).toEqual([{ code: 'NO_RULE_MATCHED', ruleId: null }]);
  });

  it('ASK_HUMAN', () => {
    const r = evaluate(makeInput({ evidence: { tier: 'WARN' }, quote: { amountAtomic: '60000' } }));
    expect(r).toMatchObject({ action: 'ASK_HUMAN', signerEligible: false });
    expect(codes(r)).toEqual(['RULE_MATCHED', 'APPROVAL_PENDING']);
  });

  it('DENY', () => {
    expect(evaluate(makeInput({ evidence: { tier: 'BLOCK' } }))).toMatchObject({ action: 'DENY', signerEligible: false });
  });
});

// T-006: evaluation order 1-11.
describe('evaluation order (SPEC section 9)', () => {
  const steps: [string, Parameters<typeof makeInput>[0], Action, ReasonCode][] = [
    ['1 scheme', { quote: { scheme: 'upto' } }, 'DENY', 'SCHEME_NOT_SUPPORTED'],
    ['2 network', { quote: { network: 'eip155:8453' } }, 'DENY', 'NETWORK_NOT_ALLOWED'],
    ['3 asset', { quote: { asset: `0x${'44'.repeat(20)}` } }, 'DENY', 'ASSET_NOT_ALLOWED'],
    ['4 service', { quote: { resourceUrl: 'http://evil.example/paid/x' } }, 'DENY', 'SERVICE_NOT_ALLOWED'],
    ['5 per-payment cap', { quote: { amountAtomic: '100001' } }, 'DENY', 'OVER_PER_PAYMENT_CAP'],
    ['6 unavailable evidence', { evidence: { tier: 'UNAVAILABLE', unavailable: 'TIMEOUT' } }, 'HOLD', 'EVIDENCE_UNAVAILABLE'],
    ['7 stale evidence', { evidence: { capturedAt: STALE } }, 'HOLD', 'EVIDENCE_STALE'],
    ['8 evidence block', { evidence: { tier: 'BLOCK' } }, 'DENY', 'EVIDENCE_BLOCK'],
    ['9 period budget', { context: { periodBudgetRemainingAtomic: '49999' } }, 'HOLD', 'PERIOD_CAP_EXCEEDED'],
  ];
  it.each(steps)('step %s', (_n, overrides, action, code) => {
    const r = evaluate(makeInput(overrides));
    expect(r.action).toBe(action);
    expect(codes(r)).toEqual([code]);
    expect(r.signerEligible).toBe(false);
  });

  it('the first failing step wins', () => {
    // wrong network AND block AND unavailable-style problems: step 2 answers first
    expect(codes(evaluate(makeInput({ quote: { network: 'eip155:8453' }, evidence: { tier: 'BLOCK' } })))).toEqual(['NETWORK_NOT_ALLOWED']);
    // over the per-payment cap beats unavailable evidence (5 before 6)
    expect(codes(evaluate(makeInput({ quote: { amountAtomic: '100001' }, evidence: { tier: 'UNAVAILABLE', unavailable: 'TIMEOUT' } })))).toEqual(['OVER_PER_PAYMENT_CAP']);
    // stale BLOCK is HOLD, not DENY (7 before 8)
    expect(codes(evaluate(makeInput({ evidence: { tier: 'BLOCK', capturedAt: STALE } })))).toEqual(['EVIDENCE_STALE']);
    // BLOCK beats budget (8 before 9)
    expect(codes(evaluate(makeInput({ evidence: { tier: 'BLOCK' }, context: { periodBudgetRemainingAtomic: '0' } })))).toEqual(['EVIDENCE_BLOCK']);
  });

  it('boundaries are inclusive: amount == per-payment cap, amount == budget, evidence exactly 30 s old', () => {
    expect(evaluate(makeInput({ quote: { amountAtomic: '100000' } })).action).toBe('PAY');
    expect(evaluate(makeInput({ context: { periodBudgetRemainingAtomic: '50000' } })).action).toBe('PAY');
    expect(evaluate(makeInput({ evidence: { capturedAt: '2026-09-26T10:00:00.000Z' } })).action).toBe('PAY');
    expect(evaluate(makeInput({ evidence: { capturedAt: '2026-09-26T09:59:59.999Z' } })).action).toBe('HOLD');
  });

  it('a hard prohibition cannot be overridden by a catch-all PAY rule (INV-015)', () => {
    const payAll = policyWithRules([{ ruleId: 'ALL', description: 'pay everything', when: [], then: { action: 'PAY' } }]);
    for (const overrides of [
      { quote: { scheme: 'upto' } },
      { quote: { network: 'eip155:8453' } },
      { quote: { asset: `0x${'44'.repeat(20)}` } },
      { quote: { resourceUrl: 'http://evil.example/paid/x' } },
      { quote: { amountAtomic: '100001' } },
      { evidence: { tier: 'BLOCK' as const } },
    ]) {
      const r = evaluate(makeInput({ policy: payAll, ...overrides }));
      expect(r.action).toBe('DENY');
      expect(r.signerEligible).toBe(false);
    }
  });

  it('a default action is applied only when no rule matches', () => {
    const p = policyWithRules([{ ruleId: 'W', description: '', when: [{ kind: 'evidenceTier', in: ['WARN'] }], then: { action: 'PAY' } }], 'DENY');
    expect(evaluate(makeInput({ policy: p })).action).toBe('DENY'); // CLEAR: no rule, default
    expect(evaluate(makeInput({ policy: p, evidence: { tier: 'WARN' } })).action).toBe('PAY');
  });

  it('a default of ASK_HUMAN follows the same approval path', () => {
    const p = policyWithRules([], 'ASK_HUMAN');
    const input = makeInput({ policy: p });
    expect(codes(evaluate(input))).toEqual(['NO_RULE_MATCHED', 'APPROVAL_PENDING']);
    expect(evaluate({ ...input, approval: makeApproval(input) })).toMatchObject({ action: 'PAY', signerEligible: true });
  });
});

// T-007 (INV-003): unusable evidence is HOLD whatever the rules say.
describe('fail closed on evidence', () => {
  const payAll = policyWithRules([{ ruleId: 'ALL', description: 'pay everything', when: [], then: { action: 'PAY' } }]);

  it.each(['TIMEOUT', 'HTTP_ERROR', 'RATE_LIMITED', 'MALFORMED', 'STALE', 'NO_KEY'] as const)('UNAVAILABLE(%s) is HOLD even with a catch-all PAY rule', (unavailable) => {
    const r = evaluate(makeInput({ policy: payAll, evidence: { tier: 'UNAVAILABLE', unavailable } }));
    expect(r).toMatchObject({ action: 'HOLD', signerEligible: false });
    expect(codes(r)).toEqual(['EVIDENCE_UNAVAILABLE']);
  });

  it('stale evidence is HOLD even with a catch-all PAY rule', () => {
    expect(evaluate(makeInput({ policy: payAll, evidence: { capturedAt: STALE } })).action).toBe('HOLD');
  });

  it('evidence captured after now (clock skew) fails closed', () => {
    expect(codes(evaluate(makeInput({ policy: payAll, evidence: { capturedAt: '2026-09-26T10:01:00.000Z' } })))).toEqual(['EVIDENCE_STALE']);
  });

  it('evidence about a different address is unusable (INV-001)', () => {
    const r = evaluate(makeInput({ policy: payAll, evidence: { address: `0x${'99'.repeat(20)}` } }));
    expect(r).toMatchObject({ action: 'HOLD', signerEligible: false });
    expect(codes(r)).toEqual(['EVIDENCE_UNAVAILABLE']);
  });

  it('an unknown provider score never satisfies a score predicate', () => {
    const p = policyWithRules([{ ruleId: 'S', description: '', when: [{ kind: 'providerScore', max: 100 }], then: { action: 'PAY' } }]);
    expect(evaluate(makeInput({ policy: p, evidence: { providerScore: null } })).action).toBe('HOLD');
    expect(evaluate(makeInput({ policy: p, evidence: { providerScore: 100 } })).action).toBe('PAY');
    expect(evaluate(makeInput({ policy: p, evidence: { providerScore: 100.5 } })).action).toBe('HOLD');
  });

  it('evaluateFailClosed turns any exception into HOLD/ENGINE_ERROR', () => {
    const bad = makeInput({ context: { periodBudgetRemainingAtomic: 'not-a-number' } });
    expect(() => evaluate(bad)).toThrow();
    expect(evaluateFailClosed(bad)).toMatchObject({ action: 'HOLD', signerEligible: false });
    expect(codes(evaluateFailClosed(bad))).toEqual(['ENGINE_ERROR']);
  });
});

// T-008 (INV-002, ADR-008): CAP is a maximum authorised amount, never a price reduction.
describe('CAP semantics', () => {
  const capAt = (cap: string) => policyWithRules([{ ruleId: 'C', description: '', when: [], then: { action: 'CAP', capAtomic: cap } }]);

  it('is eligible at or below the cap and authorises exactly the quote amount', () => {
    expect(evaluate(makeInput({ policy: capAt('60000') }))).toMatchObject({ action: 'CAP', signerEligible: true, authorisedMaxAtomic: '50000' });
    expect(evaluate(makeInput({ policy: capAt('50000') }))).toMatchObject({ signerEligible: true, authorisedMaxAtomic: '50000' });
  });

  it('is NOT signer-eligible when the exact quote is above the cap, and reports CAP_BELOW_QUOTE', () => {
    const r = evaluate(makeInput({ policy: capAt('49999') }));
    expect(r).toMatchObject({ action: 'CAP', signerEligible: false, authorisedMaxAtomic: '49999' });
    expect(codes(r)).toEqual(['RULE_MATCHED', 'CAP_BELOW_QUOTE']);
  });

  it('never authorises more than the quote amount', () => {
    const r = evaluate(makeInput({ policy: capAt('100000') }));
    expect(r.authorisedMaxAtomic).toBe('50000');
  });
});

// T-009 (INV-004, INV-005, INV-015, INV-017): ASK_HUMAN and approvals.
describe('ASK_HUMAN and approvals', () => {
  const ask = () => makeInput({ evidence: { tier: 'WARN' }, quote: { amountAtomic: '60000' } });

  it('is pending and not eligible without an approval', () => {
    expect(evaluate(ask())).toMatchObject({ action: 'ASK_HUMAN', signerEligible: false, approvalId: null });
  });

  it('a valid scoped approval becomes PAY with HUMAN_APPROVED', () => {
    const input = ask();
    const r = evaluate({ ...input, approval: makeApproval(input) });
    expect(r).toMatchObject({ action: 'PAY', signerEligible: true, authorisedMaxAtomic: '60000', approvalId: 'appr-1' });
    expect(codes(r)).toEqual(['RULE_MATCHED', 'HUMAN_APPROVED']);
  });

  const invalid: [string, (i: EvaluateInput) => Partial<ReturnType<typeof makeApproval>>, ReasonCode][] = [
    ['different quote hash', () => ({ quoteHash: `0x${'00'.repeat(32)}` }), 'QUOTE_MUTATED'],
    ['different policy version', () => ({ policyVersion: 2 }), 'POLICY_CHANGED'],
    ['expired at now', () => ({ expiresAt: '2026-09-26T10:00:30.000Z' }), 'APPROVAL_EXPIRED'],
    ['expired in the past', () => ({ expiresAt: '2026-09-26T10:00:00.000Z' }), 'APPROVAL_EXPIRED'],
    ['max amount below the quote', () => ({ maxAmountAtomic: '59999' }), 'APPROVAL_PENDING'],
    ['different attempt', () => ({ attemptId: 'att-other' }), 'APPROVAL_PENDING'],
  ];
  it.each(invalid)('an approval with a %s does not sign', (_n, patch, code) => {
    const input = ask();
    const r = evaluate({ ...input, approval: makeApproval(input, patch(input)) });
    expect(r).toMatchObject({ action: 'ASK_HUMAN', signerEligible: false, approvalId: null });
    expect(codes(r)).toEqual(['RULE_MATCHED', code]);
  });

  it('a mutated quote invalidates an approval made for the original (INV-005)', () => {
    const original = ask();
    const approval = makeApproval(original);
    const mutated = makeInput({ evidence: { tier: 'WARN' }, quote: { amountAtomic: '60000', payTo: `0x${'55'.repeat(20)}` } });
    expect(evaluate({ ...mutated, approval }).signerEligible).toBe(false);
  });

  it('an approval never overrides a hard prohibition or unusable evidence (INV-015)', () => {
    const cases: Parameters<typeof makeInput>[0][] = [
      { quote: { amountAtomic: '60000', network: 'eip155:8453' }, evidence: { tier: 'WARN' } },
      { quote: { amountAtomic: '60000', asset: `0x${'44'.repeat(20)}` }, evidence: { tier: 'WARN' } },
      { quote: { amountAtomic: '60000', scheme: 'upto' }, evidence: { tier: 'WARN' } },
      { quote: { amountAtomic: '60000' }, evidence: { tier: 'BLOCK' } },
      { quote: { amountAtomic: '60000' }, evidence: { tier: 'UNAVAILABLE', unavailable: 'TIMEOUT' } },
      { quote: { amountAtomic: '60000' }, evidence: { tier: 'WARN', capturedAt: STALE } },
      { quote: { amountAtomic: '60000' }, evidence: { tier: 'WARN' }, context: { periodBudgetRemainingAtomic: '1' } },
    ];
    for (const c of cases) {
      const input = makeInput(c);
      const r = evaluate({ ...input, approval: makeApproval(input) });
      expect(r.signerEligible, JSON.stringify(c)).toBe(false);
      expect(r.action).not.toBe('PAY');
    }
  });

  it('an approval is ignored when the winning rule is not ASK_HUMAN', () => {
    const input = makeInput();
    const r = evaluate({ ...input, approval: makeApproval(input) });
    expect(r).toMatchObject({ action: 'PAY', approvalId: null });
    expect(codes(r)).toEqual(['RULE_MATCHED']);
  });
});

// AC-020 / SPEC 22: same evidence, different context or profile, different authorised action.
describe('company context changes the action on identical evidence', () => {
  const [candA, candB, candC] = demoCandidates().map((c) => c.policy) as [ReturnType<typeof demoPolicyV1>, ReturnType<typeof demoPolicyV1>, ReturnType<typeof demoPolicyV1>];
  const first = { context: { firstTimeCounterparty: true } };

  it('v1 pays a first-time CLEAR counterparty; A holds, B caps below the quote, C asks a human', () => {
    expect(evaluate(makeInput(first)).action).toBe('PAY');
    expect(evaluate(makeInput({ policy: candA, ...first })).action).toBe('HOLD');
    const b = evaluate(makeInput({ policy: candB, ...first }));
    expect(b).toMatchObject({ action: 'CAP', signerEligible: false, authorisedMaxAtomic: '20000' });
    expect(codes(b)).toEqual(['RULE_MATCHED', 'CAP_BELOW_QUOTE']);
    expect(evaluate(makeInput({ policy: candC, ...first })).action).toBe('ASK_HUMAN');
  });

  it('a known counterparty is unaffected by B and C; a small first payment falls through to R1', () => {
    expect(evaluate(makeInput({ policy: candB })).action).toBe('PAY');
    expect(evaluate(makeInput({ policy: candC })).action).toBe('PAY');
    expect(evaluate(makeInput({ policy: candB, quote: { amountAtomic: '20000' }, ...first })).action).toBe('PAY');
    expect(evaluate(makeInput({ policy: candB, quote: { amountAtomic: '30000' }, ...first })).signerEligible).toBe(false);
  });

  it('a different profile (tighter per-payment limit) denies the same quote', () => {
    const tight = policyWithRules(demoPolicyV1().rules);
    const stricter = { ...tight, profile: { ...tight.profile, maxPerPaymentAtomic: '40000' } };
    expect(evaluate(makeInput({ policy: stricter })).action).toBe('DENY'); // policyHash is not re-checked by evaluate; hashing is the store's job
    expect(evaluate(makeInput()).action).toBe('PAY');
  });

  it('the same amount gets a different action under different budget remaining', () => {
    expect(evaluate(makeInput({ context: { periodBudgetRemainingAtomic: '500000' } })).action).toBe('PAY');
    expect(evaluate(makeInput({ context: { periodBudgetRemainingAtomic: '10000' } })).action).toBe('HOLD');
  });
});

describe('predicates', () => {
  const rule = (when: Parameters<typeof policyWithRules>[0][number]['when']) =>
    policyWithRules([{ ruleId: 'P', description: '', when, then: { action: 'PAY' } }]);

  it('amount and budget ranges are inclusive', () => {
    expect(evaluate(makeInput({ policy: rule([{ kind: 'amount', minAtomic: '50000', maxAtomic: '50000' }]) })).action).toBe('PAY');
    expect(evaluate(makeInput({ policy: rule([{ kind: 'amount', minAtomic: '50001' }]) })).action).toBe('HOLD');
    expect(evaluate(makeInput({ policy: rule([{ kind: 'budgetRemaining', maxAtomic: '500000' }]) })).action).toBe('PAY');
    expect(evaluate(makeInput({ policy: rule([{ kind: 'budgetRemaining', maxAtomic: '499999' }]) })).action).toBe('HOLD');
  });

  it('service and first-time predicates match on the gate-provided context', () => {
    expect(evaluate(makeInput({ policy: rule([{ kind: 'service', in: ['report'] }]) })).action).toBe('PAY');
    expect(evaluate(makeInput({ policy: rule([{ kind: 'service', in: ['other'] }]) })).action).toBe('HOLD');
    expect(evaluate(makeInput({ policy: rule([{ kind: 'firstTimeCounterparty', value: true }]) })).action).toBe('HOLD');
  });

  it('predicates within a rule are ANDed and the first matching rule wins', () => {
    const p = policyWithRules([
      { ruleId: 'X', description: '', when: [{ kind: 'evidenceTier', in: ['CLEAR'] }, { kind: 'amount', maxAtomic: '1' }], then: { action: 'DENY' } },
      { ruleId: 'Y', description: '', when: [{ kind: 'evidenceTier', in: ['CLEAR'] }], then: { action: 'HOLD' } },
      { ruleId: 'Z', description: '', when: [], then: { action: 'PAY' } },
    ]);
    const r = evaluate(makeInput({ policy: p }));
    expect(r.action).toBe('HOLD');
    expect(r.reasons[0]).toEqual({ code: 'RULE_MATCHED', ruleId: 'Y' });
  });
});

// INV-023: determinism and no mutation of inputs.
describe('purity', () => {
  const deepFreeze = <T>(o: T): T => {
    if (o !== null && typeof o === 'object') {
      Object.values(o as object).forEach(deepFreeze);
      Object.freeze(o);
    }
    return o;
  };

  it('returns identical results for identical input and does not mutate it', () => {
    const input = deepFreeze(makeInput({ evidence: { tier: 'WARN' }, quote: { amountAtomic: '60000' } }));
    const a = evaluate(input);
    const b = evaluate(input);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('depends on `now` only through the passed-in value', () => {
    const at = (now: string) => evaluate(makeInput({ now })).action;
    expect(at('2026-09-26T10:00:30.000Z')).toBe('PAY');
    expect(at('2026-09-26T10:01:00.000Z')).toBe('HOLD'); // evidence now 35 s old
  });
});
