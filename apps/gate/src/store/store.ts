import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import {
  APPROVAL_TRANSITIONS,
  ATTEMPT_TRANSITIONS,
  DECISION_TRANSITIONS,
  PERMIT_TRANSITIONS,
  POLICY_VERSION_TRANSITIONS,
  RESERVATION_TRANSITIONS,
  assertSameProvenance,
  approvalSchema,
  assertTransition,
  candidatePolicySchema,
  auditEventSchema,
  decisionSchema,
  formatAtomic,
  hashAuditPayload,
  labelRevisionSchema,
  parseAtomic,
  paymentAttemptSchema,
  paymentCaseSchema,
  paymentOutcomeSchema,
  paymentPolicySchema,
  policyVersionSchema,
  rawInterceptaSchema,
  regressionReportSchema,
  riskEvidenceSchema,
  signingPermitSchema,
  spendReservationSchema,
} from '@risksir/core';
import type {
  Approval,
  AuditEvent,
  CandidatePolicy,
  AuditType,
  CaseLabel,
  Decision,
  Hex32,
  PaymentAttempt,
  PaymentCase,
  PaymentOutcome,
  PaymentPolicy,
  PolicyVersion,
  RawIntercepta,
  RegressionReport,
  RiskEvidence,
  SigningPermit,
  SpendReservation,
} from '@risksir/core';

/**
 * Authoritative offchain state (SPEC section 6): a synchronous better-sqlite3 database, so every mutation is
 * serialised and multi-row invariants run inside one transaction. Every row is validated with the zod schemas
 * from @risksir/core on write and on read; an invalid row throws, which fails closed. State machines (SPEC section 11)
 * are enforced on every write: an illegal transition throws and nothing is persisted.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS attempts (attempt_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, created_at TEXT NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS raw_intercepta (raw_id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS evidence (evidence_id TEXT PRIMARY KEY, address TEXT NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS decisions (decision_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reservations (
  reservation_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL UNIQUE, org_id TEXT NOT NULL,
  period_key INTEGER NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outcomes (outcome_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL UNIQUE, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS signer_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id TEXT NOT NULL, decision_id TEXT NOT NULL UNIQUE, at TEXT NOT NULL,
  auth_from TEXT, auth_nonce TEXT, valid_before TEXT);
CREATE TABLE IF NOT EXISTS counterparty_payments (
  org_id TEXT NOT NULL, pay_to TEXT NOT NULL, attempt_id TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (org_id, pay_to, attempt_id));
CREATE TABLE IF NOT EXISTS policies (org_id TEXT NOT NULL, policy_version INTEGER NOT NULL, json TEXT NOT NULL,
  PRIMARY KEY (org_id, policy_version));
CREATE TABLE IF NOT EXISTS active_pointer (
  org_id TEXT PRIMARY KEY, policy_version INTEGER NOT NULL, transition_id TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS permits (permit_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS approvals (approval_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cases (case_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS policy_versions (org_id TEXT NOT NULL, policy_version INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (org_id, policy_version));
CREATE TABLE IF NOT EXISTS candidates (candidate_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reports (report_hash TEXT PRIMARY KEY, org_id TEXT NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);
`;

export type ReserveResult =
  | { ok: true; reservation: SpendReservation }
  | { ok: false; reason: 'PERIOD_CAP_EXCEEDED' | 'RESERVATION_FAILED' };

export interface ReserveInput {
  reservationId: string;
  orgId: string;
  attemptId: string;
  amountAtomic: string;
  periodCapAtomic: string;
  periodSeconds: number;
  nowIso: string;
  ttlSeconds: number;
}

export interface SignerAuthorization {
  from: string;
  nonce: string;
  validBefore: bigint;
}

export interface AuditInput {
  at: string;
  actor: AuditEvent['actor'];
  type: AuditType;
  refs: AuditEvent['refs'];
  /** Hashed, never stored, so no payload detail can leak a secret into the audit trail. */
  payload: unknown;
}

