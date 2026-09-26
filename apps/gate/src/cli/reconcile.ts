/**
 * Chain reconciliation of ambiguous settlements (SPEC section 12, INV-014). Read-only RPC calls; writes only to the local DB.
 *   corepack pnpm reconcile                    reconcile every ambiguous attempt of the demo organisation
 *   corepack pnpm reconcile --check <attemptId> read-only: print what the chain says about that attempt's authorisation
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_ORG_ID } from '@risksir/core';
import { reconcileAll, viemChainReader } from '../reconcile/index.js';
import { Store } from '../store/store.js';

const rpc = process.env.BASE_SEPOLIA_RPC_URL;
if (!rpc) {
  console.error('BASE_SEPOLIA_RPC_URL is not set');
  process.exit(1);
}
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const store = new Store(join(root, 'data', 'risksir.db'));
const chain = viemChainReader(rpc);

const checkIndex = process.argv.indexOf('--check');
if (checkIndex !== -1) {
  const attemptId = process.argv[checkIndex + 1] ?? '';
  const auth = store.getSignerAuthorization(attemptId);
  if (!auth) {
    console.log(JSON.stringify({ attemptId, authorisation: null, note: 'no authorisation was recorded for this attempt' }));
  } else {
    const from = auth.from as `0x${string}`;
    const nonce = auth.nonce as `0x${string}`;
    const used = await chain.authorizationUsed(from, nonce);
    console.log(
      JSON.stringify({
        attemptId,
        authorisation: { from, nonce, validBefore: auth.validBefore.toString() },
        usedOnChain: used,
        txHash: used ? await chain.findAuthorizationTx(from, nonce) : null,
        chainTimestamp: await chain.latestBlockTimestamp(),
      }),
    );
  }
} else {
  console.log(JSON.stringify(await reconcileAll(store, chain, DEMO_ORG_ID)));
}
store.close();
