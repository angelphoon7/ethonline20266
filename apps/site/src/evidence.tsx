import type { ReactNode } from 'react';
import { SignerBadge } from '../../console/src/components';
import { METRIC_LABELS, TIER_LABEL, VALUE_METRICS, basescanTx, formatUsdc, shortHash, timeOf } from '../../console/src/format';
import type { SiteRegression, SiteTrace } from './types';

/** Every trace on this page is stored evidence, so it always says when it was recorded and never says it is live. */
export function RecordedBadge({ at }: { at: string }) {
  return (
    <span className="badge recorded" data-testid="recorded-label">
      Recorded from a live run on {timeOf(at)}
    </span>
  );
}

const Row = ({ k, children }: { k: string; children: ReactNode }) => (
  <div className="kv">
    <dt>{k}</dt>
    <dd>{children}</dd>
  </div>
);

export function TraceCard({ trace, heading }: { trace: SiteTrace; heading?: string }) {
  const { quote, evidence, decision, signer, settlement } = trace;
  return (
    <article className="panel trace-card" data-testid={`trace-${trace.scene}`} aria-label={heading ?? trace.title}>
      <header className="trace-head">
        <h3>{heading ?? trace.title}</h3>
        <SignerBadge calls={signer.calls} />
      </header>
      <p>
        <RecordedBadge at={trace.recordedAt} />{' '}
        <span className="badge prov prov-other" data-provenance={evidence.provenance} title="The Intercepta call was a real API call when it was made. It is stored here, not repeated.">
          provenance: {evidence.provenance} at capture
        </span>
      </p>

      <h4>1. Selected x402 quote</h4>
      <dl>
        <Row k="Amount">
          {formatUsdc(quote.amountAtomic)} <span className="muted small">({quote.amountAtomic} atomic)</span>
        </Row>
        <Row k="Network / asset">
          {quote.network} (Base Sepolia testnet) · {shortHash(quote.asset)}
        </Row>
        <Row k="payTo">{quote.payTo}</Row>
        <Row k="Resource">{quote.resourcePath}</Row>
        <Row k="Quote hash">{shortHash(trace.quoteHash)}</Row>
      </dl>

      <h4>2. Intercepta evidence for that exact payTo</h4>
      <dl>
        <Row k="Screened address">{evidence.screenedAddress}</Row>
        <Row k="Returned at">
          {timeOf(evidence.capturedAt)}
          {evidence.latencyMs !== null ? (
            <span className="muted small">
              {' '}
              · {evidence.latencyMs} ms · HTTP {evidence.httpStatus}
            </span>
          ) : null}
        </Row>
        <Row k="Returned fields">
          toxicScore {evidence.returned.toxicScore ?? 'n/a'}; traits{' '}
          {evidence.returned.traits.length ? evidence.returned.traits.map((t) => `${t.name} (risk ${t.risk ?? 'n/a'})`).join(', ') : 'none'}
        </Row>
        <Row k="Risksir tier">
          <span className={`badge tier-${evidence.tier.toLowerCase()}`}>{evidence.tier}</span> <span className="muted small">{TIER_LABEL}</span>
        </Row>
      </dl>

      <h4>3. Policy decision</h4>
      <dl>
        <Row k="Active policy">
          v{decision.policyVersion} <span className="muted small">({shortHash(decision.policyHash)})</span>
        </Row>
        <Row k="Action">
          <span className={`badge action action-${decision.action.toLowerCase()}`}>{decision.action}</span>
        </Row>
        <Row k="Reasons">{decision.reasons.join(', ')}</Row>
        {decision.authorisedMaxAtomic !== null ? <Row k="Authorised maximum">{formatUsdc(decision.authorisedMaxAtomic)}</Row> : null}
      </dl>

      <h4>4. Signer</h4>
      {signer.calls > 0 ? <p>Signer invoked at {timeOf(signer.invokedAt)}, after the Intercepta call.</p> : <p className="muted">The signer was not called.</p>}

      <h4>5. Settlement and delivery (separate)</h4>
      <dl>
        <Row k="Settlement">{settlement.status}</Row>
        <Row k="Delivery">{settlement.delivery ?? 'n/a'}</Row>
        {settlement.txHash ? (
          <Row k="Transaction">
            <a href={settlement.basescan ?? basescanTx(settlement.txHash)} target="_blank" rel="noreferrer">
              {shortHash(settlement.txHash)} on Basescan (Base Sepolia)
            </a>
          </Row>
        ) : null}
      </dl>
    </article>
  );
}

export function RegressionTable({ data }: { data: SiteRegression }) {
  const cell = (c: SiteRegression['candidates'][number], name: string) => {
    const m = c.metrics.find((x) => x.name === name);
    return m ? `${m.numerator}/${m.denominator}` : 'n/a';
  };
  return (
    <div className="panel" data-testid="regression">
      <p>
        <RecordedBadge at={data.recordedAt} />
      </p>
      <div className="table-wrap">
        <table data-testid="metrics-table">
          <thead>
            <tr>
              <th>Metric (numerator/denominator)</th>
              {data.candidates.map((c) => (
                <th key={c.key}>
                  Candidate {c.key}
                  {data.approved.candidate === c.key ? <span className="badge approved"> approved → v{data.approved.policyVersion}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Rule added</td>
              {data.candidates.map((c) => (
                <td key={c.key} className="small">
                  {c.rule ? `${c.rule.description} → ${c.rule.action}` : 'n/a'}
                </td>
              ))}
            </tr>
            {Object.entries(METRIC_LABELS).map(([name, label]) => (
              <tr key={name}>
                <td>
                  {label}
                  {VALUE_METRICS.has(name) ? <span className="muted small"> (atomic USDC)</span> : null}
                </td>
                {data.candidates.map((c) => (
                  <td key={c.key} data-testid={`metric-${name}-${c.key}`}>
                    {cell(c, name)}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td>Cases by provenance</td>
              {data.candidates.map((c) => (
                <td key={c.key} className="small">
                  {Object.entries(c.provenanceMix)
                    .map(([p, n]) => `${p} ${n}`)
                    .join(' · ')}
                </td>
              ))}
            </tr>
            <tr>
              <td>Report hash</td>
              {data.candidates.map((c) => (
                <td key={c.key} className="small">
                  {shortHash(c.reportHash)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted small">
        {data.caveat} Only the {data.candidates[0]?.provenanceMix.real_live ?? 0} real_live cases are stored Intercepta responses; the rest are controlled variants and synthetic cases, labelled as such. Owner approval bound to report {shortHash(data.approved.reportHash)}.
      </p>
    </div>
  );
}
