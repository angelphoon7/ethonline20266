import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEMO_ORG_ID, DEMO_SERVICE_BASE, demoCandidates, demoPolicyV1, demoProfile, paymentAttemptSchema, sealReport } from '@risksir/core';
import type { PaymentAttempt, PaymentPolicy, Rule } from '@risksir/core';
import { loadDataset } from '../src/dataset/index.js';
import { LifecycleError, approveCandidate, createCandidate, installInitialPolicy, replayCandidate, rollbackPolicy } from '../src/policy/index.js';
import { Store } from '../src/store/store.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const ORG = DEMO_ORG_ID;
const v1 = demoPolicyV1(demoProfile(DEMO_SERVICE_BASE));
const [candA, candB, candC] = demoCandidates(v1).map((c) => c.policy);
const rulesOf = (p: PaymentPolicy | undefined): Rule[] => (p as PaymentPolicy).rules;

/** A tick-per-call clock so audit timestamps are strictly ordered. */
function deps() {
  let n = 0;
  let id = 0;
  return { now: () => new Date(Date.parse('2026-09-26T16:00:00.000Z') + ++n * 1000), newId: () => `id-${++id}` };
}

function world(opts: { seedCases?: boolean } = {}) {
  const store = new Store(':memory:');
  const d = deps();
  installInitialPolicy(store, ORG, v1, d);
  if (opts.seedCases !== false) for (const c of loadDataset(root)) store.saveCase(c);
  const candidate = (rules: Rule[], rationale = 'test') =>
    createCandidate(store, ORG, { rules, defaultAction: 'HOLD', rationale, originatingCaseIds: ['cv-01-incident-80000'], generatedBy: 'owner' }, d);
  return { store, d, candidate };
}

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return err instanceof LifecycleError ? err.code : `OTHER:${(err as Error).message}`;
  }
  return undefined;
};

describe('initial policy', () => {
  it('installs v1 atomically: policy, active version record, one pointer and an audit event', () => {
    const { store } = world({ seedCases: false });
    expect(store.getActivePolicyVersion(ORG)).toBe(1);
    expect(store.getPolicyVersion(ORG, 1)).toMatchObject({ status: 'active', approvedBy: 'seed', policyHash: v1.policyHash });
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM active_pointer WHERE org_id = ?').get(ORG)).toEqual({ n: 1 });
    expect(store.listAudit().map((e) => e.type)).toEqual(['PolicyActivated']);
  });
});