/** The narrow view the protected signer gets: it can read what it must verify and record one signer call, nothing else. */
export interface SignerStore {
  getDecision(decisionId: string): Decision | null;
  getAttempt(attemptId: string): PaymentAttempt | null;
  getEvidence(evidenceId: string): RiskEvidence | null;
  getReservationForAttempt(attemptId: string): SpendReservation | null;
  getActivePolicyVersion(orgId: string): number | null;
  /** The most recently armed permit for the attempt, whatever its status. */
  getLatestPermit(attemptId: string): SigningPermit | null;
  appendAudit(input: AuditInput): AuditEvent;
  /**
   * Atomic and single use (INV-024, INV-027): the permit must be armed and is consumed together with the decision.
   * Returns false if the permit or decision was already used or is not in the right state.
   */
  recordSignerCall(p: { attemptId: string; decisionId: string; permitId: string; at: string; authorization?: SignerAuthorization }): boolean;
}

export type ReconciliationResult = { kind: 'settled'; txHash: Hex32; at: string } | { kind: 'not_settled'; at: string };

const parseJson = <T>(json: string, schema: { parse: (v: unknown) => T }): T => schema.parse(JSON.parse(json));

export class Store implements SignerStore {
  readonly db: Db;

  constructor(path: string = ':memory:') {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /** Adds columns introduced after a database file was first created. */
  private migrate(): void {
    const cols = (this.db.prepare('PRAGMA table_info(signer_calls)').all() as { name: string }[]).map((c) => c.name);
    for (const col of ['auth_from', 'auth_nonce', 'valid_before']) {
      if (!cols.includes(col)) this.db.exec(`ALTER TABLE signer_calls ADD COLUMN ${col} TEXT`);
    }
  }

  close(): void {
    this.db.close();
  }

  // ---- attempts ----
  saveAttempt(attempt: PaymentAttempt): void {
    const a = paymentAttemptSchema.parse(attempt);
    const existing = this.getAttempt(a.attemptId);
    if (existing) assertTransition('attempt', ATTEMPT_TRANSITIONS, existing.status, a.status);
    this.db
      .prepare(
        `INSERT INTO attempts (attempt_id, org_id, created_at, json) VALUES (?, ?, ?, ?)
         ON CONFLICT(attempt_id) DO UPDATE SET json = excluded.json`,
      )
      .run(a.attemptId, a.orgId, a.createdAt, JSON.stringify(a));
  }

  getAttempt(attemptId: string): PaymentAttempt | null {
    const row = this.db.prepare('SELECT json FROM attempts WHERE attempt_id = ?').get(attemptId) as { json: string } | undefined;
    return row ? parseJson(row.json, paymentAttemptSchema) : null;
  }

  listAttempts(orgId: string): PaymentAttempt[] {
    const rows = this.db.prepare('SELECT json FROM attempts WHERE org_id = ? ORDER BY created_at DESC, rowid DESC').all(orgId) as { json: string }[];
    return rows.map((r) => parseJson(r.json, paymentAttemptSchema));
  }

  // ---- evidence ----
  saveRaw(raw: RawIntercepta): void {
    const r = rawInterceptaSchema.parse(raw);
    this.db.prepare('INSERT INTO raw_intercepta (raw_id, json) VALUES (?, ?)').run(r.rawId, JSON.stringify(r));
  }

  getRaw(rawId: string): RawIntercepta | null {
    const row = this.db.prepare('SELECT json FROM raw_intercepta WHERE raw_id = ?').get(rawId) as { json: string } | undefined;
    return row ? parseJson(row.json, rawInterceptaSchema) : null;
  }

  saveEvidence(evidence: RiskEvidence): void {
    const e = riskEvidenceSchema.parse(evidence);
    const existing = this.getEvidence(e.evidenceId);
    if (existing) assertSameProvenance(existing.provenance, e.provenance, `evidence ${e.evidenceId}`);
    this.db.prepare('INSERT INTO evidence (evidence_id, address, json) VALUES (?, ?, ?)').run(e.evidenceId, e.address, JSON.stringify(e));
  }

  getEvidence(evidenceId: string): RiskEvidence | null {
    const row = this.db.prepare('SELECT json FROM evidence WHERE evidence_id = ?').get(evidenceId) as { json: string } | undefined;
    return row ? parseJson(row.json, riskEvidenceSchema) : null;
  }

  // ---- decisions ----
  saveDecision(decision: Decision): void {
    const d = decisionSchema.parse(decision);
    const existing = this.getDecision(d.decisionId);
    if (existing) {
      assertTransition('decision', DECISION_TRANSITIONS, existing.status, d.status);
      // A stored decision is immutable apart from its status: the binding (quote, version, action) can never change.
      const { status: _a, ...before } = existing;
      const { status: _b, ...after } = d;
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('a stored decision is immutable apart from its status');
    }
    this.db
      .prepare(
        `INSERT INTO decisions (decision_id, attempt_id, json) VALUES (?, ?, ?)
         ON CONFLICT(decision_id) DO UPDATE SET json = excluded.json`,
      )
      .run(d.decisionId, d.attemptId, JSON.stringify(d));
  }

  getDecision(decisionId: string): Decision | null {
    const row = this.db.prepare('SELECT json FROM decisions WHERE decision_id = ?').get(decisionId) as { json: string } | undefined;
    return row ? parseJson(row.json, decisionSchema) : null;
  }

  // ---- outcomes ----
  saveOutcome(outcome: PaymentOutcome): void {
    const o = paymentOutcomeSchema.parse(outcome);
    this.db
      .prepare(
        `INSERT INTO outcomes (outcome_id, attempt_id, json) VALUES (?, ?, ?)
         ON CONFLICT(attempt_id) DO UPDATE SET json = excluded.json`,
      )
      .run(o.outcomeId, o.attemptId, JSON.stringify(o));
  }

  getOutcomeForAttempt(attemptId: string): PaymentOutcome | null {
    const row = this.db.prepare('SELECT json FROM outcomes WHERE attempt_id = ?').get(attemptId) as { json: string } | undefined;
    return row ? parseJson(row.json, paymentOutcomeSchema) : null;
  }

  // ---- reservations (INV-007) ----
  private periodSpent(orgId: string, periodKey: number): bigint {
    const rows = this.db
      .prepare('SELECT json FROM reservations WHERE org_id = ? AND period_key = ?')
      .all(orgId, periodKey) as { json: string }[];
    let total = 0n;
    for (const r of rows) {
      const res = parseJson(r.json, spendReservationSchema);
      // SPEC section 12 (ADR-021): the reservation rows are the ONLY ledger; committed means settled, so it is not added twice.
      if (res.status === 'reserved' || res.status === 'reconciling' || res.status === 'committed') total += parseAtomic(res.amountAtomic);
    }
    return total;
  }

  periodKeyFor(nowIso: string, periodSeconds: number): number {
    return Math.floor(Date.parse(nowIso) / 1000 / periodSeconds);
  }

  periodBudgetRemaining(p: { orgId: string; periodCapAtomic: string; periodSeconds: number; nowIso: string }): bigint {
    const spent = this.periodSpent(p.orgId, this.periodKeyFor(p.nowIso, p.periodSeconds));
    const cap = parseAtomic(p.periodCapAtomic);
    return spent >= cap ? 0n : cap - spent;
  }

  /** Serialised: one BEGIN IMMEDIATE transaction checks reserved + reconciling + committed spend plus this amount against the cap. */
  reserve(p: ReserveInput): ReserveResult {
    const run = this.db.transaction((): ReserveResult => {
      const existing = this.db.prepare('SELECT 1 FROM reservations WHERE attempt_id = ?').get(p.attemptId);
      if (existing) return { ok: false, reason: 'RESERVATION_FAILED' };
      const periodKey = this.periodKeyFor(p.nowIso, p.periodSeconds);
      const amount = parseAtomic(p.amountAtomic);
      if (this.periodSpent(p.orgId, periodKey) + amount > parseAtomic(p.periodCapAtomic)) {
        return { ok: false, reason: 'PERIOD_CAP_EXCEEDED' };
      }
      const reservation = spendReservationSchema.parse({
        reservationId: p.reservationId,
        orgId: p.orgId,
        attemptId: p.attemptId,
        periodKey,
        amountAtomic: formatAtomic(amount),
        status: 'reserved',
        createdAt: p.nowIso,
        expiresAt: new Date(Date.parse(p.nowIso) + p.ttlSeconds * 1000).toISOString(),
        committedAtomic: null,
      });
      this.db
        .prepare('INSERT INTO reservations (reservation_id, attempt_id, org_id, period_key, json) VALUES (?, ?, ?, ?, ?)')
        .run(reservation.reservationId, reservation.attemptId, reservation.orgId, reservation.periodKey, JSON.stringify(reservation));
      return { ok: true, reservation };
    });
    return run.immediate();
  }

  getReservationForAttempt(attemptId: string): SpendReservation | null {
    const row = this.db.prepare('SELECT json FROM reservations WHERE attempt_id = ?').get(attemptId) as { json: string } | undefined;
    return row ? parseJson(row.json, spendReservationSchema) : null;
  }

  private updateReservation(attemptId: string, patch: Partial<SpendReservation> & Pick<SpendReservation, 'status'>): SpendReservation {
    const current = this.getReservationForAttempt(attemptId);
    if (!current) throw new Error(`no reservation for attempt ${attemptId}`);
    assertTransition('reservation', RESERVATION_TRANSITIONS, current.status, patch.status);
    const next = spendReservationSchema.parse({ ...current, ...patch });
    this.db.prepare('UPDATE reservations SET json = ? WHERE attempt_id = ?').run(JSON.stringify(next), attemptId);
    return next;
  }

  commitReservation(attemptId: string, committedAtomic: string): SpendReservation {
    const current = this.getReservationForAttempt(attemptId);
    // exact scheme: the settled amount is the reserved amount; a mismatch would break the single ledger
    if (current && current.amountAtomic !== committedAtomic) throw new Error('committed amount must equal the reserved amount for the exact scheme');
    return this.updateReservation(attemptId, { status: 'committed', committedAtomic });
  }

  /** Release only after confirmed non-settlement or an unused expired authorisation, never on an HTTP timeout alone. */
  releaseReservation(attemptId: string): SpendReservation {
    return this.updateReservation(attemptId, { status: 'released' });
  }

  markReconciling(attemptId: string): SpendReservation {
    return this.updateReservation(attemptId, { status: 'reconciling' });
  }

  listReservations(orgId: string): SpendReservation[] {
    const rows = this.db.prepare('SELECT json FROM reservations WHERE org_id = ? ORDER BY rowid').all(orgId) as { json: string }[];
    return rows.map((r) => parseJson(r.json, spendReservationSchema));
  }

  // ---- signer ledger (INV-024, INV-019) ----
  recordSignerCall(p: { attemptId: string; decisionId: string; permitId: string; at: string; authorization?: SignerAuthorization }): boolean {
    const run = this.db.transaction((): boolean => {
      const decision = this.getDecision(p.decisionId);
      if (!decision || decision.status !== 'open' || decision.attemptId !== p.attemptId) return false;
      const permit = this.getPermit(p.permitId);
      if (!permit || permit.status !== 'armed' || permit.attemptId !== p.attemptId || permit.decisionId !== p.decisionId) return false;
      try {
        this.db
          .prepare('INSERT INTO signer_calls (attempt_id, decision_id, at, auth_from, auth_nonce, valid_before) VALUES (?, ?, ?, ?, ?, ?)')
          .run(p.attemptId, p.decisionId, p.at, p.authorization?.from.toLowerCase() ?? null, p.authorization?.nonce ?? null, p.authorization?.validBefore.toString() ?? null);
      } catch {
        return false; // UNIQUE(decision_id): a decision yields at most one signature
      }
      this.saveDecision({ ...decision, status: 'consumed' });
      this.setPermitStatus(permit, 'consumed');
      const attempt = this.getAttempt(p.attemptId);
      if (!attempt || !attempt.quote) throw new Error('signer call recorded for an attempt without a quote');
      // saveAttempt validates INV-019 (signerInvokedAt must follow interceptaReturnedAt); a violation rolls everything back.
      this.saveAttempt({ ...attempt, status: 'signed', signerCalls: attempt.signerCalls + 1, signerInvokedAt: p.at });
      this.db
        .prepare('INSERT OR IGNORE INTO counterparty_payments (org_id, pay_to, attempt_id, at) VALUES (?, ?, ?, ?)')
        .run(attempt.orgId, attempt.quote.payTo, attempt.attemptId, p.at);
      this.appendAudit({
        at: p.at,
        actor: 'system',
        type: 'SignerInvoked',
        refs: { attemptId: p.attemptId, decisionId: p.decisionId },
        payload: { attemptId: p.attemptId, decisionId: p.decisionId, signerCalls: attempt.signerCalls + 1 },
      });
      return true;
    });
    return run.immediate();
  }

  signerCallCount(attemptId: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM signer_calls WHERE attempt_id = ?').get(attemptId) as { n: number }).n;
  }

  getSignerAuthorization(attemptId: string): SignerAuthorization | null {
    const row = this.db.prepare('SELECT auth_from, auth_nonce, valid_before FROM signer_calls WHERE attempt_id = ?').get(attemptId) as
      | { auth_from: string | null; auth_nonce: string | null; valid_before: string | null }
      | undefined;
    if (!row || !row.auth_from || !row.auth_nonce || !row.valid_before) return null;
    return { from: row.auth_from, nonce: row.auth_nonce, validBefore: BigInt(row.valid_before) };
  }

  /** True when this organisation has never signed a payment to that address. */
  isFirstTimeCounterparty(orgId: string, payTo: string): boolean {
    return !this.db.prepare('SELECT 1 FROM counterparty_payments WHERE org_id = ? AND pay_to = ?').get(orgId, payTo.toLowerCase());
  }

  // ---- reconciliation of an ambiguous settlement (INV-014) ----
  /** Applies chain evidence to an `ambiguous` attempt in one transaction: settled commits the reservation, not_settled releases it. */
  applyReconciliation(attemptId: string, result: ReconciliationResult, newId: () => string): void {
    const run = this.db.transaction(() => {
      const attempt = this.getAttempt(attemptId);
      if (!attempt || attempt.status !== 'ambiguous') throw new Error('only an ambiguous attempt can be reconciled');
      const previous = this.getOutcomeForAttempt(attemptId);
      const base = { outcomeId: previous?.outcomeId ?? newId(), attemptId, facilitatorRef: null, observedAt: result.at };
      if (result.kind === 'settled') {
        this.saveOutcome({ ...base, settlementStatus: 'settled', txHash: result.txHash, deliveryStatus: previous?.deliveryStatus ?? 'unknown', httpStatus: previous?.httpStatus ?? null });
        this.commitReservation(attemptId, attempt.quote?.amountAtomic ?? '0');
        this.saveAttempt({ ...attempt, status: 'settled', settledAt: result.at, failure: null });
        this.appendAudit({ at: result.at, actor: 'system', type: 'SettlementObserved', refs: { attemptId, txHash: result.txHash }, payload: { attemptId, kind: 'settled', reconciled: true } });
      } else {
        this.saveOutcome({ ...base, settlementStatus: 'failed', txHash: null, deliveryStatus: 'not_received', httpStatus: previous?.httpStatus ?? null });
        this.releaseReservation(attemptId);
        this.saveAttempt({ ...attempt, status: 'failed', failure: { code: 'SIGNER_REFUSED', message: 'authorisation expired unused (reconciled)' } });
        this.appendAudit({ at: result.at, actor: 'system', type: 'SettlementObserved', refs: { attemptId }, payload: { attemptId, kind: 'not_settled', reconciled: true } });
      }
    });
    run.immediate();
  }

  // ---- cases and label revisions (INV-020) ----
  saveCase(input: PaymentCase): void {
    const c = paymentCaseSchema.parse(input);
    if (this.getCase(c.caseId)) throw new Error(`case ${c.caseId} already exists: cases are immutable, labels are appended as revisions`);
    this.db.prepare('INSERT INTO cases (case_id, org_id, json) VALUES (?, ?, ?)').run(c.caseId, c.orgId, JSON.stringify(c));
  }

  getCase(caseId: string): PaymentCase | null {
    const row = this.db.prepare('SELECT json FROM cases WHERE case_id = ?').get(caseId) as { json: string } | undefined;
    return row ? parseJson(row.json, paymentCaseSchema) : null;
  }

  listCases(orgId: string): PaymentCase[] {
    const rows = this.db.prepare('SELECT json FROM cases WHERE org_id = ? ORDER BY case_id').all(orgId) as { json: string }[];
    return rows.map((r) => parseJson(r.json, paymentCaseSchema));
  }

  /** Appends a label revision; nothing is overwritten and provenance never changes. Returns the updated case. */
  appendLabel(caseId: string, p: { label: CaseLabel; labelledBy: 'owner' | 'seed_script'; rationale: string; at: string }): PaymentCase {
    const run = this.db.transaction((): PaymentCase => {
      const current = this.getCase(caseId);
      if (!current) throw new Error(`case ${caseId} not found`);
      const revision = labelRevisionSchema.parse({ revision: current.labelRevisions.length + 1, label: p.label, labelledBy: p.labelledBy, rationale: p.rationale, at: p.at });
      const next = paymentCaseSchema.parse({ ...current, label: p.label, labelRevisions: [...current.labelRevisions, revision] });
      assertSameProvenance(current.provenance, next.provenance, `case ${caseId}`);
      this.db.prepare('UPDATE cases SET json = ? WHERE case_id = ?').run(JSON.stringify(next), caseId);
      this.appendAudit({ at: p.at, actor: p.labelledBy === 'owner' ? 'owner' : 'system', type: 'IncidentLabelled', refs: { caseId }, payload: { caseId, revision: revision.revision, label: p.label } });
      return next;
    });
    return run.immediate();
  }

  // ---- audit trail (application events, explicitly offchain) ----
  appendAudit(input: AuditInput): AuditEvent {
    const run = this.db.transaction((): AuditEvent => {
      const nextSeq = ((this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM audit_events').get() as { m: number }).m) + 1;
      const event = auditEventSchema.parse({
        eventId: `evt-${nextSeq}`,
        seq: nextSeq,
        at: input.at,
        actor: input.actor,
        type: input.type,
        refs: input.refs,
        payloadHash: hashAuditPayload(input.payload),
      });
      this.db.prepare('INSERT INTO audit_events (seq, json) VALUES (?, ?)').run(event.seq, JSON.stringify(event));
      return event;
    });
    return run.immediate();
  }

  listAudit(): AuditEvent[] {
    const rows = this.db.prepare('SELECT json FROM audit_events ORDER BY seq').all() as { json: string }[];
    return rows.map((r) => parseJson(r.json, auditEventSchema));
  }

  // ---- signing permits (ADR-019, INV-027) ----
  /** Arms a single-use permit for one attempt. Refuses if another permit for the attempt is still armed. */
  armPermit(permit: SigningPermit): SigningPermit {
    const p = signingPermitSchema.parse(permit);
    if (p.status !== 'armed') throw new Error('a permit is armed as `armed`');
    const run = this.db.transaction((): SigningPermit => {
      const existing = this.getLatestPermit(p.attemptId);
      if (existing && existing.status === 'armed') throw new Error('an armed permit already exists for this attempt');
      this.db.prepare('INSERT INTO permits (permit_id, attempt_id, json) VALUES (?, ?, ?)').run(p.permitId, p.attemptId, JSON.stringify(p));
      this.appendAudit({ at: p.armedAt, actor: 'system', type: 'PermitArmed', refs: { attemptId: p.attemptId, decisionId: p.decisionId, policyVersion: p.policyVersion }, payload: { permitId: p.permitId, quoteHash: p.quoteHash } });
      return p;
    });
    return run.immediate();
  }

  getPermit(permitId: string): SigningPermit | null {
    const row = this.db.prepare('SELECT json FROM permits WHERE permit_id = ?').get(permitId) as { json: string } | undefined;
    return row ? parseJson(row.json, signingPermitSchema) : null;
  }

  getLatestPermit(attemptId: string): SigningPermit | null {
    const row = this.db.prepare('SELECT json FROM permits WHERE attempt_id = ? ORDER BY rowid DESC LIMIT 1').get(attemptId) as { json: string } | undefined;
    return row ? parseJson(row.json, signingPermitSchema) : null;
  }

  getArmedPermit(attemptId: string): SigningPermit | null {
    const latest = this.getLatestPermit(attemptId);
    return latest && latest.status === 'armed' ? latest : null;
  }

  private setPermitStatus(permit: SigningPermit, status: SigningPermit['status']): void {
    assertTransition('permit', PERMIT_TRANSITIONS, permit.status, status);
    this.db.prepare('UPDATE permits SET json = ? WHERE permit_id = ?').run(JSON.stringify({ ...permit, status }), permit.permitId);
  }

  revokePermit(permitId: string): void {
    const permit = this.getPermit(permitId);
    if (!permit) throw new Error(`permit ${permitId} not found`);
    this.setPermitStatus(permit, 'revoked');
  }

  // ---- owner approvals for ASK_HUMAN (ADR-020) ----
  saveApproval(input: Approval): Approval {
    const a = approvalSchema.parse(input);
    if (a.status !== 'active') throw new Error('a new approval is recorded as active');
    const run = this.db.transaction((): Approval => {
      if (this.getApproval(a.approvalId)) throw new Error(`approval ${a.approvalId} already exists`);
      this.db.prepare('INSERT INTO approvals (approval_id, attempt_id, json) VALUES (?, ?, ?)').run(a.approvalId, a.attemptId, JSON.stringify(a));
      this.appendAudit({ at: a.approvedAt, actor: 'owner', type: 'ApprovalRecorded', refs: { attemptId: a.attemptId, policyVersion: a.policyVersion }, payload: { approvalId: a.approvalId, quoteHash: a.quoteHash } });
      return a;
    });
    return run.immediate();
  }

  getApproval(approvalId: string): Approval | null {
    const row = this.db.prepare('SELECT json FROM approvals WHERE approval_id = ?').get(approvalId) as { json: string } | undefined;
    return row ? parseJson(row.json, approvalSchema) : null;
  }

  private setApprovalStatus(approval: Approval, status: Approval['status']): Approval {
    assertTransition('approval', APPROVAL_TRANSITIONS, approval.status, status);
    const next = { ...approval, status };
    this.db.prepare('UPDATE approvals SET json = ? WHERE approval_id = ?').run(JSON.stringify(next), approval.approvalId);
    return next;
  }

  consumeApproval(approvalId: string): Approval {
    const a = this.getApproval(approvalId);
    if (!a) throw new Error(`approval ${approvalId} not found`);
    return this.setApprovalStatus(a, 'consumed');
  }

  expireApproval(approvalId: string): Approval {
    const a = this.getApproval(approvalId);
    if (!a) throw new Error(`approval ${approvalId} not found`);
    return this.setApprovalStatus(a, 'expired');
  }

  /** Moves an `awaiting_approval` attempt to the terminal `expired` state and records why (approval/window expiry or policy change). */
  expireAttempt(attemptId: string, code: 'APPROVAL_EXPIRED' | 'POLICY_CHANGED', at: string): PaymentAttempt {
    const run = this.db.transaction((): PaymentAttempt => {
      const attempt = this.getAttempt(attemptId);
      if (!attempt || attempt.status !== 'awaiting_approval') throw new Error('only an attempt awaiting approval can expire');
      const next = { ...attempt, status: 'expired' as const, failure: { code, message: code === 'POLICY_CHANGED' ? 'active policy version changed while awaiting approval' : 'approval or approval window expired' } };
      this.saveAttempt(next);
      const decision = attempt.decisionId ? this.getDecision(attempt.decisionId) : null;
      if (decision && decision.status === 'open') this.saveDecision({ ...decision, status: 'superseded' });
      this.appendAudit({ at, actor: 'system', type: 'AttemptExpired', refs: { attemptId }, payload: { attemptId, code } });
      return next;
    });
    return run.immediate();
  }

  // ---- policy lifecycle records (SPEC section 11, INV-010, INV-011) ----
  getPolicyVersion(orgId: string, version: number): PolicyVersion | null {
    const row = this.db.prepare('SELECT json FROM policy_versions WHERE org_id = ? AND policy_version = ?').get(orgId, version) as { json: string } | undefined;
    return row ? parseJson(row.json, policyVersionSchema) : null;
  }

  listPolicyVersions(orgId: string): PolicyVersion[] {
    const rows = this.db.prepare('SELECT json FROM policy_versions WHERE org_id = ? ORDER BY policy_version').all(orgId) as { json: string }[];
    return rows.map((r) => parseJson(r.json, policyVersionSchema));
  }

  /** Inserts a version record, or moves an existing one along the legal transitions only. */
  savePolicyVersion(orgId: string, record: PolicyVersion): void {
    const r = policyVersionSchema.parse(record);
    const existing = this.getPolicyVersion(orgId, r.policyVersion);
    if (existing) {
      assertTransition('policy version', POLICY_VERSION_TRANSITIONS, existing.status, r.status);
      // an approved version is immutable: only its status may move (INV-011)
      const { status: _a, ...before } = existing;
      const { status: _b, ...after } = r;
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('an approved policy version is immutable apart from its status');
    }
    this.db
      .prepare('INSERT INTO policy_versions (org_id, policy_version, json) VALUES (?, ?, ?) ON CONFLICT(org_id, policy_version) DO UPDATE SET json = excluded.json')
      .run(orgId, r.policyVersion, JSON.stringify(r));
  }

  /** The next free version number: monotonic, so a rolled-back number is never reused. */
  nextPolicyVersion(orgId: string): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(policy_version), 0) AS m FROM policies WHERE org_id = ?').get(orgId) as { m: number };
    return row.m + 1;
  }

  // ---- candidates and regression reports ----
  saveCandidate(orgId: string, candidate: CandidatePolicy): void {
    const c = candidatePolicySchema.parse(candidate);
    this.db
      .prepare('INSERT INTO candidates (candidate_id, org_id, json) VALUES (?, ?, ?) ON CONFLICT(candidate_id) DO UPDATE SET json = excluded.json')
      .run(c.candidateId, orgId, JSON.stringify(c));
  }

  getCandidate(candidateId: string): CandidatePolicy | null {
    const row = this.db.prepare('SELECT json FROM candidates WHERE candidate_id = ?').get(candidateId) as { json: string } | undefined;
    return row ? parseJson(row.json, candidatePolicySchema) : null;
  }

  listCandidates(orgId: string): CandidatePolicy[] {
    const rows = this.db.prepare('SELECT json FROM candidates WHERE org_id = ? ORDER BY rowid').all(orgId) as { json: string }[];
    return rows.map((r) => parseJson(r.json, candidatePolicySchema));
  }

  /** Reports are immutable and content-addressed: the same inputs give the same hash and the same row. */
  saveReport(orgId: string, report: RegressionReport): void {
    const r = regressionReportSchema.parse(report);
    this.db.prepare('INSERT OR IGNORE INTO reports (report_hash, org_id, json) VALUES (?, ?, ?)').run(r.reportHash, orgId, JSON.stringify(r));
  }

  getReport(reportHash: string): RegressionReport | null {
    const row = this.db.prepare('SELECT json FROM reports WHERE report_hash = ?').get(reportHash) as { json: string } | undefined;
    return row ? parseJson(row.json, regressionReportSchema) : null;
  }

  listReports(orgId: string): RegressionReport[] {
    const rows = this.db.prepare('SELECT json FROM reports WHERE org_id = ? ORDER BY rowid').all(orgId) as { json: string }[];
    return rows.map((r) => parseJson(r.json, regressionReportSchema));
  }

  totalSignerCalls(orgId: string): number {
    return this.listAttempts(orgId).reduce((n, a) => n + a.signerCalls, 0);
  }

  // ---- policies ----
  putPolicy(orgId: string, policy: PaymentPolicy): void {
    const p = paymentPolicySchema.parse(policy);
    this.db
      .prepare('INSERT INTO policies (org_id, policy_version, json) VALUES (?, ?, ?)')
      .run(orgId, p.policyVersion, JSON.stringify(p));
  }

  getPolicy(orgId: string, version: number): PaymentPolicy | null {
    const row = this.db.prepare('SELECT json FROM policies WHERE org_id = ? AND policy_version = ?').get(orgId, version) as { json: string } | undefined;
    return row ? parseJson(row.json, paymentPolicySchema) : null;
  }

  /**
   * Moves the active pointer in one transaction (INV-017): armed permits and open decisions of other policy versions
   * are revoked/superseded, and attempts still `awaiting_approval` under another version become `expired`.
   */
  setActivePolicy(orgId: string, version: number, transitionId: string, at: string): void {
    if (!this.getPolicy(orgId, version)) throw new Error(`policy v${version} does not exist`);
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO active_pointer (org_id, policy_version, transition_id, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(org_id) DO UPDATE SET policy_version = excluded.policy_version,
             transition_id = excluded.transition_id, updated_at = excluded.updated_at`,
        )
        .run(orgId, version, transitionId, at);
      for (const attempt of this.listAttempts(orgId)) {
        const permit = this.getLatestPermit(attempt.attemptId);
        if (permit && permit.status === 'armed' && permit.policyVersion !== version) {
          this.setPermitStatus(permit, 'revoked');
          const decision = this.getDecision(permit.decisionId);
          if (decision && decision.status === 'open') this.saveDecision({ ...decision, status: 'superseded' });
        }
        if (attempt.status === 'awaiting_approval' && attempt.policyVersion !== null && attempt.policyVersion !== version) {
          this.expireAttempt(attempt.attemptId, 'POLICY_CHANGED', at);
        }
      }
    });
    run.immediate();
  }

  getActivePolicyVersion(orgId: string): number | null {
    const row = this.db.prepare('SELECT policy_version AS v FROM active_pointer WHERE org_id = ?').get(orgId) as { v: number } | undefined;
    return row ? row.v : null;
  }

  getActivePolicy(orgId: string): PaymentPolicy | null {
    const v = this.getActivePolicyVersion(orgId);
    return v === null ? null : this.getPolicy(orgId, v);
  }
}
