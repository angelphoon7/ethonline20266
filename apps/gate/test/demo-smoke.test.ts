import { describe, expect, it } from 'vitest';
import { FULL_RUN, balanceCheck, classifyState, limitsCheck, worst } from '../src/demo/smoke.js';

const good = { activePolicyVersion: 1, caseCount: 19, safeKnown: false, altKnown: false };

// T-055 (AC-004, AC-005, AC-013): the preflight fails closed before a demo can spend or mislead.
describe('demo preflight state', () => {
  it('a fresh v1 state is ready and says which scripts to run', () => {
    expect(classifyState(good)).toMatchObject({ status: 'PASS' });
    expect(classifyState({ ...good, safeKnown: true }).detail).toMatch(/ready for demo:block and demo:v2/);
  });
  it.each([
    [{ ...good, activePolicyVersion: null }, /no active policy/],
    [{ ...good, caseCount: 3 }, /only 3 labelled cases/],
    [{ ...good, activePolicyVersion: 2 }, /policy v2 is active, not v1/],
    [{ ...good, altKnown: true }, /ALT was already paid/],
  ])('fails for %j', (state, detail) => {
    const r = classifyState(state);
    expect(r.status).toBe('FAIL');
    expect(r.detail).toMatch(detail);
  });
});

describe('demo preflight limits and balance', () => {
  it('a full run fits when the session is fresh', () => {
    expect(limitsCheck({ settlements: 0, totalAtomic: 0n }, 0).status).toBe('PASS');
  });
  it('fails when a full run would exceed 20 settlements, 1.00 USDC or 40 Intercepta calls, and never suggests lifting a limit silently', () => {
    expect(limitsCheck({ settlements: 18, totalAtomic: 0n }, 0).detail).toMatch(/settlements 18\+3 > 20/);
    expect(limitsCheck({ settlements: 0, totalAtomic: 900_000n }, 0).detail).toMatch(/spend/);
    const calls = limitsCheck({ settlements: 0, totalAtomic: 0n }, 36);
    expect(calls.status).toBe('FAIL');
    expect(calls.detail).toMatch(/new agent session is a human decision/);
    expect(FULL_RUN).toEqual({ settlements: 3, spendAtomic: 150_000n, screens: 5 });
  });
  it('counts the smoke check own live screen', () => {
    expect(limitsCheck({ settlements: 0, totalAtomic: 0n }, 34, 1).status).toBe('PASS');
    expect(limitsCheck({ settlements: 0, totalAtomic: 0n }, 35, 1).status).toBe('FAIL');
  });
  it('balance: needs gas, enough USDC for a full run, and stays under the 20 test USDC ceiling', () => {
    expect(balanceCheck(19_840_000n, 1n).status).toBe('PASS');
    expect(balanceCheck(19_840_000n, 0n).status).toBe('FAIL');
    expect(balanceCheck(100_000n, 1n).status).toBe('FAIL');
    expect(balanceCheck(20_000_001n, 1n).status).toBe('FAIL');
  });
  it('the overall result is FAIL if any check fails, SKIP if only skips, PASS otherwise', () => {
    expect(worst([{ name: 'a', status: 'PASS', detail: '' }, { name: 'b', status: 'FAIL', detail: '' }])).toBe('FAIL');
    expect(worst([{ name: 'a', status: 'PASS', detail: '' }, { name: 'b', status: 'SKIP', detail: '' }])).toBe('SKIP');
    expect(worst([{ name: 'a', status: 'PASS', detail: '' }])).toBe('PASS');
  });
});
