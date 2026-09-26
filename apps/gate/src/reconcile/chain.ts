import { createPublicClient, http, parseAbi, parseAbiItem } from 'viem';
import { baseSepolia } from 'viem/chains';
import { CHAIN } from '../chain.js';
import type { ChainReader } from './reconcile.js';

/** Read-only Base Sepolia reader over the official USDC (EIP-3009): authorizationState and the AuthorizationUsed event. */
const authorizationStateAbi = parseAbi(['function authorizationState(address authorizer, bytes32 nonce) view returns (bool)']);
const authorizationUsedEvent = parseAbiItem('event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)');

/** eth_getLogs ranges are limited by public RPCs: search the most recent blocks (about an hour on Base Sepolia). */
const LOG_LOOKBACK_BLOCKS = 5000n;

export function viemChainReader(rpcUrl: string, lookback: bigint = LOG_LOOKBACK_BLOCKS): ChainReader {
  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  return {
    async authorizationUsed(from, nonce) {
      return client.readContract({ address: CHAIN.usdc, abi: authorizationStateAbi, functionName: 'authorizationState', args: [from, nonce] });
    },
    async findAuthorizationTx(from, nonce) {
      const latest = await client.getBlockNumber();
      const logs = await client.getLogs({
        address: CHAIN.usdc,
        event: authorizationUsedEvent,
        args: { authorizer: from, nonce },
        fromBlock: latest > lookback ? latest - lookback : 0n,
        toBlock: latest,
      });
      const hash = logs[0]?.transactionHash;
      return hash ? (hash.toLowerCase() as `0x${string}`) : null;
    },
    async latestBlockTimestamp() {
      const block = await client.getBlock();
      return Number(block.timestamp);
    },
  };
}
