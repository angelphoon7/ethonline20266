import { formatAtomic, parseAtomic } from '../money.js';
import { hashQuote } from '../fingerprint.js';
import { evaluate } from '../policy/evaluate.js';
import type { EvaluateResult } from '../policy/evaluate.js';
import { canonicalQuoteSchema } from '../types.js';
import type { PaymentCase, PaymentPolicy, Replayed } from '../types.js';

/**
 * Deterministic replay of ONE stored case under ONE policy (SPEC section 13). It uses the case's stored evidence
 * snapshot and the production `evaluate()`; it never screens, never reads a clock (`now` is the evidence's own
 * `capturedAt`, so freshness never fires) and has no signer capability. Pure (INV-012, INV-023).
 */
export function replayCase(policy: PaymentPolicy, c: PaymentCase): Replayed {
  const quote = canonicalQuoteSchema.parse({
    scheme: 'exact',
    network: c.quote.network,
    asset: c.quote.asset,
    amountAtomic: c.quote.amountAtomic,
    payTo: c.quote.payTo,
    resourceUrl: c.quote.resourceUrl,
    attemptId: c.caseId,
    maxTimeoutSeconds: 60,
  });
  const result = evaluate({
    policy,
    quote,
    quoteHash: hashQuote(quote),
    evidence: c.evidence,
    context: {
      firstTimeCounterparty: c.context.firstTimeCounterparty,
      service: c.quote.service,
      periodBudgetRemainingAtomic: c.context.periodBudgetRemainingAtomic,
    },
    approval: null,
    now: c.evidence.capturedAt,
  });
  return { action: result.action, reasons: result.reasons.map((r) => r.code), exposureAtomic: formatAtomic(exposureOf(result, parseAtomic(c.quote.amountAtomic))) };
}

/**
 * Counterfactual exposure (not a loss claim): `PAY` and an eligible `CAP` expose the quote amount; `HOLD`, `DENY`, a
 * `CAP` below the quote and a pending `ASK_HUMAN` (assumed NOT approved) expose nothing.
 */
export function exposureOf(result: Pick<EvaluateResult, 'action' | 'signerEligible'>, amount: bigint): bigint {
  return (result.action === 'PAY' || result.action === 'CAP') && result.signerEligible ? amount : 0n;
}

/** Whether a replayed action would have been signed autonomously. */
export function isEligibleReplay(r: Replayed): boolean {
  return r.action === 'PAY' || (r.action === 'CAP' && !r.reasons.includes('CAP_BELOW_QUOTE'));
}