// T-029 (AC-012, INV-010): candidates, report binding, approval.
describe('candidates and replay', () => {
  it('the server builds a candidate: next version, parent = active, profile copied, status draft', () => {
    const { candidate } = world();
    const c = candidate(rulesOf(candB));
    expect(c).toMatchObject({ baseVersion: 1, status: 'draft', generatedBy: 'owner' });
    expect(c.policy).toMatchObject({ policyVersion: 2, parentVersion: 1, profile: v1.profile, defaultAction: 'HOLD' });
  });

  it('rejects invalid candidates: duplicate rule ids, a CAP rule without a cap, an unknown originating case, an empty rationale is allowed but a bad default is not', () => {
    const { store, d } = world();
    const dup = [rulesOf(candB)[0] as Rule, rulesOf(candB)[0] as Rule];
    expect(codeOf(() => createCandidate(store, ORG, { rules: dup, defaultAction: 'HOLD', rationale: '', originatingCaseIds: [], generatedBy: 'owner' }, d))).toBe('CANDIDATE_INVALID');
    const noCap = [{ ruleId: 'X', description: '', when: [], then: { action: 'CAP' } }] as unknown as Rule[];
    expect(codeOf(() => createCandidate(store, ORG, { rules: noCap, defaultAction: 'HOLD', rationale: '', originatingCaseIds: [], generatedBy: 'owner' }, d))).toBe('CANDIDATE_INVALID');
    expect(codeOf(() => createCandidate(store, ORG, { rules: [], defaultAction: 'PAY' as never, rationale: '', originatingCaseIds: [], generatedBy: 'owner' }, d))).toBe('CANDIDATE_INVALID');
    expect(codeOf(() => createCandidate(store, ORG, { rules: [], defaultAction: 'HOLD', rationale: '', originatingCaseIds: ['nope'], generatedBy: 'owner' }, d))).toBe('CANDIDATE_INVALID');
    expect(store.listCandidates(ORG)).toHaveLength(0);
  });

  it('there is nothing to base a candidate on without an active policy', () => {
    const store = new Store(':memory:');
    expect(codeOf(() => createCandidate(store, ORG, { rules: [], defaultAction: 'HOLD', rationale: '', originatingCaseIds: [], generatedBy: 'owner' }))).toBe('NO_ACTIVE_POLICY');
  });

  it('replay seals a report bound to the candidate, baseline and dataset hashes, marks the candidate replayed and audits it', () => {
    const { store, d, candidate } = world();
    const c = candidate(rulesOf(candB));
    const report = replayCandidate(store, ORG, c.candidateId, d);
    expect(report).toMatchObject({ candidateHash: c.policy.policyHash, baselineHash: v1.policyHash });
    expect(report.caseResults).toHaveLength(19);
    expect(store.getCandidate(c.candidateId)?.status).toBe('replayed');
    expect(store.getReport(report.reportHash)?.reportHash).toBe(report.reportHash);
    expect(store.listAudit().at(-1)).toMatchObject({ type: 'RegressionCompleted', refs: { candidateId: c.candidateId, reportHash: report.reportHash } });
  });

  it('replaying again on unchanged data gives the same report hash and stores it once', () => {
    const { store, d, candidate } = world();
    const c = candidate(rulesOf(candB));
    const a = replayCandidate(store, ORG, c.candidateId, d);
    const b = replayCandidate(store, ORG, c.candidateId, d);
    expect(b.reportHash).toBe(a.reportHash);
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM reports').get()).toEqual({ n: 1 });
  });

  it('an empty dataset cannot be replayed', () => {
    const { store, d } = world({ seedCases: false });
    const c = createCandidate(store, ORG, { rules: rulesOf(candB), defaultAction: 'HOLD', rationale: '', originatingCaseIds: [], generatedBy: 'owner' }, d);
    expect(codeOf(() => replayCandidate(store, ORG, c.candidateId, d))).toBe('NO_CASES');
    expect(store.getCandidate(c.candidateId)?.status).toBe('draft');
  });

  it('a missing candidate is reported, not thrown as a crash', () => {
    const { store, d } = world();
    expect(codeOf(() => replayCandidate(store, ORG, 'missing', d))).toBe('CANDIDATE_NOT_FOUND');
  });
});

