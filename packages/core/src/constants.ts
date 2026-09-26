/** Defaults from SPEC Appendix A (ADR-012, ADR-013). Changing one needs an ADR. */
export const EVIDENCE_FRESHNESS_S = 30;
export const DECISION_TTL_S = 60;
export const APPROVAL_TTL_S = 600;
export const INTERCEPTA_TIMEOUT_MS = 8000;

/** The only network and asset Risksir may sign on (INV-006, OPERATIONAL_GUARDRAILS section 2). USDC is confirmed against docs.x402.org in Spike B. */
export const BASE_SEPOLIA_NETWORK = 'eip155:84532' as const;
export const BASE_SEPOLIA_USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e' as const;

/** Live testnet spend limits, OPERATIONAL_GUARDRAILS section 4, in USDC atomic units. */
export const LIVE_LIMITS = {
  maxPerPaymentAtomic: 100_000n,
  maxSessionTotalAtomic: 1_000_000n,
  maxSessionSettlements: 20,
} as const;
