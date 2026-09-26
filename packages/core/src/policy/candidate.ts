import { LIVE_LIMITS } from '../constants.js';
import { verifyPolicyHash } from '../fingerprint.js';
import { parseAtomic } from '../money.js';
import { HARD_PROHIBITIONS, paymentPolicySchema } from '../types.js';
import type { PaymentPolicy } from '../types.js';

export type CandidateValidation = { ok: true } | { ok: false; errors: string[] };

/**
 * Validity checks run before a candidate can be replayed or approved (SPEC section 9). Pure.
 * Structural rules (complete hard prohibitions, no default that pays, CAP needs a cap, unique rule ids)
 * are enforced by the schema; this adds the relationship to the base version.
 */
export function validateCandidate(candidate: unknown, base: PaymentPolicy): CandidateValidation {
  const parsed = paymentPolicySchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(policy)'}: ${i.message}`) };
  }
  const c = parsed.data;
  const errors: string[] = [];

  if (!verifyPolicyHash(c)) errors.push('policyHash does not match the policy body');
  if (c.profile.orgId !== base.profile.orgId) errors.push('orgId must match the base policy');
  if (c.profile.network !== base.profile.network) errors.push('network must match the base policy (INV-006)');
  if (c.profile.asset !== base.profile.asset) errors.push('asset must match the base policy (INV-006)');
  if (c.parentVersion !== base.policyVersion) errors.push('parentVersion must equal the base policy version');
  if (c.policyVersion <= base.policyVersion) errors.push('policyVersion must be greater than the base version');

  const maxPer = parseAtomic(c.profile.maxPerPaymentAtomic);
  if (maxPer > parseAtomic(base.profile.maxPerPaymentAtomic)) errors.push('maxPerPaymentAtomic may not exceed the base policy');
  if (maxPer > LIVE_LIMITS.maxPerPaymentAtomic) errors.push('maxPerPaymentAtomic may not exceed the live per-payment limit');
  if (parseAtomic(c.profile.periodCapAtomic) > parseAtomic(base.profile.periodCapAtomic)) {
    errors.push('periodCapAtomic may not exceed the base policy');
  }
  // Belt and braces on top of the schema: the hard-prohibition set can never shrink (INV-015).
  for (const h of HARD_PROHIBITIONS) {
    if (!c.profile.hardProhibitions.includes(h)) errors.push(`hard prohibition ${h} is missing`);
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
