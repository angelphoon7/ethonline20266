/**
 * Read-only: prints the payer's PUBLIC address and its Base Sepolia ETH and test USDC balances.
 * Run: corepack pnpm --filter @risksir/gate wallet:status. Makes RPC reads only; signs and spends nothing.
 */
import { atomicToUsdcString } from '@risksir/core';
import { readWalletStatus } from '../signer/public.js';

const rpc = process.env.BASE_SEPOLIA_RPC_URL;
if (!rpc) {
  console.error('BASE_SEPOLIA_RPC_URL is not set');
  process.exit(1);
}
const s = await readWalletStatus(rpc);
console.log(
  JSON.stringify({
    network: 'eip155:84532',
    payerPublicAddress: s.payer,
    ethWei: s.ethWei.toString(),
    usdc: atomicToUsdcString(s.usdcAtomic),
    usdcAtomic: s.usdcAtomic.toString(),
  }),
);
