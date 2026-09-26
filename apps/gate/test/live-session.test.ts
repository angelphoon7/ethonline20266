import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LIVE_LIMITS } from '@risksir/core';
import { LiveSession, formatBanner } from '../src/live/session.js';
import { makeWorld } from './helpers/world.js';
import { SignerRefusedError } from '../src/signer/public.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const file = () => {
  const d = mkdtempSync(join(tmpdir(), 'risksir-live-'));
  dirs.push(d);
  return join(d, 'session.json');
};

// T-053: the live-run guard aborts before signing when a guardrail limit would be exceeded.
describe('live session limits (OPERATIONAL_GUARDRAILS section 4)', () => {
  it('allows a payment within all limits', () => {
    expect(new LiveSession(file()).check(50_000n)).toBeNull();
  });

  it('refuses above the per-payment limit', () => {
    expect(new LiveSession(file()).check(LIVE_LIMITS.maxPerPaymentAtomic + 1n)).toMatch(/per-payment limit/);
  });

  it('refuses when the session total would exceed 1.00 USDC', () => {
    const s = new LiveSession(file());
    for (let i = 0; i < 9; i++) s.recordSigned(100_000n); // 0.90 USDC
    expect(s.check(100_000n)).toBeNull(); // exactly 1.00
    s.recordSigned(100_000n);
    expect(s.check(1n)).toMatch(/session total/);
  });

  it('refuses the 21st settlement', () => {
    const s = new LiveSession(file());
    for (let i = 0; i < 20; i++) s.recordSigned(1n);
    expect(s.check(1n)).toMatch(/20 settlements/);
  });

  it('persists across instances and fails closed on a corrupt file', () => {
    const p = file();
    new LiveSession(p).recordSigned(30_000n);
    expect(new LiveSession(p).state()).toEqual({ settlements: 1, totalAtomic: 30_000n });
    writeFileSync(p, 'garbage');
    expect(new LiveSession(p).check(1n)).not.toBeNull();
  });

  it('prints network, public payer, payTo, amount, count and maximum total', () => {
    const banner = formatBanner({
      network: 'eip155:84532',
      payerPublicAddress: '0x4a599d033E1295E93bbFB5feA17aB44b2CbAD9fD',
      payTo: `0x${'11'.repeat(20)}`,
      amountAtomic: 50_000n,
      count: 1,
      session: { settlements: 0, totalAtomic: 0n },
    });
    for (const needle of ['eip155:84532', '0x4a599d03', `0x${'11'.repeat(20)}`, '0.05 USDC', 'count:', 'max total:', '1 USDC']) expect(banner).toContain(needle);
  });

  it('the protected signer refuses when the session guard says no, with zero signer calls', async () => {
    const session = new LiveSession(file());
    for (let i = 0; i < 10; i++) session.recordSigned(100_000n); // session exhausted
    const w = makeWorld({ extraCheck: ({ amountAtomic }) => session.check(amountAtomic) });
    await expect(w.attemptSigner.signTypedData(w.typedData())).rejects.toBeInstanceOf(SignerRefusedError);
    expect(w.signerCalls()).toBe(0);
  });
});
