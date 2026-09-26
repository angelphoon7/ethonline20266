// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { ApiError } from '../src/api';
import type { Api } from '../src/api';
import { PRESETS } from '../src/presets';
import type { CandidatePolicy, PolicyVersion } from '../src/types';
import { awaitingTrace, blockedTrace, cases, report, settledTrace, state, summaries, versions } from './fixtures';

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const TOKEN = 'console-test-token-0123456789';

function fakeApi(over: Partial<Record<keyof Api, unknown>> = {}) {
  let version = 1;
  let vers: PolicyVersion[] = [{ ...(versions[0] as PolicyVersion), status: 'active' }];
  let cands: CandidatePolicy[] = [];
  const calls: Record<string, unknown[][]> = {};
  const rec = <T,>(name: string, fn: (...a: never[]) => Promise<T>) => (...a: unknown[]) => {
    (calls[name] ??= []).push(a);
    return fn(...(a as never[]));
  };
  const api = {
    state: rec('state', async () => state(version)),
    policies: rec('policies', async () => ({ versions: vers, activeVersion: version })),
    attempts: rec('attempts', async () => ({ attempts: [...summaries, { ...summaries[1], attemptId: 'att-wait-0003', status: 'awaiting_approval', action: 'ASK_HUMAN' }] })),
    trace: rec('trace', async (id: string) => (id === 'att-settled-0001' ? settledTrace() : id === 'att-wait-0003' ? awaitingTrace() : blockedTrace())),
    cases: rec('cases', async () => ({ cases })),
    label: rec('label', async () => cases[0]),
    candidates: rec('candidates', async () => ({ candidates: cands })),
    createCandidate: rec('createCandidate', async (input: { rationale: string }) => {
      const c = { candidateId: `cand-${cands.length + 1}-xxxxxxxx`, baseVersion: version, originatingCaseIds: [], policy: { policyVersion: version + 1 }, rationale: input.rationale, generatedBy: 'owner', status: 'draft', createdAt: '2026-09-26T12:00:00.000Z' } as unknown as CandidatePolicy;
      cands = [...cands, c];
      return c;
    }),
    replay: rec('replay', async (id: string) => {
      cands = cands.map((c) => (c.candidateId === id ? { ...c, status: 'replayed' as const } : c));
      return report();
    }),
    approve: rec('approve', async () => {
      version = 2;
      vers = versions;
      cands = cands.map((c) => ({ ...c, status: 'approved' as const }));
      return versions[1];
    }),
    rollback: rec('rollback', async () => {
      version = 1;
      return versions[0];
    }),
    approveAttempt: rec('approveAttempt', async () => ({ approval: { approvalId: 'appr-1' }, resumed: false })),
    audit: rec('audit', async () => ({ events: [] })),
    ...over,
  } as unknown as Api;
  return { api, calls };
}

