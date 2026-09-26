/**
 * The demo candidates from SPEC Appendix A (ADR-012), as plain rule JSON for `POST /api/candidates`. The server builds the
 * policy itself (next version, parent, profile), so a client can only supply rules and a default action. A test keeps
 * these equal to the rules in `@risksir/core` (`demoCandidates`), so they cannot drift.
 */
export interface RulePreset {
  key: 'A' | 'B' | 'C';
  title: string;
  rationale: string;
  rules: Record<string, unknown>[];
}

const V1_RULES: Record<string, unknown>[] = [
  { ruleId: 'R1', description: 'No disqualifying signal: pay', when: [{ kind: 'evidenceTier', in: ['CLEAR'] }], then: { action: 'PAY' } },
  {
    ruleId: 'R2',
    description: 'WARN and amount at most 0.05 USDC: pay',
    when: [{ kind: 'evidenceTier', in: ['WARN'] }, { kind: 'amount', maxAtomic: '50000' }],
    then: { action: 'PAY' },
  },
  { ruleId: 'R3', description: 'Any other WARN: ask a human', when: [{ kind: 'evidenceTier', in: ['WARN'] }], then: { action: 'ASK_HUMAN' } },
];

export const PRESETS: RulePreset[] = [
  {
    key: 'A',
    title: 'Hold every first-time counterparty',
    rationale: 'Blunt: stops the incident pattern but also disrupts every legitimate first payment.',
    rules: [{ ruleId: 'A1', description: 'First-time counterparty: hold', when: [{ kind: 'firstTimeCounterparty', value: true }], then: { action: 'HOLD' } }, ...V1_RULES],
  },
  {
    key: 'B',
    title: 'Cap first payments at 0.02 USDC',
    rationale: 'Balanced: first-time counterparty and amount of at least 0.03 USDC is capped at 0.02 USDC (a larger exact quote is not signed).',
    rules: [
      {
        ruleId: 'B1',
        description: 'First-time counterparty and amount >= 0.03: cap at 0.02',
        when: [{ kind: 'firstTimeCounterparty', value: true }, { kind: 'amount', minAtomic: '30000' }],
        then: { action: 'CAP', capAtomic: '20000' },
      },
      ...V1_RULES,
    ],
  },
  {
    key: 'C',
    title: 'Ask a human for larger first payments',
    rationale: 'Review: first-time counterparty and amount of at least 0.03 USDC needs a scoped owner approval.',
    rules: [
      {
        ruleId: 'C1',
        description: 'First-time counterparty and amount >= 0.03: ask a human',
        when: [{ kind: 'firstTimeCounterparty', value: true }, { kind: 'amount', minAtomic: '30000' }],
        then: { action: 'ASK_HUMAN' },
      },
      ...V1_RULES,
    ],
  },
];