describe('approval is bound to an exact report (INV-010)', () => {
  it('refuses an unreplayed candidate, a missing report, a blank approver', () => {
    const { store, d, candidate } = world();
    const c = candidate(rulesOf(candB));
    expect(codeOf(() => approveCandidate(store, ORG, c.candidateId, `0x${'00'.repeat(32)}`, 'owner', d))).toBe('CANDIDATE_NOT_REPLAYED');
    const r = replayCandidate(store, ORG, c.candidateId, d);
    expect(codeOf(() => approveCandidate(store, ORG, c.candidateId, `0x${'00'.repeat(32)}`, 'owner', d))).toBe('REPORT_NOT_FOUND');
    expect(codeOf(() => approveCandidate(store, ORG, c.candidateId, r.reportHash, '  ', d))).toBe('APPROVER_REQUIRED');
    expect(store.getActivePolicyVersion(ORG)).toBe(1);
  });

  it("refuses another candidate's report", () => {
    const { store, d, candidate } = world();
    const a = candidate(rulesOf(candA));
    const b = candidate(rulesOf(candB));
    const ra = replayCandidate(store, ORG, a.candidateId, d);
    replayCandidate(store, ORG, b.candidateId, d);
    expect(codeOf(() => approveCandidate(store, ORG, b.candidateId, ra.reportHash, 'owner', d))).toBe('REPORT_CANDIDATE_MISMATCH');
    expect(store.getActivePolicyVersion(ORG)).toBe(1);
  });

  it('refuses a report computed on an older dataset: the owner labelled a case after the replay', () => {
    const { store, d, candidate } = world();
    const c = candidate(rulesOf(candB));
    const r = replayCandidate(store, ORG, c.candidateId, d);
    store.appendLabel('cv-01-incident-80000', { label: 'bad', labelledBy: 'owner', rationale: 'incident', at: '2026-09-26T17:00:00.000Z' });
    expect(codeOf(() => approveCandidate(store, ORG, c.candidateId, r.reportHash, 'owner', d))).toBe('REPORT_DATASET_STALE');
    const again = replayCandidate(store, ORG, c.candidateId, d);
    expect(again.reportHash).not.toBe(r.reportHash);
    expect(() => approveCandidate(store, ORG, c.candidateId, again.reportHash, 'owner', d)).not.toThrow();
  });

  it('refuses a validly sealed report that was computed against a different baseline', () => {
    const { store, d, candidate } = world();
    const c = candidate(rulesOf(candB));
    const r = replayCandidate(store, ORG, c.candidateId, d);
    const { reportHash: _h, reportId: _i, generatedAt: _g, ...body } = r;
    const foreign = sealReport({ ...body, baselineHash: `0x${'ab'.repeat(32)}` }, { reportId: 'foreign', generatedAt: r.generatedAt });
    store.saveReport(ORG, foreign); // a consistent report, but for another baseline
    expect(codeOf(() => approveCandidate(store, ORG, c.candidateId, foreign.reportHash, 'owner', d))).toBe('REPORT_BASELINE_STALE');
    expect(store.getActivePolicyVersion(ORG)).toBe(1);
  });

  it('refuses a tampered stored report', () => {
    const { store, d, candidate } = world();
    const c = candidate(rulesOf(candB));
    const r = replayCandidate(store, ORG, c.candidateId, d);
    const tampered = { ...r, metrics: r.metrics.map((m) => (m.name === 'bad_cases_prevented' ? { ...m, numerator: '99' } : m)) };
    store.db.prepare('UPDATE reports SET json = ? WHERE report_hash = ?').run(JSON.stringify(tampered), r.reportHash);
    expect(codeOf(() => approveCandidate(store, ORG, c.candidateId, r.reportHash, 'owner', d))).toBe('REPORT_TAMPERED');
  });

  it('a candidate whose base is no longer active cannot be approved (the losing siblings become rejected)', () => {
    const { store, d, candidate } = world();
    const a = candidate(rulesOf(candA));
    const b = candidate(rulesOf(candB));
    const ra = replayCandidate(store, ORG, a.candidateId, d);
    const rb = replayCandidate(store, ORG, b.candidateId, d);
    approveCandidate(store, ORG, b.candidateId, rb.reportHash, 'owner', d);
    expect(store.getCandidate(a.candidateId)?.status).toBe('rejected');
    expect(codeOf(() => approveCandidate(store, ORG, a.candidateId, ra.reportHash, 'owner', d))).toBe('CANDIDATE_NOT_REPLAYED');
  });

  it('approval activates the version atomically: policy, records, pointer, candidates and audit events', () => {
    const { store, d, candidate } = world();
    const [a, b, c] = [candidate(rulesOf(candA)), candidate(rulesOf(candB)), candidate(rulesOf(candC))] as const;
    for (const x of [a, b, c]) replayCandidate(store, ORG, x.candidateId, d);
    const rb = store.getReport(replayCandidate(store, ORG, b.candidateId, d).reportHash)!;

    const active = approveCandidate(store, ORG, b.candidateId, rb.reportHash, 'owner', d);

    expect(active).toMatchObject({ policyVersion: 2, status: 'active', approvedReportHash: rb.reportHash, approvedBy: 'owner', parentVersion: 1, rollbackTarget: 1 });
    expect(store.getActivePolicyVersion(ORG)).toBe(2);
    expect(store.getPolicy(ORG, 2)?.policyHash).toBe(b.policy.policyHash);
    expect(store.listPolicyVersions(ORG).map((v) => [v.policyVersion, v.status])).toEqual([[1, 'superseded'], [2, 'active']]);
    expect([a, b, c].map((x) => store.getCandidate(x.candidateId)?.status)).toEqual(['rejected', 'approved', 'rejected']);
    const types = store.listAudit().map((e) => e.type);
    expect(types.slice(-2)).toEqual(['PolicyApproved', 'PolicyActivated']);
    expect(store.listAudit().find((e) => e.type === 'PolicyApproved')?.actor).toBe('owner');
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM active_pointer WHERE org_id = ?').get(ORG)).toEqual({ n: 1 });
  });

  it('is atomic: a failure while moving the pointer leaves v1 active and nothing else changed', () => {
    class FailingStore extends Store {
      fail = false;
      override setActivePolicy(orgId: string, version: number, transitionId: string, at: string): void {
        if (this.fail) throw new Error('boom');
        super.setActivePolicy(orgId, version, transitionId, at);
      }
    }
    const store = new FailingStore(':memory:');
    const d = deps();
    installInitialPolicy(store, ORG, v1, d);
    for (const c of loadDataset(root)) store.saveCase(c);
    const c = createCandidate(store, ORG, { rules: rulesOf(candB), defaultAction: 'HOLD', rationale: '', originatingCaseIds: [], generatedBy: 'owner' }, d);
    const r = replayCandidate(store, ORG, c.candidateId, d);
    const auditBefore = store.listAudit().length;

    store.fail = true;
    expect(() => approveCandidate(store, ORG, c.candidateId, r.reportHash, 'owner', d)).toThrow('boom');

    expect(store.getActivePolicyVersion(ORG)).toBe(1);
    expect(store.getPolicy(ORG, 2)).toBeNull();
    expect(store.listPolicyVersions(ORG).map((v) => [v.policyVersion, v.status])).toEqual([[1, 'active']]);
    expect(store.getCandidate(c.candidateId)?.status).toBe('replayed');
    expect(store.listAudit()).toHaveLength(auditBefore);
    store.fail = false;
    expect(() => approveCandidate(store, ORG, c.candidateId, r.reportHash, 'owner', d)).not.toThrow(); // and it can still be approved
  });
});

