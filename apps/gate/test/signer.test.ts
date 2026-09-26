import { recoverTypedDataAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { BASE_SEPOLIA_USDC, canonicalQuoteSchema, decisionSchema, hashQuote, paymentAttemptSchema } from '@risksir/core';
import { SignerRefusedError, createProtectedSigner } from '../src/signer/public.js';
import { PAY_TO, makeWorld, ORG, T_START } from './helpers/world.js';
import type { World } from './helpers/world.js';

/** Signing must be refused, and refused with zero recorded signer calls, an untouched open decision and an unsigned attempt. */
async function expectZeroSignerCalls(w: World, request = w.typedData()) {
  await expect(w.attemptSigner.signTypedData(request)).rejects.toBeInstanceOf(SignerRefusedError);
  expect(w.signerCalls()).toBe(0);
  const attempt = w.store.getAttempt(w.attemptId);
  expect(attempt?.signerCalls).toBe(0);
  expect(attempt?.signerInvokedAt).toBeNull();
  expect(attempt?.status).toBe('decided');
  expect(w.refusals.length).toBeGreaterThan(0);
}

// T-023 (INV-004, INV-024, INV-019): exactly one signature for a valid decision.
describe('protected signer: approved PAY signs exactly once', () => {
  it('signs, counts one call, consumes the decision and records the signer timestamp after the Intercepta return', async () => {
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
    expect(w.store.isFirstTimeCounterparty(ORG, PAY_TO)).toBe(false);
  });

  it('a decision yields at most one signature: the second request is refused (INV-024)', async () => {
    const w = makeWorld();
    await w.attemptSigner.signTypedData(w.typedData());
    await expect(w.attemptSigner.signTypedData(w.typedData())).rejects.toBeInstanceOf(SignerRefusedError);
    expect(w.signerCalls()).toBe(1);
  });

  it('the ledger itself refuses a second call for the same decision even if checks were bypassed', async () => {
    const w = makeWorld();
    expect(w.store.recordSignerCall({ attemptId: w.attemptId, decisionId: w.decisionId, at: new Date(w.clock.ms).toISOString() })).toBe(true);
    expect(w.store.recordSignerCall({ attemptId: w.attemptId, decisionId: w.decisionId, at: new Date(w.clock.ms).toISOString() })).toBe(false);
  });

  it('a signer call at or before the Intercepta return cannot be persisted (INV-019)', () => {
    const w = makeWorld();
    const before = new Date(T_START + 1000).toISOString(); // before interceptaReturnedAt (T+2s)
    expect(() => w.store.recordSignerCall({ attemptId: w.attemptId, decisionId: w.decisionId, at: before })).toThrow();
    expect(w.signerCalls()).toBe(0);
    expect(w.store.getDecision(w.decisionId)?.status).toBe('open'); // rolled back
  });
});

// T-024 (INV-002/004/005/006/007/017): the zero-signer-call matrix.
describe('protected signer: zero signer calls', () => {
  describe('decisions that must never sign', () => {
    const notEligible: [string, Record<string, unknown>][] = [
      ['HOLD', { action: 'HOLD', signerEligible: false, authorisedMaxAtomic: null, reasons: [{ code: 'NO_RULE_MATCHED', ruleId: null }] }],
      ['DENY', { action: 'DENY', signerEligible: false, authorisedMaxAtomic: null, reasons: [{ code: 'EVIDENCE_BLOCK', ruleId: null }] }],
      ['pending ASK_HUMAN', { action: 'ASK_HUMAN', signerEligible: false, authorisedMaxAtomic: null, reasons: [{ code: 'APPROVAL_PENDING', ruleId: 'R3' }] }],
      ['CAP below the quote', { action: 'CAP', signerEligible: false, authorisedMaxAtomic: '20000', reasons: [{ code: 'CAP_BELOW_QUOTE', ruleId: 'B1' }] }],
    ];
    it.each(notEligible)('%s', async (_name, decision) => {
      await expectZeroSignerCalls(makeWorld({ decision }));
    });

    it.each(['consumed', 'expired', 'superseded'] as const)('a %s decision', async (status) => {
      await expectZeroSignerCalls(makeWorld({ decision: { status } }));
    });

    it('an expired decision (clock past expiresAt)', async () => {
      const w = makeWorld();
      w.clock.ms = T_START + 3000 + 60_000; // decidedAt + TTL
      await expectZeroSignerCalls(w);
      expect(w.refusals[0]?.code).toBe('DECISION_EXPIRED');
    });

    it('no decision bound to the attempt', async () => {
      await expectZeroSignerCalls(makeWorld({ bind: false }));
    });

    it('an unknown decision id', async () => {
      const w = makeWorld();
      w.attemptSigner.authorise('dec-does-not-exist');
      await expectZeroSignerCalls(w);
    });

    it("another attempt's decision", async () => {
      const w = makeWorld();
      const other = decisionSchema.parse({ ...w.store.getDecision(w.decisionId), decisionId: 'dec-other', attemptId: 'att-other' });
      w.store.saveDecision(other);
      w.attemptSigner.authorise('dec-other');
      await expectZeroSignerCalls(w);
    });
  });

  describe('typed data that differs from the bound quote (quote mutation, INV-005)', () => {
    const mutations: [string, Parameters<World['typedData']>[0]][] = [
      ['recipient', { message: { to: `0x${'99'.repeat(20)}` } }],
      ['amount +1', { message: { value: 50001n } }],
      ['amount -1', { message: { value: 49999n } }],
      ['chain id', { domain: { chainId: 8453 } }],
      ['verifying contract', { domain: { verifyingContract: `0x${'44'.repeat(20)}` } }],
      ['payer', { message: { from: `0x${'55'.repeat(20)}` } }],
      ['validBefore far in the future', { message: { validBefore: 9_999_999_999n } }],
      ['validBefore in the past', { message: { validBefore: 1n } }],
      ['validAfter in the future', { message: { validAfter: 9_999_999_999n } }],
    ];
    it.each(mutations)('%s', async (_name, patch) => {
      const w = makeWorld();
      await expectZeroSignerCalls(w, w.typedData(patch));
    });

    it.each([
      ['a different primary type', { primaryType: 'Permit' }],
      ['different types', { types: { Permit: [{ name: 'owner', type: 'address' }] } }],
    ])('refuses %s', async (_name, patch) => {
      const w = makeWorld();
      await expectZeroSignerCalls(w, { ...w.typedData(), ...patch } as ReturnType<World['typedData']>);
    });

    it('refuses non-numeric amounts', async () => {
      const w = makeWorld();
      await expectZeroSignerCalls(w, w.typedData({ message: { value: 'not-a-number' } }));
    });
  });

  describe('stored quote no longer matches the decision hash', () => {
    const changes: [string, Record<string, unknown>][] = [
      ['payTo', { payTo: `0x${'99'.repeat(20)}` }],
      ['amount', { amountAtomic: '50001' }],
      ['asset', { asset: `0x${'44'.repeat(20)}` }],
      ['network', { network: 'eip155:8453' }],
      ['scheme', { scheme: 'upto' }],
      ['resource', { resourceUrl: 'http://localhost:4021/paid/report/risky' }],
      ['validity', { maxTimeoutSeconds: 61 }],
    ];
    it.each(changes)('%s changed after the decision', async (_name, patch) => {
      const w = makeWorld();
      const attempt = w.store.getAttempt(w.attemptId);
      w.store.saveAttempt(paymentAttemptSchema.parse({ ...attempt, quote: canonicalQuoteSchema.parse({ ...w.quote, ...patch }) }));
      await expectZeroSignerCalls(w);
      expect(w.refusals[0]?.code).toBe('QUOTE_MUTATED');
    });
  });

  describe('network and asset allowlist enforced even when the decision binds the quote (INV-006)', () => {
    const allowlist: [string, Record<string, unknown>, Record<string, unknown>, string][] = [
      ['wrong network', { network: 'eip155:8453' }, {}, 'NETWORK_NOT_ALLOWED'],
      ['wrong asset', { asset: `0x${'44'.repeat(20)}` }, { verifyingContract: `0x${'44'.repeat(20)}` }, 'ASSET_NOT_ALLOWED'],
    ];
    it.each(allowlist)('%s', async (_name, quotePatch, domain, code) => {
      const w = makeWorld({ quote: quotePatch });
      await expectZeroSignerCalls(w, w.typedData({ domain }));
      expect(w.refusals[0]?.code).toBe(code);
    });
  });

  describe('limits', () => {
    it('amount above the decision authorised maximum', async () => {
      await expectZeroSignerCalls(makeWorld({ decision: { authorisedMaxAtomic: '49999' } }));
    });

    it('amount above the live per-payment limit even if the decision allows it', async () => {
      const w = makeWorld({ quote: { amountAtomic: '100001' }, decision: { authorisedMaxAtomic: '100001' } });
      await expectZeroSignerCalls(w);
      expect(w.refusals[0]?.code).toBe('OVER_PER_PAYMENT_CAP');
    });

    it('an extra live-run limit (session total) refuses', async () => {
      await expectZeroSignerCalls(makeWorld({ extraCheck: () => 'session total would exceed 1.00 USDC' }));
    });

    it('no reservation, a released reservation, or a reservation for another amount', async () => {
      await expectZeroSignerCalls(makeWorld({ reserve: false }));
      const released = makeWorld();
      released.store.releaseReservation(released.attemptId);
      await expectZeroSignerCalls(released);
    });
  });

  describe('policy and evidence', () => {
    it('policy version changed while the attempt is pending (INV-017)', async () => {
      const w = makeWorld();
      const v1 = w.store.getPolicy(ORG, 1);
      w.store.putPolicy(ORG, { ...(v1 as NonNullable<typeof v1>), policyVersion: 2, parentVersion: 1, policyHash: `0x${'ab'.repeat(32)}` });
      w.store.setActivePolicy(ORG, 2, 'tr-2', new Date(w.clock.ms).toISOString());
      await expectZeroSignerCalls(w);
      expect(w.refusals[0]?.code).toBe('POLICY_CHANGED');
    });

    it.each([
      ['UNAVAILABLE evidence', { tier: 'UNAVAILABLE', unavailable: 'TIMEOUT', providerScore: null }],
      ['BLOCK evidence', { tier: 'BLOCK', providerScore: 100, reasons: ['known_scammer'] }],
      ['evidence for another address', { address: `0x${'99'.repeat(20)}` }],
      ['evidence captured after the decision', { capturedAt: new Date(T_START + 10_000).toISOString() }],
    ])('%s', async (_name, evidence) => {
      await expectZeroSignerCalls(makeWorld({ evidence }));
    });
  });

  it('a refusal is thrown as SignerRefusedError with a reason code and never signs partially', async () => {
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

  it('exposes only address and signTypedData/authorise: no key material on the signer objects', () => {
    const w = makeWorld();
    expect(Object.keys(w.signer).sort()).toEqual(['address', 'forAttempt']);
    expect(Object.keys(w.attemptSigner).sort()).toEqual(['address', 'authorise', 'signTypedData']);
    expect(JSON.stringify(w.signer)).not.toMatch(/0x[0-9a-fA-F]{64}\b/);
  });

  it('hashQuote of the stored quote is the value the decision binds', () => {
    const w = makeWorld();
    expect(w.store.getDecision(w.decisionId)?.quoteHash).toBe(hashQuote(w.quote));
    expect(BASE_SEPOLIA_USDC).toBe('0x036cbd53842c5426634e7929541ec2318f3dcf7e');
  });
});
