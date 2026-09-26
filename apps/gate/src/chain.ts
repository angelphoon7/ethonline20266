import { BASE_SEPOLIA_NETWORK, BASE_SEPOLIA_USDC } from '@risksir/core';

/**
 * The single chain configuration source (AGENTS.md). Confirmed against docs.x402.org on 2026-09-26:
 * Base Sepolia is `eip155:84532` and the official test USDC is 0x036CbD53842c5426634e7929541eC2318f3dCF7e.
 * The signer enforces these independently of the policy engine (INV-006).
 */
export const CHAIN = {
  network: BASE_SEPOLIA_NETWORK,
  chainId: 84532,
  usdc: BASE_SEPOLIA_USDC,
  basescanTx: (hash: string) => `https://sepolia.basescan.org/tx/${hash}`,
} as const;
