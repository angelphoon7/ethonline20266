import { createPublicClient, http, parseAbi, parseAbiItem } from 'viem';
import { baseSepolia } from 'viem/chains';
import { CHAIN } from '../chain.js';
import type { ChainReader } from './reconcile.js';

/** Read-only Base Sepolia reader over the official USDC (EIP-3009): authorizationState and the AuthorizationUsed event. */
const authorizationStateAbi = parseAbi(['function authorizationState(address authorizer, bytes32 nonce) view returns (bool)']);
const authorizationUsedEvent = parseAbiItem('event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)');

/** Search the most recent blocks (about 3 hours on Base Sepolia at 2 s blocks). */
const LOG_LOOKBACK_BLOCKS = 5000n;
/** The public RPC rejects eth_getLogs ranges above 1,000 blocks (observed in M-006), so the search is chunked. */
const LOG_WINDOW_BLOCKS = 1000n;

export function viemChainReader(rpcUrl: string, lookback: bigint = LOG_LOOKBACK_BLOCKS, window: bigint = LOG_WINDOW_BLOCKS): ChainReader {
  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  return {
    async authorizationUsed(from, nonce) {
      return client.readContract({ address: CHAIN.usdc, abi: authorizationStateAbi, functionName: 'authorizationState', args: [from, nonce] });
    },
    async findAuthorizationTx(from, nonce) {
      // Newest window first: a recently signed authorisation is found in the first request. Any RPC failure means
      // "not found", which the reconciler treats as pending and keeps the reservation (it never releases on an error).
      try {
        const latest = await client.getBlockNumber();
        const floor = latest > lookback ? latest - lookback : 0n;
        for (let to = latest; to >= floor; to -= window) {
          const fromBlock = to - window + 1n > floor ? to - window + 1n : floor;
          const logs = await client.getLogs({ address: CHAIN.usdc, event: authorizationUsedEvent, args: { authorizer: from, nonce }, fromBlock, toBlock: to });
          const hash = logs[0]?.transactionHash;
          if (hash) return hash.toLowerCase() as `0x${string}`;
          if (fromBlock === floor) break;
        }
        return null;
      } catch {
        return null;
      }
    },
    async latestBlockTimestamp() {
      const block = await client.getBlock();
      return Number(block.timestamp);
    },
  };
}
