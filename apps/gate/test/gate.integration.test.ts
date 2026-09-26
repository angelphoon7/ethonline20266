import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import { demoCandidates, demoPolicyV1, demoProfile } from '@risksir/core';
import { adapterScreen, fixtureScreen, makeClock, makeGateWorld, policyWithCaps } from './helpers/gateWorld.js';
import { startEmptyBodySeller, startRawSeller, startRealSeller, startStubFacilitator, usdcRequirement } from './helpers/servers.js';
import type { RawSeller, Running, StubFacilitator } from './helpers/servers.js';

const SAFE = `0x${'11'.repeat(20)}`;
const RISKY = `0x${'22'.repeat(20)}`;
const ALT = `0x${'33'.repeat(20)}`;

let facilitator: StubFacilitator;
let seller: Running;
let base: string; // http://127.0.0.1:port/paid/

beforeAll(async () => {
  facilitator = await startStubFacilitator();
  seller = await startRealSeller(facilitator.url, [
    { variant: 'safe', payTo: SAFE, price: '$0.05' },
    { variant: 'risky', payTo: RISKY, price: '$0.01' },
    { variant: 'alt', payTo: ALT, price: '$0.05' },
  ]);
  base = `${seller.url}/paid/`;
});
afterAll(async () => {
  await seller.close();
  await facilitator.close();
});

const tiers = { [SAFE]: 'CLEAR', [RISKY]: 'BLOCK', [ALT]: 'CLEAR' } as const;

function freshFacilitatorCounters() {
  return { ...facilitator.calls };
}

