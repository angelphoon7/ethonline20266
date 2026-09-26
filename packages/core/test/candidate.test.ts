import { describe, expect, it } from 'vitest';
import { demoCandidates, demoPolicyV1, demoProfile, sealPolicy, validateCandidate } from '../src/index.js';
import type { PaymentPolicy, UnsealedPolicy } from '../src/index.js';

const base = demoPolicyV1();
const errorsOf = (c: unknown, b: PaymentPolicy = base) => {
  const r = validateCandidate(c, b);
  return r.ok ? [] : r.errors;
};

// T-010: candidate validation.
describe('validateCandidate', () => {
  it('accepts the demo candidates A, B and C', () => {
    for (const c of demoCandidates(base)) expect(validateCandidate(c.policy, base), c.key).toEqual({ ok: true });
  });

  const body = (over: Partial<UnsealedPolicy> = {}): UnsealedPolicy => ({
    policyVersion: 2,
    parentVersion: 1,
    profile: base.profile,
    rules: base.rules,
    defaultAction: 'HOLD',
    ...over,
  });

  it('rejects a default action that pays or caps', () => {
    for (const defaultAction of ['PAY', 'CAP']) {
      expect(errorsOf({ ...sealPolicy(body()), defaultAction }).length).toBeGreaterThan(0);
    }
  });

  it('rejects a missing hard prohibition', () => {
    const profile = { ...base.profile, hardProhibitions: base.profile.hardProhibitions.filter((h) => h !== 'EVIDENCE_BLOCK') };
    expect(errorsOf({ ...sealPolicy(body()), profile }).join()).toMatch(/hardProhibitions/);
  });

  it('rejects a CAP rule without capAtomic and duplicate rule ids', () => {
    const rules = [{ ruleId: 'K', description: '', when: [], then: { action: 'CAP' } }];
    expect(errorsOf({ ...sealPolicy(body()), rules }).join()).toMatch(/capAtomic/);
    const dup = [base.rules[0], base.rules[0]];
    expect(errorsOf({ ...sealPolicy(body()), rules: dup }).join()).toMatch(/unique/);
  });

  it('rejects a changed network or asset (INV-006)', () => {
    expect(errorsOf({ ...sealPolicy(body()), profile: { ...base.profile, network: 'eip155:8453' } }).length).toBeGreaterThan(0);
    const otherAsset = sealPolicy(body({ profile: { ...base.profile, asset: `0x${'44'.repeat(20)}` } }));
    expect(errorsOf(otherAsset).join()).toMatch(/asset must match/);
  });

  it('rejects a candidate that loosens limits, or a limit above the live per-payment cap', () => {
    const looser = sealPolicy(body({ profile: { ...base.profile, maxPerPaymentAtomic: '100001' } }));
    expect(errorsOf(looser).join()).toMatch(/maxPerPaymentAtomic may not exceed the base/);
    const morePeriod = sealPolicy(body({ profile: { ...base.profile, periodCapAtomic: '500001' } }));
    expect(errorsOf(morePeriod).join()).toMatch(/periodCapAtomic/);
    const bigBase = sealPolicy({ ...body({ policyVersion: 1, parentVersion: null }), profile: { ...base.profile, maxPerPaymentAtomic: '200000' } });
    const bigCand = sealPolicy(body({ profile: { ...bigBase.profile } }));
    expect(errorsOf(bigCand, bigBase).join()).toMatch(/live per-payment limit/);
  });

  it('rejects a wrong parent or a non-increasing version', () => {
    expect(errorsOf(sealPolicy(body({ policyVersion: 3, parentVersion: 2 }))).join()).toMatch(/parentVersion must equal/);
    expect(errorsOf(sealPolicy(body({ policyVersion: 1, parentVersion: null }))).join()).toMatch(/greater than/);
  });

  it('rejects a tampered policy hash and another organisation', () => {
    const tampered = { ...sealPolicy(body()), defaultAction: 'DENY' as const };
    expect(errorsOf(tampered).join()).toMatch(/policyHash/);
    const otherOrg = sealPolicy(body({ profile: demoProfile() && { ...base.profile, orgId: 'org-other' } }));
    expect(errorsOf(otherOrg).join()).toMatch(/orgId/);
  });

  it('rejects non-policy input without throwing', () => {
    expect(errorsOf(null).length).toBeGreaterThan(0);
    expect(errorsOf({}).length).toBeGreaterThan(0);
  });
});
