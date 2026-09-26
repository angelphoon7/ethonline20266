import { useEffect, useState } from 'react';
import { DATA_FILES } from './config';
import { RecordedBadge, RegressionTable, TraceCard } from './evidence';
import { Claims, Footer, Hero, HowItWorks, Problem, Section } from './sections';
import type { SiteData, SiteRegression, SiteTrace, SiteV2 } from './types';

async function load<T>(url: string, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function loadSiteData(fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<SiteData> {
  const [pass, block, regression, v2] = await Promise.all([
    load<SiteTrace>(DATA_FILES.pass, fetchImpl),
    load<SiteTrace>(DATA_FILES.block, fetchImpl),
    load<SiteRegression>(DATA_FILES.regression, fetchImpl),
    load<SiteV2>(DATA_FILES.v2, fetchImpl),
  ]);
  return { pass, block, regression, v2 };
}

function Evidence({ data }: { data: SiteData }) {
  const { v2, v1AfterRollback } = data.v2;
  return (
    <>
      <Section id="evidence" title="Recorded evidence">
        <p className="muted">
          Four traces from test runs on 2026-09-26. Each shows the timestamp of the run it was recorded from. Nothing on this page is live: the Intercepta calls and payments happened earlier and are stored here.
        </p>
        <div className="traces">
          <TraceCard trace={data.pass} heading="Scene 2 · Pass: a clear counterparty is paid" />
          <TraceCard trace={data.block} heading="Scene 3 · Block: an Intercepta-flagged payTo is denied" />
        </div>
      </Section>
      <Section id="evolution" title="After the incident: policy v2 changes a new payment">
        <div className="changed panel" data-testid="changed-action">
          <p>
            <strong>Same kind of payment, different action.</strong> A first-time counterparty asks for the same quote each time. Each attempt below got its own fresh Intercepta screen.
          </p>
          <p className="action-compare">
            <span>
              Policy v{v1AfterRollback.decision.policyVersion}:{' '}
              <span className={`badge action action-${v1AfterRollback.decision.action.toLowerCase()}`}>{v1AfterRollback.decision.action}</span> (signer calls: {v1AfterRollback.signer.calls})
            </span>
            <span aria-hidden="true">→</span>
            <span>
              Policy v{v2.decision.policyVersion}: <span className={`badge action action-${v2.decision.action.toLowerCase()}`}>{v2.decision.action}</span> (signer calls: {v2.signer.calls})
            </span>
          </p>
          <p className="muted small">
            The v1 trace is a later attempt, made after the owner rolled v2 back, with the same quote and a new screen. It is recorded, not a simulation. <RecordedBadge at={v1AfterRollback.recordedAt} />
          </p>
        </div>
        <div className="traces">
          <TraceCard trace={v2} heading="Scene 5 · Policy v2: CAP below the quote, nothing signed" />
          <TraceCard trace={v1AfterRollback} heading="Scene 5 · Policy v1 (after rollback): the same payment is paid" />
        </div>
      </Section>
      <Section id="regression" title="Regression comparison: candidate A vs B">
        <p className="muted">Candidates were replayed over the same labelled cases; the owner approved one, bound to its report.</p>
        <RegressionTable data={data.regression} />
      </Section>
    </>
  );
}

export function App({ fetchImpl }: { fetchImpl?: typeof fetch }) {
  const [data, setData] = useState<SiteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadSiteData(fetchImpl)
      .then((d) => !cancelled && setData(d))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'could not load the recorded evidence'));
    return () => {
      cancelled = true;
    };
  }, [fetchImpl]);

  return (
    <div className="site">
      <nav className="nav" aria-label="sections">
        <a href="#top" className="brand">
          Risksir
        </a>
        <span className="nav-links">
          <a href="#how">How it works</a>
          <a href="#evidence">Evidence</a>
          <a href="#regression">Regression</a>
          <a href="#claims">Claims</a>
        </span>
      </nav>
      <Hero />
      <Problem />
      <HowItWorks />
      {data ? (
        <Evidence data={data} />
      ) : error ? (
        <p role="alert" className="panel error">
          Could not load the recorded evidence ({error}).
        </p>
      ) : (
        <p className="muted" aria-busy="true">
          Loading recorded evidence…
        </p>
      )}
      <Claims />
      <Footer />
    </div>
  );
}