// T-040 (AC-001..004, INV-001, INV-019): a real local 402 -> live-style screen -> PAY -> one signature -> settlement.
describe('pass path (real local x402 seller, stub facilitator, fixture evidence)', () => {
  it('receives a real 402, screens the exact payTo before signing, signs once and settles', async () => {
    const clock = makeClock();
    const s = fixtureScreen(tiers, clock);
    const w = makeGateWorld({ serviceBase: base, screen: s.screen, clock });
    const before = freshFacilitatorCounters();

    const result = await w.gate.run(w.task('report/safe'));

    expect(s.calls).toEqual([SAFE]); // exactly the selected payTo, exactly once
    expect(result.decision).toMatchObject({ action: 'PAY', signerEligible: true, policyVersion: 1, status: 'consumed' });
    expect(result.attempt).toMatchObject({ status: 'settled', signerCalls: 1 });
    expect(result.attempt.quote).toMatchObject({ scheme: 'exact', network: 'eip155:84532', payTo: SAFE, amountAtomic: '50000' });
    expect(result.attempt.quote?.asset).toBe(getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e').toLowerCase());
    expect(Date.parse(result.attempt.interceptaReturnedAt ?? '')).toBeLessThan(Date.parse(result.attempt.signerInvokedAt ?? ''));
    expect(result.outcome).toMatchObject({ settlementStatus: 'settled', deliveryStatus: 'received', httpStatus: 200 });
    expect(result.outcome?.txHash).toBe(facilitator.settled.at(-1)?.transaction);
    expect(result.response?.body).toMatchObject({ variant: 'safe' });
    expect(facilitator.calls.verify - before.verify).toBe(1);
    expect(facilitator.calls.settle - before.settle).toBe(1);
    expect(facilitator.settled.at(-1)).toMatchObject({ to: getAddress(SAFE), value: '50000' });
    expect(w.store.getReservationForAttempt(result.attempt.attemptId)?.status).toBe('committed');
    expect(w.store.getLatestPermit(result.attempt.attemptId)).toMatchObject({ status: 'consumed', decisionId: result.decision?.decisionId, quoteHash: result.attempt.quoteHash });
    expect(w.store.isFirstTimeCounterparty('org-exampleco', SAFE)).toBe(false);
    expect(w.logs.at(-1)).toMatch(/signerCalls=1 settlement=settled delivery=received tx=0x/);
  });
});

// T-041 (AC-005, AC-006): an Intercepta BLOCK is DENY with zero signer calls.
describe('block path (Intercepta-driven)', () => {
  it('denies a known-risk payTo with zero signer calls and no signer timestamp; nothing reaches the facilitator', async () => {
    const clock = makeClock();
    const w = makeGateWorld({ serviceBase: base, screen: fixtureScreen(tiers, clock).screen, clock });
    const before = freshFacilitatorCounters();

    const result = await w.gate.run(w.task('report/risky'));

    expect(result.blocked).toBe(true);
    expect(result.decision).toMatchObject({ action: 'DENY', signerEligible: false });
    expect(result.decision?.reasons.map((r) => r.code)).toEqual(['EVIDENCE_BLOCK']);
    expect(result.evidence).toMatchObject({ tier: 'BLOCK', reasons: ['known_scammer'], provenance: 'synthetic' });
    expect(result.attempt).toMatchObject({ status: 'failed', signerCalls: 0, signerInvokedAt: null });
    expect(w.store.signerCallCount(result.attempt.attemptId)).toBe(0);
    expect(facilitator.calls.verify - before.verify).toBe(0);
    expect(facilitator.calls.settle - before.settle).toBe(0);
    expect(w.store.getReservationForAttempt(result.attempt.attemptId)).toBeNull();
    expect(w.store.getLatestPermit(result.attempt.attemptId)).toBeNull(); // no permit is ever armed for a non-eligible decision
    expect(w.logs.at(-1)).toMatch(/action=DENY signerCalls=0 settlement=none/);
  });
});

// T-042 (AC-021, INV-003): every Intercepta failure is HOLD with zero signer calls, one call and no retry.
describe('Intercepta failures fail closed', () => {
  const failures: [string, () => Promise<Response>, string][] = [
    ['timeout', () => new Promise(() => undefined), 'TIMEOUT'],
    ['HTTP 500', async () => new Response('{}', { status: 500 }), 'HTTP_ERROR'],
    ['HTTP 429', async () => new Response('{}', { status: 429 }), 'RATE_LIMITED'],
    ['malformed body', async () => new Response(JSON.stringify({ nope: true }), { status: 200 }), 'MALFORMED'],
    ['non-JSON body', async () => new Response('<html>', { status: 200 }), 'MALFORMED'],
  ];
  it.each(failures)('%s => HOLD, zero signer calls, exactly one Intercepta call', async (_n, impl, code) => {
    const clock = makeClock();
    const hanging: typeof fetch = (_u, init) =>
      new Promise((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        void impl().then(resolve);
      });
    const a = adapterScreen(hanging, clock);
    const w = makeGateWorld({ serviceBase: base, screen: a.screen, clock });
    const before = freshFacilitatorCounters();

    const result = await w.gate.run(w.task('report/safe'));

    expect(a.calls.n).toBe(1);
    expect(result.evidence).toMatchObject({ tier: 'UNAVAILABLE', unavailable: code });
    expect(result.decision).toMatchObject({ action: 'HOLD', signerEligible: false });
    expect(result.attempt).toMatchObject({ status: 'failed', signerCalls: 0, signerInvokedAt: null });
    expect(facilitator.calls.settle - before.settle).toBe(0);
  });
});

// T-043 (AC-022, INV-005): mutating the quote after the decision cannot produce a signature.
describe('quote mutation after the decision', () => {
  let raw: RawSeller;
  beforeAll(async () => {
    raw = await startRawSeller([usdcRequirement({ payTo: SAFE })]);
  });
  afterAll(() => raw.close());

  const mutations: [string, (r: { payTo: string; amount: string; maxTimeoutSeconds: number }) => void][] = [
    ['payTo swapped', (r) => void (r.payTo = ALT)],
    ['amount raised', (r) => void (r.amount = '50001')],
    ['amount lowered', (r) => void (r.amount = '49999')],
    ['validity extended', (r) => void (r.maxTimeoutSeconds = 3600)],
  ];
  it.each(mutations)('%s by a later hook produces zero signatures', async (_n, mutate) => {
    const clock = makeClock();
    const w = makeGateWorld({
      serviceBase: `${raw.url}/`,
      screen: fixtureScreen('CLEAR', clock).screen,
      clock,
      // An adversarial hook registered AFTER the gate's own mutates the shared, already-decided requirement.
      configureClient: (client) => {
        client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
          mutate(selectedRequirements);
        });
      },
    });
    const result = await w.gate.run(w.task('anything'));

    expect(result.attempt.signerCalls).toBe(0);
    expect(w.store.signerCallCount(result.attempt.attemptId)).toBe(0);
    expect(result.attempt.signerInvokedAt).toBeNull();
    expect(raw.paymentHeaders()).toBe(0);
    expect(w.refusals[0]?.code).toBe('QUOTE_MUTATED');
    expect(w.store.getReservationForAttempt(result.attempt.attemptId)?.status).toBe('released');
  });
});

