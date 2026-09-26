import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, createApi } from './api';
import type { Api } from './api';
import { Header, MetricsTable, Panel, ProvenanceBadge, SignerBadge, TraceView } from './components';
import type { MetricColumn } from './components';
import { basescanTx, compactCases, formatUsdc, shortHash, usdcNumber } from './format';
import { PRESETS } from './presets';
import type { ApiState, AttemptSummary, CandidatePolicy, PaymentCase, PolicyVersion, RegressionReport, Trace } from './types';

/**
 * One page, a few panels, and every panel affects a future payment (SPEC section 20): the profile the agent is held to,
 * the decision traces, incident labels (Trigger C), regression comparison with approval, and rollback. The owner token
 * lives only in this component's memory.
 */
const SCENARIO_BUTTONS = [
  ['pass', 'Run scene 2: pay SAFE'],
  ['block', 'Run scene 3: risky payTo'],
  ['v2', 'Run scene 5: new ALT payment'],
] as const;

/** True on any host other than this machine: the public preview has no backend, so it must never take a token. */
const isHostedPreview = () => typeof location !== 'undefined' && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

export function App({ apiFactory = createApi, hosted = isHostedPreview() }: { apiFactory?: (token: string) => Api; hosted?: boolean }) {
  const [tokenInput, setTokenInput] = useState('');
  const [api, setApi] = useState<Api | null>(null);
  const [state, setState] = useState<ApiState | null>(null);
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [cases, setCases] = useState<PaymentCase[]>([]);
  const [candidates, setCandidates] = useState<CandidatePolicy[]>([]);
  const [reports, setReports] = useState<Record<string, RegressionReport>>({});
  const [versions, setVersions] = useState<PolicyVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [labelCase, setLabelCase] = useState('');
  const [labelValue, setLabelValue] = useState('bad');
  const [showAllCases, setShowAllCases] = useState(false);
  const [rationale, setRationale] = useState('');

  const refresh = useCallback(async (a: Api) => {
    const [s, p, at, c, cand] = await Promise.all([a.state(), a.policies(), a.attempts(), a.cases(), a.candidates()]);
    setState(s);
    setVersions(p.versions);
    setAttempts(at.attempts);
    setCases(c.cases);
    setCandidates(cand.candidates);
  }, []);

  const run = useCallback(
    async (fn: () => Promise<unknown>, done?: string) => {
      setError(null);
      setNotice(null);
      try {
        await fn();
        if (done) setNotice(done);
      } catch (err) {
        setError(err instanceof ApiError ? `${err.code ?? err.status}: ${err.message}` : (err as Error).message);
      }
    },
    [],
  );

  const connect = (e: FormEvent) => {
    e.preventDefault();
    if (hosted) return; // the public preview never creates an API client or sends a token
    const a = apiFactory(tokenInput.trim());
    void run(async () => {
      await refresh(a);
      setApi(a);
      setTokenInput(''); // the token is not kept in the input either
    });
  };

  const selectAttempt = (id: string) => api && void run(async () => setTrace(await api.trace(id)));

  const columns: MetricColumn[] = candidates.map((c) => ({ label: `v${c.policy.policyVersion} ${c.candidateId.slice(0, 4)}`, report: reports[c.candidateId] ?? null }));
  const activeVersion = state?.activePolicy?.policyVersion;
  const profile = state?.activePolicy?.profile;
  const incident = cases.find((c) => c.caseId.startsWith('cv-01')) ?? cases[0];

  return (
    <div className="app">
      <Header state={state} connected={api !== null} />
      {error ? <div className="alert error" role="alert">{error}</div> : null}
      {notice ? <div className="alert ok" role="status">{notice}</div> : null}

      {!api ? (
        <Panel title="Connect" {...(hosted ? {} : { note: 'The owner token is sent only to the local API through the dev proxy and is kept in memory, never stored.' })}>
          {hosted ? (
            <p className="alert" data-testid="hosted-notice">
              Preview only. The owner console needs the local backend, so Connect is disabled on this page and no token is ever sent from here. To run the demo, start it on your own machine with <strong>pnpm demo:up</strong>.
            </p>
          ) : null}
          <form onSubmit={connect} className="row">
            <label>
              Owner token{' '}
              <input type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} autoComplete="off" aria-label="Owner token" disabled={hosted} />
            </label>
            <button type="submit" disabled={hosted || tokenInput.trim().length === 0}>Connect</button>
          </form>
        </Panel>
      ) : (
        <main className="grid">
          <Panel title="Company risk profile">
            {profile ? (
              <dl data-testid="profile">
                <div className="kv"><dt>Per payment limit</dt><dd>{formatUsdc(profile.maxPerPaymentAtomic)}</dd></div>
                <div className="kv"><dt>Period cap</dt><dd>{formatUsdc(profile.periodCapAtomic)} per {profile.periodSeconds / 3600} h</dd></div>
                <div className="kv"><dt>Network / asset</dt><dd>{profile.network} · {shortHash(profile.asset)}</dd></div>
                <div className="kv"><dt>Allowed services</dt><dd>{profile.allowedServices.join(', ')}</dd></div>
                <div className="kv"><dt>Rules</dt><dd>{state?.activePolicy?.rules.map((r) => r.ruleId).join(' → ')} → default {state?.activePolicy?.defaultAction}</dd></div>
                <div className="kv"><dt>Signer calls (all attempts)</dt><dd>{state?.signerCallsTotal}</dd></div>
              </dl>
            ) : (
              <p className="muted">No active policy.</p>
            )}
          </Panel>

          <Panel title="Live trace">
            <div className="scenario-buttons" aria-label="run a scenario">
              {SCENARIO_BUTTONS.map(([scenario, label]) => (
                <button
                  key={scenario}
                  onClick={() => api && void run(async () => {
                    const r = await api.runScenario(scenario);
                    await refresh(api);
                    setTrace(await api.trace(r.attemptId));
                  }, `${label}: attempt recorded (live Intercepta screen, testnet only).`)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Attempt</th><th>Status</th><th>v</th><th>Action</th><th>Amount (USDC)</th><th>Signer</th><th>Tx (Base Sepolia)</th></tr></thead>
                <tbody>
                  {attempts.map((a) => (
                    <tr key={a.attemptId} onClick={() => selectAttempt(a.attemptId)} className={trace?.attempt.attemptId === a.attemptId ? 'selected' : ''} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && selectAttempt(a.attemptId)}>
                      <td>{shortHash(a.attemptId, 6)}</td>
                      <td>{a.status}</td>
                      <td>{a.policyVersion ?? 'n/a'}</td>
                      <td>{a.action ?? 'n/a'}</td>
                      <td>{usdcNumber(a.amountAtomic)}</td>
                      <td><SignerBadge calls={a.signerCalls} /></td>
                      <td>{a.txHash ? <a href={basescanTx(a.txHash)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{shortHash(a.txHash, 4)}</a> : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {attempts.length === 0 ? <p className="muted">No attempts yet.</p> : null}
            </div>
            {trace ? (
              <>
                <TraceView trace={trace} />
                {trace.attempt.status === 'awaiting_approval' && trace.attempt.quoteHash ? (
                  <button
                    onClick={() => api && void run(async () => {
                      const r = await api.approveAttempt(trace.attempt.attemptId, trace.attempt.quoteHash as string);
                      await refresh(api);
                      setTrace(await api.trace(trace.attempt.attemptId));
                      return r;
                    }, 'Approval recorded for exactly this quote.')}
                  >
                    Approve this quote (expires in 10 min)
                  </button>
                ) : null}
              </>
            ) : null}
          </Panel>

          <Panel title="Incident labelling">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Case</th><th>Provenance</th><th>Label</th><th>Amount (USDC)</th><th>First-time</th></tr></thead>
                <tbody>
                  {(showAllCases ? cases : compactCases(cases, labelCase)).map((c) => (
                    <tr key={c.caseId} onClick={() => setLabelCase(c.caseId)} className={labelCase === c.caseId ? 'selected' : ''}>
                      <td>{c.caseId}</td>
                      <td><ProvenanceBadge provenance={c.provenance} /></td>
                      <td>{c.label}</td>
                      <td>{usdcNumber(c.quote.amountAtomic)}</td>
                      <td>{c.context.firstTimeCounterparty ? 'yes' : 'no'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {cases.length > 6 ? (
              <p className="muted small">
                {showAllCases ? `All ${cases.length} cases` : `Showing ${compactCases(cases, labelCase).length} of ${cases.length} cases`} ·{' '}
                <button type="button" className="link" onClick={() => setShowAllCases((v) => !v)}>{showAllCases ? 'Show fewer' : 'Show all'}</button>
              </p>
            ) : null}
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                if (!api || !labelCase) return;
                void run(async () => {
                  await api.label(labelCase, labelValue, rationale);
                  await refresh(api);
                  setRationale('');
                }, `Labelled ${labelCase} as ${labelValue}.`);
              }}
            >
              <span>{labelCase || 'select a case above'}</span>
              <select value={labelValue} onChange={(e) => setLabelValue(e.target.value)} aria-label="Label">
                <option value="bad">bad</option>
                <option value="good">good</option>
                <option value="unknown">unknown</option>
              </select>
              <input value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="rationale (required)" aria-label="Rationale" />
              <button type="submit" disabled={!labelCase || rationale.trim() === ''}>Add label</button>
            </form>
          </Panel>

          <Panel title="Candidate policies">
            <div className="row">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  title={p.rationale}
                  onClick={() => api && void run(async () => {
                    await api.createCandidate({ rules: p.rules, defaultAction: 'HOLD', rationale: p.rationale, originatingCaseIds: incident ? [incident.caseId] : [] });
                    await refresh(api);
                  }, `Candidate ${p.key} created.`)}
                >
                  Create candidate {p.key}: {p.title}
                </button>
              ))}
            </div>
            <ul className="list">
              {candidates.map((c) => {
                const report = reports[c.candidateId];
                return (
                  <li key={c.candidateId}>
                    <strong>v{c.policy.policyVersion}</strong> {c.candidateId.slice(0, 8)} · {c.status} · <span className="muted">{c.rationale}</span>
                    <span className="row">
                      <button disabled={c.status !== 'draft' && c.status !== 'replayed'} onClick={() => api && void run(async () => {
                        const r = await api.replay(c.candidateId);
                        setReports((m) => ({ ...m, [c.candidateId]: r }));
                        await refresh(api);
                      }, 'Replayed.')}>Replay</button>
                      <button disabled={!report || c.status !== 'replayed'} onClick={() => api && report && void run(async () => {
                        await api.approve(c.candidateId, report.reportHash);
                        setReports({});
                        setTrace(null);
                        await refresh(api);
                      }, 'Approved and activated as a new policy version.')}>Approve (bound to this report)</button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title="Regression comparison">
            <MetricsTable columns={columns} />
          </Panel>

          <Panel title="Policy versions">
            <ul className="list">
              {versions.map((v) => (
                <li key={v.policyVersion}>
                  <strong>v{v.policyVersion}</strong> {v.status} <span className="muted">{shortHash(v.policyHash)}</span>
                  {v.status === 'superseded' ? (
                    <button onClick={() => api && void run(async () => {
                      await api.rollback(v.policyVersion);
                      setReports({});
                      await refresh(api);
                    }, `Rolled back to v${v.policyVersion}.`)}>Roll back to v{v.policyVersion}</button>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="muted small">Active: {activeVersion !== undefined ? `v${activeVersion}` : 'none'}.</p>
          </Panel>
        </main>
      )}
    </div>
  );
}
