import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_ORG_ID, DEMO_SERVICE_BASE, demoCandidates, demoPolicyV1, demoProfile, sealPolicy } from '@risksir/core';
import type { Rule } from '@risksir/core';
import { ROUTES, TIER_LABEL, createOwnerApi, safeEqual } from '../src/api/index.js';
import { loadDataset } from '../src/dataset/index.js';
import { installInitialPolicy } from '../src/policy/index.js';
import { Store } from '../src/store/store.js';
import { fixtureScreen, makeClock, makeGateWorld } from './helpers/gateWorld.js';
import { startRealSeller, startStubFacilitator } from './helpers/servers.js';
import type { Running, StubFacilitator } from './helpers/servers.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const TOKEN = 'test-owner-token-0123456789abcdef';
const ORG = DEMO_ORG_ID;
const base = demoPolicyV1(demoProfile(DEMO_SERVICE_BASE));
const ruleB = (demoCandidates(base)[1]?.policy.rules ?? []) as Rule[];

async function serve(store: Store, extra: Partial<Parameters<typeof createOwnerApi>[0]> = {}) {
  const app = createOwnerApi({ store, orgId: ORG, ownerToken: TOKEN, ...extra });
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, token: string | null = TOKEN, headers: Record<string, string> = {}) => {
    const res = await fetch(url + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token !== null ? { authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, json: text ? (JSON.parse(text) as any) : null }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  return { call, close: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))) };
}

function seededStore() {
  const store = new Store(':memory:');
  installInitialPolicy(store, ORG, base);
  for (const c of loadDataset(root)) store.saveCase(c);
  return store;
}

