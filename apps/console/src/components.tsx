import type { ReactNode } from 'react';
import { METRIC_LABELS, TIER_LABEL, VALUE_METRICS, basescanTx, formatUsdc, shortHash, timeOf } from './format';
import type { ApiState, RegressionReport, Trace } from './types';

const PROVENANCE_TEXT: Record<string, string> = {
  real_live: 'REAL LIVE',
  sponsor_fixture: 'SPONSOR FIXTURE',
  controlled_variant: 'CONTROLLED VARIANT',
  synthetic: 'SYNTHETIC',
};

/** Only `real_live` may ever read as live (INV-012). Every other provenance says what it is. */
export function ProvenanceBadge({ provenance }: { provenance: string }) {
  const live = provenance === 'real_live';
  return (
    <span className={`badge prov ${live ? 'prov-live' : 'prov-other'}`} data-provenance={provenance} title={live ? 'Observed live from the Intercepta API' : 'Not live evidence: recorded, fixture, controlled or synthetic data'}>
      {PROVENANCE_TEXT[provenance] ?? provenance.toUpperCase()}
    </span>
  );
}

/** The large, colour-coded proof badge (SPEC section 20). */
export function SignerBadge({ calls }: { calls: number }) {
  return (
    <span data-testid="signer-badge" className={`badge signer ${calls === 0 ? 'signer-zero' : 'signer-one'}`}>
      signer calls: {calls}
    </span>
  );
}

export function TierBadge({ tier }: { tier: string }) {
  return (
    <span className="tier">
      <span className={`badge tier-${tier.toLowerCase()}`}>{tier}</span>
      <span className="muted small"> {TIER_LABEL}</span>
    </span>
  );
}

export function Header({ state, connected }: { state: ApiState | null; connected: boolean }) {
  const v = state?.activePolicy?.policyVersion;
  return (
    <header className="header">
      <div className="brand">Risksir <span className="muted">owner console</span></div>
      <div className="header-items">
        {state ? null : <span>not connected</span>}
        <span data-testid="policy-version" className="badge version">{v !== undefined ? `Policy v${v}` : connected ? 'no active policy' : 'Policy: n/a'}</span>
        <span>Base Sepolia <span className="muted small">(eip155:84532, testnet only)</span></span>
        <span className="legend" aria-label="provenance legend">
          <ProvenanceBadge provenance="real_live" /> <ProvenanceBadge provenance="controlled_variant" /> <ProvenanceBadge provenance="synthetic" />
        </span>
      </div>
    </header>
  );
}

export function Panel({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {note ? <p className="muted small">{note}</p> : null}
      {children}
    </section>
  );
}

const Row = ({ k, children }: { k: string; children: ReactNode }) => (
  <div className="kv">
    <dt>{k}</dt>
    <dd>{children}</dd>
  </div>
);