// T-044 / T-045: wrong network, wrong asset, caps.
describe('policy hard prohibitions and caps through the whole gate', () => {
  const wrong: [string, Record<string, unknown>, string][] = [
    ['wrong network', { network: 'eip155:8453' }, 'NETWORK_NOT_ALLOWED'],
    ['wrong asset', { asset: `0x${'44'.repeat(20)}` }, 'ASSET_NOT_ALLOWED'],
  ];

  it.each(wrong)('%s: the SDK spend controls already filter it, so nothing is decided or signed', async (_n, patch) => {
    const raw = await startRawSeller([usdcRequirement({ payTo: SAFE, ...patch })]);
    try {
      const clock = makeClock();
      const w = makeGateWorld({ serviceBase: `${raw.url}/`, screen: fixtureScreen('CLEAR', clock).screen, clock });
      const result = await w.gate.run(w.task('anything'));
      expect(result.attempt).toMatchObject({ status: 'failed', signerCalls: 0, signerInvokedAt: null });
      expect(raw.paymentHeaders()).toBe(0);
    } finally {
      await raw.close();
    }
  });

  it.each(wrong)('%s: with the SDK spend controls disabled the policy alone DENYs it (defence in depth)', async (_n, patch, code) => {
    const raw = await startRawSeller([usdcRequirement({ payTo: SAFE, ...patch })]);
    try {
      const clock = makeClock();
      const screen = fixtureScreen('CLEAR', clock);
      const w = makeGateWorld({
        serviceBase: `${raw.url}/`,
        screen: screen.screen,
        clock,
        configureClient: (client) => void client.setSpendControls(false),
      });
      const result = await w.gate.run(w.task('anything'));
      expect(result.decision?.action).toBe('DENY');
      expect(result.decision?.reasons[0]?.code).toBe(code);
      expect(result.decision?.evidenceId).toBeNull(); // stage A: decided without evidence
      expect(screen.calls).toHaveLength(0); // and without spending an Intercepta call (T-034, INV-029)
      expect(result.attempt.signerCalls).toBe(0);
      expect(raw.paymentHeaders()).toBe(0);
    } finally {
      await raw.close();
    }
  });

  it('an amount above the per-payment cap is DENY', async () => {
    const clock = makeClock();
    const w = makeGateWorld({ serviceBase: base, screen: fixtureScreen(tiers, clock).screen, clock, policy: policyWithCaps(base, { maxPerPaymentAtomic: '40000' }) });
    const result = await w.gate.run(w.task('report/safe'));
    expect(result.decision?.reasons[0]?.code).toBe('OVER_PER_PAYMENT_CAP');
    expect(result.attempt.signerCalls).toBe(0);
  });

  it('a payment above the period cap is HOLD; earlier payments settled, the last is not signed', async () => {
    const clock = makeClock();
    const w = makeGateWorld({ serviceBase: base, screen: fixtureScreen(tiers, clock).screen, clock, policy: policyWithCaps(base, { periodCapAtomic: '120000' }) });
    const first = await w.gate.run(w.task('report/safe'));
    const second = await w.gate.run(w.task('report/safe'));
    const third = await w.gate.run(w.task('report/safe'));
    expect([first.attempt.status, second.attempt.status]).toEqual(['settled', 'settled']);
    expect(third.decision).toMatchObject({ action: 'HOLD', signerEligible: false });
    expect(third.decision?.reasons[0]?.code).toBe('PERIOD_CAP_EXCEEDED');
    expect(third.attempt.signerCalls).toBe(0);
  });
});

