import type { PaymentCase, RiskEvidence } from '../src/index.js';

/** Obviously fake test addresses; none is a real wallet and none holds funds. */
export const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
export const PAYER = `0x${'aa'.repeat(20)}`;
export const PAY_TO_SAFE = `0x${'11'.repeat(20)}`;
export const PAY_TO_RISKY = `0x${'22'.repeat(20)}`;
export const PAY_TO_ALT = `0x${'33'.repeat(20)}`;

export const T0 = '2026-09-26T10:00:00.000Z';
export const T1 = '2026-09-26T10:00:05.000Z';
export const T2 = '2026-09-26T10:00:10.000Z';

export function quoteInput(overrides: Record<string, unknown> = {}) {
  return {
    scheme: 'exact',
    network: 'eip155:84532',
    asset: USDC,
    amountAtomic: '50000',
    payTo: PAY_TO_SAFE,
    resourceUrl: 'http://localhost:4021/paid/report/safe',
    attemptId: 'att-1',
    maxTimeoutSeconds: 60,
    ...overrides,
  };
}

export function profileInput(overrides: Record<string, unknown> = {}) {
  return {
    orgId: 'org-1',
    profileVersion: 1,
    network: 'eip155:84532',
    asset: USDC,
    maxPerPaymentAtomic: '100000',
    periodCapAtomic: '500000',
    periodSeconds: 86400,
    allowedServices: ['http://localhost:4021/paid/'],
    hardProhibitions: [
      'EVIDENCE_BLOCK',
      'NETWORK_NOT_ALLOWED',
      'ASSET_NOT_ALLOWED',
      'SCHEME_NOT_SUPPORTED',
      'OVER_PER_PAYMENT_CAP',
      'SERVICE_NOT_ALLOWED',
    ],
    reviewCapacityPerPeriod: 20,
    ...overrides,
  };
}

export function unsealedPolicyInput(overrides: Record<string, unknown> = {}) {
  return {
    policyVersion: 1,
    parentVersion: null,
    profile: profileInput(),
    rules: [
      { ruleId: 'R1', description: 'CLEAR pays', when: [{ kind: 'evidenceTier', in: ['CLEAR'] }], then: { action: 'PAY' } },
    ],
    defaultAction: 'HOLD',
    ...overrides,
  };
}

export function evidenceInput(overrides: Record<string, unknown> = {}) {
  return {
    evidenceId: 'ev-1',
    rawId: 'raw-1',
    provenance: 'synthetic',
    address: PAY_TO_SAFE,
    tier: 'CLEAR',
    providerScore: null,
    reasons: [],
    unavailable: null,
    capturedAt: T0,
    mappingVersion: 'test-0',
    ...overrides,
  };
}

export function caseInput(overrides: Record<string, unknown> = {}) {
  return {
    caseId: 'case-1',
    orgId: 'org-1',
    provenance: 'synthetic',
    attemptId: null,
    fixtureId: 'fx-1',
    quote: {
      amountAtomic: '80000',
      payTo: PAY_TO_SAFE,
      network: 'eip155:84532',
      asset: USDC,
      resourceUrl: 'http://localhost:4021/paid/report/safe',
      service: 'report',
    },
    context: { firstTimeCounterparty: true, periodBudgetRemainingAtomic: '500000' },
    evidence: evidenceInput() as RiskEvidence,
    recorded: null,
    label: 'unknown',
    labelRevisions: [{ revision: 1, label: 'unknown', labelledBy: 'seed_script', rationale: 'seed', at: T0 }],
    createdAt: T0,
    ...overrides,
  } as unknown as PaymentCase;
}

export function decisionInput(overrides: Record<string, unknown> = {}) {
  return {
    decisionId: 'dec-1',
    attemptId: 'att-1',
    quoteHash: `0x${'ab'.repeat(32)}`,
    policyVersion: 1,
    policyHash: `0x${'cd'.repeat(32)}`,
    evidenceId: 'ev-1',
    action: 'PAY',
    reasons: [{ code: 'RULE_MATCHED', ruleId: 'R1' }],
    authorisedMaxAtomic: '50000',
    signerEligible: true,
    approvalId: null,
    decidedAt: T1,
    expiresAt: '2026-09-26T10:01:05.000Z',
    status: 'open',
    ...overrides,
  };
}

export function attemptInput(overrides: Record<string, unknown> = {}) {
  return {
    attemptId: 'att-1',
    orgId: 'org-1',
    agentId: 'agent-1',
    taskId: 'task-1',
    resourceUrl: 'http://localhost:4021/paid/report/safe',
    status: 'decided',
    quote: null,
    quoteHash: null,
    policyVersion: 1,
    evidenceId: 'ev-1',
    decisionId: 'dec-1',
    signerCalls: 0,
    createdAt: T0,
    quotedAt: T0,
    interceptaRequestedAt: T0,
    interceptaReturnedAt: T1,
    decidedAt: T1,
    signerInvokedAt: null,
    submittedAt: null,
    settledAt: null,
    failure: null,
    ...overrides,
  };
}