/** One attempt's decision trace, in the order judges need it: quote, evidence, policy, action, signer, settlement, delivery. */
export function TraceView({ trace }: { trace: Trace }) {
  const { attempt, decision, evidence, outcome, signer } = trace;
  const q = attempt.quote;
  return (
    <div className="trace" data-testid="trace">
      <div className="trace-head">
        <h3>Attempt {shortHash(attempt.attemptId, 6)}</h3>
        <span className="badge status">{attempt.status}</span>
        <SignerBadge calls={signer.calls} />
      </div>

      <h4>1. Selected quote</h4>
      {q ? (
        <dl>
          <Row k="Amount">{formatUsdc(q.amountAtomic)} <span className="muted small">({q.amountAtomic} atomic)</span></Row>
          <Row k="Network / asset">{q.network} · {shortHash(q.asset)}</Row>
          <Row k="payTo">{q.payTo}</Row>
          <Row k="Resource">{q.resourceUrl}</Row>
          <Row k="Quote hash">{shortHash(attempt.quoteHash)}</Row>
        </dl>
      ) : (
        <p className="muted">No quote was recorded.</p>
      )}

      <h4>2. Intercepta evidence</h4>
      {evidence ? (
        <dl>
          <Row k="Provenance"><ProvenanceBadge provenance={evidence.provenance} /></Row>
          <Row k="Tier"><TierBadge tier={evidence.tier} /></Row>
          <Row k="Provider score">{evidence.providerScore ?? 'n/a'} <span className="muted small">(as returned, unmapped)</span></Row>
          <Row k="Provider traits">{evidence.reasons.length ? evidence.reasons.join(', ') : 'none'}</Row>
          <Row k="Screened address">{evidence.address}</Row>
          <Row k="Intercepta call returned">{timeOf(attempt.interceptaReturnedAt)}</Row>
        </dl>
      ) : (
        <p className="muted" data-testid="no-evidence">No Intercepta call was made: the quote was rejected by a local check first.</p>
      )}

      <h4>3. Policy decision</h4>
      {decision ? (
        <dl>
          <Row k="Policy version">v{decision.policyVersion}</Row>
          <Row k="Action"><span className={`badge action action-${decision.action.toLowerCase()}`}>{decision.action}</span></Row>
          <Row k="Reasons">{decision.reasons.map((r) => r.code).join(', ')}</Row>
        </dl>
      ) : (
        <p className="muted">No decision was recorded.</p>
      )}

      <h4>4. Signer</h4>
      {signer.calls > 0 ? (
        <p data-testid="signer-invoked">Signer invoked at {timeOf(signer.invokedAt)} (after the Intercepta call).</p>
      ) : (
        <p className="muted" data-testid="signer-not-called">-</p>
      )}

      <h4>5. Settlement and delivery (separate)</h4>
      <dl>
        <Row k="Settlement">{outcome?.settlementStatus ?? 'none'}</Row>
        <Row k="Delivery">{outcome?.deliveryStatus ?? 'n/a'}</Row>
        {outcome?.txHash ? (
          <Row k="Transaction">
            <a href={basescanTx(outcome.txHash)} target="_blank" rel="noreferrer">{shortHash(outcome.txHash)} on Basescan (Base Sepolia)</a>
          </Row>
        ) : null}
      </dl>
    </div>
  );
}

export interface MetricColumn {
  label: string;
  report: RegressionReport | null;
}

/** Candidates side by side with numerators and denominators from the stored report; never a single opaque score. */
export function MetricsTable({ columns }: { columns: MetricColumn[] }) {
  const shown = columns.filter((c): c is { label: string; report: RegressionReport } => c.report !== null);
  if (shown.length === 0) return <p className="muted">Replay a candidate to compare it with the active policy.</p>;
  const cell = (report: RegressionReport, name: string) => {
    const m = report.metrics.find((x) => x.name === name);
    if (!m) return 'n/a';
    return `${m.numerator}/${m.denominator}`;
  };
  return (
    <div className="table-wrap">
      <table data-testid="metrics-table">
        <thead>
          <tr>
            <th>Metric (numerator/denominator)</th>
            {shown.map((c) => (
              <th key={c.label}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(METRIC_LABELS).map(([name, label]) => (
            <tr key={name}>
              <td>{label}{VALUE_METRICS.has(name) ? <span className="muted small"> (atomic USDC)</span> : null}</td>
              {shown.map((c) => (
                <td key={c.label} data-testid={`metric-${name}-${c.label}`}>{cell(c.report, name)}</td>
              ))}
            </tr>
          ))}
          <tr>
            <td>Cases by provenance</td>
            {shown.map((c) => (
              <td key={c.label} className="small">
                {Object.entries(c.report.provenanceMix).map(([p, n]) => `${p} ${n}`).join(' · ')}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="muted small">Counterfactual replay of stored evidence on labelled cases (engine {shown[0]?.report.engineVersion}, dataset {shortHash(shown[0]?.report.datasetHash ?? null)}); not a measure of real prevented loss.</p>
    </div>
  );
}
