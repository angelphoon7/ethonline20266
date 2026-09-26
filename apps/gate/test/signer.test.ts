import { recoverTypedDataAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { BASE_SEPOLIA_USDC, decisionSchema, hashQuote, paymentAttemptSchema } from '@risksir/core';
import type { ReasonCode } from '@risksir/core';
import { SignerRefusedError, createProtectedSigner } from '../src/signer/public.js';
import { ORG, PAY_TO, T_START, makeWorld } from './helpers/world.js';
import type { World } from './helpers/world.js';

/**
 * A refusal: SignerRefusedError, zero recorded signer calls, an unsigned attempt, an untouched open decision and an
 * untouched armed permit (nothing is consumed by a refused request).
 */
async function expectRefused(w: World, code?: ReasonCode, request = w.typedData()) {
  const decisionBefore = w.store.getDecision(w.decisionId)?.status;
  const permitBefore = w.store.getLatestPermit(w.attemptId)?.status;
  const err = await w.attemptSigner.signTypedData(request).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(SignerRefusedError);
  if (code) expect((err as SignerRefusedError).code).toBe(code);
  expect(w.signerCalls()).toBe(0);
  const attempt = w.store.getAttempt(w.attemptId);
  expect(attempt?.signerCalls).toBe(0);
  expect(attempt?.signerInvokedAt).toBeNull();
  expect(attempt?.status).toBe('decided');
  expect(w.store.getDecision(w.decisionId)?.status).toBe(decisionBefore);
  expect(w.store.getLatestPermit(w.attemptId)?.status).toBe(permitBefore);
  expect(w.refusals.length).toBeGreaterThan(0);
  expect(w.store.listAudit().filter((e) => e.type === 'SignerRefused').length).toBeGreaterThan(0);
}

// T-023 (INV-004, INV-024, INV-019, INV-027): exactly one signature for a valid permit and decision.
describe('protected signer: an armed permit and an eligible decision sign exactly once', () => {
  it('signs, counts one call, consumes the permit and the decision, and records the signer timestamp after the Intercepta return', async () => {
    const w = makeWorld();
    const request = w.typedData();
    const signature = await w.attemptSigner.signTypedData(request);
    expect(signature).toMatch(/^0x[0-9a-f]{130}$/);

    const recovered = await recoverTypedDataAddress({
      domain: request.domain,
      types: request.types,
      primaryType: 'TransferWithAuthorization',
      message: request.message,
      signature,
    } as Parameters<typeof recoverTypedDataAddress>[0]);
    expect(recovered.toLowerCase()).toBe(w.signer.address.toLowerCase());

    expect(w.signerCalls()).toBe(1);
    const attempt = w.store.getAttempt(w.attemptId);
    expect(attempt).toMatchObject({ status: 'signed', signerCalls: 1 });
    expect(Date.parse(attempt?.interceptaReturnedAt ?? '')).toBeLessThan(Date.parse(attempt?.signerInvokedAt ?? ''));
    expect(w.store.getDecision(w.decisionId)?.status).toBe('consumed');
    expect(w.store.getLatestPermit(w.attemptId)?.status).toBe('consumed');
    expect(w.store.isFirstTimeCounterparty(ORG, PAY_TO)).toBe(false);
    expect(w.store.listAudit().map((e) => e.type)).toEqual(expect.arrayContaining(['PermitArmed', 'SignerInvoked']));
  });

  it('a permit is single use: the second request is refused (INV-024, INV-027)', async () => {
    const w = makeWorld();
    await w.attemptSigner.signTypedData(w.typedData());
    await expect(w.attemptSigner.signTypedData(w.typedData())).rejects.toBeInstanceOf(SignerRefusedError);
    expect(w.signerCalls()).toBe(1);
  });

  it('the ledger refuses a second call for the same decision or permit even if the checks were bypassed', () => {
    const w = makeWorld();
    const call = { attemptId: w.attemptId, decisionId: w.decisionId, permitId: w.permitId, at: new Date(w.clock.ms).toISOString() };
    expect(w.store.recordSignerCall(call)).toBe(true);
    expect(w.store.recordSignerCall(call)).toBe(false);
  });

  it('a signer call at or before the Intercepta return cannot be persisted; permit and decision stay usable (INV-019)', () => {
    const w = makeWorld();
    const before = new Date(T_START + 1000).toISOString(); // before interceptaReturnedAt (T+2s)
    expect(() => w.store.recordSignerCall({ attemptId: w.attemptId, decisionId: w.decisionId, permitId: w.permitId, at: before })).toThrow();
    expect(w.signerCalls()).toBe(0);
    expect(w.store.getDecision(w.decisionId)?.status).toBe('open'); // rolled back
    expect(w.store.getLatestPermit(w.attemptId)?.status).toBe('armed');
  });

  it('the SDK-facing signer has no way to bind or authorise anything: only address and signTypedData', () => {
    const w = makeWorld();
    expect(Object.keys(w.attemptSigner).sort()).toEqual(['address', 'signTypedData']);
  });
});

// T-024 (INV-002/004/005/006/007/017/027): one negative test per mismatch, tables A and B of SPEC section 12.
describe('protected signer refuses (table A: typed data vs the permit stored quote)', () => {
  const mismatches: [string, Parameters<World['typedData']>[0], ReasonCode][] = [
    ['A2 recipient', { message: { to: `0x${'99'.repeat(20)}` } }, 'QUOTE_MUTATED'],
    ['A3 amount +1', { message: { value: 50001n } }, 'QUOTE_MUTATED'],
    ['A3 amount -1', { message: { value: 49999n } }, 'QUOTE_MUTATED'],
    ['A3 non-numeric amount', { message: { value: 'not-a-number' } }, 'QUOTE_MUTATED'],
    ['A4 verifying contract', { domain: { verifyingContract: `0x${'44'.repeat(20)}` } }, 'ASSET_NOT_ALLOWED'],
    ['A5 chain id', { domain: { chainId: 8453 } }, 'NETWORK_NOT_ALLOWED'],
    ['A6 payer', { message: { from: `0x${'55'.repeat(20)}` } }, 'SIGNER_REFUSED'],
    ['A7 validAfter in the future', { message: { validAfter: 9_999_999_999n } }, 'QUOTE_MUTATED'],
    ['A7 validBefore beyond the quote validity', { message: { validBefore: 9_999_999_999n } }, 'QUOTE_MUTATED'],
    ['A7 validBefore already expired', { message: { validBefore: 1n } }, 'QUOTE_MUTATED'],
  ];
  it.each(mismatches)('%s', async (_name, patch, code) => {
    const w = makeWorld();
    await expectRefused(w, code, w.typedData(patch));
  });

  it.each([
    ['A1 a different primary type', { primaryType: 'Permit' }],
    ['A1 different types', { types: { Permit: [{ name: 'owner', type: 'address' }] } }],
  ])('%s', async (_name, patch) => {
    const w = makeWorld();
    await expectRefused(w, 'SIGNER_REFUSED', { ...w.typedData(), ...patch } as ReturnType<World['typedData']>);
  });

  it.each([
    ['A5 the permit quote is on another network', { network: 'eip155:8453' }, {}, 'NETWORK_NOT_ALLOWED'],
    ['A4 the permit quote asset is not the allowlisted USDC', { asset: `0x${'44'.repeat(20)}` }, { verifyingContract: `0x${'44'.repeat(20)}` }, 'ASSET_NOT_ALLOWED'],
  ] as const)('%s', async (_name, quotePatch, domain, code) => {
    const w = makeWorld({ quote: quotePatch });
    await expectRefused(w, code, w.typedData({ domain }));
  });
});

describe('protected signer refuses (table B: permit and decision conditions)', () => {
  describe('B1 the permit', () => {
    it('no permit was armed', async () => {
      await expectRefused(makeWorld({ arm: false }), 'SIGNER_REFUSED');
    });

    it('the permit was already consumed', async () => {
      const w = makeWorld();
      await w.attemptSigner.signTypedData(w.typedData());
      const err = await w.attemptSigner.signTypedData(w.typedData()).catch((e: unknown) => e);
      expect((err as SignerRefusedError).code).toBe('SIGNER_REFUSED');
      expect(w.signerCalls()).toBe(1);
    });

    it('the permit was revoked', async () => {
      const w = makeWorld();
      w.store.revokePermit(w.permitId);
      await expectRefused(w, 'SIGNER_REFUSED');
    });

    it('the permit expired (clock past its expiry)', async () => {
      const w = makeWorld();
      w.clock.ms = T_START + 3000 + 60_000;
      await expectRefused(w, 'DECISION_EXPIRED');
    });

    it("a permit armed for another attempt does not authorise this one", async () => {
      const w = makeWorld({ arm: false });
      const other = w.signer.forAttempt('att-other');
      await expect(other.signTypedData(w.typedData())).rejects.toBeInstanceOf(SignerRefusedError);
      expect(w.signerCalls()).toBe(0);
    });

    it("a permit that points at another attempt's decision", async () => {
      const w = makeWorld({ permit: { decisionId: 'dec-other' } });
      w.store.saveDecision(decisionSchema.parse({ ...w.store.getDecision(w.decisionId), decisionId: 'dec-other', attemptId: 'att-other' }));
      await expectRefused(w, 'SIGNER_REFUSED');
    });
  });

  describe('B2 the decision', () => {
    const notEligible: [string, Record<string, unknown>][] = [
      ['HOLD', { action: 'HOLD', signerEligible: false, authorisedMaxAtomic: null, reasons: [{ code: 'NO_RULE_MATCHED', ruleId: null }] }],
      ['DENY', { action: 'DENY', signerEligible: false, authorisedMaxAtomic: null, reasons: [{ code: 'EVIDENCE_BLOCK', ruleId: null }] }],
      ['pending ASK_HUMAN', { action: 'ASK_HUMAN', signerEligible: false, authorisedMaxAtomic: null, reasons: [{ code: 'APPROVAL_PENDING', ruleId: 'R3' }] }],
      ['CAP below the quote', { action: 'CAP', signerEligible: false, authorisedMaxAtomic: '20000', reasons: [{ code: 'CAP_BELOW_QUOTE', ruleId: 'B1' }] }],
    ];
    it.each(notEligible)('a %s decision, even with an armed permit', async (_name, decision) => {
      await expectRefused(makeWorld({ decision }), 'SIGNER_REFUSED');
    });

    it.each(['consumed', 'expired', 'superseded'] as const)('a %s decision', async (status) => {
      await expectRefused(makeWorld({ decision: { status } }));
    });

    it('an expired decision (clock past expiresAt, permit still within its own window)', async () => {
      const w = makeWorld({ permit: { expiresAt: new Date(T_START + 3_600_000).toISOString() } });
      w.clock.ms = T_START + 3000 + 60_000;
      await expectRefused(w, 'DECISION_EXPIRED');
    });

    it.each([
      ['UNAVAILABLE evidence', { tier: 'UNAVAILABLE', unavailable: 'TIMEOUT', providerScore: null }],
      ['BLOCK evidence', { tier: 'BLOCK', providerScore: 100, reasons: ['known_scammer'] }],
      ['evidence for another address', { address: `0x${'99'.repeat(20)}` }],
      ['evidence captured after the decision', { capturedAt: new Date(T_START + 10_000).toISOString() }],
    ])('%s', async (_name, evidence) => {
      await expectRefused(makeWorld({ evidence }), 'SIGNER_REFUSED');
    });
  });

  describe('B3 quote hash consistency', () => {
    it('the decision quote hash differs from the attempt quote hash', async () => {
      const w = makeWorld();
      w.store.saveAttempt(paymentAttemptSchema.parse({ ...w.store.getAttempt(w.attemptId), quoteHash: `0x${'00'.repeat(32)}` }));
      await expectRefused(w, 'QUOTE_MUTATED');
    });

    it('the permit quote hash differs from the decision quote hash', async () => {
      await expectRefused(makeWorld({ permit: { quoteHash: `0x${'00'.repeat(32)}` } }), 'QUOTE_MUTATED');
    });

    it('the quote stored in the permit no longer hashes to the decision quote hash (payTo, asset kept consistent with the typed data)', async () => {
      const w = makeWorld();
      const permit = w.store.getLatestPermit(w.attemptId) as NonNullable<ReturnType<World['store']['getLatestPermit']>>;
      // a permit whose stored resource differs: the typed data still matches every field it carries, but the hash does not
      const w2 = makeWorld({ permit: { quote: { ...permit.quote, resourceUrl: 'http://localhost:4021/paid/report/risky' } } });
      await expectRefused(w2, 'QUOTE_MUTATED');
      expect(hashQuote(w2.store.getLatestPermit(w2.attemptId)!.quote)).not.toBe(w2.store.getDecision(w2.decisionId)?.quoteHash);
    });
  });

  describe('B4 policy version', () => {
    it('the active policy changed while the attempt was pending (revokes the permit)', async () => {
      const w = makeWorld();
      const v1 = w.store.getPolicy(ORG, 1) as NonNullable<ReturnType<World['store']['getPolicy']>>;
      w.store.putPolicy(ORG, { ...v1, policyVersion: 2, parentVersion: 1, policyHash: `0x${'ab'.repeat(32)}` });
      w.store.setActivePolicy(ORG, 2, 'tr-2', new Date(w.clock.ms).toISOString());
      expect(w.store.getLatestPermit(w.attemptId)?.status).toBe('revoked');
      await expectRefused(w, 'POLICY_CHANGED');
    });

    it('the permit was armed under another policy version than the decision', async () => {
      await expectRefused(makeWorld({ permit: { policyVersion: 2 } }), 'POLICY_CHANGED');
    });
  });

  describe('B5 reservation and B6 limits', () => {
    it('no reservation', async () => {
      await expectRefused(makeWorld({ reserve: false }), 'RESERVATION_FAILED');
    });

    it('a released reservation', async () => {
      const w = makeWorld();
      w.store.releaseReservation(w.attemptId);
      await expectRefused(w, 'RESERVATION_FAILED');
    });

    it('amount above the decision authorised maximum', async () => {
      await expectRefused(makeWorld({ decision: { authorisedMaxAtomic: '49999' } }), 'OVER_PER_PAYMENT_CAP');
    });

    it('amount above the live per-payment limit even if the decision allows it', async () => {
      const w = makeWorld({ quote: { amountAtomic: '100001' }, decision: { authorisedMaxAtomic: '100001' } });
      await expectRefused(w, 'OVER_PER_PAYMENT_CAP');
    });

    it('an extra live-run limit (session total) refuses', async () => {
      await expectRefused(makeWorld({ extraCheck: () => 'session total would exceed 1.00 USDC' }), 'OVER_PER_PAYMENT_CAP');
    });
  });

  it('a refusal is a SignerRefusedError with a reason code and never signs partially', async () => {
    const w = makeWorld({ decision: { action: 'HOLD', signerEligible: false, authorisedMaxAtomic: null, reasons: [{ code: 'NO_RULE_MATCHED', ruleId: null }] } });
    const err = await w.attemptSigner.signTypedData(w.typedData()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SignerRefusedError);
    expect((err as SignerRefusedError).code).toBe('SIGNER_REFUSED');
  });
});

describe('protected signer: key handling (INV-008, INV-018)', () => {
  it('fails closed without a key and never puts key material in the error', () => {
    const world = makeWorld();
    const secret = '0xnot-a-valid-key-should-not-leak';
    expect(() => createProtectedSigner({ store: world.store, now: () => new Date(), keyProvider: () => secret as `0x${string}` })).toThrow();
    try {
      createProtectedSigner({ store: world.store, now: () => new Date(), keyProvider: () => secret as `0x${string}` });
    } catch (err) {
      expect(String((err as Error).message)).not.toContain(secret);
    }
  });

  it('exposes only address and forAttempt, and no key material on the signer objects', () => {
    const w = makeWorld();
    expect(Object.keys(w.signer).sort()).toEqual(['address', 'forAttempt']);
    expect(JSON.stringify(w.signer)).not.toMatch(/0x[0-9a-fA-F]{64}\b/);
  });

  it('the decision binds the hash of the quote stored in the permit', () => {
    const w = makeWorld();
    expect(w.store.getDecision(w.decisionId)?.quoteHash).toBe(hashQuote(w.quote));
    expect(w.store.getLatestPermit(w.attemptId)?.quoteHash).toBe(hashQuote(w.quote));
    expect(BASE_SEPOLIA_USDC).toBe('0x036cbd53842c5426634e7929541ec2318f3dcf7e');
  });
});
