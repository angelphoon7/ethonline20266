import { EVIDENCE_FRESHNESS_S, QUOTE_MAX_VALIDITY_S } from '../constants.js';
import { formatAtomic, parseAtomic } from '../money.js';
import type { AtomicAmount } from '../money.js';
import type { Action, Approval, CanonicalQuote, Hex32, PaymentPolicy, Predicate, ReasonCode, RiskEvidence, Rule } from '../types.js';

/**
 * Pure, deterministic policy decision (SPEC section 9, INV-023): no clock, network, randomness, DB or LLM.
 * Time, evidence, context and approval are all passed in.
 */
export interface EvaluateInput {
  policy: PaymentPolicy;
  quote: CanonicalQuote;
  quoteHash: Hex32;
  /** Null only at the local stage; a null at the evidence stage fails closed (HOLD). */
  evidence: RiskEvidence | null;
  context: {
    firstTimeCounterparty: boolean;
    /** Task/service id chosen by the gate from server-side typed scope, never by the agent. */
    service: string;
    periodBudgetRemainingAtomic: AtomicAmount;
  };
  approval: Approval | null;
  /** ISO timestamp; used only for evidence freshness and approval expiry. */
  now: string;
}

export interface EvaluateReason {
  code: ReasonCode;
  ruleId: string | null;
}

export interface EvaluateResult {
  action: Action;
  reasons: EvaluateReason[];
  /** PAY/eligible CAP: the quote amount. CAP below the quote: the cap (informational). Otherwise null. */
  authorisedMaxAtomic: AtomicAmount | null;
  signerEligible: boolean;
  approvalId: string | null;
}

const done = (
  action: Action,
  reasons: EvaluateReason[],
  extra: Partial<Pick<EvaluateResult, 'authorisedMaxAtomic' | 'signerEligible' | 'approvalId'>> = {},
): EvaluateResult => ({
  action,
  reasons,
  authorisedMaxAtomic: extra.authorisedMaxAtomic ?? null,
  signerEligible: extra.signerEligible ?? false,
  approvalId: extra.approvalId ?? null,
});

const reason = (code: ReasonCode, ruleId: string | null = null): EvaluateReason => ({ code, ruleId });

function parseTime(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new TypeError(`invalid timestamp: ${iso}`);
  return t;
}

function inRange(value: bigint, minAtomic: string | undefined, maxAtomic: string | undefined): boolean {
  if (minAtomic !== undefined && value < parseAtomic(minAtomic)) return false;
  if (maxAtomic !== undefined && value > parseAtomic(maxAtomic)) return false;
  return true;
}

function matches(p: Predicate, input: EvaluateInput, amount: bigint, budget: bigint): boolean {
  switch (p.kind) {
    case 'evidenceTier':
      return p.in.some((t) => t === input.evidence?.tier);
    case 'providerScore': {
      const score = input.evidence?.providerScore ?? null;
      if (score === null) return false; // an unknown score never satisfies a score predicate
      if (p.min !== undefined && score < p.min) return false;
      if (p.max !== undefined && score > p.max) return false;
      return true;
    }
    case 'amount':
      return inRange(amount, p.minAtomic, p.maxAtomic);
    case 'firstTimeCounterparty':
      return input.context.firstTimeCounterparty === p.value;
    case 'service':
      return p.in.includes(input.context.service);
    case 'budgetRemaining':
      return inRange(budget, p.minAtomic, p.maxAtomic);
  }
}

/** Why an approval does not cover this attempt, or null if it does. */
function approvalProblem(input: EvaluateInput, amount: bigint): ReasonCode | null {
  const a = input.approval;
  if (a === null) return 'APPROVAL_PENDING';
  if (a.attemptId !== input.quote.attemptId) return 'APPROVAL_PENDING';
  if (a.quoteHash !== input.quoteHash) return 'QUOTE_MUTATED'; // INV-005
  if (a.policyVersion !== input.policy.policyVersion) return 'POLICY_CHANGED'; // INV-017
  if (parseTime(input.now) >= parseTime(a.expiresAt)) return 'APPROVAL_EXPIRED';
  if (amount > parseAtomic(a.maxAmountAtomic)) return 'APPROVAL_PENDING';
  return null;
}

