import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import {
  decisionSchema,
  paymentAttemptSchema,
  paymentOutcomeSchema,
  paymentPolicySchema,
  rawInterceptaSchema,
  riskEvidenceSchema,
  spendReservationSchema,
  parseAtomic,
  formatAtomic,
} from '@risksir/core';
import type {
  Decision,
  PaymentAttempt,
  PaymentOutcome,
  PaymentPolicy,
  RawIntercepta,
  RiskEvidence,
  SpendReservation,
} from '@risksir/core';

/**
 * Authoritative offchain state (SPEC section 6): a synchronous better-sqlite3 database, so every mutation is
 * serialised and multi-row invariants run inside one transaction. Every row is validated with the zod schemas
 * from @risksir/core on write and on read; an invalid row throws, which fails closed.
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
  id INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id TEXT NOT NULL, decision_id TEXT NOT NULL UNIQUE, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS counterparty_payments (
  org_id TEXT NOT NULL, pay_to TEXT NOT NULL, attempt_id TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (org_id, pay_to, attempt_id));
CREATE TABLE IF NOT EXISTS policies (org_id TEXT NOT NULL, policy_version INTEGER NOT NULL, json TEXT NOT NULL,
  PRIMARY KEY (org_id, policy_version));
CREATE TABLE IF NOT EXISTS active_pointer (
  org_id TEXT PRIMARY KEY, policy_version INTEGER NOT NULL, transition_id TEXT NOT NULL, updated_at TEXT NOT NULL);
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

/** The narrow view the protected signer gets: it can read what it must verify and record one signer call, nothing else. */
export interface SignerStore {
  getDecision(decisionId: string): Decision | null;
  getAttempt(attemptId: string): PaymentAttempt | null;
  getEvidence(evidenceId: string): RiskEvidence | null;
  getReservationForAttempt(attemptId: string): SpendReservation | null;
  getActivePolicyVersion(orgId: string): number | null;
  /** Atomic and single use per decision (INV-024). Returns false if this decision already produced a signer call. */
  recordSignerCall(p: { attemptId: string; decisionId: string; at: string }): boolean;
}

const parseJson = <T>(json: string, schema: { parse: (v: unknown) => T }): T => schema.parse(JSON.parse(json));

export class Store implements SignerStore {
  readonly db: Db;

  constructor(path: string = ':memory:') {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // ---- attempts ----
  saveAttempt(attempt: PaymentAttempt): void {
    const a = paymentAttemptSchema.parse(attempt);
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
    this.db.prepare('INSERT INTO evidence (evidence_id, address, json) VALUES (?, ?, ?)').run(e.evidenceId, e.address, JSON.stringify(e));
  }

  getEvidence(evidenceId: string): RiskEvidence | null {
    const row = this.db.prepare('SELECT json FROM evidence WHERE evidence_id = ?').get(evidenceId) as { json: string } | undefined;
    return row ? parseJson(row.json, riskEvidenceSchema) : null;
  }

  // ---- decisions ----
  saveDecision(decision: Decision): void {
    const d = decisionSchema.parse(decision);
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
      if (res.status === 'reserved' || res.status === 'reconciling') total += parseAtomic(res.amountAtomic);
      else if (res.status === 'committed') total += parseAtomic(res.committedAtomic ?? res.amountAtomic);
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

  private updateReservation(attemptId: string, from: SpendReservation['status'][], patch: Partial<SpendReservation>): SpendReservation {
    const current = this.getReservationForAttempt(attemptId);
    if (!current) throw new Error(`no reservation for attempt ${attemptId}`);
    if (!from.includes(current.status)) throw new Error(`illegal reservation transition ${current.status} -> ${String(patch.status)}`);
    const next = spendReservationSchema.parse({ ...current, ...patch });
    this.db.prepare('UPDATE reservations SET json = ? WHERE attempt_id = ?').run(JSON.stringify(next), attemptId);
    return next;
  }

  commitReservation(attemptId: string, committedAtomic: string): SpendReservation {
    return this.updateReservation(attemptId, ['reserved', 'reconciling'], { status: 'committed', committedAtomic });
  }

  /** Release only after confirmed non-settlement or an unused expired authorisation, never on an HTTP timeout alone. */
  releaseReservation(attemptId: string): SpendReservation {
    return this.updateReservation(attemptId, ['reserved', 'reconciling'], { status: 'released' });
  }

  markReconciling(attemptId: string): SpendReservation {
    return this.updateReservation(attemptId, ['reserved'], { status: 'reconciling' });
  }

  // ---- signer ledger (INV-024, INV-019) ----
  recordSignerCall(p: { attemptId: string; decisionId: string; at: string }): boolean {
    const run = this.db.transaction((): boolean => {
      const decision = this.getDecision(p.decisionId);
      if (!decision || decision.status !== 'open' || decision.attemptId !== p.attemptId) return false;
      try {
        this.db.prepare('INSERT INTO signer_calls (attempt_id, decision_id, at) VALUES (?, ?, ?)').run(p.attemptId, p.decisionId, p.at);
      } catch {
        return false; // UNIQUE(decision_id): a decision yields at most one signature
      }
      this.saveDecision({ ...decision, status: 'consumed' });
      const attempt = this.getAttempt(p.attemptId);
      if (!attempt || !attempt.quote) throw new Error('signer call recorded for an attempt without a quote');
      // saveAttempt validates INV-019 (signerInvokedAt must follow interceptaReturnedAt); a violation rolls everything back.
      this.saveAttempt({ ...attempt, status: 'signed', signerCalls: attempt.signerCalls + 1, signerInvokedAt: p.at });
      this.db
        .prepare('INSERT OR IGNORE INTO counterparty_payments (org_id, pay_to, attempt_id, at) VALUES (?, ?, ?, ?)')
        .run(attempt.orgId, attempt.quote.payTo, attempt.attemptId, p.at);
      return true;
    });
    return run.immediate();
  }

  signerCallCount(attemptId: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM signer_calls WHERE attempt_id = ?').get(attemptId) as { n: number }).n;
  }

  /** True when this organisation has never signed a payment to that address. */
  isFirstTimeCounterparty(orgId: string, payTo: string): boolean {
    return !this.db.prepare('SELECT 1 FROM counterparty_payments WHERE org_id = ? AND pay_to = ?').get(orgId, payTo.toLowerCase());
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

  setActivePolicy(orgId: string, version: number, transitionId: string, at: string): void {
    if (!this.getPolicy(orgId, version)) throw new Error(`policy v${version} does not exist`);
    this.db
      .prepare(
        `INSERT INTO active_pointer (org_id, policy_version, transition_id, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(org_id) DO UPDATE SET policy_version = excluded.policy_version,
           transition_id = excluded.transition_id, updated_at = excluded.updated_at`,
      )
      .run(orgId, version, transitionId, at);
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
