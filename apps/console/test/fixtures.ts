import type { ApiState, AttemptSummary, PaymentCase, PolicyVersion, RegressionReport, Trace } from '../src/types';

const HASH = (c: string) => `0x${c.repeat(64)}` as `0x${string}`;
export const PAY_TO = `0x${'11'.repeat(20)}`;
export const TX = `0x${'ab'.repeat(32)}`;

export const state = (version = 1): ApiState => ({
  orgId: 'org-exampleco',
  network: 'eip155:84532',
  activePolicy: {
    policyVersion: version,
    policyHash: HASH('c'),
    profile: {
      maxPerPaymentAtomic: '100000',
      periodCapAtomic: '500000',
      periodSeconds: 86400,
      network: 'eip155:84532',
      asset: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
      allowedServices: ['http://127.0.0.1:4021/paid/'],
      reviewCapacityPerPeriod: 20,
    },
    defaultAction: 'HOLD',
    rules: [{ ruleId: 'R1', description: '' }, { ruleId: 'R2', description: '' }],
  },
  signerCallsTotal: 1,
  attempts: 2,
  awaitingApproval: 0,
  cases: 2,
});

const baseAttempt = {
  orgId: 'org-exampleco',
  agentId: 'agent-1',
  taskId: 't',
  resourceUrl: 'http://127.0.0.1:4021/paid/report/safe',
  quote: { scheme: 'exact', network: 'eip155:84532', asset: '0x036cbd53842c5426634e7929541ec2318f3dcf7e', amountAtomic: '50000', payTo: PAY_TO, resourceUrl: 'http://127.0.0.1:4021/paid/report/safe', attemptId: 'att-1', maxTimeoutSeconds: 300 },
  quoteHash: HASH('a'),
  policyVersion: 1,
  evidenceId: 'ev-1',
  decisionId: 'dec-1',
  createdAt: '2026-09-26T10:00:00.000Z',
  quotedAt: '2026-09-26T10:00:00.100Z',
  interceptaRequestedAt: '2026-09-26T10:00:00.200Z',
  interceptaReturnedAt: '2026-09-26T10:00:01.000Z',
  decidedAt: '2026-09-26T10:00:01.010Z',
  awaitingApprovalUntil: null,
  submittedAt: null,
  settledAt: null,
  failure: null,
} as const;

const evidence = (over: Record<string, unknown> = {}) => ({
  evidenceId: 'ev-1', rawId: 'raw-1', provenance: 'real_live', address: PAY_TO, tier: 'CLEAR', providerScore: 0, reasons: [], unavailable: null,
  capturedAt: '2026-09-26T10:00:01.000Z', mappingVersion: 'quickscan-v1', tierLabel: 'Risksir tier (policy threshold ADR-017), not an Intercepta verdict', ...over,
});

export const settledTrace = (): Trace =>
  ({
    attempt: { ...baseAttempt, attemptId: 'att-settled-0001', status: 'settled', signerCalls: 1, signerInvokedAt: '2026-09-26T10:00:01.020Z', settledAt: '2026-09-26T10:00:03.000Z' },
    decision: { decisionId: 'dec-1', attemptId: 'att-settled-0001', quoteHash: HASH('a'), policyVersion: 1, policyHash: HASH('c'), evidenceId: 'ev-1', action: 'PAY', reasons: [{ code: 'RULE_MATCHED', ruleId: 'R1' }], authorisedMaxAtomic: '50000', signerEligible: true, approvalId: null, decidedAt: '2026-09-26T10:00:01.010Z', expiresAt: '2026-09-26T10:01:01.010Z', status: 'consumed' },
    evidence: evidence(),
    outcome: { outcomeId: 'o1', attemptId: 'att-settled-0001', settlementStatus: 'settled', txHash: TX, facilitatorRef: null, deliveryStatus: 'received', httpStatus: 200, observedAt: '2026-09-26T10:00:03.000Z' },
    permit: { permitId: 'p1', status: 'consumed', expiresAt: '2026-09-26T10:01:01.010Z' },
    signer: { calls: 1, invokedAt: '2026-09-26T10:00:01.020Z' },
    audit: [],
  }) as unknown as Trace;

