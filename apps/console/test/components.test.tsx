// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AttemptCard, ComparisonTable, Header, ProvenanceBadge, ProvenanceLegend, SignerBadge, TraceView } from '../src/components';
import { TIER_LABEL } from '../src/format';
import { TX, awaitingTrace, blockedTrace, localRejectTrace, report, settledTrace, state, summaries } from './fixtures';

afterEach(cleanup);

// T-054 (AC-006, AC-008, AC-015, INV-012, INV-019): the proof is visible without explanation.
describe('header', () => {
  it('always shows the active policy version and the network, and nothing else (ADR-028)', () => {
    render(<Header state={state(2)} connected />);
    expect(screen.getByTestId('policy-version').textContent).toBe('Policy v2');
    expect(screen.getByText('Base Sepolia · testnet')).toBeTruthy();
    expect(document.body.textContent).not.toContain('org-exampleco'); // no organisation id in the header
    expect(document.querySelector('header')?.textContent).not.toMatch(/REAL LIVE|CONTROLLED VARIANT|SYNTHETIC/); // the legend sits beside the tables
  });

  it('the provenance legend names the live, controlled and synthetic chips', () => {
    render(<ProvenanceLegend />);
    expect(screen.getByLabelText('provenance legend').textContent).toMatch(/REAL LIVE.*CONTROLLED VARIANT.*SYNTHETIC/);
  });

  it('shows v1 for v1 and says so before a connection exists', () => {
    const { rerender } = render(<Header state={state(1)} connected />);
    expect(screen.getByTestId('policy-version').textContent).toBe('Policy v1');
    rerender(<Header state={null} connected={false} />);
    expect(screen.getByTestId('policy-version').textContent).toBe('Policy: n/a');
  });
});

describe('signer badge', () => {
  it('is a colour-coded badge reading signer calls: 0 or signer calls: 1', () => {
    const { rerender } = render(<SignerBadge calls={0} />);
    expect(screen.getByTestId('signer-badge').textContent).toBe('signer calls: 0');
    expect(screen.getByTestId('signer-badge').className).toContain('signer-zero');
    rerender(<SignerBadge calls={1} />);
    expect(screen.getByTestId('signer-badge').textContent).toBe('signer calls: 1');
    expect(screen.getByTestId('signer-badge').className).toContain('signer-one');
  });
});

describe('provenance badge', () => {
  it('only real_live reads as live; every other provenance says what it is', () => {
    for (const p of ['sponsor_fixture', 'controlled_variant', 'synthetic']) {
      const { unmount } = render(<ProvenanceBadge provenance={p} />);
      const el = document.querySelector('[data-provenance]') as HTMLElement;
      expect(el.textContent).not.toMatch(/LIVE/);
      expect(el.className).toContain('prov-other');
      unmount();
    }
    render(<ProvenanceBadge provenance="real_live" />);
    expect((document.querySelector('[data-provenance]') as HTMLElement).textContent).toBe('REAL LIVE');
  });
});

