import { LIVE_LIMITS, hashQuote, parseAtomic } from '@risksir/core';
import type { ReasonCode } from '@risksir/core';
import { CHAIN } from '../chain.js';
import { loadAccount } from './key.js';
import type { KeyProvider } from './key.js';
import type { SignerStore } from '../store/store.js';

/**
 * The protected signer (SPEC section 12, ADR-019, INV-002/004/005/006/007/024/027). The x402 EVM client is handed an
 * object with exactly `address` and `signTypedData`. Every signature request is checked against a single-use SIGNING
 * PERMIT that the gate armed for this attempt, plus the stored decision, immediately before signing (defence in depth on
 * top of the SDK `onBeforePaymentCreation` hook, ADR-015).
 *
 * Isolation wording (ADR-024): the signer is the only CODE PATH that reads PAYER_PRIVATE_KEY. That is code-path
 * isolation inside one process, enforced by static tests; it is not a process or security boundary.
 *
 * The EIP-3009 typed data has only from/to/value/validAfter/validBefore/nonce and the domain, so the quote hash is
 * never recomputed from it: the typed data is compared with the quote stored in the permit (table A) and the decision
 * level conditions are checked separately (table B).
 */
export class SignerRefusedError extends Error {
  constructor(
    readonly code: ReasonCode,
    readonly detail: string,
  ) {
    super(`signer refused: ${code} (${detail})`);
    this.name = 'SignerRefusedError';
  }
}

export interface TypedDataRequest {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface SignerDeps {
  store: SignerStore;
  now: () => Date;
  keyProvider?: KeyProvider;
  /** Extra live-run limits (session total / settlement count). Returns a refusal detail, or null to allow. */
  extraCheck?: (ctx: { attemptId: string; amountAtomic: bigint }) => string | null;
  onRefusal?: (info: { attemptId: string; decisionId: string | null; code: ReasonCode; detail: string }) => void;
  /** Redacted: never receives the signature itself. */
  onSigned?: (info: { attemptId: string; decisionId: string; signerCalls: number }) => void;
}

/** What the SDK sees. There is deliberately no way to bind or authorise anything here: the gate arms the permit in the store. */
export interface AttemptSigner {
  readonly address: `0x${string}`;
  signTypedData(request: TypedDataRequest): Promise<`0x${string}`>;
}

export interface ProtectedSigner {
  readonly address: `0x${string}`;
  forAttempt(attemptId: string): AttemptSigner;
}

/** The EIP-3009 typed data the exact scheme signs; anything else (Permit2, permits, arbitrary messages) is refused. */
const EXPECTED_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

const CLOCK_SKEW_S = 5;

const lower = (v: unknown): string => (typeof v === 'string' ? v.toLowerCase() : '');
function toBigInt(v: unknown): bigint | null {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'string' || typeof v === 'number') {
    try {
      return BigInt(v);
    } catch {
      return null;
    }
  }
  return null;
}