export const blockedTrace = (): Trace =>
  ({
    attempt: { ...baseAttempt, attemptId: 'att-blocked-0002', status: 'failed', signerCalls: 0, signerInvokedAt: null },
    decision: { decisionId: 'dec-2', attemptId: 'att-blocked-0002', quoteHash: HASH('a'), policyVersion: 1, policyHash: HASH('c'), evidenceId: 'ev-2', action: 'DENY', reasons: [{ code: 'EVIDENCE_BLOCK', ruleId: null }], authorisedMaxAtomic: null, signerEligible: false, approvalId: null, decidedAt: '2026-09-26T10:00:01.010Z', expiresAt: '2026-09-26T10:01:01.010Z', status: 'open' },
    evidence: evidence({ evidenceId: 'ev-2', tier: 'BLOCK', providerScore: 100, reasons: ['known_scammer', 'attack_money_target'] }),
    outcome: null,
    permit: null,
    signer: { calls: 0, invokedAt: null },
    audit: [],
  }) as unknown as Trace;

export const localRejectTrace = (): Trace => {
  const t = blockedTrace();
  return { ...t, evidence: null, attempt: { ...t.attempt, interceptaReturnedAt: null, interceptaRequestedAt: null } };
};

export const awaitingTrace = (): Trace => {
  const t = blockedTrace();
  return { ...t, attempt: { ...t.attempt, attemptId: 'att-wait-0003', status: 'awaiting_approval', awaitingApprovalUntil: '2026-09-26T10:10:00.000Z' } };
};

export const summaries: AttemptSummary[] = [
  { attemptId: 'att-settled-0001', status: 'settled', policyVersion: 1, action: 'PAY', signerCalls: 1, createdAt: '2026-09-26T10:00:00.000Z', payTo: PAY_TO, amountAtomic: '50000' },
  { attemptId: 'att-blocked-0002', status: 'failed', policyVersion: 1, action: 'DENY', signerCalls: 0, createdAt: '2026-09-26T10:01:00.000Z', payTo: PAY_TO, amountAtomic: '10000' },
];

const mkCase = (id: string, provenance: string, label: string, amount: string, firstTime: boolean) => ({
  caseId: id, orgId: 'org-exampleco', provenance, attemptId: null, fixtureId: id,
  quote: { amountAtomic: amount, payTo: PAY_TO, network: 'eip155:84532', asset: '0x036cbd53842c5426634e7929541ec2318f3dcf7e', resourceUrl: 'http://127.0.0.1:4021/paid/report/safe', service: 'report' },
  context: { firstTimeCounterparty: firstTime, periodBudgetRemainingAtomic: '500000' },
  evidence: evidence({ provenance }), recorded: null, label,
  labelRevisions: [{ revision: 1, label: 'unknown', labelledBy: 'seed_script', rationale: 'seed', at: '2026-09-26T10:00:00.000Z' }], createdAt: '2026-09-26T10:00:00.000Z',
});
export const cases = [mkCase('cv-01-incident-80000', 'controlled_variant', 'unknown', '80000', true), mkCase('real-02-pay-safe', 'real_live', 'good', '50000', true)] as unknown as PaymentCase[];

export const versions: PolicyVersion[] = [
  { policyVersion: 1, policyHash: HASH('c'), status: 'superseded', approvedReportHash: null, approvedBy: 'seed', approvedAt: '2026-09-26T09:00:00.000Z', parentVersion: null, rollbackTarget: null },
  { policyVersion: 2, policyHash: HASH('d'), status: 'active', approvedReportHash: HASH('e'), approvedBy: 'owner', approvedAt: '2026-09-26T11:00:00.000Z', parentVersion: 1, rollbackTarget: 1 },
];

export const report = (candidateHash = HASH('d')): RegressionReport => {
  const names = ['bad_cases_prevented', 'bad_value_prevented', 'bad_value_remaining', 'good_cases_changed', 'good_value_delayed_or_denied', 'human_reviews_added', 'auto_approval_rate', 'hold_rate', 'deny_rate', 'bad_cases_weakened'];
  const values: Record<string, [string, string]> = {
    bad_cases_prevented: ['3', '3'], bad_value_prevented: ['190000', '190000'], bad_value_remaining: ['0', '190000'], good_cases_changed: ['2', '9'],
    good_value_delayed_or_denied: ['80000', '340000'], human_reviews_added: ['-1', '19'], auto_approval_rate: ['6', '19'], hold_rate: ['2', '19'], deny_rate: ['3', '19'], bad_cases_weakened: ['0', '6'],
  };
  return {
    reportId: 'r1', candidateHash, baselineHash: HASH('c'), datasetHash: HASH('f'), engineVersion: 'regression/1.0.0', caseResults: [],
    metrics: names.map((name) => ({ name, numerator: values[name]?.[0], denominator: values[name]?.[1] })),
    provenanceMix: { real_live: 4, sponsor_fixture: 0, controlled_variant: 11, synthetic: 4 }, reportHash: HASH('9'), generatedAt: '2026-09-26T11:00:00.000Z',
  } as unknown as RegressionReport;
};
