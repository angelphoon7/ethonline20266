import { BASE_SEPOLIA_NETWORK, BASE_SEPOLIA_USDC } from '../constants.js';
import { sealPolicy } from '../fingerprint.js';
import { HARD_PROHIBITIONS } from '../types.js';
import type { PaymentPolicy, RiskProfile, Rule, UnsealedPolicy } from '../types.js';

/**
 * Demo policy v1 and candidates A/B/C from SPEC Appendix A (ADR-012). Amounts are USDC atomic units scaled to the
 * live testnet limits (0.05 USDC = 50000). Rules key on the OBSERVED tier and context predicates only.
 * Intercepta tier thresholds stay provisional until Spike A (ADR-007).
 */
export const DEMO_ORG_ID = 'org-exampleco';

export function demoProfile(serviceBase = 'http://localhost:4021/paid/'): RiskProfile {
  return {
    orgId: DEMO_ORG_ID,
    profileVersion: 1,
    network: BASE_SEPOLIA_NETWORK,
    asset: BASE_SEPOLIA_USDC,
    maxPerPaymentAtomic: '100000',
    periodCapAtomic: '500000',
    periodSeconds: 86400,
    allowedServices: [serviceBase],
    hardProhibitions: [...HARD_PROHIBITIONS],
    reviewCapacityPerPeriod: 20,
  };
}

const v1Rules: Rule[] = [
  { ruleId: 'R1', description: 'No disqualifying signal: pay', when: [{ kind: 'evidenceTier', in: ['CLEAR'] }], then: { action: 'PAY' } },
  {
    ruleId: 'R2',
    description: 'WARN and amount at most 0.05 USDC: pay',
    when: [
      { kind: 'evidenceTier', in: ['WARN'] },
      { kind: 'amount', maxAtomic: '50000' },
    ],
    then: { action: 'PAY' },
  },
  { ruleId: 'R3', description: 'Any other WARN: ask a human', when: [{ kind: 'evidenceTier', in: ['WARN'] }], then: { action: 'ASK_HUMAN' } },
];

export function demoPolicyV1(profile: RiskProfile = demoProfile()): PaymentPolicy {
  return sealPolicy({ policyVersion: 1, parentVersion: null, profile, rules: v1Rules, defaultAction: 'HOLD' });
}

export interface DemoCandidate {
  key: 'A' | 'B' | 'C';
  title: string;
  rationale: string;
  policy: PaymentPolicy;
}

/** Candidates A (blunt), B (balanced), C (review), each v1 plus one rule placed before R1, as version 2. */
export function demoCandidates(base: PaymentPolicy = demoPolicyV1()): DemoCandidate[] {
  const make = (rule: Rule): PaymentPolicy => {
    const body: UnsealedPolicy = {
      policyVersion: base.policyVersion + 1,
      parentVersion: base.policyVersion,
      profile: base.profile,
      rules: [rule, ...base.rules],
      defaultAction: base.defaultAction,
    };
    return sealPolicy(body);
  };
  return [
    {
      key: 'A',
      title: 'Hold every first-time counterparty',
      rationale: 'Blunt: stops the incident pattern but also disrupts every legitimate first payment.',
      policy: make({
        ruleId: 'A1',
        description: 'First-time counterparty: hold',
        when: [{ kind: 'firstTimeCounterparty', value: true }],
        then: { action: 'HOLD' },
      }),
    },
    {
      key: 'B',
      title: 'Cap first payments at 0.02 USDC',
      rationale: 'Balanced: first-time counterparty and amount of at least 0.03 USDC is capped at 0.02 USDC (a larger exact quote is not signed).',
      policy: make({
        ruleId: 'B1',
        description: 'First-time counterparty and amount >= 0.03: cap at 0.02',
        when: [
          { kind: 'firstTimeCounterparty', value: true },
          { kind: 'amount', minAtomic: '30000' },
        ],
        then: { action: 'CAP', capAtomic: '20000' },
      }),
    },
    {
      key: 'C',
      title: 'Ask a human for larger first payments',
      rationale: 'Review: first-time counterparty and amount of at least 0.03 USDC needs a scoped owner approval.',
      policy: make({
        ruleId: 'C1',
        description: 'First-time counterparty and amount >= 0.03: ask a human',
        when: [
          { kind: 'firstTimeCounterparty', value: true },
          { kind: 'amount', minAtomic: '30000' },
        ],
        then: { action: 'ASK_HUMAN' },
      }),
    },
  ];
}