describe('decision trace', () => {
  it('a blocked attempt shows signer calls: 0, the reason, and NO signer timestamp', () => {
    render(<TraceView trace={blockedTrace()} />);
    const trace = screen.getByTestId('trace');
    expect(within(trace).getByTestId('signer-badge').textContent).toBe('signer calls: 0');
    expect(within(trace).getByTestId('signer-not-called').textContent).toBe('-');
    expect(within(trace).queryByTestId('signer-invoked')).toBeNull();
    expect(trace.textContent).not.toMatch(/Signer invoked at/);
    expect(trace.textContent).toMatch(/DENY/);
    expect(trace.textContent).toMatch(/EVIDENCE_BLOCK/);
    expect(trace.querySelector('a')).toBeNull(); // no transaction link
  });

  it('labels the tier as a Risksir policy tier and shows the provider score and traits as returned', () => {
    render(<TraceView trace={blockedTrace()} />);
    const trace = screen.getByTestId('trace');
    expect(trace.textContent).toContain(TIER_LABEL);
    expect(trace.textContent).toMatch(/known_scammer, attack_money_target/);
    expect(trace.textContent).toMatch(/100/);
    expect(trace.querySelector('[data-provenance="real_live"]')).not.toBeNull();
  });

  it('a settled attempt shows signer calls: 1, the Intercepta time before the signer time, a Basescan link, and settlement and delivery separately', () => {
    render(<TraceView trace={settledTrace()} />);
    const trace = screen.getByTestId('trace');
    expect(within(trace).getByTestId('signer-badge').textContent).toBe('signer calls: 1');
    const text = trace.textContent ?? '';
    const intercepta = text.indexOf('Intercepta call returned');
    const signer = text.indexOf('Signer invoked at');
    expect(intercepta).toBeGreaterThan(-1);
    expect(signer).toBeGreaterThan(intercepta); // Intercepta timestamp is shown before the signer timestamp
    const link = trace.querySelector('a') as HTMLAnchorElement;
    expect(link.href).toBe(`https://sepolia.basescan.org/tx/${TX}`);
    expect(text).toMatch(/Settlementsettled/);
    expect(text).toMatch(/Deliveryreceived/);
    expect(text).toMatch(/0\.05 USDC/);
  });

  it('a quote rejected locally says no Intercepta call was made and shows no evidence', () => {
    render(<TraceView trace={localRejectTrace()} />);
    expect(screen.getByTestId('no-evidence').textContent).toMatch(/No Intercepta call was made/);
    expect(screen.getByTestId('trace').textContent).not.toMatch(/Intercepta call returned/);
  });

  it('non-live evidence is never presented as live in a trace', () => {
    const t = blockedTrace();
    render(<TraceView trace={{ ...t, evidence: { ...(t.evidence as NonNullable<typeof t.evidence>), provenance: 'synthetic' } }} />);
    const badge = screen.getByTestId('trace').querySelector('[data-provenance]') as HTMLElement;
    expect(badge.dataset.provenance).toBe('synthetic');
    expect(badge.textContent).toBe('SYNTHETIC');
  });

  it('an attempt awaiting approval renders with zero signer calls', () => {
    render(<TraceView trace={awaitingTrace()} />);
    expect(screen.getByTestId('signer-badge').textContent).toBe('signer calls: 0');
    expect(screen.getByTestId('trace').textContent).toMatch(/awaiting_approval/);
  });
});

describe('regression comparison', () => {
  const cols = [
    { key: 'B', label: 'B · v2', report: report(), approved: true },
    { key: 'A', label: 'A · v2', report: null, approved: false },
  ];

  it('shows every metric with numerator and denominator per candidate, the provenance mix and the approved candidate', () => {
    render(<ComparisonTable columns={cols} />);
    expect(screen.getByTestId('metric-bad_cases_prevented-B').textContent).toBe('3/3');
    expect(screen.getByTestId('metric-good_cases_changed-B').textContent).toBe('2/9');
    expect(screen.getByTestId('metric-human_reviews_added-B').textContent).toBe('-1/19');
    expect(screen.getByTestId('metric-bad_cases_prevented-A').textContent).toBe('-'); // not replayed yet: no invented numbers
    expect(screen.getByTestId('metrics-table').textContent).toMatch(/real_live 4 · sponsor_fixture 0 · controlled_variant 11 · synthetic 4/);
    expect(screen.getByText('B · v2').closest('th')?.textContent).toMatch(/approved/);
    expect(screen.getByText('A · v2').closest('th')?.textContent).not.toMatch(/approved/);
    expect(document.body.textContent).toMatch(/not a measure of real prevented loss/);
  });

  it('has a v1 column that never claims prevention numbers for the baseline', () => {
    render(<ComparisonTable columns={cols} />);
    expect(screen.getByText('v1 (active)')).toBeTruthy();
    const row = screen.getByText('Bad cases prevented').closest('tr') as HTMLElement;
    expect(row.querySelectorAll('td')[1]?.textContent).toBe('-');
  });

  it('asks for a replay when there is nothing to compare', () => {
    render(<ComparisonTable columns={[{ key: 'x', label: 'x', report: null, approved: false }]} />);
    expect(screen.getByText(/Replay a candidate/)).toBeTruthy();
  });
});

