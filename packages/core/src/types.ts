import { z } from 'zod';
import { atomicAmountSchema, signedIntegerStringSchema } from './money.js';
import { provenanceSchema } from './provenance.js';

/**
 * zod schemas and inferred types for SPEC section 7. Every external input is validated with these.
 * Money is a decimal string of atomic units; addresses are lowercase; hashes are lowercase 0x + 64 hex.
 * The only opaque value is `RawIntercepta.body`.
 */

// ---- primitives ---------------------------------------------------------------------------------------

export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 20-byte 0x address')
  .transform((s) => s.toLowerCase() as `0x${string}`);
export type Address = z.output<typeof addressSchema>;

export const hex32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'must be 0x + 64 hex characters')
  .transform((s) => s.toLowerCase() as `0x${string}`);
export type Hex32 = z.output<typeof hex32Schema>;

export const timestampSchema = z.iso.datetime();
const idSchema = z.string().min(1);
const versionSchema = z.number().int().min(1);
const countSchema = z.number().int().min(0);

const ts = (s: string): number => Date.parse(s);

// ---- enumerations -------------------------------------------------------------------------------------

export const ACTIONS = ['PAY', 'CAP', 'HOLD', 'ASK_HUMAN', 'DENY'] as const;
export const actionSchema = z.enum(ACTIONS);
export type Action = z.infer<typeof actionSchema>;

export const TIERS = ['CLEAR', 'WARN', 'BLOCK', 'UNAVAILABLE'] as const;
export const tierSchema = z.enum(TIERS);
export type Tier = z.infer<typeof tierSchema>;

/** Tiers a rule may match on; UNAVAILABLE is handled before rules and can never be matched. */
export const RULE_TIERS = ['CLEAR', 'WARN', 'BLOCK'] as const;

export const HARD_PROHIBITIONS = [
  'EVIDENCE_BLOCK',
  'NETWORK_NOT_ALLOWED',
  'ASSET_NOT_ALLOWED',
  'SCHEME_NOT_SUPPORTED',
  'OVER_PER_PAYMENT_CAP',
  'SERVICE_NOT_ALLOWED',
] as const;
export const hardProhibitionSchema = z.enum(HARD_PROHIBITIONS);
export type HardProhibition = z.infer<typeof hardProhibitionSchema>;

export const REASON_CODES = [
  'SCHEME_NOT_SUPPORTED',
  'NETWORK_NOT_ALLOWED',
  'ASSET_NOT_ALLOWED',
  'SERVICE_NOT_ALLOWED',
  'OVER_PER_PAYMENT_CAP',
  'EVIDENCE_UNAVAILABLE',
  'EVIDENCE_STALE',
  'EVIDENCE_BLOCK',
  'PERIOD_CAP_EXCEEDED',
  'RULE_MATCHED',
  'NO_RULE_MATCHED',
  'CAP_BELOW_QUOTE',
  'APPROVAL_PENDING',
  'HUMAN_APPROVED',
  'APPROVAL_EXPIRED',
  'QUOTE_INVALID',
  'QUOTE_MUTATED',
  'POLICY_CHANGED',
  'RESERVATION_FAILED',
  'DECISION_EXPIRED',
  'SIGNER_REFUSED',
  'ENGINE_ERROR',
] as const;
export const reasonCodeSchema = z.enum(REASON_CODES);
export type ReasonCode = z.infer<typeof reasonCodeSchema>;

export const METRIC_NAMES = [
  'bad_cases_prevented',
  'bad_value_prevented',
  'bad_value_remaining',
  'good_cases_changed',
  'good_value_delayed_or_denied',
  'human_reviews_added',
  'auto_approval_rate',
  'hold_rate',
  'deny_rate',
  'bad_cases_weakened',
] as const;
export const metricNameSchema = z.enum(METRIC_NAMES);
export type MetricName = z.infer<typeof metricNameSchema>;

