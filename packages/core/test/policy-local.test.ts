import { describe, expect, it } from 'vitest';
import { QUOTE_MAX_VALIDITY_S, canonicalQuoteSchema, decisionSchema, demoPolicyV1, evaluate, evaluateLocal, evaluateLocalFailClosed } from '../src/index.js';
import type { Action, ReasonCode } from '../src/index.js';
import { decisionInput, quoteInput } from './fixtures.js';
import { makeInput } from './policy-helpers.js';

const quote = (over: Record<string, unknown> = {}) => {
  const { maxTimeoutSeconds, ...rest } = over;
  const q = canonicalQuoteSchema.parse(quoteInput(rest));
  // the schema requires validity >= 1; the local stage must still catch a 0 that reaches it by any other route
  return maxTimeoutSeconds === undefined ? q : { ...q, maxTimeoutSeconds: maxTimeoutSeconds as number };
};
const policy = demoPolicyV1();

// T-009a (AC-035, INV-029): stage A needs no evidence and runs before any Intercepta call.
describe('evaluateLocal (stage A)', () => {
  it('passes a well-formed quote (null: it may be screened)', () => {
    expect(evaluateLocal(policy, quote())).toBeNull();
  });

  const rejects: [string, Record<string, unknown>, Action, ReasonCode][] = [
    ['scheme', { scheme: 'upto' }, 'DENY', 'SCHEME_NOT_SUPPORTED'],
    ['network', { network: 'eip155:8453' }, 'DENY', 'NETWORK_NOT_ALLOWED'],
    ['asset', { asset: `0x${'44'.repeat(20)}` }, 'DENY', 'ASSET_NOT_ALLOWED'],
    ['service scope', { resourceUrl: 'http://evil.example/paid/x' }, 'DENY', 'SERVICE_NOT_ALLOWED'],
    ['per-payment cap', { amountAtomic: '100001' }, 'DENY', 'OVER_PER_PAYMENT_CAP'],
    ['validity too short', { maxTimeoutSeconds: 0 }, 'HOLD', 'QUOTE_INVALID'],
    ['validity too long', { maxTimeoutSeconds: QUOTE_MAX_VALIDITY_S + 1 }, 'HOLD', 'QUOTE_INVALID'],
  ];
  it.each(rejects)('rejects %s without evidence and never as eligible', (_n, patch, action, code) => {
    const r = evaluateLocal(policy, quote(patch));
    expect(r).toMatchObject({ action, signerEligible: false, authorisedMaxAtomic: null });
    expect(r?.reasons.map((x) => x.code)).toEqual([code]);
  });

  it('accepts the validity bounds themselves', () => {
    expect(evaluateLocal(policy, quote({ maxTimeoutSeconds: 1 }))).toBeNull();
    expect(evaluateLocal(policy, quote({ maxTimeoutSeconds: QUOTE_MAX_VALIDITY_S }))).toBeNull();
  });

  it('first failing check wins (scheme before network before validity)', () => {
    expect(evaluateLocal(policy, quote({ scheme: 'upto', network: 'eip155:8453', maxTimeoutSeconds: 0 }))?.reasons[0]?.code).toBe('SCHEME_NOT_SUPPORTED');
    expect(evaluateLocal(policy, quote({ network: 'eip155:8453', maxTimeoutSeconds: 0 }))?.reasons[0]?.code).toBe('NETWORK_NOT_ALLOWED');
  });

  it('is fail-closed: an exception becomes HOLD/ENGINE_ERROR', () => {
    const broken = { ...quote(), amountAtomic: 'not-a-number' };
    expect(() => evaluateLocal(policy, broken)).toThrow();
    expect(evaluateLocalFailClosed(policy, broken)).toMatchObject({ action: 'HOLD', signerEligible: false });
  });

  it('evaluate() runs stage A first, so a locally rejected quote is decided even with no evidence at all', () => {
    const input = { ...makeInput({ quote: { network: 'eip155:8453' } }), evidence: null };
    expect(evaluate(input)).toMatchObject({ action: 'DENY' });
    expect(evaluate(input).reasons[0]?.code).toBe('NETWORK_NOT_ALLOWED');
  });

  it('stage B with null evidence fails closed (HOLD), never a pass', () => {
    const input = { ...makeInput(), evidence: null };
    const r = evaluate(input);
    expect(r).toMatchObject({ action: 'HOLD', signerEligible: false });
    expect(r.reasons[0]?.code).toBe('EVIDENCE_UNAVAILABLE');
  });
});

// INV-009: a Decision without evidence is never signer-eligible.
describe('Decision evidence rule (INV-009)', () => {
  it('accepts a stage-A rejection with no evidence id', () => {
    expect(decisionSchema.safeParse(decisionInput({ evidenceId: null, action: 'DENY', signerEligible: false, authorisedMaxAtomic: null, reasons: [{ code: 'NETWORK_NOT_ALLOWED', ruleId: null }] })).success).toBe(true);
  });

  it('rejects a signer-eligible decision without evidence', () => {
    expect(decisionSchema.safeParse(decisionInput({ evidenceId: null })).success).toBe(false);
  });

  it('still requires the evidenceId key to be present', () => {
    const d: Record<string, unknown> = decisionInput();
    delete d.evidenceId;
    expect(decisionSchema.safeParse(d).success).toBe(false);
  });
});