// T-046 / T-047 (INV-004, INV-017): expiry and policy change while pending.
describe('decision validity at signing time', () => {
  it('an expired decision (61 s pass between decision and signing) is not signed', async () => {
    const clock = makeClock();
    const w = makeGateWorld({
      serviceBase: base,
      screen: fixtureScreen(tiers, clock).screen,
      clock,
      configureClient: (client) => {
        client.onBeforePaymentCreation(async () => {
          clock.offset.ms += 61_000;
        });
      },
    });
    const result = await w.gate.run(w.task('report/safe'));
    expect(result.attempt.signerCalls).toBe(0);
    expect(w.refusals[0]?.code).toBe('DECISION_EXPIRED');
    expect(w.store.getReservationForAttempt(result.attempt.attemptId)?.status).toBe('released');
  });

  it('a policy activated while the attempt is pending invalidates its decision', async () => {
    const clock = makeClock();
    const world: ReturnType<typeof makeGateWorld> = makeGateWorld({
      serviceBase: base,
      screen: fixtureScreen(tiers, clock).screen,
      clock,
      configureClient: (client) => {
        client.onBeforePaymentCreation(async () => {
          const v2 = demoCandidates(demoPolicyV1(demoProfile(base)))[1]!.policy;
          world.store.putPolicy('org-exampleco', v2);
          world.store.setActivePolicy('org-exampleco', 2, 'tr-2', clock.now().toISOString());
        });
      },
    });
    const result = await world.gate.run(world.task('report/safe'));
    expect(result.attempt.signerCalls).toBe(0);
    expect(world.refusals[0]?.code).toBe('POLICY_CHANGED');
  });
});

// T-048 / T-049 (INV-014): settlement and delivery are separate; ambiguity keeps the reservation.
describe('settlement outcomes', () => {
  it('a facilitator that drops the settle connection leaves the attempt ambiguous and the reservation reconciling, with no second signature', async () => {
    const f = await startStubFacilitator();
    const s = await startRealSeller(f.url, [{ variant: 'safe', payTo: SAFE, price: '$0.05' }]);
    try {
      f.mode.settle = 'hangup';
      const clock = makeClock();
      const w = makeGateWorld({ serviceBase: `${s.url}/paid/`, screen: fixtureScreen('CLEAR', clock).screen, clock });
      const result = await w.gate.run(w.task('report/safe'));
      expect(result.attempt.signerCalls).toBe(1);
      expect(w.store.signerCallCount(result.attempt.attemptId)).toBe(1);
      expect(['ambiguous', 'failed']).toContain(result.attempt.status);
      const reservation = w.store.getReservationForAttempt(result.attempt.attemptId);
      expect(reservation?.status).not.toBe('released'); // never released on an unknown settlement
      expect(f.calls.settle).toBeGreaterThanOrEqual(1);
    } finally {
      await s.close();
      await f.close();
    }
  });

  it('a settled payment whose resource returns no usable body is settled with delivery not_received (INV-014)', async () => {
    const f = await startStubFacilitator();
    const s = await startEmptyBodySeller(f.url, SAFE);
    try {
      const clock = makeClock();
      const w = makeGateWorld({ serviceBase: `${s.url}/paid/`, screen: fixtureScreen('CLEAR', clock).screen, clock });
      const result = await w.gate.run(w.task('report/empty'));
      expect(result.attempt.status).toBe('settled');
      expect(result.outcome).toMatchObject({ settlementStatus: 'settled', deliveryStatus: 'not_received', httpStatus: 200 });
      expect(result.outcome?.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    } finally {
      await s.close();
      await f.close();
    }
  });
});

// T-052 (AC-025, INV-007): concurrent attempts cannot exceed the period cap.
describe('concurrency', () => {
  it('five parallel attempts against a 0.10 USDC period cap sign at most twice', async () => {
    const clock = makeClock();
    const w = makeGateWorld({ serviceBase: base, screen: fixtureScreen(tiers, clock).screen, clock, policy: policyWithCaps(base, { periodCapAtomic: '100000' }) });
    const results = await Promise.all(Array.from({ length: 5 }, () => w.gate.run(w.task('report/safe'))));
    const signed = results.filter((r) => r.attempt.signerCalls > 0);
    expect(signed.length).toBeLessThanOrEqual(2);
    expect(signed.length).toBe(2);
    const held = results.filter((r) => r.attempt.signerCalls === 0);
    expect(held).toHaveLength(3);
    for (const h of held) expect(['PERIOD_CAP_EXCEEDED', 'RESERVATION_FAILED']).toContain(h.decision?.reasons[0]?.code);
    const spent = results.filter((r) => r.attempt.status === 'settled').length * 50000;
    expect(spent).toBeLessThanOrEqual(100000);
  });
});