export const AUDIT_TYPES = [
  'QuoteSelected',
  'RiskScreenRequested',
  'RiskScreenReturned',
  'RiskScreenUnavailable',
  'PolicyDecided',
  'SignerInvoked',
  'SignerRefused',
  'PaymentSubmitted',
  'SettlementObserved',
  'ResourceReturned',
  'IncidentLabelled',
  'RegressionCompleted',
  'PolicyApproved',
  'PolicyActivated',
  'PolicyRolledBack',
] as const;
export const auditTypeSchema = z.enum(AUDIT_TYPES);
export type AuditType = z.infer<typeof auditTypeSchema>;

export const caseLabelSchema = z.enum(['good', 'bad', 'unknown']);
export type CaseLabel = z.infer<typeof caseLabelSchema>;

// ---- organisation, profile, policy --------------------------------------------------------------------

export const organisationSchema = z.strictObject({
  orgId: idSchema,
  name: z.string().min(1),
  payerAddress: addressSchema,
  agentIds: z.array(idSchema),
});
export type Organisation = z.infer<typeof organisationSchema>;

export const riskProfileSchema = z
  .strictObject({
    orgId: idSchema,
    profileVersion: versionSchema,
    network: z.literal('eip155:84532'),
    asset: addressSchema,
    maxPerPaymentAtomic: atomicAmountSchema,
    periodCapAtomic: atomicAmountSchema,
    periodSeconds: z.number().int().min(1),
    allowedServices: z.array(z.string().min(1)),
    hardProhibitions: z.array(hardProhibitionSchema),
    reviewCapacityPerPeriod: countSchema,
  })
  .superRefine((p, ctx) => {
    const have = new Set(p.hardProhibitions);
    const complete = have.size === p.hardProhibitions.length && HARD_PROHIBITIONS.every((h) => have.has(h));
    if (!complete) {
      ctx.addIssue({
        code: 'custom',
        path: ['hardProhibitions'],
        message: 'hardProhibitions must list every HARD_PROHIBITIONS value exactly once (INV-015)',
      });
    }
  });
export type RiskProfile = z.infer<typeof riskProfileSchema>;

export const predicateSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('evidenceTier'), in: z.array(z.enum(RULE_TIERS)).min(1) }),
  z.strictObject({ kind: z.literal('providerScore'), min: z.number().optional(), max: z.number().optional() }),
  z.strictObject({
    kind: z.literal('amount'),
    minAtomic: atomicAmountSchema.optional(),
    maxAtomic: atomicAmountSchema.optional(),
  }),
  z.strictObject({ kind: z.literal('firstTimeCounterparty'), value: z.boolean() }),
  z.strictObject({ kind: z.literal('service'), in: z.array(z.string().min(1)).min(1) }),
  z.strictObject({
    kind: z.literal('budgetRemaining'),
    minAtomic: atomicAmountSchema.optional(),
    maxAtomic: atomicAmountSchema.optional(),
  }),
]);
export type Predicate = z.infer<typeof predicateSchema>;

export const ruleSchema = z
  .strictObject({
    ruleId: idSchema,
    description: z.string(),
    when: z.array(predicateSchema),
    then: z.strictObject({ action: actionSchema, capAtomic: atomicAmountSchema.optional() }),
  })
  .superRefine((r, ctx) => {
    const hasCap = r.then.capAtomic !== undefined;
    if (r.then.action === 'CAP' && !hasCap) {
      ctx.addIssue({ code: 'custom', path: ['then', 'capAtomic'], message: 'a CAP rule requires capAtomic' });
    }
    if (r.then.action !== 'CAP' && hasCap) {
      ctx.addIssue({ code: 'custom', path: ['then', 'capAtomic'], message: 'capAtomic is only valid for CAP' });
    }
  });
export type Rule = z.infer<typeof ruleSchema>;

export const DEFAULT_ACTIONS = ['HOLD', 'ASK_HUMAN', 'DENY'] as const;

