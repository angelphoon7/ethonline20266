import { randomUUID } from 'node:crypto';
import {
  REGRESSION_ENGINE_VERSION,
  hashDataset,
  hashReport,
  runRegression,
  sealPolicy,
  sealReport,
  validateCandidate,
} from '@risksir/core';
import type { CandidatePolicy, PaymentPolicy, PolicyVersion, RegressionReport, Rule } from '@risksir/core';
import type { Store } from '../store/store.js';

/**
 * Policy lifecycle (SPEC sections 9, 11, INV-010, INV-011, INV-017, INV-025): candidate -> replay -> owner approval bound to
 * the exact report -> atomic activation, plus rollback as a new logged pointer transition. Everything that changes the
 * active pointer runs in ONE database transaction, so a failure leaves the previous policy active. No signer is involved
 * and no AI component can call these functions with approval rights (INV-016): approval takes an authenticated owner id.
 */
export type LifecycleErrorCode =
  | 'NO_ACTIVE_POLICY'
  | 'CANDIDATE_INVALID'
  | 'CANDIDATE_NOT_FOUND'
  | 'CANDIDATE_NOT_REPLAYED'
  | 'CANDIDATE_NOT_PENDING'
  | 'BASE_NOT_ACTIVE'
  | 'NO_CASES'
  | 'REPORT_NOT_FOUND'
  | 'REPORT_TAMPERED'
  | 'REPORT_CANDIDATE_MISMATCH'
  | 'REPORT_BASELINE_STALE'
  | 'REPORT_DATASET_STALE'
  | 'REPORT_ENGINE_STALE'
  | 'ROLLBACK_TARGET_INVALID'
  | 'APPROVER_REQUIRED';

export class LifecycleError extends Error {
  constructor(
    readonly code: LifecycleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LifecycleError';
  }
}

export interface LifecycleDeps {
  now?: () => Date;
  newId?: () => string;
}
const clock = (d: LifecycleDeps) => d.now ?? (() => new Date());
const ids = (d: LifecycleDeps) => d.newId ?? randomUUID;

/** Version records for policies that were installed before the lifecycle existed (for example the demo seed). */
export function ensureVersionRecords(store: Store, orgId: string, at: string): void {
  const active = store.getActivePolicyVersion(orgId);
  for (let v = 1; v < store.nextPolicyVersion(orgId); v++) {
    const policy = store.getPolicy(orgId, v);
    if (!policy || store.getPolicyVersion(orgId, v)) continue;
    store.savePolicyVersion(orgId, {
      policyVersion: v,
      policyHash: policy.policyHash,
      status: v === active ? 'active' : 'superseded',
      approvedReportHash: null,
      approvedBy: 'seed',
      approvedAt: at,
      parentVersion: policy.parentVersion,
      rollbackTarget: null,
    });
  }
}

/** Installs the first policy version (the owner-approved starting profile). Atomic. */
export function installInitialPolicy(store: Store, orgId: string, policy: PaymentPolicy, deps: LifecycleDeps = {}): void {
  const at = clock(deps)().toISOString();
  const run = store.db.transaction(() => {
    store.putPolicy(orgId, policy);
    store.savePolicyVersion(orgId, {
      policyVersion: policy.policyVersion,
      policyHash: policy.policyHash,
      status: 'active',
      approvedReportHash: null,
      approvedBy: 'seed',
      approvedAt: at,
      parentVersion: policy.parentVersion,
      rollbackTarget: null,
    });
    store.setActivePolicy(orgId, policy.policyVersion, ids(deps)(), at);
    store.appendAudit({ at, actor: 'system', type: 'PolicyActivated', refs: { policyVersion: policy.policyVersion }, payload: { policyHash: policy.policyHash, initial: true } });
  });
  run.immediate();
}

export interface CandidateInput {
  rules: Rule[];
  defaultAction: PaymentPolicy['defaultAction'];
  rationale: string;
  originatingCaseIds: string[];
  generatedBy: CandidatePolicy['generatedBy'];
}

/**
 * The server builds the candidate: version = next free number, parent = the active version, profile copied from it. A
 * candidate can therefore only change rules and the default action, never the network, asset or limits.
 */
