import { LIVE_LIMITS, hashQuote, parseAtomic } from '@risksir/core';
import type { ReasonCode } from '@risksir/core';
import { CHAIN } from '../chain.js';
import { loadAccount } from './key.js';
import type { KeyProvider } from './key.js';
import type { SignerStore } from '../store/store.js';

/**
 * The protected signer (SPEC section 12, INV-002/004/005/006/008/024). The x402 EVM client is handed an object with
 * exactly `address` and `signTypedData`; every signature request is checked against a STORED decision immediately
 * before signing. This is defence in depth on top of the SDK `onBeforePaymentCreation` hook (ADR-015): even if a hook
 * misbehaves, nothing is signed without a stored, open, eligible decision that binds this exact quote.
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

export interface AttemptSigner {
  readonly address: `0x${string}`;
  /** Binds the decision this attempt may sign under. Grants nothing by itself: every signature is still fully checked. */
  authorise(decisionId: string): void;
  signTypedData(request: TypedDataRequest): Promise<`0x${string}`>;
}

export interface ProtectedSigner {
  readonly address: `0x${string}`;
  forAttempt(attemptId: string): AttemptSigner;
}

/** The EIP-3009 typed data the exact EVM scheme signs; anything else (Permit2, permits, arbitrary messages) is refused. */
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
    deps.onRefusal?.({ attemptId, decisionId, code, detail });
    throw new SignerRefusedError(code, detail);
  }

  return {
    address,
    forAttempt(attemptId: string): AttemptSigner {
      let boundDecisionId: string | null = null;
      return {
        address,
        authorise(decisionId: string) {
          boundDecisionId = decisionId;
        },
        async signTypedData(req: TypedDataRequest): Promise<`0x${string}`> {
          const decisionId = boundDecisionId;
          const fail: (code: ReasonCode, detail: string) => never = (code, detail) => refuse(attemptId, decisionId, code, detail);
          const nowMs = deps.now().getTime();
          const nowS = Math.floor(nowMs / 1000);

          // 0. Only EIP-3009 TransferWithAuthorization on the allowlisted chain and asset (INV-006).
          if (req.primaryType !== 'TransferWithAuthorization' || JSON.stringify(req.types) !== JSON.stringify(EXPECTED_TYPES)) {
            fail('SIGNER_REFUSED', `unsupported typed data ${String(req.primaryType)}`);
          }
          if (Number(req.domain.chainId) !== CHAIN.chainId) fail('NETWORK_NOT_ALLOWED', 'domain.chainId is not 84532');
          if (lower(req.domain.verifyingContract) !== CHAIN.usdc) fail('ASSET_NOT_ALLOWED', 'verifyingContract is not the allowlisted USDC');
          if (lower(req.message.from) !== address.toLowerCase()) fail('SIGNER_REFUSED', 'message.from is not the payer address');

          // 1. A stored, open, eligible, unexpired decision, bound to this attempt, with usable evidence.
          if (!decisionId) fail('SIGNER_REFUSED', 'no decision is bound to this attempt');
          const decision = deps.store.getDecision(decisionId as string);
          if (!decision) fail('SIGNER_REFUSED', 'decision not found');
          const d = decision as NonNullable<typeof decision>;
          if (d.attemptId !== attemptId) fail('SIGNER_REFUSED', 'decision belongs to another attempt');
          if (d.status !== 'open') fail(d.status === 'expired' ? 'DECISION_EXPIRED' : 'SIGNER_REFUSED', `decision is ${d.status}`);
          if (!d.signerEligible) fail('SIGNER_REFUSED', `decision action ${d.action} is not signer-eligible`);
          if (nowMs >= Date.parse(d.expiresAt)) fail('DECISION_EXPIRED', 'decision expired');
          const evidence = deps.store.getEvidence(d.evidenceId);
          if (!evidence || evidence.tier === 'UNAVAILABLE' || evidence.tier === 'BLOCK') fail('SIGNER_REFUSED', 'decision has no usable evidence');
          const ev = evidence as NonNullable<typeof evidence>;
          if (Date.parse(ev.capturedAt) > Date.parse(d.decidedAt)) fail('SIGNER_REFUSED', 'evidence was captured after the decision');

          // 2. The typed data must match the quote that the stored decision binds (INV-004, INV-005).
          const attempt = deps.store.getAttempt(attemptId);
          if (!attempt || !attempt.quote) fail('SIGNER_REFUSED', 'attempt has no stored quote');
          const quote = (attempt as NonNullable<typeof attempt>).quote as NonNullable<NonNullable<typeof attempt>['quote']>;
          if (hashQuote(quote) !== d.quoteHash || (attempt as NonNullable<typeof attempt>).quoteHash !== d.quoteHash) {
            fail('QUOTE_MUTATED', 'stored quote does not hash to the decision quote hash');
          }
          if (ev.address !== quote.payTo) fail('SIGNER_REFUSED', 'evidence is for a different address than the quote payTo');
          if (lower(req.message.to) !== quote.payTo) fail('QUOTE_MUTATED', 'message.to differs from the quote payTo');
          const value = toBigInt(req.message.value);
          if (value === null) fail('QUOTE_MUTATED', 'message.value is not an integer');
          if (value !== parseAtomic(quote.amountAtomic)) fail('QUOTE_MUTATED', 'message.value differs from the quote amount');
          if (quote.network !== CHAIN.network) fail('NETWORK_NOT_ALLOWED', 'quote network is not eip155:84532');
          if (quote.asset !== CHAIN.usdc) fail('ASSET_NOT_ALLOWED', 'quote asset is not the allowlisted USDC');
          if (lower(req.domain.verifyingContract) !== quote.asset) fail('ASSET_NOT_ALLOWED', 'verifyingContract differs from the quote asset');
          const validAfter = toBigInt(req.message.validAfter);
          const validBefore = toBigInt(req.message.validBefore);
          if (validAfter === null || validBefore === null) fail('QUOTE_MUTATED', 'validity window is not an integer');
          if (validAfter > BigInt(nowS)) fail('QUOTE_MUTATED', 'validAfter is in the future');
          if (validBefore <= BigInt(nowS) || validBefore > BigInt(nowS + quote.maxTimeoutSeconds + CLOCK_SKEW_S)) {
            fail('QUOTE_MUTATED', 'validBefore is outside the quoted validity window');
          }

          // 3. Amount limits (INV-007).
          if (d.authorisedMaxAtomic === null || value > parseAtomic(d.authorisedMaxAtomic)) fail('OVER_PER_PAYMENT_CAP', 'value exceeds the authorised maximum');
          if (value > LIVE_LIMITS.maxPerPaymentAtomic) fail('OVER_PER_PAYMENT_CAP', 'value exceeds the live per-payment limit');
          const extra = deps.extraCheck?.({ attemptId, amountAtomic: value });
          if (extra) fail('OVER_PER_PAYMENT_CAP', extra);

          // 4. The active policy must still be the one that decided (INV-017).
          if (deps.store.getActivePolicyVersion(attempt!.orgId) !== d.policyVersion) fail('POLICY_CHANGED', 'active policy version changed since the decision');

          // 5. A matching reservation (INV-007).
          const reservation = deps.store.getReservationForAttempt(attemptId);
          if (!reservation || reservation.status !== 'reserved' || parseAtomic(reservation.amountAtomic) !== value) {
            fail('RESERVATION_FAILED', 'no matching reserved budget for this attempt');
          }

          // 6. Count the call and consume the decision atomically; a decision signs at most once (INV-024).
          let recorded = false;
          try {
            recorded = deps.store.recordSignerCall({ attemptId, decisionId: d.decisionId, at: deps.now().toISOString() });
          } catch (err) {
            fail('SIGNER_REFUSED', `could not record the signer call: ${(err as Error).message}`);
          }
          if (!recorded) fail('SIGNER_REFUSED', 'decision was already used');

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