// T-030 (AC-028, INV-026): every owner route requires the bearer token.
describe('authentication', () => {
  it('refuses to start with a short token', () => {
    expect(() => createOwnerApi({ store: new Store(':memory:'), orgId: ORG, ownerToken: 'short' })).toThrow(/at least 16/);
  });

  it('safeEqual compares in constant time over hashes and handles any length', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', 'x')).toBe(false);
  });

  it('every route rejects a missing token, a wrong token, a wrong scheme and an empty bearer with 401', async () => {
    const s = await serve(seededStore());
    try {
      for (const [method, template] of ROUTES) {
        const path = template.replace(':id', 'x').replace(':hash', `0x${'00'.repeat(32)}`);
        const body = method === 'POST' ? {} : undefined;
        for (const [label, token, headers] of [
          ['no header', null, {}],
          ['wrong token', 'wrong-token-0123456789abcdef', {}],
          ['same prefix, different length', `${TOKEN}x`, {}],
          ['Basic scheme', null, { authorization: `Basic ${Buffer.from(TOKEN).toString('base64')}` }],
          ['empty bearer', null, { authorization: 'Bearer ' }],
        ] as const) {
          const r = await s.call(method, path, body, token, headers);
          expect(r.status, `${method} ${path} (${label})`).toBe(401);
          expect(r.headers.get('www-authenticate')).toBe('Bearer');
          expect(r.text).not.toContain(TOKEN);
        }
      }
    } finally {
      await s.close();
    }
  });

  it('an unauthenticated caller cannot tell which routes exist, but non-api paths are simply 404', async () => {
    const s = await serve(seededStore());
    try {
      expect((await s.call('GET', '/api/does-not-exist', undefined, null)).status).toBe(401);
      expect((await s.call('GET', '/api/does-not-exist')).status).toBe(404);
      expect((await s.call('GET', '/elsewhere', undefined, null)).status).toBe(404);
    } finally {
      await s.close();
    }
  });

  it('accepts the right token, with any case of the Bearer scheme', async () => {
    const s = await serve(seededStore());
    try {
      expect((await s.call('GET', '/api/state')).status).toBe(200);
      expect((await s.call('GET', '/api/state', undefined, null, { authorization: `bearer ${TOKEN}` })).status).toBe(200);
    } finally {
      await s.close();
    }
  });

  it('the buyer agent and signer code cannot reach the owner API or the owner token (static)', () => {
    const srcRoot = join(root, 'apps', 'gate', 'src');
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.ts') ? [join(d, e.name)] : []));
    for (const dir of ['agent', 'signer']) {
      for (const f of walk(join(srcRoot, dir))) {
        const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
        expect(code, f).not.toMatch(/OWNER_CONSOLE_TOKEN/);
        expect(code, f).not.toMatch(/from\s+['"][^'"]*\/api\//);
      }
    }
  });
});

describe('request validation', () => {
  it('rejects unknown keys, bad values, invalid JSON and oversized bodies', async () => {
    const store = seededStore();
    const s = await serve(store);
    try {
      expect((await s.call('POST', '/api/cases/cv-01-incident-80000/label', { label: 'bad', rationale: 'x', extra: 1 })).status).toBe(400);
      expect((await s.call('POST', '/api/cases/cv-01-incident-80000/label', { label: 'terrible', rationale: 'x' })).status).toBe(400);
      expect((await s.call('POST', '/api/cases/cv-01-incident-80000/label', { label: 'bad', rationale: '  ' })).status).toBe(400);
      expect((await s.call('POST', '/api/cases/cv-01-incident-80000/label', '{not json')).status).toBe(400);
      expect((await s.call('POST', '/api/cases/cv-01-incident-80000/label', { label: 'bad', rationale: 'x'.repeat(70_000) })).status).toBe(413);
      expect((await s.call('POST', '/api/agent/run', { scenario: 'nope' })).status).toBe(400);
      expect(store.getCase('cv-01-incident-80000')?.labelRevisions).toHaveLength(1); // nothing was applied
    } finally {
      await s.close();
    }
  });

  it('a body cannot set the approver or the profile: the owner identity and the limits are not client-controlled', async () => {
    const s = await serve(seededStore());
    try {
      const noProfile = await s.call('POST', '/api/candidates', { rules: ruleB, defaultAction: 'HOLD', rationale: 'r', originatingCaseIds: [], profile: { maxPerPaymentAtomic: '1000000' } });
      expect(noProfile.status).toBe(400);
      const c = await s.call('POST', '/api/candidates', { rules: ruleB, defaultAction: 'HOLD', rationale: 'r', originatingCaseIds: [] });
      expect(c.status).toBe(201);
      expect(c.json.generatedBy).toBe('owner');
      const rep = await s.call('POST', `/api/candidates/${c.json.candidateId}/replay`);
      const approver = await s.call('POST', `/api/candidates/${c.json.candidateId}/approve`, { reportHash: rep.json.reportHash, approvedBy: 'someone-else' });
      expect(approver.status).toBe(400);
    } finally {
      await s.close();
    }
  });

  it('an invalid candidate is a 400 and a default action that pays is rejected', async () => {
    const s = await serve(seededStore());
    try {
      expect((await s.call('POST', '/api/candidates', { rules: [], defaultAction: 'PAY', rationale: '', originatingCaseIds: [] })).status).toBe(400);
      const dup = [ruleB[0], ruleB[0]];
      const r = await s.call('POST', '/api/candidates', { rules: dup, defaultAction: 'HOLD', rationale: '', originatingCaseIds: [] });
      expect(r.status).toBe(400);
      expect(r.json.code).toBe('CANDIDATE_INVALID');
    } finally {
      await s.close();
    }
  });
});

// AC-009, AC-012, AC-014: the owner loop over HTTP.
describe('owner loop over HTTP', () => {
  it('labels the incident, replays candidates, approves one bound to its report, and rolls back', async () => {
    const store = seededStore();
    const s = await serve(store);
    try {
      // Trigger C: the authenticated owner labels the incident
      const label = await s.call('POST', '/api/cases/cv-01-incident-80000/label', { label: 'bad', rationale: 'merchant took the payment and delivered nothing' });
      expect(label.status).toBe(200);
      expect(label.json.labelRevisions.map((r: { labelledBy: string }) => r.labelledBy)).toEqual(['seed_script', 'owner']);
      expect((await s.call('POST', '/api/cases/missing/label', { label: 'bad', rationale: 'x' })).status).toBe(404);

      // two candidates, replayed
      const [ca, cb] = [demoCandidates(base)[0]!.policy.rules, demoCandidates(base)[1]!.policy.rules];
      const a = (await s.call('POST', '/api/candidates', { rules: ca, defaultAction: 'HOLD', rationale: 'blunt', originatingCaseIds: ['cv-01-incident-80000'] })).json;
      const b = (await s.call('POST', '/api/candidates', { rules: cb, defaultAction: 'HOLD', rationale: 'balanced', originatingCaseIds: ['cv-01-incident-80000'] })).json;
      const ra = (await s.call('POST', `/api/candidates/${a.candidateId}/replay`)).json;
      const rb = (await s.call('POST', `/api/candidates/${b.candidateId}/replay`)).json;
      expect(ra.metrics.length).toBe(10);
      const m = (r: typeof rb, name: string) => r.metrics.find((x: { name: string }) => x.name === name);
      expect(m(rb, 'bad_cases_prevented')).toMatchObject({ numerator: '4', denominator: '4' }); // the incident is now a bad case that v1 exposed
      expect(Number(m(ra, 'good_value_delayed_or_denied').numerator)).toBeGreaterThan(Number(m(rb, 'good_value_delayed_or_denied').numerator));

      // approval must name the exact report
      const wrong = await s.call('POST', `/api/candidates/${b.candidateId}/approve`, { reportHash: ra.reportHash });
      expect(wrong.status).toBe(409);
      expect(wrong.json.code).toBe('REPORT_CANDIDATE_MISMATCH');
      expect((await s.call('GET', '/api/state')).json.activePolicy.policyVersion).toBe(1);

      const ok = await s.call('POST', `/api/candidates/${b.candidateId}/approve`, { reportHash: rb.reportHash });
      expect(ok.status).toBe(200);
      expect(ok.json).toMatchObject({ policyVersion: 2, status: 'active', approvedReportHash: rb.reportHash, approvedBy: 'owner' });
      expect((await s.call('GET', '/api/state')).json.activePolicy.policyVersion).toBe(2);
      expect((await s.call('GET', '/api/reports/' + rb.reportHash)).json.reportHash).toBe(rb.reportHash);
      expect((await s.call('POST', `/api/candidates/${a.candidateId}/approve`, { reportHash: ra.reportHash })).status).toBe(409); // the sibling is stale now

      const back = await s.call('POST', '/api/policy/rollback', { toVersion: 1 });
      expect(back.status).toBe(200);
      expect((await s.call('GET', '/api/state')).json.activePolicy.policyVersion).toBe(1);
      expect((await s.call('POST', '/api/policy/rollback', { toVersion: 2 })).status).toBe(409);
      const versions = (await s.call('GET', '/api/policies')).json.versions.map((v: { policyVersion: number; status: string }) => [v.policyVersion, v.status]);
      expect(versions).toEqual([[1, 'active'], [2, 'rolled_back']]);
      const types = (await s.call('GET', '/api/audit')).json.events.map((e: { type: string }) => e.type);
      expect(types).toEqual(expect.arrayContaining(['IncidentLabelled', 'RegressionCompleted', 'PolicyApproved', 'PolicyActivated', 'PolicyRolledBack']));
    } finally {
      await s.close();
    }
  });

  it('cases are listed with provenance and labels (never presented as live unless real_live)', async () => {
    const s = await serve(seededStore());
    try {
      const { cases } = (await s.call('GET', '/api/cases')).json;
      expect(cases).toHaveLength(19);
      expect(cases.filter((c: { provenance: string }) => c.provenance === 'real_live')).toHaveLength(4);
      for (const c of cases) expect(c.evidence.provenance).toBe(c.provenance);
    } finally {
      await s.close();
    }
  });

  it('agent/run answers 501 without a wired runner and delegates to one when present', async () => {
    const store = seededStore();
    const none = await serve(store);
    try {
      expect((await none.call('POST', '/api/agent/run', { scenario: 'pass' })).status).toBe(501);
    } finally {
      await none.close();
    }
    let ran: string | null = null;
    const withRunner = await serve(store, {
      runScenario: async (name) => {
        ran = name;
        return { attempt: { attemptId: 'a1', status: 'failed', signerCalls: 0 }, decision: { action: 'DENY', reasons: [{ code: 'EVIDENCE_BLOCK', ruleId: null }] }, outcome: null } as never;
      },
    });
    try {
      const r = await withRunner.call('POST', '/api/agent/run', { scenario: 'block' });
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ action: 'DENY', signerCalls: 0, reasons: ['EVIDENCE_BLOCK'] });
      expect(ran).toBe('block');
    } finally {
      await withRunner.close();
    }
  });
});