export function createCandidate(store: Store, orgId: string, input: CandidateInput, deps: LifecycleDeps = {}): CandidatePolicy {
  const base = store.getActivePolicy(orgId);
  if (!base) throw new LifecycleError('NO_ACTIVE_POLICY', 'there is no active policy to base a candidate on');
  for (const id of input.originatingCaseIds) {
    if (!store.getCase(id)) throw new LifecycleError('CANDIDATE_INVALID', `originating case ${id} does not exist`);
  }
  let policy: PaymentPolicy;
  try {
    policy = sealPolicy({ policyVersion: store.nextPolicyVersion(orgId), parentVersion: base.policyVersion, profile: base.profile, rules: input.rules, defaultAction: input.defaultAction });
  } catch (err) {
    throw new LifecycleError('CANDIDATE_INVALID', `invalid policy: ${(err as Error).message.slice(0, 300)}`);
  }
  const validation = validateCandidate(policy, base);
  if (!validation.ok) throw new LifecycleError('CANDIDATE_INVALID', validation.errors.join('; '));
  const candidate: CandidatePolicy = {
    candidateId: ids(deps)(),
    baseVersion: base.policyVersion,
    originatingCaseIds: input.originatingCaseIds,
    policy,
    rationale: input.rationale,
    generatedBy: input.generatedBy,
    status: 'draft',
    createdAt: clock(deps)().toISOString(),
  };
  store.saveCandidate(orgId, candidate);
  return candidate;
}

/** Replays a candidate over the current dataset and stores the sealed, content-addressed report. */
export function replayCandidate(store: Store, orgId: string, candidateId: string, deps: LifecycleDeps = {}): RegressionReport {
  const candidate = store.getCandidate(candidateId);
  if (!candidate) throw new LifecycleError('CANDIDATE_NOT_FOUND', 'candidate not found');
  if (candidate.status !== 'draft' && candidate.status !== 'replayed') throw new LifecycleError('CANDIDATE_NOT_PENDING', `candidate is ${candidate.status}`);
  const base = store.getActivePolicy(orgId);
  if (!base || base.policyVersion !== candidate.baseVersion) throw new LifecycleError('BASE_NOT_ACTIVE', 'the candidate was built on a policy version that is no longer active');
  const cases = store.listCases(orgId);
  if (cases.length === 0) throw new LifecycleError('NO_CASES', 'the dataset is empty: seed cases first');

  let report: RegressionReport;
  try {
    report = sealReport(runRegression({ baseline: base, candidate: candidate.policy, cases }), { reportId: ids(deps)(), generatedAt: clock(deps)().toISOString() });
  } catch (err) {
    throw new LifecycleError('CANDIDATE_INVALID', (err as Error).message);
  }
  const at = report.generatedAt;
  const run = store.db.transaction(() => {
    store.saveReport(orgId, report);
    store.saveCandidate(orgId, { ...candidate, status: 'replayed' });
    store.appendAudit({ at, actor: 'system', type: 'RegressionCompleted', refs: { candidateId, reportHash: report.reportHash, policyVersion: candidate.policy.policyVersion }, payload: { reportHash: report.reportHash, datasetHash: report.datasetHash } });
  });
  run.immediate();
  return report;
}

/**
 * Explicit approval bound to one report (INV-010). It succeeds only if the report was computed on this exact candidate
 * hash, the currently active baseline hash, the current dataset hash and the current engine version. Activation, the
 * version records, the pointer, the sibling-candidate cleanup and the audit events are ONE transaction.
 */
