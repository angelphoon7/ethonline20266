// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Header, MetricsTable, ProvenanceBadge, SignerBadge, TraceView } from '../src/components';
import { TIER_LABEL } from '../src/format';
import { TX, awaitingTrace, blockedTrace, localRejectTrace, report, settledTrace, state } from './fixtures';

afterEach(cleanup);

// T-054 (AC-006, AC-008, AC-015, INV-012, INV-019): the proof is visible without explanation.
describe('header', () => {
  it('always shows the active policy version, the network and the provenance legend', () => {
    render(<Header state={state(2)} connected />);
    expect(screen.getByTestId('policy-version').textContent).toBe('Policy v2');
    expect(screen.getByText(/Base Sepolia/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('org-exampleco'); // no organisation id in the header
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
  it('shows every metric with numerator and denominator per candidate and the provenance mix', () => {
    render(<MetricsTable columns={[{ label: 'v2 B', report: report() }, { label: 'v2 A', report: null }]} />);
    expect(screen.getByTestId('metric-bad_cases_prevented-v2 B').textContent).toBe('3/3');
    expect(screen.getByTestId('metric-good_cases_changed-v2 B').textContent).toBe('2/9');
    expect(screen.getByTestId('metric-human_reviews_added-v2 B').textContent).toBe('-1/19');
    expect(screen.queryByTestId('metric-bad_cases_prevented-v2 A')).toBeNull(); // not replayed yet: no column, no invented numbers
    expect(screen.getByTestId('metrics-table').textContent).toMatch(/real_live 4 · sponsor_fixture 0 · controlled_variant 11 · synthetic 4/);
    expect(document.body.textContent).toMatch(/not a measure of real prevented loss/);
  });

  it('asks for a replay when there is nothing to compare', () => {
    render(<MetricsTable columns={[{ label: 'x', report: null }]} />);
    expect(screen.getByText(/Replay a candidate/)).toBeTruthy();
  });
});