const paymentPolicyShape = {
  policyVersion: versionSchema,
  parentVersion: versionSchema.nullable(),
  profile: riskProfileSchema,
  rules: z.array(ruleSchema),
  /** A default that pays is invalid (ADR-013). */
  defaultAction: z.enum(DEFAULT_ACTIONS),
} as const;

function checkPolicyShape(
  p: { policyVersion: number; parentVersion: number | null; rules: { ruleId: string }[] },
  ctx: z.RefinementCtx,
): void {
  if (p.parentVersion !== null && p.parentVersion >= p.policyVersion) {
    ctx.addIssue({ code: 'custom', path: ['parentVersion'], message: 'parentVersion must be lower than policyVersion' });
  }
  const ids = p.rules.map((r) => r.ruleId);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: 'custom', path: ['rules'], message: 'rule ids must be unique' });
  }
}

/** A policy body before its hash is computed (the hash never covers itself). */
export const unsealedPolicySchema = z.strictObject(paymentPolicyShape).superRefine(checkPolicyShape);
export type UnsealedPolicy = z.infer<typeof unsealedPolicySchema>;

export const paymentPolicySchema = z
  .strictObject({ ...paymentPolicyShape, policyHash: hex32Schema })
  .superRefine(checkPolicyShape);
export type PaymentPolicy = z.infer<typeof paymentPolicySchema>;

// ---- quote and attempt --------------------------------------------------------------------------------

export const canonicalQuoteSchema = z.strictObject({
  scheme: z.string().min(1),
  /** CAIP-2. Unvalidated here: the allowlist is enforced by the policy AND the signer. */
  network: z.string().min(1),
  asset: addressSchema,
  amountAtomic: atomicAmountSchema,
  payTo: addressSchema,
  resourceUrl: z.url().transform((u) => new URL(u).href),
  attemptId: idSchema,
  maxTimeoutSeconds: z.number().int().min(1),
});
export type CanonicalQuote = z.infer<typeof canonicalQuoteSchema>;

export const ATTEMPT_STATUSES = [
  'created',
  'quoted',
  'screened',
  'decided',
  'signed',
  'submitted',
  'settled',
  'failed',
  'ambiguous',
] as const;
export const attemptStatusSchema = z.enum(ATTEMPT_STATUSES);
export type AttemptStatus = z.infer<typeof attemptStatusSchema>;

export const paymentAttemptSchema = z
  .strictObject({
    attemptId: idSchema,
    orgId: idSchema,
    agentId: idSchema,
    taskId: idSchema,
    resourceUrl: z.string().min(1),
    status: attemptStatusSchema,
    quote: canonicalQuoteSchema.nullable(),
    quoteHash: hex32Schema.nullable(),
    policyVersion: versionSchema.nullable(),
    evidenceId: idSchema.nullable(),
    decisionId: idSchema.nullable(),
    /** Written only by the signer path. */
    signerCalls: countSchema,
    createdAt: timestampSchema,
    quotedAt: timestampSchema.nullable(),
    interceptaRequestedAt: timestampSchema.nullable(),
    interceptaReturnedAt: timestampSchema.nullable(),
    decidedAt: timestampSchema.nullable(),
    signerInvokedAt: timestampSchema.nullable(),
    submittedAt: timestampSchema.nullable(),
    settledAt: timestampSchema.nullable(),
    failure: z.strictObject({ code: reasonCodeSchema, message: z.string() }).nullable(),
  })
  .superRefine((a, ctx) => {
    // INV-019: a signer timestamp must be preceded by the returned Intercepta call; no signer call, no timestamp.
    if (a.signerInvokedAt !== null) {
      if (a.interceptaReturnedAt === null || ts(a.interceptaReturnedAt) >= ts(a.signerInvokedAt)) {
        ctx.addIssue({
          code: 'custom',
          path: ['signerInvokedAt'],
          message: 'signerInvokedAt must be later than interceptaReturnedAt (INV-019)',
        });
      }
      if (a.signerCalls < 1) {
        ctx.addIssue({ code: 'custom', path: ['signerCalls'], message: 'signerInvokedAt set but signerCalls is 0' });
      }
    } else if (a.signerCalls > 0) {
      ctx.addIssue({ code: 'custom', path: ['signerInvokedAt'], message: 'signerCalls > 0 requires signerInvokedAt' });
    }
  });
