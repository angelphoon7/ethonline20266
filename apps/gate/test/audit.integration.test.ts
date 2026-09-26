import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashAuditPayload } from '@risksir/core';
import { adapterScreen, fixtureScreen, makeClock, makeGateWorld } from './helpers/gateWorld.js';
import { startRealSeller, startStubFacilitator } from './helpers/servers.js';
import type { Running, StubFacilitator } from './helpers/servers.js';

const SAFE = `0x${'11'.repeat(20)}`;
const RISKY = `0x${'22'.repeat(20)}`;

let facilitator: StubFacilitator;
let seller: Running;
let base: string;
beforeAll(async () => {
  facilitator = await startStubFacilitator();
  seller = await startRealSeller(facilitator.url, [
    { variant: 'safe', payTo: SAFE, price: '$0.05' },
    { variant: 'risky', payTo: RISKY, price: '$0.01' },
  ]);
  base = `${seller.url}/paid/`;
});
afterAll(async () => {
  await seller.close();
  await facilitator.close();
});

const types = (w: ReturnType<typeof makeGateWorld>) => w.store.listAudit().map((e) => e.type);

// T-032: audit events are emitted for each step, in order, and carry only hashes of payloads.
describe('audit trail', () => {
  it('pass path: quote, screen, decision, permit, signer, submit, settle, resource, in that order', async () => {
    const clock = makeClock();
    const w = makeGateWorld({ serviceBase: base, screen: fixtureScreen({ [SAFE]: 'CLEAR' }, clock).screen, clock });
    const result = await w.gate.run(w.task('report/safe'));
    expect(result.attempt.status).toBe('settled');
    expect(types(w)).toEqual([
      'QuoteSelected',
      'RiskScreenRequested',
      'RiskScreenReturned',
      'PolicyDecided',
      'PermitArmed',
      'SignerInvoked',
      'PaymentSubmitted',
      'SettlementObserved',
      'ResourceReturned',
    ]);
  });

  it('block path: no permit and no signer event', async () => {
    const clock = makeClock();
    const w = makeGateWorld({ serviceBase: base, screen: fixtureScreen({ [RISKY]: 'BLOCK' }, clock).screen, clock });
    await w.gate.run(w.task('report/risky'));
    expect(types(w)).toEqual(['QuoteSelected', 'RiskScreenRequested', 'RiskScreenReturned', 'PolicyDecided']);
  });

  it('an unavailable screen is recorded as RiskScreenUnavailable', async () => {
    const clock = makeClock();
    const a = adapterScreen(async () => new Response('{}', { status: 500 }), clock);
    const w = makeGateWorld({ serviceBase: base, screen: a.screen, clock });
    await w.gate.run(w.task('report/safe'));
    expect(types(w)).toEqual(['QuoteSelected', 'RiskScreenRequested', 'RiskScreenUnavailable', 'PolicyDecided']);
  });

  it('a signer refusal is recorded after the permit was armed', async () => {
    const clock = makeClock();
    const w = makeGateWorld({
      serviceBase: base,
      screen: fixtureScreen({ [SAFE]: 'CLEAR' }, clock).screen,
      clock,
      configureClient: (client) => {
        client.onBeforePaymentCreation(async ({ selectedRequirements }) => void (selectedRequirements.amount = '50001'));
      },
    });
    await w.gate.run(w.task('report/safe'));
    expect(types(w)).toEqual(['QuoteSelected', 'RiskScreenRequested', 'RiskScreenReturned', 'PolicyDecided', 'PermitArmed', 'SignerRefused']);
  });

  it('events have a strictly increasing seq, non-decreasing time, typed refs and a payload hash only', async () => {
    const clock = makeClock();
    const w = makeGateWorld({ serviceBase: base, screen: fixtureScreen({ [SAFE]: 'CLEAR' }, clock).screen, clock });
    const result = await w.gate.run(w.task('report/safe'));
    const events = w.store.listAudit();
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    for (let i = 1; i < events.length; i++) expect(Date.parse(events[i]!.at)).toBeGreaterThanOrEqual(Date.parse(events[i - 1]!.at));
    for (const e of events) {
      expect(e.refs.attemptId).toBe(result.attempt.attemptId);
      expect(e.payloadHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(Object.keys(e).sort()).toEqual(['actor', 'at', 'eventId', 'payloadHash', 'refs', 'seq', 'type']); // no payload body stored
    }
    expect(events.find((e) => e.type === 'SettlementObserved')?.refs.txHash).toBe(result.outcome?.txHash);
    expect(events.find((e) => e.type === 'QuoteSelected')?.payloadHash).toBe(hashAuditPayload({ attemptId: result.attempt.attemptId, quoteHash: result.attempt.quoteHash }));
  });
});