describe('approvals and attempt traces over HTTP (real local seller, stub facilitator, fixture evidence)', () => {
  let facilitator: StubFacilitator;
  let seller: Running;
  const SAFE = `0x${'11'.repeat(20)}`;
  beforeAll(async () => {
    facilitator = await startStubFacilitator();
    seller = await startRealSeller(facilitator.url, [{ variant: 'safe', payTo: SAFE, price: '$0.05' }]);
  });
  afterAll(async () => {
    await seller.close();
    await facilitator.close();
  });

  const askHumanPolicy = (serviceBase: string) => demoCandidates(demoPolicyV1(demoProfile(serviceBase)))[2]!.policy;

  it('POST /api/approvals binds the shown quote, resumes the attempt and returns the settled result; the trace shows the signer only when it was called', async () => {
    const serviceBase = `${seller.url}/paid/`;
    const clock = makeClock();
    const w = makeGateWorld({ serviceBase, screen: fixtureScreen({ [SAFE]: 'CLEAR' }, clock).screen, clock, policy: askHumanPolicy(serviceBase) });
    const task = w.task('report/safe');
    const parked = await w.gate.run(task);
    const id = parked.attempt.attemptId;
    const s = await serve(w.store, { now: clock.now, resumeApproval: (attemptId, approvalId) => w.gate.resumeWithApproval(attemptId, approvalId, task) });
    try {
      const trace1 = (await s.call('GET', `/api/attempts/${id}`)).json;
      expect(trace1.attempt.status).toBe('awaiting_approval');
      expect(trace1.signer).toEqual({ calls: 0, invokedAt: null });
      expect(trace1.evidence).toMatchObject({ provenance: 'synthetic', tier: 'CLEAR', tierLabel: TIER_LABEL });
      expect(trace1.permit).toBeNull();

      const unauth = await s.call('POST', '/api/approvals', { attemptId: id, quoteHash: parked.attempt.quoteHash }, null);
      expect(unauth.status).toBe(401);
      expect(w.store.getApproval('x')).toBeNull();
      const wrongQuote = await s.call('POST', '/api/approvals', { attemptId: id, quoteHash: `0x${'00'.repeat(32)}` });
      expect(wrongQuote.status).toBe(409);
      expect(wrongQuote.json.code).toBe('QUOTE_MISMATCH');
      expect((await s.call('POST', '/api/approvals', { attemptId: 'missing', quoteHash: parked.attempt.quoteHash })).status).toBe(404);

      const ok = await s.call('POST', '/api/approvals', { attemptId: id, quoteHash: parked.attempt.quoteHash });
      expect(ok.status).toBe(201);
      expect(ok.json.resumed).toBe(true);
      expect(ok.json.result).toMatchObject({ status: 'settled', action: 'PAY', signerCalls: 1, settlement: 'settled' });
      expect(ok.json.result.txHash).toMatch(/^0x[0-9a-f]{64}$/);

      const trace2 = (await s.call('GET', `/api/attempts/${id}`)).json;
      expect(trace2.signer.calls).toBe(1);
      expect(Date.parse(trace2.signer.invokedAt)).toBeGreaterThan(Date.parse(trace2.attempt.interceptaReturnedAt));
      expect(trace2.permit.status).toBe('consumed');
      expect(trace2.audit.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['ApprovalRecorded', 'PermitArmed', 'SignerInvoked']));
      expect((await s.call('POST', '/api/approvals', { attemptId: id, quoteHash: parked.attempt.quoteHash })).status).toBe(409); // no longer awaiting
    } finally {
      await s.close();
    }
  });

  it('an approval after the policy changed expires the attempt instead of approving it', async () => {
    const serviceBase = `${seller.url}/paid/`;
    const clock = makeClock();
    const w = makeGateWorld({ serviceBase, screen: fixtureScreen({ [SAFE]: 'CLEAR' }, clock).screen, clock, policy: askHumanPolicy(serviceBase) });
    const parked = await w.gate.run(w.task('report/safe'));
    const s = await serve(w.store, { now: clock.now });
    try {
      const v3 = sealPolicy({ policyVersion: 3, parentVersion: 2, profile: askHumanPolicy(serviceBase).profile, rules: [], defaultAction: 'HOLD' });
      // simulate a policy change that bypasses the lifecycle to hit the API's own guard
      w.store.db.prepare('INSERT INTO policies (org_id, policy_version, json) VALUES (?, ?, ?)').run(ORG, 3, JSON.stringify(v3));
      w.store.db.prepare('UPDATE active_pointer SET policy_version = 3 WHERE org_id = ?').run(ORG);
      const r = await s.call('POST', '/api/approvals', { attemptId: parked.attempt.attemptId, quoteHash: parked.attempt.quoteHash });
      expect(r.status).toBe(409);
      expect(r.json.code).toBe('POLICY_CHANGED');
      expect(w.store.getAttempt(parked.attempt.attemptId)).toMatchObject({ status: 'expired', signerCalls: 0 });
    } finally {
      await s.close();
    }
  });
});