export type PaymentAttempt = z.infer<typeof paymentAttemptSchema>;

// ---- evidence -----------------------------------------------------------------------------------------

export const rawInterceptaSchema = z.strictObject({
  rawId: idSchema,
  provenance: provenanceSchema,
  endpoint: z.string().min(1),
  address: addressSchema,
  interpretedNetwork: z.literal('evm-mainnet'),
  httpStatus: z.number().int().nullable(),
  receivedAt: timestampSchema,
  latencyMs: countSchema,
  /** The provider response stored verbatim. Request headers are never stored (INV-021). */
  body: z.unknown(),
  error: z.enum(['TIMEOUT', 'NETWORK']).nullable(),
});
export type RawIntercepta = z.infer<typeof rawInterceptaSchema>;

export const UNAVAILABLE_REASONS = ['TIMEOUT', 'HTTP_ERROR', 'RATE_LIMITED', 'MALFORMED', 'STALE', 'NO_KEY'] as const;
export const riskEvidenceSchema = z
  .strictObject({
    evidenceId: idSchema,
    rawId: idSchema.nullable(),
    provenance: provenanceSchema,
    address: addressSchema,
    tier: tierSchema,
    providerScore: z.number().nullable(),
    reasons: z.array(z.string()),
    unavailable: z.enum(UNAVAILABLE_REASONS).nullable(),
    capturedAt: timestampSchema,
    mappingVersion: z.string().min(1),
  })
  .superRefine((e, ctx) => {
    if ((e.tier === 'UNAVAILABLE') !== (e.unavailable !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['unavailable'],
        message: 'unavailable must be set exactly when tier is UNAVAILABLE',
      });
    }
  });
export type RiskEvidence = z.infer<typeof riskEvidenceSchema>;

// ---- decision, approval, reservation, outcome ---------------------------------------------------------

export const decisionSchema = z
  .strictObject({
    decisionId: idSchema,
    attemptId: idSchema,
    quoteHash: hex32Schema,
    policyVersion: versionSchema,
    policyHash: hex32Schema,
    /** Every Decision carries evidence (INV-009); an unusable screen is still an evidence record. */
    evidenceId: idSchema,
    action: actionSchema,
    reasons: z.array(z.strictObject({ code: reasonCodeSchema, ruleId: idSchema.nullable() })).min(1),
    authorisedMaxAtomic: atomicAmountSchema.nullable(),
    signerEligible: z.boolean(),
    approvalId: idSchema.nullable(),
    decidedAt: timestampSchema,
    expiresAt: timestampSchema,
    status: z.enum(['open', 'consumed', 'expired', 'superseded']),
  })
  .superRefine((d, ctx) => {
    if (d.signerEligible) {
      if (d.action !== 'PAY' && d.action !== 'CAP') {
        ctx.addIssue({ code: 'custom', path: ['signerEligible'], message: 'only PAY or CAP can be signer-eligible' });
      }
      if (d.authorisedMaxAtomic === null) {
        ctx.addIssue({ code: 'custom', path: ['authorisedMaxAtomic'], message: 'an eligible decision needs authorisedMaxAtomic' });
      }
    }
    if (ts(d.expiresAt) <= ts(d.decidedAt)) {
      ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'expiresAt must be later than decidedAt' });
    }
  });
export type Decision = z.infer<typeof decisionSchema>;

export const approvalSchema = z.strictObject({
  approvalId: idSchema,
  attemptId: idSchema,
  quoteHash: hex32Schema,
  policyVersion: versionSchema,
  maxAmountAtomic: atomicAmountSchema,
  approvedAt: timestampSchema,
  expiresAt: timestampSchema,
});
export type Approval = z.infer<typeof approvalSchema>;