async function connected(over: Partial<Record<keyof Api, unknown>> = {}) {
  const fake = fakeApi(over);
  const factory = vi.fn(() => fake.api);
  render(<App apiFactory={factory} />);
  fireEvent.change(screen.getByLabelText('Owner token'), { target: { value: TOKEN } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  await screen.findByText('Company risk profile');
  return { ...fake, factory };
}

describe('connecting', () => {
  it('shows only the connect form before a token is accepted, and the connect button needs a token', () => {
    render(<App apiFactory={() => fakeApi().api} />);
    expect(screen.getByTestId('policy-version').textContent).toBe('Policy: n/a');
    expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('Live trace')).toBeNull();
  });

  it('a rejected token shows the API error and reveals nothing', async () => {
    const bad = fakeApi({ state: async () => { throw new ApiError(401, 'unauthorised'); } });
    render(<App apiFactory={() => bad.api} />);
    fireEvent.change(screen.getByLabelText('Owner token'), { target: { value: 'wrong-token-0123456789abcd' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect((await screen.findByRole('alert')).textContent).toBe('401: unauthorised');
    expect(screen.queryByText('Live trace')).toBeNull();
  });

  it('keeps the token in memory only: it is passed to the API factory, cleared from the input, and never stored', async () => {
    const { factory } = await connected();
    expect(factory).toHaveBeenCalledWith(TOKEN);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe('');
    expect(location.href).not.toContain(TOKEN);
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it('shows the active version in the header, the read-only profile and the attempts with signer badges', async () => {
    await connected();
    expect(screen.getByTestId('policy-version').textContent).toBe('Policy v1');
    expect(screen.getByTestId('profile').textContent).toMatch(/0\.1 USDC/);
    expect(screen.getByTestId('profile').textContent).toMatch(/0\.5 USDC per 24 h/);
    const badges = screen.getAllByTestId('signer-badge').map((b) => b.textContent);
    expect(badges).toContain('signer calls: 1');
    expect(badges).toContain('signer calls: 0');
  });
});

describe('decision traces and approvals', () => {
  it('selecting an attempt loads and shows its trace', async () => {
    const { calls } = await connected();
    fireEvent.click(screen.getByText('settled').closest('tr') as HTMLElement);
    const trace = await screen.findByTestId('trace');
    expect(calls.trace?.[0]?.[0]).toBe('att-settled-0001');
    expect(within(trace).getByTestId('signer-badge').textContent).toBe('signer calls: 1');
    expect(trace.querySelector('a')?.getAttribute('href')).toMatch(/basescan\.org\/tx\/0x/);
  });

  it('an attempt awaiting approval offers Approve, which sends exactly the shown quote hash', async () => {
    const { calls } = await connected();
    const row = screen.getAllByText('awaiting_approval')[0]?.closest('tr') as HTMLElement;
    fireEvent.click(row);
    await screen.findByTestId('trace');
    fireEvent.click(await screen.findByRole('button', { name: /Approve this quote/ }));
    await screen.findByText('Approval recorded for exactly this quote.');
    expect(calls.approveAttempt?.[0]).toEqual(['att-wait-0003', `0x${'a'.repeat(64)}`]);
  });

  it('a settled or blocked attempt offers no approve button', async () => {
    await connected();
    fireEvent.click(screen.getAllByText('failed')[0]?.closest('tr') as HTMLElement);
    await screen.findByTestId('trace');
    expect(screen.queryByRole('button', { name: /Approve this quote/ })).toBeNull();
  });
});

describe('incident labelling', () => {
  it('needs a case and a rationale, then appends an owner label', async () => {
    const { calls } = await connected();
    const add = screen.getByRole('button', { name: 'Add label' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.click(screen.getByText('cv-01-incident-80000').closest('tr') as HTMLElement);
    fireEvent.change(screen.getByLabelText('Rationale'), { target: { value: 'merchant did not deliver' } });
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    await screen.findByText('Labelled cv-01-incident-80000 as bad.');
    expect(calls.label?.[0]).toEqual(['cv-01-incident-80000', 'bad', 'merchant did not deliver']);
  });

  it('shows each case with its provenance badge and never labels a non-live case as live', async () => {
    await connected();
    const row = screen.getByText('cv-01-incident-80000').closest('tr') as HTMLElement;
    expect(row.querySelector('[data-provenance="controlled_variant"]')?.textContent).toBe('CONTROLLED VARIANT');
    expect(screen.getByText('real-02-pay-safe').closest('tr')?.querySelector('[data-provenance="real_live"]')?.textContent).toBe('REAL LIVE');
  });
});

describe('candidates, comparison, approval and rollback', () => {
  it('creates a candidate from a preset with only rules and a default action (the server owns everything else)', async () => {
    const { calls } = await connected();
    fireEvent.click(screen.getByRole('button', { name: /Create candidate B/ }));
    await screen.findByText('Candidate B created.');
    const [input] = calls.createCandidate?.[0] ?? [];
    const b = PRESETS.find((p) => p.key === 'B');
    expect(input).toEqual({ rules: b?.rules, defaultAction: 'HOLD', rationale: b?.rationale, originatingCaseIds: ['cv-01-incident-80000'] });
    expect(Object.keys(input as object).sort()).toEqual(['defaultAction', 'originatingCaseIds', 'rationale', 'rules']);
  });

  it('approve is disabled until the candidate is replayed; then it approves exactly that report, and the header shows the new version', async () => {
    const { calls } = await connected();
    fireEvent.click(screen.getByRole('button', { name: /Create candidate B/ }));
    await screen.findByText('Candidate B created.');
    const approve = screen.getByRole('button', { name: /Approve \(bound to this report\)/ }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    await screen.findByText('Replayed.');
    expect(screen.getByTestId('metrics-table')).toBeTruthy();
    expect(screen.getByText('3/3', { selector: 'td' })).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('button', { name: /Approve \(bound to this report\)/ }) as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(screen.getByRole('button', { name: /Approve \(bound to this report\)/ }));
    await screen.findByText('Approved and activated as a new policy version.');
    expect(calls.approve?.[0]).toEqual([expect.stringMatching(/^cand-1/), `0x${'9'.repeat(64)}`]);
    await waitFor(() => expect(screen.getByTestId('policy-version').textContent).toBe('Policy v2'));
  });

  it('rollback is offered only for a superseded version and calls the API with that version', async () => {
    const { calls } = await connected();
    fireEvent.click(screen.getByRole('button', { name: /Create candidate B/ }));
    await screen.findByText('Candidate B created.');
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    await screen.findByText('Replayed.');
    await waitFor(() => expect((screen.getByRole('button', { name: /Approve \(bound/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /Approve \(bound/ }));
    await waitFor(() => expect(screen.getByTestId('policy-version').textContent).toBe('Policy v2'));

    const rollback = await screen.findByRole('button', { name: 'Roll back to v1' });
    expect(screen.queryByRole('button', { name: 'Roll back to v2' })).toBeNull(); // the active version has no rollback button
    fireEvent.click(rollback);
    await screen.findByText('Rolled back to v1.');
    expect(calls.rollback?.[0]).toEqual([1]);
    await waitFor(() => expect(screen.getByTestId('policy-version').textContent).toBe('Policy v1'));
  });

  it('surfaces an API rejection with its code (for example a stale approval)', async () => {
    await connected({ approve: async () => { throw new ApiError(409, 'the dataset changed since the report: replay again', 'REPORT_DATASET_STALE'); } });
    fireEvent.click(screen.getByRole('button', { name: /Create candidate B/ }));
    await screen.findByText('Candidate B created.');
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    await screen.findByText('Replayed.');
    await waitFor(() => expect((screen.getByRole('button', { name: /Approve \(bound/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /Approve \(bound/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('REPORT_DATASET_STALE: the dataset changed since the report: replay again');
  });
});

describe('scenario buttons (live testnet run through the owner API)', () => {
  it('run the named scenario, then show that attempt trace', async () => {
    const runScenario = vi.fn(async (_s: string) => ({ attemptId: 'att-blocked-0002', status: 'failed', action: 'DENY' }));
    const { calls } = await connected({ runScenario });
    fireEvent.click(screen.getByRole('button', { name: 'Run scene 3: risky payTo' }));
    await screen.findByText(/Run scene 3: risky payTo: attempt recorded/);
    expect(runScenario).toHaveBeenCalledWith('block');
    expect(calls.trace?.at(-1)?.[0]).toBe('att-blocked-0002');
    expect((await screen.findByTestId('trace')).textContent).toMatch(/signer calls: 0/);
  });

  it('a server that is not in live mode answers 501 and the error is shown, with no invented attempt', async () => {
    await connected({ runScenario: async () => { throw new ApiError(501, 'no scenario runner is wired in this process', 'NOT_IMPLEMENTED'); } });
    fireEvent.click(screen.getByRole('button', { name: 'Run scene 2: pay SAFE' }));
    expect((await screen.findByRole('alert')).textContent).toBe('NOT_IMPLEMENTED: no scenario runner is wired in this process');
  });
});
