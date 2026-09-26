/**
 * Read-only on-chain check of a settlement: fetches the Base Sepolia receipt and decodes the USDC Transfer events.
 * Run: corepack pnpm verify:tx <txHash>. Makes RPC reads only. Independent of the facilitator's own report.
 */
import { createPublicClient, decodeEventLog, http, parseAbiItem } from 'viem';
import { baseSepolia } from 'viem/chains';
import { CHAIN } from '../chain.js';

const hash = process.argv[2];
const rpc = process.env.BASE_SEPOLIA_RPC_URL;
if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash) || !rpc) {
  console.error('usage: verify:tx <0x-transaction-hash> (needs BASE_SEPOLIA_RPC_URL)');
  process.exit(1);
}

const client = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
const receipt = await client.getTransactionReceipt({ hash: hash as `0x${string}` });
const transfer = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const usdcTransfers = receipt.logs
  .filter((l) => l.address.toLowerCase() === CHAIN.usdc)
  .flatMap((l) => {
    try {
      const d = decodeEventLog({ abi: [transfer], data: l.data, topics: l.topics });
      return [{ from: d.args.from, to: d.args.to, valueAtomic: d.args.value.toString() }];
    } catch {
      return [];
    }
  });
console.log(JSON.stringify({ network: CHAIN.network, txHash: hash, status: receipt.status, blockNumber: receipt.blockNumber.toString(), usdcTransfers }, null, 2));
