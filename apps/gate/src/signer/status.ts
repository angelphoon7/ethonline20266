import { createPublicClient, http, parseAbi } from 'viem';
import { baseSepolia } from 'viem/chains';
import { CHAIN } from '../chain.js';
import { loadAccount } from './key.js';
import type { KeyProvider } from './key.js';

/** Public payer address only. Never returns or logs key material. */
export function payerPublicAddress(provider?: KeyProvider): `0x${string}` {
  return loadAccount(provider).address;
}

export interface WalletStatus {
  payer: `0x${string}`;
  ethWei: bigint;
  usdcAtomic: bigint;
}

/** Read-only Base Sepolia balance check for the payer (ETH for gas is not needed for x402 but shows the wallet exists). */
export async function readWalletStatus(rpcUrl: string, provider?: KeyProvider): Promise<WalletStatus> {
  const payer = payerPublicAddress(provider);
  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  const [ethWei, usdcAtomic] = await Promise.all([
    client.getBalance({ address: payer }),
    client.readContract({
      address: CHAIN.usdc,
      abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
      functionName: 'balanceOf',
      args: [payer],
    }),
  ]);
  return { payer, ethWei, usdcAtomic };
}