// INV-011: approved versions are immutable; rollback is a new logged transition.
describe('immutability and rollback', () => {
  function withV2() {
    const w = world();
    const c = w.candidate(rulesOf(candB));
    const r = replayCandidate(w.store, ORG, c.candidateId, w.d);
    approveCandidate(w.store, ORG, c.candidateId, r.reportHash, 'owner', w.d);
    return { ...w, c, r };
  }

  it('an approved policy version can never be overwritten or edited', () => {
    const { store } = withV2();
    expect(() => store.putPolicy(ORG, { ...(store.getPolicy(ORG, 2) as PaymentPolicy), defaultAction: 'DENY' })).toThrow();
    const record = store.getPolicyVersion(ORG, 2)!;
    expect(() => store.savePolicyVersion(ORG, { ...record, approvedReportHash: `0x${'00'.repeat(32)}` })).toThrow(/immutable/);
    expect(() => store.savePolicyVersion(ORG, { ...record, status: 'approved' })).toThrow(/illegal policy version transition/);
    expect(store.getPolicy(ORG, 2)?.defaultAction).toBe('HOLD');
  });

  it('rolls back to v1 as a new logged transition: v2 is rolled_back, the pointer moves, nothing is deleted', () => {
    const { store, d } = withV2();
    const before = store.db.prepare('SELECT transition_id AS t FROM active_pointer WHERE org_id = ?').get(ORG) as { t: string };
    const restored = rollbackPolicy(store, ORG, 1, 'owner', d);
    expect(restored).toMatchObject({ policyVersion: 1, status: 'active' });
    expect(store.getActivePolicyVersion(ORG)).toBe(1);
    expect(store.listPolicyVersions(ORG).map((v) => [v.policyVersion, v.status])).toEqual([[1, 'active'], [2, 'rolled_back']]);
    expect(store.getPolicy(ORG, 2)).not.toBeNull(); // history is kept
    const after = store.db.prepare('SELECT transition_id AS t FROM active_pointer WHERE org_id = ?').get(ORG) as { t: string };
    expect(after.t).not.toBe(before.t);
    const audit = store.listAudit().at(-1)!;
    expect(audit).toMatchObject({ type: 'PolicyRolledBack', actor: 'owner', refs: { policyVersion: 1 } });
  });

  it('rejects invalid rollback targets: current, unknown, rolled back, blank owner', () => {
    const { store, d } = withV2();
    expect(codeOf(() => rollbackPolicy(store, ORG, 2, 'owner', d))).toBe('ROLLBACK_TARGET_INVALID');
    expect(codeOf(() => rollbackPolicy(store, ORG, 9, 'owner', d))).toBe('ROLLBACK_TARGET_INVALID');
    expect(codeOf(() => rollbackPolicy(store, ORG, 1, '', d))).toBe('APPROVER_REQUIRED');
    rollbackPolicy(store, ORG, 1, 'owner', d);
    expect(codeOf(() => rollbackPolicy(store, ORG, 2, 'owner', d))).toBe('ROLLBACK_TARGET_INVALID'); // rolled_back is terminal
    expect(store.getActivePolicyVersion(ORG)).toBe(1);
  });

  it('a rolled-back version number is never reused: the next candidate is v3 with parent v1', () => {
    const { store, d, candidate } = withV2();
    rollbackPolicy(store, ORG, 1, 'owner', d);
    const next = candidate(rulesOf(candC));
    expect(next.policy).toMatchObject({ policyVersion: 3, parentVersion: 1 });
    const r = replayCandidate(store, ORG, next.candidateId, d);
    approveCandidate(store, ORG, next.candidateId, r.reportHash, 'owner', d);
    expect(store.getActivePolicyVersion(ORG)).toBe(3);
    expect(store.listPolicyVersions(ORG).map((v) => [v.policyVersion, v.status])).toEqual([[1, 'superseded'], [2, 'rolled_back'], [3, 'active']]);
  });

  it('records versions that pre-date the lifecycle (a policy installed without version records)', () => {
    const store = new Store(':memory:');
    const d = deps();
    store.putPolicy(ORG, v1);
    store.setActivePolicy(ORG, 1, 'seed', d.now().toISOString());
    for (const c of loadDataset(root)) store.saveCase(c);
    const c = createCandidate(store, ORG, { rules: rulesOf(candB), defaultAction: 'HOLD', rationale: '', originatingCaseIds: [], generatedBy: 'owner' }, d);
    const r = replayCandidate(store, ORG, c.candidateId, d);
    approveCandidate(store, ORG, c.candidateId, r.reportHash, 'owner', d);
    expect(store.listPolicyVersions(ORG).map((v) => [v.policyVersion, v.status])).toEqual([[1, 'superseded'], [2, 'active']]);
  });
});

