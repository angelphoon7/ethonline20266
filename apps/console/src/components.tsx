import { useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { METRIC_LABELS, TIER_LABEL, VALUE_METRICS, basescanTx, clock, formatUsdc, shortAddr, shortHash, timeOf, usdcFixed } from './format';
import type { ApiState, AttemptSummary, RegressionReport, Trace } from './types';

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

/** The provenance legend, shown beside the tables that use the chips (SPEC section 20, ADR-028). */
export function ProvenanceLegend() {
  return (
    <span className="legend" aria-label="provenance legend">
      <ProvenanceBadge provenance="real_live" /> <ProvenanceBadge provenance="controlled_variant" /> <ProvenanceBadge provenance="synthetic" />
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

export function ActionBadge({ action, big = false }: { action: string | null; big?: boolean }) {
  if (!action) return <span className="badge">n/a</span>;
  return <span className={`badge action action-${action.toLowerCase()} ${big ? 'action-big' : ''}`}>{action}</span>;
}

export function LabelChip({ label }: { label: string }) {
  return <span className={`badge label-${label}`}>{label}</span>;
}

/** Always visible: the brand, the active policy version and the network (SPEC section 20, ADR-028). */
export function Header({ state, connected }: { state: ApiState | null; connected: boolean }) {
  const v = state?.activePolicy?.policyVersion;
  return (
    <header className="header">
      <div className="brand">Risksir</div>
      <div className="header-items">
        <span data-testid="policy-version" className="version">{v !== undefined ? `Policy v${v}` : connected ? 'no active policy' : 'Policy: n/a'}</span>
        <span className="net">Base Sepolia · testnet</span>
      </div>
    </header>
  );
}

export function Panel({ title, step, children, note, aside }: { title: string; step?: string; children: ReactNode; note?: string; aside?: ReactNode }) {
  return (
    <section className="panel">
      <h2>
        {step ? <span className="step">{step}</span> : null}
        {title}
        {aside ? <span style={{ marginLeft: 'auto' }}>{aside}</span> : null}
      </h2>
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
          <Row k="payTo"><span className="addr">{q.payTo}</span></Row>
          <Row k="Resource">{q.resourceUrl}</Row>
          <Row k="Quote hash"><span className="addr">{shortHash(attempt.quoteHash)}</span></Row>
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
          <Row k="Screened address"><span className="addr">{evidence.address}</span></Row>
          <Row k="Intercepta call returned">{timeOf(attempt.interceptaReturnedAt)}</Row>
        </dl>
      ) : (
        <p className="muted" data-testid="no-evidence">No Intercepta call was made: the quote was rejected by a local check first.</p>
      )}

      <h4>3. Policy decision</h4>
      {decision ? (
        <dl>
          <Row k="Policy version">v{decision.policyVersion}</Row>
          <Row k="Action"><ActionBadge action={decision.action} /></Row>
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

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      aria-label={`Copy ${value}`}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(value).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          },
          () => undefined,
        );
      }}
    >
      {done ? 'copied' : 'copy'}
    </button>
  );
}

const STEP = (label: string, time: string | null, empty = '-') => (
  <li key={label}>
    <span>{label}</span>
    <strong>{time ?? empty}</strong>
  </li>
);

