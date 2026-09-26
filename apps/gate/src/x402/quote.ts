import { canonicalQuoteSchema } from '@risksir/core';
import type { CanonicalQuote } from '@risksir/core';
import type { PaymentRequirements } from '@x402/core/types';

/**
 * Turns the requirement the SDK selected into a CanonicalQuote (SPEC section 8). The resource URL is the one the gate
 * itself requested, never a value the seller supplies, so a seller cannot rewrite it. Anything that does not parse
 * returns null and the attempt fails closed as QUOTE_INVALID (the network is NOT validated here: the policy and the
 * signer enforce the allowlist).
 */
export function canonicalQuoteFrom(
  requirement: PaymentRequirements,
  ctx: { requestedUrl: string; attemptId: string },
): CanonicalQuote | null {
  const parsed = canonicalQuoteSchema.safeParse({
    scheme: requirement.scheme,
    network: requirement.network,
    asset: requirement.asset,
    amountAtomic: requirement.amount,
    payTo: requirement.payTo,
    resourceUrl: ctx.requestedUrl,
    attemptId: ctx.attemptId,
    maxTimeoutSeconds: requirement.maxTimeoutSeconds,
  });
  return parsed.success ? parsed.data : null;
}
