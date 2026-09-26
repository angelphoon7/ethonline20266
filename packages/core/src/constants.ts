/** Defaults from SPEC Appendix A (ADR-012, ADR-013). Changing one needs an ADR. */
export const EVIDENCE_FRESHNESS_S = 30;
export const DECISION_TTL_S = 60;
export const APPROVAL_TTL_S = 600;
export const INTERCEPTA_TIMEOUT_MS = 8000;
/** A quote whose `maxTimeoutSeconds` is outside [1, QUOTE_MAX_VALIDITY_S] is HOLD `QUOTE_INVALID` at the local stage (ADR-022). */
export const QUOTE_MAX_VALIDITY_S = 600;

/** The only network and asset Risksir may sign on (INV-006, OPERATIONAL_GUARDRAILS section 2). USDC is confirmed against docs.x402.org in Spike B. */
export const BASE_SEPOLIA_NETWORK = 'eip155:84532' as const;
export const BASE_SEPOLIA_USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e' as const;

/** Largest test USDC balance the payer wallet may hold (OPERATIONAL_GUARDRAILS section 3, raised from 20 to 100 by the human on 2026-09-26, ADR-026). Checked by the demo preflight, not by the signer. */
export const PAYER_BALANCE_CEILING_ATOMIC = 100_000_000n;

/** Live testnet spend limits, OPERATIONAL_GUARDRAILS section 4, in USDC atomic units. */
export const LIVE_LIMITS = {
  maxPerPaymentAtomic: 100_000n,
  maxSessionTotalAtomic: 100_000_000n, // 100 test USDC (was 1.00 until 2026-09-26, ADR-029)
  maxSessionSettlements: 1000, // was 20 until 2026-09-26, ADR-029
} as const;
