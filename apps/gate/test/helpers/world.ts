import { getAddress } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import {
  BASE_SEPOLIA_USDC,
  DECISION_TTL_S,
  canonicalQuoteSchema,
  decisionSchema,
  demoPolicyV1,
  hashQuote,
  paymentAttemptSchema,
  riskEvidenceSchema,
} from '@risksir/core';
import type { CanonicalQuote, Decision, PaymentAttempt, RiskEvidence } from '@risksir/core';
import { createProtectedSigner } from '../../src/signer/public.js';
import type { AttemptSigner, ProtectedSigner, SignerDeps, TypedDataRequest } from '../../src/signer/public.js';
import { Store } from '../../src/store/store.js';

export const ORG = 'org-exampleco';
export const PAY_TO = `0x${'11'.repeat(20)}`;
export const T_START = Date.parse('2026-09-26T10:00:00.000Z');

export interface World {
  store: Store;
  signer: ProtectedSigner;
  attemptSigner: AttemptSigner;
  attemptId: string;
  decisionId: string;
  quote: CanonicalQuote;
  clock: { ms: number };
  refusals: { code: string; detail: string }[];
  typedData(patch?: { domain?: Record<string, unknown>; message?: Record<string, unknown> }): TypedDataRequest;
  /** Number of signer calls recorded in the ledger for this attempt. */
  signerCalls(): number;
}

export interface WorldOptions {
  quote?: Record<string, unknown>;
  decision?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  reserve?: boolean;
  bind?: boolean;
  extraCheck?: SignerDeps['extraCheck'];
}

const EXPECTED_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

/** Builds a store with policy v1 active, one decided attempt, its evidence, decision and reservation, and a signer with a throwaway key. */
export function makeWorld(opts: WorldOptions = {}): World {
  const store = new Store(':memory:');
  const v1 = demoPolicyV1();
  store.putPolicy(ORG, v1);
  store.setActivePolicy(ORG, 1, 'tr-1', new Date(T_START).toISOString());

  const clock = { ms: T_START + 6000 };
  const refusals: World['refusals'] = [];
  const signer = createProtectedSigner({
    store,
    now: () => new Date(clock.ms),
    keyProvider: () => generatePrivateKey(), // throwaway, unfunded test key
    ...(opts.extraCheck ? { extraCheck: opts.extraCheck } : {}),
    onRefusal: (r) => refusals.push({ code: r.code, detail: r.detail }),
  });

  const attemptId = 'att-1';
  const decisionId = 'dec-1';
  const quote = canonicalQuoteSchema.parse({
    scheme: 'exact',
    network: 'eip155:84532',
    asset: BASE_SEPOLIA_USDC,
    amountAtomic: '50000',
    payTo: PAY_TO,
    resourceUrl: 'http://localhost:4021/paid/report/safe',
    attemptId,
    maxTimeoutSeconds: 60,
    ...opts.quote,
  });
  const quoteHash = hashQuote(quote);
  const iso = (offsetS: number) => new Date(T_START + offsetS * 1000).toISOString();

  const evidence: RiskEvidence = riskEvidenceSchema.parse({
    evidenceId: 'ev-1',
    rawId: null,
    provenance: 'synthetic',
    address: quote.payTo,
    tier: 'CLEAR',
    providerScore: 0,
    reasons: [],
    unavailable: null,
    capturedAt: iso(2),
    mappingVersion: 'test-0',
    ...opts.evidence,
  });
  store.saveEvidence(evidence);

  const attempt: PaymentAttempt = paymentAttemptSchema.parse({
    attemptId,
    orgId: ORG,
    agentId: 'agent-1',
    taskId: 'task-1',
    resourceUrl: quote.resourceUrl,
    status: 'decided',
    quote,
    quoteHash,
    policyVersion: 1,
    evidenceId: evidence.evidenceId,
    decisionId,
    signerCalls: 0,
    createdAt: iso(0),
    quotedAt: iso(1),
    interceptaRequestedAt: iso(1),
    interceptaReturnedAt: iso(2),
    decidedAt: iso(3),
    signerInvokedAt: null,
    submittedAt: null,
    settledAt: null,
    failure: null,
  });
  store.saveAttempt(attempt);

  const decision: Decision = decisionSchema.parse({
    decisionId,
    attemptId,
    quoteHash,
    policyVersion: 1,
    policyHash: v1.policyHash,
    evidenceId: evidence.evidenceId,
    action: 'PAY',
    reasons: [{ code: 'RULE_MATCHED', ruleId: 'R1' }],
    authorisedMaxAtomic: quote.amountAtomic,
    signerEligible: true,
    approvalId: null,
    decidedAt: iso(3),
    expiresAt: iso(3 + DECISION_TTL_S),
    status: 'open',
    ...opts.decision,
  });
  store.saveDecision(decision);

  if (opts.reserve !== false) {
    const r = store.reserve({
      reservationId: 'res-1',
      orgId: ORG,
      attemptId,
      amountAtomic: quote.amountAtomic,
      periodCapAtomic: v1.profile.periodCapAtomic,
      periodSeconds: v1.profile.periodSeconds,
      nowIso: iso(3),
      ttlSeconds: 300,
    });
    if (!r.ok) throw new Error(`test world could not reserve: ${r.reason}`);
  }

  const attemptSigner = signer.forAttempt(attemptId);
  if (opts.bind !== false) attemptSigner.authorise(decisionId);

  const typedData: World['typedData'] = (patch = {}) => ({
    domain: {
      name: 'USDC',
      version: '2',
      chainId: 84532,
      verifyingContract: getAddress(BASE_SEPOLIA_USDC),
      ...patch.domain,
    },
    types: EXPECTED_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: {
      from: signer.address,
      to: getAddress(quote.payTo),
      value: BigInt(quote.amountAtomic),
      validAfter: 0n,
      validBefore: BigInt(Math.floor(clock.ms / 1000) + quote.maxTimeoutSeconds),
      nonce: `0x${'11'.repeat(32)}`,
      ...patch.message,
    },
  });

  return { store, signer, attemptSigner, attemptId, decisionId, quote, clock, refusals, typedData, signerCalls: () => store.signerCallCount(attemptId) };
}
