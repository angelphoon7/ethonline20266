import { useCallback, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, createApi } from './api';
import type { Api } from './api';
import { AttemptCard, ComparisonTable, Header, LabelChip, Panel, ProvenanceBadge, ProvenanceLegend, TraceView } from './components';
import type { CompareColumn } from './components';
import { compactCases, formatUsdc, shortAddr, shortCaseId, shortHash, timeOf, usdcFixed } from './format';
import { PRESETS } from './presets';
import type { ApiState, AttemptSummary, CandidatePolicy, PaymentCase, PolicyVersion, RegressionReport, Trace } from './types';

/**
 * One page in demo order (SPEC section 20, ADR-028): the profile the agent is held to, the payments with their decision
 * traces, incident labels and regression comparison with approval (Trigger C), and the promotion with rollback. The owner
 * token lives only in this component's memory.
 */
const SCENARIO_BUTTONS = [
  ['pass', 'Run scene 2: pay SAFE'],
  ['block', 'Run scene 3: risky payTo'],
  ['v2', 'Run scene 5: new ALT payment'],
] as const;

/** A short name for a candidate: A, B or C for the demo presets (their first rule id is A1, B1 or C1), otherwise a short id. */
const candidateKey = (c: CandidatePolicy): string => {
  const id = (c.policy as { rules?: { ruleId?: string }[] }).rules?.[0]?.ruleId;
  const k = typeof id === 'string' ? id.charAt(0) : '';
  return k === 'A' || k === 'B' || k === 'C' ? k : c.candidateId.slice(0, 4);
};

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
  /** Presentation only: every report replayed in this session, so the comparison stays visible after an approval. */
  const [history, setHistory] = useState<Record<string, RegressionReport>>({});
  /** Presentation only: the trace of every attempt, loaded read-only so each attempt card can show its evidence. */
  const traceCache = useRef<Record<string, Trace>>({});
  const [traces, setTraces] = useState<Record<string, Trace>>({});
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
    const cache = traceCache.current;
    const stale = at.attempts.filter((x) => {
      const t = cache[x.attemptId];
      return !t || t.attempt.status !== x.status || t.signer.calls !== x.signerCalls;
    });
    await Promise.all(
      stale.map(async (x) => {
        try {
          cache[x.attemptId] = await a.trace(x.attemptId);
        } catch {
          // the card keeps showing "Loading evidence" until a later refresh succeeds
        }
      }),
    );
    setTraces({ ...cache });
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

  const activeVersion = state?.activePolicy?.policyVersion;
  const profile = state?.activePolicy?.profile;
  const incident = cases.find((c) => c.caseId.startsWith('cv-01')) ?? cases[0];
  const newestFirst = [...attempts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const activeRecord = versions.find((v) => v.status === 'active');
  const previousVersion = activeRecord?.parentVersion ?? null;
  const superseded = versions.filter((v) => v.status === 'superseded');

  const rollbackButton = (v: PolicyVersion) => (
    <button
      key={v.policyVersion}
      onClick={() => api && void run(async () => {
        await api.rollback(v.policyVersion);
        setReports({});
        await refresh(api);
      }, `Rolled back to v${v.policyVersion}.`)}
    >
      Roll back to v{v.policyVersion}
    </button>
  );

  const columns: CompareColumn[] = candidates.map((c) => ({
    key: c.candidateId,
    label: `${candidateKey(c)} · v${c.policy.policyVersion}`,
    report: reports[c.candidateId] ?? history[c.candidateId] ?? null,
    approved: c.status === 'approved',
    actions: (
      <>
        <button disabled={c.status !== 'draft' && c.status !== 'replayed'} onClick={() => api && void run(async () => {
          const r = await api.replay(c.candidateId);
          setReports((m) => ({ ...m, [c.candidateId]: r }));
          setHistory((m) => ({ ...m, [c.candidateId]: r }));
          await refresh(api);
        }, 'Replayed.')}>Replay</button>
        <button disabled={!reports[c.candidateId] || c.status !== 'replayed'} onClick={() => api && reports[c.candidateId] && void run(async () => {
          await api.approve(c.candidateId, (reports[c.candidateId] as RegressionReport).reportHash);
          setReports({});
          setTrace(null);
          await refresh(api);
        }, 'Approved and activated as a new policy version.')}>Approve (bound to this report)</button>
      </>
    ),
  }));

  return (
    <div className="app">
      <Header state={state} connected={api !== null} />
      {error ? <div className="alert error" role="alert">{error}</div> : null}
      {notice ? <div className="alert ok" role="status">{notice}</div> : null}

      {!api ? (
        <div className="page">
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
        </div>
      ) : (
        <main className="page">
          <Panel title="Company risk profile" step="Step 1">
            {profile ? (
              <div data-testid="profile">
                <div className="tiles">
                  <div className="tile"><div className="k">Per payment limit</div><div className="v">{formatUsdc(profile.maxPerPaymentAtomic)}</div></div>
                  <div className="tile"><div className="k">Period cap</div><div className="v">{formatUsdc(profile.periodCapAtomic)} per {profile.periodSeconds / 3600} h</div></div>
                  <div className="tile"><div className="k">Network / asset</div><div className="v small-v" title={profile.asset}>{profile.network} · {shortAddr(profile.asset)}</div></div>
                  <div className="tile"><div className="k">Allowed service</div><div className="v small-v" title={profile.allowedServices.join(', ')}>{profile.allowedServices.join(', ')}</div></div>
                </div>
                <h4>Active rules, in order</h4>
                <ol className="rules">
                  {state?.activePolicy?.rules.map((r) => (
                    <li key={r.ruleId}><span className="rid">{r.ruleId}</span><span>{r.description || '-'}</span></li>
                  ))}
                  <li><span className="rid">else</span><span>default {state?.activePolicy?.defaultAction}</span></li>
                </ol>
              </div>
            ) : (
              <p className="muted">No active policy.</p>
            )}
          </Panel>

          <Panel title="Payments" step="Steps 2–3" aside={<ProvenanceLegend />}>
            <div className="scenes" aria-label="run a scenario">
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
            {newestFirst.length === 0 ? (
              <div className="empty">No payments yet. Run scene 2 to make the first payment.</div>
            ) : (
              <div className="attempt-list">
                {newestFirst.map((a) => (
                  <AttemptCard key={a.attemptId} attempt={a} trace={traces[a.attemptId]} selected={trace?.attempt.attemptId === a.attemptId} onSelect={() => selectAttempt(a.attemptId)} />
                ))}
              </div>
            )}
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

          <Panel title="Regression" step="Step 4">
            <div className="split">
              <div>
                <div className="sub">Incident cases <ProvenanceLegend /></div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Case</th><th>Provenance</th><th>Label</th><th className="num">Amount (USDC)</th><th>First-time</th></tr></thead>
                    <tbody>
                      {(showAllCases ? cases : compactCases(cases, labelCase)).map((c) => (
                        <tr key={c.caseId} onClick={() => setLabelCase(c.caseId)} className={labelCase === c.caseId ? 'selected' : ''}>
                          <td><span className="mono trunc" title={c.caseId}>{shortCaseId(c.caseId)}</span></td>
                          <td><ProvenanceBadge provenance={c.provenance} /></td>
                          <td><LabelChip label={c.label} /></td>
                          <td className="num">{usdcFixed(c.quote.amountAtomic)}</td>
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
                  <span className="mono trunc" title={labelCase}>{labelCase || 'select a case above'}</span>
                  <select value={labelValue} onChange={(e) => setLabelValue(e.target.value)} aria-label="Label">
                    <option value="bad">bad</option>
                    <option value="good">good</option>
                    <option value="unknown">unknown</option>
                  </select>
                  <input value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="rationale (required)" aria-label="Rationale" />
                  <button type="submit" disabled={!labelCase || rationale.trim() === ''}>Add label</button>
                </form>
              </div>

              <div>
                <div className="sub">Candidate policies</div>
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
                  {candidates.map((c) => (
                    <li key={c.candidateId} className="cand">
                      <strong>{candidateKey(c)}</strong> <span className="muted small">v{c.policy.policyVersion} · {c.status}</span> <span className="muted">{c.rationale}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="sub">Comparison with v1 <span className="row">{superseded.map(rollbackButton)}</span></div>
            <ComparisonTable columns={columns} />
          </Panel>

          <Panel title="Promotion" step="Step 5">
            {activeRecord ? (
              <div className="promo" data-testid="promotion">
                {previousVersion !== null ? (
                  <>
                    <span className="version">v{previousVersion}</span>
                    <span className="arrow">→</span>
                  </>
                ) : null}
                <span className="version">v{activeRecord.policyVersion}</span>
                <span className="muted">
                  {previousVersion !== null
                    ? `approved by ${activeRecord.approvedBy} · ${timeOf(activeRecord.approvedAt)} · report ${activeRecord.approvedReportHash ? shortHash(activeRecord.approvedReportHash) : '-'}`
                    : 'initial policy; no promotion yet'}
                </span>
              </div>
            ) : null}
            <div className="versions">
              {versions.map((v) => (
                <div key={v.policyVersion} className="version-row">
                  <strong>v{v.policyVersion}</strong> <span>{v.status}</span> <span className="muted mono">{shortHash(v.policyHash)}</span>
                  {v.status === 'superseded' ? rollbackButton(v) : null}
                </div>
              ))}
            </div>
            <p className="muted small">Active: {activeVersion !== undefined ? `v${activeVersion}` : 'none'}.</p>
          </Panel>
        </main>
      )}
    </div>
  );
}