export const spendReservationSchema = z
  .strictObject({
    reservationId: idSchema,
    orgId: idSchema,
    attemptId: idSchema,
    periodKey: z.number().int(),
    amountAtomic: atomicAmountSchema,
    status: z.enum(['reserved', 'committed', 'released', 'reconciling']),
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
    committedAtomic: atomicAmountSchema.nullable(),
  })
  .superRefine((r, ctx) => {
    if (r.status === 'committed' && r.committedAtomic === null) {
      ctx.addIssue({ code: 'custom', path: ['committedAtomic'], message: 'committed reservation needs committedAtomic' });
    }
  });
export type SpendReservation = z.infer<typeof spendReservationSchema>;

/** Settlement and delivery are recorded and shown separately (INV-014). */
export const paymentOutcomeSchema = z
  .strictObject({
    outcomeId: idSchema,
    attemptId: idSchema,
    settlementStatus: z.enum(['none', 'pending', 'settled', 'failed', 'ambiguous']),
    txHash: hex32Schema.nullable(),
    facilitatorRef: z.string().nullable(),
    deliveryStatus: z.enum(['unknown', 'received', 'not_received']),
    httpStatus: z.number().int().nullable(),
    observedAt: timestampSchema,
  })
  .superRefine((o, ctx) => {
    if (o.settlementStatus === 'settled' && o.txHash === null) {
      ctx.addIssue({ code: 'custom', path: ['txHash'], message: 'a settled outcome needs a txHash' });
    }
  });
export type PaymentOutcome = z.infer<typeof paymentOutcomeSchema>;

// ---- cases and regression -----------------------------------------------------------------------------

export const labelRevisionSchema = z.strictObject({
  revision: z.number().int().min(1),
  label: caseLabelSchema,
  labelledBy: z.enum(['owner', 'seed_script']),
  rationale: z.string(),
  at: timestampSchema,
});
export type LabelRevision = z.infer<typeof labelRevisionSchema>;

export const caseQuoteSchema = z.strictObject({
  amountAtomic: atomicAmountSchema,
  payTo: addressSchema,
  network: z.string().min(1),
  asset: addressSchema,
  resourceUrl: z.string().min(1),
  service: z.string().min(1),
});
export type CaseQuote = z.infer<typeof caseQuoteSchema>;

export const paymentCaseSchema = z
  .strictObject({
    caseId: idSchema,
    orgId: idSchema,
    provenance: provenanceSchema,
    attemptId: idSchema.nullable(),
    fixtureId: idSchema.nullable(),
    quote: caseQuoteSchema,
    context: z.strictObject({
      firstTimeCounterparty: z.boolean(),
      periodBudgetRemainingAtomic: atomicAmountSchema,
    }),
    /** Stored snapshot; replay never re-screens. */
    evidence: riskEvidenceSchema,
    recorded: z
      .strictObject({ action: actionSchema, policyVersion: versionSchema, signerCalled: z.boolean() })
      .nullable(),
    label: caseLabelSchema,
    labelRevisions: z.array(labelRevisionSchema).min(1),
    createdAt: timestampSchema,
  })
  .superRefine((c, ctx) => {
    // INV-020: revisions are append-only, numbered 1..n, and the current label is the last revision.
    c.labelRevisions.forEach((rev, i) => {
      if (rev.revision !== i + 1) {
        ctx.addIssue({ code: 'custom', path: ['labelRevisions', i, 'revision'], message: 'revisions must be numbered 1..n in order' });
      }
    });
    const last = c.labelRevisions[c.labelRevisions.length - 1];
    if (last !== undefined && last.label !== c.label) {
      ctx.addIssue({ code: 'custom', path: ['label'], message: 'label must equal the latest label revision' });
    }
    if (c.evidence.provenance !== c.provenance && c.provenance === 'real_live') {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence', 'provenance'],
        message: 'a real_live case needs real_live evidence (never relabel non-live evidence as live)',
      });
    }
  });