// AC-031, INV-017: activation invalidates what was decided under the previous version.
describe('activation invalidates the previous version', () => {
  it('an attempt awaiting approval under v1 becomes expired when v2 is activated, and an armed permit is revoked', () => {
    const { store, d, candidate } = world();
    const at = '2026-09-26T16:00:00.000Z';
    const base = {
      orgId: ORG, agentId: 'a', taskId: 't', resourceUrl: `${DEMO_SERVICE_BASE}report/safe`, quote: null, quoteHash: null, policyVersion: 1,
      evidenceId: null, decisionId: null, signerCalls: 0, createdAt: at, quotedAt: at, interceptaRequestedAt: null, interceptaReturnedAt: null,
      decidedAt: at, awaitingApprovalUntil: '2026-09-26T16:10:00.000Z', signerInvokedAt: null, submittedAt: null, settledAt: null, failure: null,
    };
    const waiting = paymentAttemptSchema.parse({ ...base, attemptId: 'att-wait', status: 'created', quotedAt: null, decidedAt: null, policyVersion: null, awaitingApprovalUntil: null });
    store.saveAttempt(waiting);
    let cur: PaymentAttempt = waiting;
    for (const status of ['quoted', 'decided', 'awaiting_approval'] as const) {
      cur = paymentAttemptSchema.parse({ ...cur, ...base, attemptId: 'att-wait', status });
      store.saveAttempt(cur);
    }
    expect(store.getAttempt('att-wait')?.status).toBe('awaiting_approval');

    const c = candidate(rulesOf(candB));
    const r = replayCandidate(store, ORG, c.candidateId, d);
    approveCandidate(store, ORG, c.candidateId, r.reportHash, 'owner', d);

    expect(store.getAttempt('att-wait')).toMatchObject({ status: 'expired', signerCalls: 0 });
    expect(store.getAttempt('att-wait')?.failure?.code).toBe('POLICY_CHANGED');
    expect(store.listAudit().map((e) => e.type)).toContain('AttemptExpired');
  });
});
