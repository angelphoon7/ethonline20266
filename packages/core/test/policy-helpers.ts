import {
  canonicalQuoteSchema,
  hashQuote,
  riskEvidenceSchema,
  sealPolicy,
  demoPolicyV1,
} from '../src/index.js';
import type { Approval, EvaluateInput, PaymentPolicy, UnsealedPolicy } from '../src/index.js';
import { PAY_TO_SAFE, evidenceInput, quoteInput } from './fixtures.js';

export const NOW = '2026-09-26T10:00:30.000Z';
export const FRESH = '2026-09-26T10:00:25.000Z'; // 5 s before NOW
export const STALE = '2026-09-26T09:59:59.000Z'; // 31 s before NOW

interface Overrides {
  policy?: PaymentPolicy;
  quote?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  context?: Partial<EvaluateInput['context']>;
  approval?: Approval | null;
  now?: string;
}

export function makeInput(o: Overrides = {}): EvaluateInput {
  const quote = canonicalQuoteSchema.parse(quoteInput(o.quote));
  return {
    policy: o.policy ?? demoPolicyV1(),
    quote,
    quoteHash: hashQuote(quote),
    evidence: riskEvidenceSchema.parse(evidenceInput({ address: quote.payTo ?? PAY_TO_SAFE, capturedAt: FRESH, ...o.evidence })),
    context: {
      firstTimeCounterparty: false,
      service: 'report',
      periodBudgetRemainingAtomic: '500000',
      ...o.context,
    },
    approval: o.approval ?? null,
    now: o.now ?? NOW,
  };
}

/** v1 with its rules replaced, re-sealed so the hash stays valid. */
export function policyWithRules(rules: UnsealedPolicy['rules'], defaultAction: UnsealedPolicy['defaultAction'] = 'HOLD'): PaymentPolicy {
  const v1 = demoPolicyV1();
  return sealPolicy({ policyVersion: 1, parentVersion: null, profile: v1.profile, rules, defaultAction });
}

export function makeApproval(input: EvaluateInput, patch: Partial<Approval> = {}): Approval {
  return {
    approvalId: 'appr-1',
    attemptId: input.quote.attemptId,
    quoteHash: input.quoteHash,
    policyVersion: input.policy.policyVersion,
    maxAmountAtomic: input.quote.amountAtomic,
    approvedAt: '2026-09-26T10:00:20.000Z',
    expiresAt: '2026-09-26T10:10:20.000Z',
    ...patch,
  };
}
