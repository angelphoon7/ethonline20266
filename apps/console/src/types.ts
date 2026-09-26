import type {
  AuditEvent,
  CandidatePolicy,
  Decision,
  Metric,
  PaymentAttempt,
  PaymentCase,
  PaymentOutcome,
  PolicyVersion,
  RegressionReport,
  RiskEvidence,
} from '@risksir/core';

/** Response shapes of the owner API (SPEC section 19). Type-only imports: no core code is bundled into the browser. */
export type { AuditEvent, CandidatePolicy, Decision, Metric, PaymentAttempt, PaymentCase, PaymentOutcome, PolicyVersion, RegressionReport, RiskEvidence };

export interface ApiState {
  orgId: string;
  network: string;
  activePolicy: {
    policyVersion: number;
    policyHash: string;
    profile: {
      maxPerPaymentAtomic: string;
      periodCapAtomic: string;
      periodSeconds: number;
      network: string;
      asset: string;
      allowedServices: string[];
      reviewCapacityPerPeriod: number;
    };
    defaultAction: string;
    rules: { ruleId: string; description: string }[];
  } | null;
  signerCallsTotal: number;
  attempts: number;
  awaitingApproval: number;
  cases: number;
}

export interface AttemptSummary {
  attemptId: string;
  status: string;
  policyVersion: number | null;
  action: string | null;
  signerCalls: number;
  createdAt: string;
  payTo: string | null;
  amountAtomic: string | null;
}

export type PresentedEvidence = (RiskEvidence & { tierLabel: string }) | null;

export interface Trace {
  attempt: PaymentAttempt;
  decision: Decision | null;
  evidence: PresentedEvidence;
  outcome: PaymentOutcome | null;
  permit: { permitId: string; status: string; expiresAt: string } | null;
  signer: { calls: number; invokedAt: string | null };
  audit: AuditEvent[];
}

export interface Approved {
  approval: { approvalId: string };
  resumed: boolean;
}