function applyAction(
  action: Action,
  cap: string | undefined,
  ruleId: string | null,
  matchedCode: 'RULE_MATCHED' | 'NO_RULE_MATCHED',
  input: EvaluateInput,
  amount: bigint,
): EvaluateResult {
  const matched = reason(matchedCode, ruleId);
  switch (action) {
    case 'PAY':
      return done('PAY', [matched], { authorisedMaxAtomic: formatAtomic(amount), signerEligible: true });
    case 'CAP': {
      if (cap === undefined) throw new Error('CAP rule without capAtomic');
      if (amount <= parseAtomic(cap)) {
        return done('CAP', [matched], { authorisedMaxAtomic: formatAtomic(amount), signerEligible: true });
      }
      // CAP is a maximum authorised amount, never a unilateral price reduction (ADR-008).
      return done('CAP', [matched, reason('CAP_BELOW_QUOTE', ruleId)], { authorisedMaxAtomic: cap });
    }
    case 'ASK_HUMAN': {
      const problem = approvalProblem(input, amount);
      if (problem === null) {
        // A valid, scoped approval, plus the fresh live screen already required by steps 6-9, becomes PAY.
        return done('PAY', [matched, reason('HUMAN_APPROVED', ruleId)], {
          authorisedMaxAtomic: formatAtomic(amount),
          signerEligible: true,
          approvalId: (input.approval as Approval).approvalId,
        });
      }
      return done('ASK_HUMAN', [matched, reason(problem, ruleId)]);
    }
    case 'HOLD':
    case 'DENY':
      return done(action, [matched]);
  }
}

/**
 * Stage A (SPEC section 9): local checks that need no evidence, run BEFORE any Intercepta call (ADR-022).
 * Returns the terminal result of the first failing check, or null when the quote may be screened.
 * Steps 1-5 are hard prohibitions (DENY); an invalid validity window is HOLD.
 */
export function evaluateLocal(policy: PaymentPolicy, quote: CanonicalQuote): EvaluateResult | null {
  const profile = policy.profile;
  if (quote.scheme !== 'exact') return done('DENY', [reason('SCHEME_NOT_SUPPORTED')]);
  if (quote.network !== profile.network) return done('DENY', [reason('NETWORK_NOT_ALLOWED')]);
  if (quote.asset !== profile.asset) return done('DENY', [reason('ASSET_NOT_ALLOWED')]);
  if (!profile.allowedServices.some((prefix) => quote.resourceUrl.startsWith(prefix))) {
    return done('DENY', [reason('SERVICE_NOT_ALLOWED')]);
  }
  if (parseAtomic(quote.amountAtomic) > parseAtomic(profile.maxPerPaymentAtomic)) {
    return done('DENY', [reason('OVER_PER_PAYMENT_CAP')]);
  }
  if (quote.maxTimeoutSeconds < 1 || quote.maxTimeoutSeconds > QUOTE_MAX_VALIDITY_S) {
    return done('HOLD', [reason('QUOTE_INVALID')]);
  }
  return null;
}

/** Fail-closed wrapper for stage A: an exception becomes HOLD with `ENGINE_ERROR`. */
export function evaluateLocalFailClosed(policy: PaymentPolicy, quote: CanonicalQuote): EvaluateResult | null {
  try {
    return evaluateLocal(policy, quote);
  } catch {
    return done('HOLD', [reason('ENGINE_ERROR')]);
  }
}

export function evaluate(input: EvaluateInput): EvaluateResult {
  const { policy, quote, evidence } = input;
  const amount = parseAtomic(quote.amountAtomic);
  const budget = parseAtomic(input.context.periodBudgetRemainingAtomic);

  // Stage A: hard prohibitions on the quote itself. No rule, candidate or approval can override them (INV-015).
  const local = evaluateLocal(policy, quote);
  if (local) return local;

  // Stage B, steps 6-7: unusable evidence fails closed before any rule can run (INV-003).
  if (evidence === null || evidence.tier === 'UNAVAILABLE' || evidence.address !== quote.payTo) {
    return done('HOLD', [reason('EVIDENCE_UNAVAILABLE')]);
  }
  const ageMs = parseTime(input.now) - parseTime(evidence.capturedAt);
  if (ageMs < 0 || ageMs > EVIDENCE_FRESHNESS_S * 1000) return done('HOLD', [reason('EVIDENCE_STALE')]);

  // Step 8: the evidence-block hard prohibition. Step 9: the period budget (cap - used, excluding this attempt).
  if (evidence.tier === 'BLOCK') return done('DENY', [reason('EVIDENCE_BLOCK')]);
  if (amount > budget) return done('HOLD', [reason('PERIOD_CAP_EXCEEDED')]);

  // Steps 10-11: ordered rules, first match wins, then the default action.
  const rule: Rule | undefined = policy.rules.find((r) => r.when.every((p) => matches(p, input, amount, budget)));
  if (rule !== undefined) {
    return applyAction(rule.then.action, rule.then.capAtomic, rule.ruleId, 'RULE_MATCHED', input, amount);
  }
  return applyAction(policy.defaultAction, undefined, null, 'NO_RULE_MATCHED', input, amount);
}

/** Fail-closed wrapper for the gate: any exception becomes HOLD with `ENGINE_ERROR` (SPEC section 16). */
export function evaluateFailClosed(input: EvaluateInput): EvaluateResult {
  try {
    return evaluate(input);
  } catch {
    return done('HOLD', [reason('ENGINE_ERROR')]);
  }
}