// AC-006, AC-008, AC-015, AC-023: a judge reads each payment in three seconds.
describe('attempt card', () => {
  const [settled, blocked] = summaries as [(typeof summaries)[number], (typeof summaries)[number]];

  it('a paid attempt: PAY badge, amount, signer calls 1, settlement and delivery separate, Basescan link, signed time in the timeline', () => {
    render(<AttemptCard attempt={settled} trace={settledTrace()} selected={false} onSelect={() => undefined} />);
    const card = screen.getByTestId('attempt-card');
    expect(within(card).getByText('PAY').className).toContain('action-big');
    expect(card.textContent).toContain('0.05');
    expect(within(card).getByTestId('signer-badge').textContent).toBe('signer calls: 1');
    expect(card.textContent).toMatch(/Settlementsettled/);
    expect(card.textContent).toMatch(/Deliveryreceived/);
    expect((card.querySelector('a') as HTMLAnchorElement).href).toBe(`https://sepolia.basescan.org/tx/${TX}`);
    const timeline = within(card).getByLabelText('timeline').textContent ?? '';
    expect(timeline).toMatch(/signed10:00:01/);
    expect(timeline.indexOf('Intercepta screened')).toBeLessThan(timeline.indexOf('signed')); // Intercepta before the signer
  });

  it('a denied attempt: DENY badge, signer calls 0, "not called" and no signer time, no transaction link', () => {
    render(<AttemptCard attempt={blocked} trace={blockedTrace()} selected={false} onSelect={() => undefined} />);
    const card = screen.getByTestId('attempt-card');
    expect(within(card).getByText('DENY').className).toContain('action-big');
    expect(within(card).getByTestId('signer-badge').textContent).toBe('signer calls: 0');
    expect(within(card).getByLabelText('timeline').textContent).toMatch(/signednot called/);
    expect(card.querySelector('a')).toBeNull();
  });

  it('shows the evidence: shortened address with copy, score, tier with the Risksir threshold label, reasons, time and provenance', () => {
    render(<AttemptCard attempt={blocked} trace={blockedTrace()} selected={false} onSelect={() => undefined} />);
    const card = screen.getByTestId('attempt-card');
    expect(card.textContent).toContain('0x1111…1111');
    expect(within(card).getByRole('button', { name: /^Copy 0x1111/ })).toBeTruthy();
    expect(card.textContent).toMatch(/score 100/);
    expect(card.textContent).toMatch(/BLOCK/);
    expect(within(card).getByText('Risksir threshold').getAttribute('title')).toBe(TIER_LABEL);
    expect(card.textContent).toMatch(/known_scammer, attack_money_target/);
    expect(card.querySelector('[data-provenance="real_live"]')?.textContent).toBe('REAL LIVE');
  });

  it('never presents non-live evidence as live, says so for a locally rejected quote, and shows a loading state before the trace arrives', () => {
    const t = blockedTrace();
    const { unmount } = render(<AttemptCard attempt={blocked} trace={{ ...t, evidence: { ...(t.evidence as NonNullable<typeof t.evidence>), provenance: 'synthetic' } }} selected={false} onSelect={() => undefined} />);
    expect(document.querySelector('[data-provenance]')?.textContent).toBe('SYNTHETIC');
    unmount();
    const { unmount: u2 } = render(<AttemptCard attempt={blocked} trace={localRejectTrace()} selected={false} onSelect={() => undefined} />);
    expect(screen.getByText(/No Intercepta call was made/)).toBeTruthy();
    expect(screen.getByLabelText('timeline').textContent).toMatch(/Intercepta screenedskipped/);
    u2();
    render(<AttemptCard attempt={blocked} trace={undefined} selected={false} onSelect={() => undefined} />);
    expect(screen.getByText(/Loading evidence/)).toBeTruthy();
  });
});
