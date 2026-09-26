import type { SellerRoute } from './server.js';

/**
 * Prices (SPEC Appendix A): safe and alt 0.05 USDC (a first-time counterparty above the v2 first-payment band),
 * risky 0.01 USDC (never signed). All are within OPERATIONAL_GUARDRAILS section 4 (at most 0.10 USDC per payment).
 */
const PRICES: Record<SellerRoute['variant'], string> = { safe: '$0.05', risky: '$0.01', alt: '$0.05' };

/** Builds the seller routes from SELLER_PAY_TO_* variables; a variant whose variable is unset is omitted. */
export function routesFromEnv(env: Record<string, string | undefined>): SellerRoute[] {
  const pairs: [SellerRoute['variant'], string | undefined][] = [
    ['safe', env.SELLER_PAY_TO_SAFE],
    ['risky', env.SELLER_PAY_TO_RISKY],
    ['alt', env.SELLER_PAY_TO_ALT],
  ];
  return pairs.filter((p): p is [SellerRoute['variant'], string] => Boolean(p[1])).map(([variant, payTo]) => ({ variant, payTo, price: PRICES[variant] }));
}
