import { randomUUID } from 'node:crypto';
import { addressSchema } from '@risksir/core';
import type { Provenance, RawIntercepta, RiskEvidence } from '@risksir/core';
import type { CallBudget } from './budget.js';
import type { Mapper } from './mapping.js';

/**
 * Live Intercepta (W3A) address screen. Read-only GET of the quick-scan endpoint only (INV-021, guardrails section 2).
 * The API key is sent as a header and never stored, logged or returned. No automatic retry: every call spends the
 * 40-call session budget, and a new attempt makes a new call (ADR-013). Every failure becomes an UNAVAILABLE evidence
 * record, which the policy engine turns into HOLD (INV-003).
 */
export const QUICK_SCAN_PATH_RE = /^\/api\/public\/v2\/extension\/account\/0x[0-9a-f]{40}\/quick-scan$/;
export const quickScanPath = (address: string): string => `/api/public/v2/extension/account/${address}/quick-scan`;

export interface ScreenDeps {
  baseUrl: string | undefined;
  apiKey: string | undefined;
  mapper: Mapper;
  provenance: Provenance;
  mappingVersion: string;
  budget?: CallBudget;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  newId?: () => string;
}

export interface ScreenResult {
  /** Null when no call was made (no key/URL, or local call budget exhausted). */
  raw: RawIntercepta | null;
  evidence: RiskEvidence;
}

const DEFAULT_TIMEOUT_MS = 8000;

export async function screenAddress(addressInput: string, deps: ScreenDeps): Promise<ScreenResult> {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? randomUUID;
  const address = addressSchema.parse(addressInput);
  const evidenceId = newId();

  const unavailable = (
    why: NonNullable<RiskEvidence['unavailable']>,
    raw: RawIntercepta | null,
    reasons: string[] = [],
  ): ScreenResult => ({
    raw,
    evidence: {
      evidenceId,
      rawId: raw?.rawId ?? null,
      provenance: deps.provenance,
      address,
      tier: 'UNAVAILABLE',
      providerScore: null,
      reasons,
      unavailable: why,
      capturedAt: raw?.receivedAt ?? now().toISOString(),
      mappingVersion: deps.mappingVersion,
    },
  });

  if (!deps.apiKey || !deps.baseUrl) return unavailable('NO_KEY', null);

  const budget = deps.budget?.tryConsume();
  if (budget && !budget.ok) {
    return unavailable('RATE_LIMITED', null, [`LOCAL_CALL_BUDGET_EXHAUSTED ${budget.used}/${budget.limit}`]);
  }

  const path = quickScanPath(address);
  if (!QUICK_SCAN_PATH_RE.test(path)) throw new Error('refusing to call a non quick-scan endpoint');
  const url = new URL(path, deps.baseUrl);
  const doFetch = deps.fetchImpl ?? fetch;
  const started = performance.now();
  const base = {
    rawId: newId(),
    provenance: deps.provenance,
    endpoint: url.toString(),
    address,
    interpretedNetwork: 'evm-mainnet' as const,
  };

  let res: Response;
  try {
    res = await doFetch(url, {
      method: 'GET',
      headers: { 'X-API-KEY': deps.apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    const raw: RawIntercepta = {
      ...base,
      httpStatus: null,
      receivedAt: now().toISOString(),
      latencyMs: Math.round(performance.now() - started),
      body: null,
      error: timedOut ? 'TIMEOUT' : 'NETWORK',
    };
    return unavailable(timedOut ? 'TIMEOUT' : 'HTTP_ERROR', raw);
  }

  let text = '';
  try {
    text = await res.text();
  } catch {
    // unreadable body is treated as an empty body
  }
  let body: unknown;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = text; // stored verbatim as a string
  }
  const raw: RawIntercepta = {
    ...base,
    httpStatus: res.status,
    receivedAt: now().toISOString(),
    latencyMs: Math.round(performance.now() - started),
    body,
    error: null,
  };

  if (res.status === 429) return unavailable('RATE_LIMITED', raw);
  if (res.status < 200 || res.status >= 300) return unavailable('HTTP_ERROR', raw);

  const mapped = deps.mapper(body);
  if (mapped === null) return unavailable('MALFORMED', raw);

  return {
    raw,
    evidence: {
      evidenceId,
      rawId: raw.rawId,
      provenance: deps.provenance,
      address,
      tier: mapped.tier,
      providerScore: mapped.providerScore,
      reasons: mapped.reasons,
      unavailable: null,
      capturedAt: raw.receivedAt,
      mappingVersion: deps.mappingVersion,
    },
  };
}
