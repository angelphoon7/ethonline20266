import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUOTE_MAX_VALIDITY_S } from '@risksir/core';
import { fixtureScreen, makeClock, makeGateWorld } from './helpers/gateWorld.js';
import { startRawSeller, usdcRequirement } from './helpers/servers.js';
import type { RawSeller } from './helpers/servers.js';

const SAFE = `0x${'11'.repeat(20)}`;

let raw: RawSeller;
beforeAll(async () => {
  raw = await startRawSeller([usdcRequirement({ payTo: SAFE })]);
});
afterAll(() => raw.close());

// T-034 (AC-035, INV-029, ADR-022): local checks run before any Intercepta call.
describe('local stage runs before the Intercepta call', () => {
  const rejected: [string, Record<string, unknown>, string, string][] = [
    ['wrong network', { network: 'eip155:8453' }, 'DENY', 'NETWORK_NOT_ALLOWED'],
    ['wrong asset', { asset: `0x${'44'.repeat(20)}` }, 'DENY', 'ASSET_NOT_ALLOWED'],
    ['over the per-payment cap', { amount: '100001' }, 'DENY', 'OVER_PER_PAYMENT_CAP'],
    ['quote validity above the maximum', { maxTimeoutSeconds: QUOTE_MAX_VALIDITY_S + 1 }, 'HOLD', 'QUOTE_INVALID'],
  ];

  it.each(rejected)('%s: a Decision without evidence, zero Intercepta calls, zero signer calls', async (_n, patch, action, code) => {
    raw.setAccepts([usdcRequirement({ payTo: SAFE, ...patch })]);
    const clock = makeClock();
    const screen = fixtureScreen('CLEAR', clock);
    const w = makeGateWorld({
      serviceBase: `${raw.url}/`,
      screen: screen.screen,
      clock,
      // the SDK's own spend controls would filter some of these first; disable them so the policy stage is what answers
      configureClient: (client) => void client.setSpendControls(false),
    });
    const before = raw.paymentHeaders();

    const result = await w.gate.run(w.task('anything'));

    expect(screen.calls).toHaveLength(0);
    expect(result.evidence).toBeNull();
    expect(result.decision).toMatchObject({ action, signerEligible: false, evidenceId: null, status: 'open' });
    expect(result.decision?.reasons[0]?.code).toBe(code);
    expect(result.attempt).toMatchObject({ status: 'failed', signerCalls: 0, signerInvokedAt: null, interceptaRequestedAt: null, interceptaReturnedAt: null });
    expect(raw.paymentHeaders() - before).toBe(0);
    const types = w.store.listAudit().map((e) => e.type);
    expect(types).toEqual(['QuoteSelected', 'PolicyDecided']); // no RiskScreenRequested
    expect(w.store.getReservationForAttempt(result.attempt.attemptId)).toBeNull();
    expect(w.store.getLatestPermit(result.attempt.attemptId)).toBeNull();
  });

  it('an eligible quote makes exactly one live call and its Decision carries the evidence id', async () => {
    raw.setAccepts([usdcRequirement({ payTo: SAFE })]);
    const clock = makeClock();
    const screen = fixtureScreen('CLEAR', clock);
    const w = makeGateWorld({ serviceBase: `${raw.url}/`, screen: screen.screen, clock });
    const result = await w.gate.run(w.task('anything'));
    expect(screen.calls).toEqual([SAFE]);
    expect(result.decision?.evidenceId).toBe(result.evidence?.evidenceId);
    expect(result.decision).toMatchObject({ action: 'PAY', signerEligible: true });
    expect(w.store.listAudit().map((e) => e.type)).toEqual(
      expect.arrayContaining(['QuoteSelected', 'RiskScreenRequested', 'RiskScreenReturned', 'PolicyDecided', 'PermitArmed', 'SignerInvoked']),
    );
  });

  it('a service outside the allowed scope is rejected before any request at all', async () => {
    const clock = makeClock();
    const screen = fixtureScreen('CLEAR', clock);
    const w = makeGateWorld({ serviceBase: `${raw.url}/`, screen: screen.screen, clock });
    const result = await w.gate.run({ agentId: 'agent-1', taskId: 't', url: 'http://evil.example/paid/x', service: 'report' });
    expect(result.attempt).toMatchObject({ status: 'failed', signerCalls: 0 });
    expect(result.attempt.failure?.code).toBe('SERVICE_NOT_ALLOWED');
    expect(screen.calls).toHaveLength(0);
  });
});
