import type { ApiState, Approved, AttemptSummary, AuditEvent, CandidatePolicy, PaymentCase, PolicyVersion, RegressionReport, Trace } from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/**
 * Owner API client. The bearer token is held in memory by the caller and sent only to the same-origin `/api` proxy. It is
 * never written to localStorage, sessionStorage, cookies, logs or the URL.
 */
export function createApi(token: string, fetchImpl: typeof fetch = (...a) => fetch(...a)) {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(`/api${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) throw new ApiError(res.status, String(json.error ?? res.statusText), typeof json.code === 'string' ? json.code : undefined);
    return json as T;
  }
  return {
    state: () => call<ApiState>('GET', '/state'),
    policies: () => call<{ versions: PolicyVersion[]; activeVersion: number | null }>('GET', '/policies'),
    attempts: () => call<{ attempts: AttemptSummary[] }>('GET', '/attempts'),
    trace: (id: string) => call<Trace>('GET', `/attempts/${encodeURIComponent(id)}`),
    cases: () => call<{ cases: PaymentCase[] }>('GET', '/cases'),
    label: (id: string, label: string, rationale: string) => call<PaymentCase>('POST', `/cases/${encodeURIComponent(id)}/label`, { label, rationale }),
    candidates: () => call<{ candidates: CandidatePolicy[] }>('GET', '/candidates'),
    createCandidate: (input: { rules: unknown[]; defaultAction: string; rationale: string; originatingCaseIds: string[] }) => call<CandidatePolicy>('POST', '/candidates', input),
    replay: (candidateId: string) => call<RegressionReport>('POST', `/candidates/${encodeURIComponent(candidateId)}/replay`),
    approve: (candidateId: string, reportHash: string) => call<PolicyVersion>('POST', `/candidates/${encodeURIComponent(candidateId)}/approve`, { reportHash }),
    rollback: (toVersion: number) => call<PolicyVersion>('POST', '/policy/rollback', { toVersion }),
    approveAttempt: (attemptId: string, quoteHash: string) => call<Approved>('POST', '/approvals', { attemptId, quoteHash }),
    audit: () => call<{ events: AuditEvent[] }>('GET', '/audit'),
  };
}
export type Api = ReturnType<typeof createApi>;