export function createProtectedSigner(deps: SignerDeps): ProtectedSigner {
  const account = loadAccount(deps.keyProvider); // the only key access; never exported
  const address = account.address;

  function refuse(attemptId: string, decisionId: string | null, code: ReasonCode, detail: string): never {
    try {
      deps.store.appendAudit({
        at: deps.now().toISOString(),
        actor: 'system',
        type: 'SignerRefused',
        refs: { attemptId, ...(decisionId ? { decisionId } : {}) },
        payload: { attemptId, decisionId, code, detail },
      });
    } catch {
      // an audit failure must never mask the refusal
    }
    deps.onRefusal?.({ attemptId, decisionId, code, detail });
    throw new SignerRefusedError(code, detail);
  }

  return {
    address,
    forAttempt(attemptId: string): AttemptSigner {
      return {
        address,
        async signTypedData(req: TypedDataRequest): Promise<`0x${string}`> {
          let decisionId: string | null = null;
          const fail: (code: ReasonCode, detail: string) => never = (code, detail) => refuse(attemptId, decisionId, code, detail);
          const nowMs = deps.now().getTime();
          const nowS = Math.floor(nowMs / 1000);

          // A1: only EIP-3009 TransferWithAuthorization.
          if (req.primaryType !== 'TransferWithAuthorization' || JSON.stringify(req.types) !== JSON.stringify(EXPECTED_TYPES)) {
            fail('SIGNER_REFUSED', `unsupported typed data ${String(req.primaryType)}`);
          }

          // B1: an armed, unexpired permit for THIS attempt.
          const permit = deps.store.getLatestPermit(attemptId);
          if (!permit) fail('SIGNER_REFUSED', 'no signing permit was armed for this attempt');
          const pm = permit as NonNullable<typeof permit>;
          decisionId = pm.decisionId;
          if (pm.status !== 'armed') {
            const orgId = deps.store.getAttempt(attemptId)?.orgId;
            const version = orgId ? deps.store.getActivePolicyVersion(orgId) : null;
            if (pm.status === 'revoked' && version !== null && version !== pm.policyVersion) fail('POLICY_CHANGED', 'the permit was revoked because the active policy version changed');
            fail('SIGNER_REFUSED', `signing permit is ${pm.status}`);
          }
          if (nowMs >= Date.parse(pm.expiresAt)) fail('DECISION_EXPIRED', 'signing permit expired');
          const quote = pm.quote;

          // A2, A3: recipient and amount equal the stored quote.
          if (lower(req.message.to) !== quote.payTo) fail('QUOTE_MUTATED', 'message.to differs from the quote payTo');
          const value = toBigInt(req.message.value);
          if (value === null) fail('QUOTE_MUTATED', 'message.value is not an integer');
          const v = value as bigint;
          if (v !== parseAtomic(quote.amountAtomic)) fail('QUOTE_MUTATED', 'message.value differs from the quote amount');

          // A4, A5: allowlisted chain and asset, and equal to the quote's (INV-006).
          if (lower(req.domain.verifyingContract) !== CHAIN.usdc || quote.asset !== CHAIN.usdc) fail('ASSET_NOT_ALLOWED', 'verifyingContract or quote asset is not the allowlisted USDC');
          if (Number(req.domain.chainId) !== CHAIN.chainId || quote.network !== CHAIN.network) fail('NETWORK_NOT_ALLOWED', 'chainId or quote network is not eip155:84532');

          // A6: the payer is this signer.
          if (lower(req.message.from) !== address.toLowerCase()) fail('SIGNER_REFUSED', 'message.from is not the payer address');

          // A7: validity within the quote window and not expired.
          const validAfter = toBigInt(req.message.validAfter);
          const validBefore = toBigInt(req.message.validBefore);
          if (validAfter === null || validBefore === null) fail('QUOTE_MUTATED', 'validity window is not an integer');
          if ((validAfter as bigint) > BigInt(nowS)) fail('QUOTE_MUTATED', 'validAfter is in the future');
          const vb = validBefore as bigint;
          if (vb <= BigInt(nowS) || vb > BigInt(nowS + quote.maxTimeoutSeconds + CLOCK_SKEW_S)) fail('QUOTE_MUTATED', 'validBefore is outside the quoted validity window');

          // B2: the stored decision is open, eligible, unexpired and has usable evidence (INV-001).
          const decision = deps.store.getDecision(pm.decisionId);
          if (!decision) fail('SIGNER_REFUSED', 'decision not found');
          const d = decision as NonNullable<typeof decision>;
          if (d.attemptId !== attemptId) fail('SIGNER_REFUSED', 'decision belongs to another attempt');
          if (d.status !== 'open') fail(d.status === 'expired' ? 'DECISION_EXPIRED' : 'SIGNER_REFUSED', `decision is ${d.status}`);
          if (!d.signerEligible) fail('SIGNER_REFUSED', `decision action ${d.action} is not signer-eligible`);
          if (nowMs >= Date.parse(d.expiresAt)) fail('DECISION_EXPIRED', 'decision expired');
          if (d.evidenceId === null) fail('SIGNER_REFUSED', 'decision has no evidence');
          const evidence = deps.store.getEvidence(d.evidenceId as string);
          if (!evidence || evidence.tier === 'UNAVAILABLE' || evidence.tier === 'BLOCK') fail('SIGNER_REFUSED', 'decision has no usable evidence');
          const ev = evidence as NonNullable<typeof evidence>;
          if (Date.parse(ev.capturedAt) > Date.parse(d.decidedAt)) fail('SIGNER_REFUSED', 'evidence was captured after the decision');
          if (ev.address !== quote.payTo) fail('SIGNER_REFUSED', 'evidence is for a different address than the quote payTo');

          // B3: the quote hash is consistent across decision, attempt and permit, and the stored quote hashes to it.
          const attempt = deps.store.getAttempt(attemptId);
          if (!attempt) fail('SIGNER_REFUSED', 'attempt not found');
          const at = attempt as NonNullable<typeof attempt>;
          if (d.quoteHash !== at.quoteHash || d.quoteHash !== pm.quoteHash || hashQuote(quote) !== d.quoteHash) {
            fail('QUOTE_MUTATED', 'decision, attempt and permit do not bind the same quote hash');
          }

          // B4: the active policy is still the one that decided (INV-017).
          if (d.policyVersion !== pm.policyVersion || deps.store.getActivePolicyVersion(at.orgId) !== d.policyVersion) fail('POLICY_CHANGED', 'active policy version changed since the decision');

          // B5: a matching reservation is held (INV-007).
          const reservation = deps.store.getReservationForAttempt(attemptId);
          if (!reservation || reservation.status !== 'reserved' || parseAtomic(reservation.amountAtomic) !== v) fail('RESERVATION_FAILED', 'no matching reserved budget for this attempt');

          // B6: amount limits.
          if (d.authorisedMaxAtomic === null || v > parseAtomic(d.authorisedMaxAtomic)) fail('OVER_PER_PAYMENT_CAP', 'value exceeds the authorised maximum');
          if (v > LIVE_LIMITS.maxPerPaymentAtomic) fail('OVER_PER_PAYMENT_CAP', 'value exceeds the live per-payment limit');
          const extra = deps.extraCheck?.({ attemptId, amountAtomic: v });
          if (extra) fail('OVER_PER_PAYMENT_CAP', extra);

          // B7 + consume: count the call and consume permit and decision atomically; a decision signs at most once (INV-024).
          let recorded = false;
          try {
            recorded = deps.store.recordSignerCall({
              attemptId,
              decisionId: d.decisionId,
              permitId: pm.permitId,
              at: deps.now().toISOString(),
              authorization: { from: address, nonce: String(req.message.nonce), validBefore: vb },
            });
          } catch (err) {
            fail('SIGNER_REFUSED', `could not record the signer call: ${(err as Error).message}`);
          }
          if (!recorded) fail('SIGNER_REFUSED', 'permit or decision was already used');

          const signature = await account.signTypedData({
            domain: req.domain,
            types: req.types,
            primaryType: 'TransferWithAuthorization',
            message: req.message,
          } as Parameters<typeof account.signTypedData>[0]);
          deps.onSigned?.({ attemptId, decisionId: d.decisionId, signerCalls: 1 });
          return signature;
        },
      };
    },
  };
}