export function approveCandidate(store: Store, orgId: string, candidateId: string, reportHash: string, approvedBy: string, deps: LifecycleDeps = {}): PolicyVersion {
  if (!approvedBy.trim()) throw new LifecycleError('APPROVER_REQUIRED', 'an authenticated approver is required');
  const at = clock(deps)().toISOString();
  const candidate = store.getCandidate(candidateId);
  if (!candidate) throw new LifecycleError('CANDIDATE_NOT_FOUND', 'candidate not found');
  if (candidate.status !== 'replayed') throw new LifecycleError('CANDIDATE_NOT_REPLAYED', `candidate is ${candidate.status}: replay it before approval`);
  const active = store.getActivePolicy(orgId);
  if (!active) throw new LifecycleError('NO_ACTIVE_POLICY', 'there is no active policy');
  if (candidate.baseVersion !== active.policyVersion) throw new LifecycleError('BASE_NOT_ACTIVE', 'the active policy changed since the candidate was created');
  const validation = validateCandidate(candidate.policy, active);
  if (!validation.ok) throw new LifecycleError('CANDIDATE_INVALID', validation.errors.join('; '));

  const report = store.getReport(reportHash);
  if (!report) throw new LifecycleError('REPORT_NOT_FOUND', 'no such regression report');
  if (hashReport(report) !== report.reportHash) throw new LifecycleError('REPORT_TAMPERED', 'the stored report does not match its hash');
  if (report.candidateHash !== candidate.policy.policyHash) throw new LifecycleError('REPORT_CANDIDATE_MISMATCH', 'the report was computed for a different candidate');
  if (report.baselineHash !== active.policyHash) throw new LifecycleError('REPORT_BASELINE_STALE', 'the report was computed against a different baseline');
  if (report.datasetHash !== hashDataset(store.listCases(orgId))) throw new LifecycleError('REPORT_DATASET_STALE', 'the dataset changed since the report: replay again');
  if (report.engineVersion !== REGRESSION_ENGINE_VERSION) throw new LifecycleError('REPORT_ENGINE_STALE', 'the report was computed by another engine version');

  const run = store.db.transaction((): PolicyVersion => {
    ensureVersionRecords(store, orgId, at);
    store.putPolicy(orgId, candidate.policy); // insert-only: an approved version can never be overwritten (INV-011)
    const approved: PolicyVersion = {
      policyVersion: candidate.policy.policyVersion,
      policyHash: candidate.policy.policyHash,
      status: 'approved',
      approvedReportHash: report.reportHash,
      approvedBy,
      approvedAt: at,
      parentVersion: candidate.policy.parentVersion,
      rollbackTarget: active.policyVersion,
    };
    store.savePolicyVersion(orgId, approved);
    const previous = store.getPolicyVersion(orgId, active.policyVersion) as PolicyVersion;
    store.savePolicyVersion(orgId, { ...previous, status: 'superseded' });
    store.savePolicyVersion(orgId, { ...approved, status: 'active' });
    store.setActivePolicy(orgId, candidate.policy.policyVersion, ids(deps)(), at);
    store.saveCandidate(orgId, { ...candidate, status: 'approved' });
    for (const other of store.listCandidates(orgId)) {
      if (other.candidateId !== candidateId && (other.status === 'draft' || other.status === 'replayed')) store.saveCandidate(orgId, { ...other, status: 'rejected' });
    }
    store.appendAudit({ at, actor: 'owner', type: 'PolicyApproved', refs: { candidateId, reportHash: report.reportHash, policyVersion: candidate.policy.policyVersion }, payload: { approvedBy, reportHash: report.reportHash } });
    store.appendAudit({ at, actor: 'system', type: 'PolicyActivated', refs: { candidateId, policyVersion: candidate.policy.policyVersion }, payload: { previousVersion: active.policyVersion } });
    return { ...approved, status: 'active' };
  });
  return run.immediate();
}

/** Rollback is a NEW logged pointer transition to an earlier approved version; nothing is edited or deleted (INV-011). */
export function rollbackPolicy(store: Store, orgId: string, toVersion: number, by: string, deps: LifecycleDeps = {}): PolicyVersion {
  if (!by.trim()) throw new LifecycleError('APPROVER_REQUIRED', 'an authenticated owner is required');
  const at = clock(deps)().toISOString();
  const run = store.db.transaction((): PolicyVersion => {
    ensureVersionRecords(store, orgId, at);
    const currentVersion = store.getActivePolicyVersion(orgId);
    if (currentVersion === null) throw new LifecycleError('NO_ACTIVE_POLICY', 'there is no active policy');
    const target = store.getPolicyVersion(orgId, toVersion);
    if (!target || target.status !== 'superseded' || toVersion >= currentVersion) {
      throw new LifecycleError('ROLLBACK_TARGET_INVALID', 'the target must be an earlier approved version that was superseded');
    }
    const current = store.getPolicyVersion(orgId, currentVersion) as PolicyVersion;
    const transitionId = ids(deps)();
    store.savePolicyVersion(orgId, { ...current, status: 'rolled_back' });
    store.savePolicyVersion(orgId, { ...target, status: 'active' });
    store.setActivePolicy(orgId, toVersion, transitionId, at);
    store.appendAudit({ at, actor: 'owner', type: 'PolicyRolledBack', refs: { policyVersion: toVersion }, payload: { from: currentVersion, to: toVersion, transitionId, by } });
    return { ...target, status: 'active' };
  });
  return run.immediate();
}