/** A payment attempt as a card: decision on the left, Intercepta evidence in the middle, proof on the right, timeline below. */
export function AttemptCard({ attempt, trace, selected, onSelect }: { attempt: AttemptSummary; trace: Trace | undefined; selected: boolean; onSelect: () => void }) {
  const ev = trace?.evidence ?? null;
  const at = trace?.attempt;
  const outcome = trace?.outcome ?? null;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') onSelect();
  };
  return (
    <article className={`attempt-card ${selected ? 'selected' : ''}`} data-testid="attempt-card" data-status={attempt.status} data-attempt={attempt.attemptId} tabIndex={0} onClick={onSelect} onKeyDown={onKey}>
      <div className="ac-left">
        <ActionBadge action={attempt.action} big />
        <div className="amount">{attempt.amountAtomic !== null ? usdcFixed(attempt.amountAtomic) : 'n/a'} <span className="muted small">USDC</span></div>
        <div className="muted small">policy v{attempt.policyVersion ?? 'n/a'} · {attempt.status}</div>
      </div>

      <div className="ac-mid">
        {ev ? (
          <>
            <div className="fact"><span className="k">Screened</span><span className="addr trunc" title={ev.address}>{shortAddr(ev.address)}</span><CopyButton value={ev.address} /></div>
            <div className="fact">
              <span className="k">Result</span>
              <span>score {ev.providerScore ?? 'n/a'}</span>
              <span className={`badge tier-${ev.tier.toLowerCase()}`}>{ev.tier}</span>
              <span className="muted small" title={TIER_LABEL}>Risksir threshold</span>
            </div>
            <div className="fact"><span className="k">Reasons</span><span className="trunc" title={ev.reasons.join(', ')}>{ev.reasons.length ? ev.reasons.join(', ') : 'none'}</span></div>
            <div className="fact"><span className="k">Returned</span><span>{timeOf(at?.interceptaReturnedAt ?? null)}</span><ProvenanceBadge provenance={ev.provenance} /></div>
          </>
        ) : trace ? (
          <p className="muted">No Intercepta call was made: the quote was rejected by a local check first.</p>
        ) : (
          <p className="muted">Loading evidence…</p>
        )}
      </div>

      <div className="ac-right">
        <SignerBadge calls={attempt.signerCalls} />
        <div className="fact"><span className="k">Settlement</span><span>{outcome?.settlementStatus ?? '-'}</span></div>
        <div className="fact"><span className="k">Delivery</span><span>{outcome?.deliveryStatus ?? '-'}</span></div>
        {attempt.txHash ? (
          <span>
            <a href={basescanTx(attempt.txHash)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="addr">
              {shortAddr(attempt.txHash)} on Basescan
            </a>
            <span className="muted small block"> Base Sepolia</span>
          </span>
        ) : null}
      </div>

      <ol className="timeline" aria-label="timeline">
        {STEP('quoted', clock(at?.quotedAt ?? null))}
        {STEP('Intercepta screened', clock(at?.interceptaReturnedAt ?? null), trace ? 'skipped' : '-')}
        {STEP('decided', clock(at?.decidedAt ?? null))}
        {STEP('signed', attempt.signerCalls > 0 ? clock(at?.signerInvokedAt ?? null) : null, 'not called')}
        {STEP('settled', outcome?.settlementStatus === 'settled' ? clock(outcome.observedAt) : null)}
      </ol>
    </article>
  );
}

export interface CompareColumn {
  key: string;
  label: string;
  report: RegressionReport | null;
  approved: boolean;
  actions?: ReactNode;
}

/** The v1 baseline's own values, taken from the stored case results; deltas against itself are not shown. */
function baselineCell(report: RegressionReport | null, name: string): string {
  if (!report || report.caseResults.length === 0) return '-';
  const rs = report.caseResults;
  if (name === 'hold_rate') return `${rs.filter((r) => r.baseline.action === 'HOLD').length}/${rs.length}`;
  if (name === 'deny_rate') return `${rs.filter((r) => r.baseline.action === 'DENY').length}/${rs.length}`;
  return '-';
}

/** v1 and the candidates side by side, numerator/denominator per metric, the approved candidate highlighted; never a single score. */
export function ComparisonTable({ columns }: { columns: CompareColumn[] }) {
  const replayed = columns.filter((c) => c.report !== null);
  const anyReport = replayed[0]?.report ?? null;
  const cell = (report: RegressionReport | null, name: string) => {
    const m = report?.metrics.find((x) => x.name === name);
    return m ? `${m.numerator}/${m.denominator}` : '-';
  };
  if (columns.length === 0) return <p className="muted">Create at least two candidates, then replay each one to compare it with v1.</p>;
  return (
    <div className="table-wrap">
      {replayed.length === 0 ? <p className="muted">Replay a candidate to compare it with v1.</p> : null}
      <table className="compare" data-testid="metrics-table">
        <thead>
          <tr>
            <th>Metric (numerator/denominator)</th>
            <th className="num baseline">v1 (active)</th>
            {columns.map((c) => (
              <th key={c.key} className={`num ${c.approved ? 'col-approved' : ''}`}>
                {c.label}
                {c.approved ? <span className="badge approved"> approved</span> : null}
                {c.actions ? <div className="actions">{c.actions}</div> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(METRIC_LABELS).map(([name, label]) => (
            <tr key={name}>
              <td>{label}{VALUE_METRICS.has(name) ? <span className="muted small"> (atomic)</span> : null}</td>
              <td className="cell baseline">{baselineCell(anyReport, name)}</td>
              {columns.map((c) => (
                <td key={c.key} className={`cell ${c.approved ? 'col-approved' : ''}`} data-testid={`metric-${name}-${c.key}`}>{cell(c.report, name)}</td>
              ))}
            </tr>
          ))}
          <tr>
            <td>Cases by provenance</td>
            <td className="cell baseline">-</td>
            {columns.map((c) => (
              <td key={c.key} className={`cell small prov-mix ${c.approved ? 'col-approved' : ''}`}>
                {c.report ? Object.entries(c.report.provenanceMix).map(([p, n]) => `${p} ${n}`).join(' · ') : '-'}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {anyReport ? (
        <p className="muted small">
          Counterfactual replay of stored evidence on labelled cases (engine {anyReport.engineVersion}, dataset {shortHash(anyReport.datasetHash)}); not a measure of real prevented loss. The v1 column shows the active policy&apos;s own hold and deny counts; changes against v1 appear in each candidate column.
        </p>
      ) : null}
    </div>
  );
}
