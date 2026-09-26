// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { DATA_FILES } from '../src/config';

afterEach(cleanup);

// vitest runs from the repository root (import.meta.url is not a file URL under jsdom)
const dataDir = join(process.cwd(), 'apps', 'site', 'public');
/** Serves the committed JSON files exactly as the static host would. */
const staticFetch = (async (url: string) => {
  try {
    const body = readFileSync(join(dataDir, url), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
}) as unknown as typeof fetch;

async function rendered() {
  render(<App fetchImpl={staticFetch} />);
  await screen.findByTestId('regression');
}

describe('showcase page', () => {
  it('starts with the hero summary, the GitHub and demo video buttons, and says the page is static', async () => {
    await rendered();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Risksir');
    expect(document.body.textContent).toMatch(/closed-loop risk-policy engine for x402 agents: Intercepta supplies live payment risk/);
    expect(screen.getByRole('link', { name: 'GitHub repo' }).getAttribute('href')).toMatch(/^https:\/\/github\.com\//);
    expect(screen.getByRole('link', { name: 'Demo video' })).toBeTruthy();
    expect(screen.getByTestId('site-note').textContent).toMatch(/never signs, pays or calls Intercepta/);
  });

  it('has the sections in the required order and the required footer', async () => {
    await rendered();
    const ids = [...document.querySelectorAll('section[id]')].map((s) => s.id);
    expect(ids).toEqual(['top', 'problem', 'how', 'evidence', 'evolution', 'regression', 'claims']);
    expect(document.querySelector('footer')?.textContent).toBe('Built for ETHGlobal Tokyo 2026 — Intercepta: Safe Agent-to-Agent Payments with x402');
  });

  it('shows the four traces in order with signer calls 1, 0, 0, 1 and every one labelled as recorded', async () => {
    await rendered();
    const cards = [...document.querySelectorAll<HTMLElement>('[data-testid^="trace-"]')]; // document order
    expect(cards.map((c) => c.dataset.testid)).toEqual(['trace-pass', 'trace-block', 'trace-v2', 'trace-v1']);
    const calls = cards.map((c) => within(c).getByTestId('signer-badge').textContent);
    expect(calls).toEqual(['signer calls: 1', 'signer calls: 0', 'signer calls: 0', 'signer calls: 1']);
    for (const c of cards) {
      expect(within(c).getByTestId('recorded-label').textContent).toMatch(/^Recorded from a live run on \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} UTC$/);
    }
    // the scene 3 card is the zero-call deny
    expect(within(screen.getByTestId('trace-block')).getByTestId('signer-badge').textContent).toBe('signer calls: 0');
    expect(within(screen.getByTestId('trace-block')).getByText('DENY')).toBeTruthy();
  });

  it('never presents anything as live now: no REAL LIVE badge, no live-now wording', async () => {
    await rendered();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/REAL LIVE/);
    expect(text).not.toMatch(/live now|live demo|streaming|currently live/i);
    expect(document.querySelectorAll('[data-testid="recorded-label"]').length).toBeGreaterThanOrEqual(5); // 4 traces + regression (+ callout)
  });

  it('links settled traces to Basescan on Base Sepolia, and blocked ones have no transaction link', async () => {
    await rendered();
    const pay = within(screen.getByTestId('trace-pass')).getByRole('link');
    expect(pay.getAttribute('href')).toMatch(/^https:\/\/sepolia\.basescan\.org\/tx\/0x[0-9a-f]{64}$/);
    expect(within(screen.getByTestId('trace-block')).queryByRole('link')).toBeNull();
  });

  it('labels the tier as a Risksir policy threshold and the claim boundaries include CLEAR is not safe', async () => {
    await rendered();
    expect(document.body.textContent).toContain('Risksir tier (policy threshold ADR-017), not an Intercepta verdict');
    expect(screen.getByText(/CLEAR does not mean safe/)).toBeTruthy();
    expect(screen.getByText(/not a security boundary/)).toBeTruthy();
  });

  it('shows the changed action next to what v1 did, and the A vs B table with numerators and denominators', async () => {
    await rendered();
    const changed = screen.getByTestId('changed-action').textContent ?? '';
    expect(changed).toMatch(/Policy v1: PAY \(signer calls: 1\)/);
    expect(changed).toMatch(/Policy v2: CAP \(signer calls: 0\)/);
    expect(screen.getByTestId('metric-bad_cases_prevented-B').textContent).toMatch(/^\d+\/\d+$/);
    expect(screen.getByTestId('metric-good_cases_changed-A').textContent).toMatch(/^\d+\/\d+$/);
    expect(screen.getByTestId('metrics-table').textContent).toMatch(/approved → v2/);
  });

  it('a missing data file shows an error, not invented evidence', async () => {
    const failing = (async (url: string) => (url === DATA_FILES.block ? { ok: false, status: 404, json: async () => ({}) } : staticFetch(url))) as unknown as typeof fetch;
    render(<App fetchImpl={failing} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Could not load the recorded evidence/));
    expect(screen.queryByTestId('trace-pass')).toBeNull();
  });
});