export type PaymentCase = z.infer<typeof paymentCaseSchema>;

export const candidatePolicySchema = z.strictObject({
  candidateId: idSchema,
  baseVersion: versionSchema,
  originatingCaseIds: z.array(idSchema),
  policy: paymentPolicySchema,
  rationale: z.string(),
  generatedBy: z.enum(['owner', 'seed_script', 'analyst']),
  status: z.enum(['draft', 'replayed', 'rejected', 'approved']),
  createdAt: timestampSchema,
});
export type CandidatePolicy = z.infer<typeof candidatePolicySchema>;

export const replayedSchema = z.strictObject({
  action: actionSchema,
  reasons: z.array(reasonCodeSchema),
  exposureAtomic: atomicAmountSchema,
});
export type Replayed = z.infer<typeof replayedSchema>;

export const caseResultSchema = z.strictObject({
  caseId: idSchema,
  provenance: provenanceSchema,
  label: caseLabelSchema,
  baseline: replayedSchema,
  candidate: replayedSchema,
});
export type CaseResult = z.infer<typeof caseResultSchema>;

export const metricSchema = z.strictObject({
  name: metricNameSchema,
  numerator: signedIntegerStringSchema,
  denominator: atomicAmountSchema,
});
export type Metric = z.infer<typeof metricSchema>;

const provenanceMixSchema = z.strictObject({
  real_live: countSchema,
  sponsor_fixture: countSchema,
  controlled_variant: countSchema,
  synthetic: countSchema,
});

const regressionReportShape = {
  candidateHash: hex32Schema,
  baselineHash: hex32Schema,
  datasetHash: hex32Schema,
  engineVersion: z.string().min(1),
  caseResults: z.array(caseResultSchema),
  metrics: z.array(metricSchema),
  provenanceMix: provenanceMixSchema,
} as const;

/** A report before its identity fields; `reportId`, `generatedAt` and `reportHash` are excluded from the hash. */
export const unsealedReportSchema = z.strictObject(regressionReportShape);
export type UnsealedReport = z.infer<typeof unsealedReportSchema>;

export const regressionReportSchema = z.strictObject({
  reportId: idSchema,
  ...regressionReportShape,
  reportHash: hex32Schema,
  generatedAt: timestampSchema,
});
export type RegressionReport = z.infer<typeof regressionReportSchema>;

export const policyVersionSchema = z.strictObject({
  policyVersion: versionSchema,
  policyHash: hex32Schema,
  status: z.enum(['draft', 'replayed', 'approved', 'active', 'superseded', 'rolled_back']),
  approvedReportHash: hex32Schema.nullable(),
  approvedBy: z.string().nullable(),
  approvedAt: timestampSchema.nullable(),
  parentVersion: versionSchema.nullable(),
  rollbackTarget: versionSchema.nullable(),
});
export type PolicyVersion = z.infer<typeof policyVersionSchema>;

export const activePointerSchema = z.strictObject({
  orgId: idSchema,
  policyVersion: versionSchema,
  transitionId: idSchema,
  updatedAt: timestampSchema,
});
export type ActivePointer = z.infer<typeof activePointerSchema>;

export const auditEventSchema = z.strictObject({
  eventId: idSchema,
  seq: z.number().int().min(1),
  at: timestampSchema,
  actor: z.enum(['owner', 'agent', 'system']),
  type: auditTypeSchema,
  refs: z.strictObject({
    attemptId: idSchema.optional(),
    decisionId: idSchema.optional(),
    evidenceId: idSchema.optional(),
    caseId: idSchema.optional(),
    candidateId: idSchema.optional(),
    reportHash: hex32Schema.optional(),
    policyVersion: versionSchema.optional(),
    txHash: hex32Schema.optional(),
  }),
  payloadHash: hex32Schema,
});
export type AuditEvent = z.infer<typeof auditEventSchema>;
