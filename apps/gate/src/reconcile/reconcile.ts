import { randomUUID } from 'node:crypto';
import type { Hex32 } from '@risksir/core';
import type { Store } from '../store/store.js';

/**
 * Reconciliation of an ambiguous settlement (SPEC section 12, INV-014). A signed EIP-3009 authorisation has a unique
 * (from, nonce) and a validBefore. The chain is the authority:
 *  - nonce used     -> it settled: commit the reservation, record the tx hash (found via the AuthorizationUsed event);
 *  - nonce unused and validBefore has passed on CHAIN time -> it can never settle: release the reservation;
 *  - otherwise      -> still pending: keep the reservation, do not re-sign, do not retry.
 * Never releases on an HTTP timeout alone.
 */
export interface ChainReader {
  authorizationUsed(from: `0x${string}`, nonce: `0x${string}`): Promise<boolean>;
  /** The transaction that consumed the authorisation, or null if it cannot be found in the searched range. */
  findAuthorizationTx(from: `0x${string}`, nonce: `0x${string}`): Promise<Hex32 | null>;
  /** Timestamp (seconds) of the latest block: chain time, not the local clock. */
  latestBlockTimestamp(): Promise<number>;
}

export type ReconcileStatus = 'settled' | 'not_settled' | 'pending' | 'skipped';

export async function reconcileAttempt(
  store: Store,
  chain: ChainReader,
  attemptId: string,
  opts: { now?: () => Date; newId?: () => string } = {},
): Promise<ReconcileStatus> {
  const now = opts.now ?? (() => new Date());
  const newId = opts.newId ?? randomUUID;
  const attempt = store.getAttempt(attemptId);
  if (!attempt || attempt.status !== 'ambiguous') return 'skipped';

  const auth = store.getSignerAuthorization(attemptId);
  if (!auth) return 'pending'; // without the nonce nothing can be proven either way

  const from = auth.from as `0x${string}`;
  const nonce = auth.nonce as `0x${string}`;

  if (await chain.authorizationUsed(from, nonce)) {
    const txHash = await chain.findAuthorizationTx(from, nonce);
    if (!txHash) return 'pending'; // settled, but the hash is outside the searched range: keep the reservation
    store.applyReconciliation(attemptId, { kind: 'settled', txHash, at: now().toISOString() }, newId);
    return 'settled';
  }

  const chainNow = await chain.latestBlockTimestamp();
  if (BigInt(chainNow) > auth.validBefore) {
    store.applyReconciliation(attemptId, { kind: 'not_settled', at: now().toISOString() }, newId);
    return 'not_settled';
  }
  return 'pending';
}

export async function reconcileAll(
  store: Store,
  chain: ChainReader,
  orgId: string,
  opts: { now?: () => Date; newId?: () => string } = {},
): Promise<Record<string, ReconcileStatus>> {
  const out: Record<string, ReconcileStatus> = {};
  for (const attempt of store.listAttempts(orgId)) {
    if (attempt.status === 'ambiguous') out[attempt.attemptId] = await reconcileAttempt(store, chain, attempt.attemptId, opts);
  }
  return out;
}
