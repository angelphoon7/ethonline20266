import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { APPROVAL_TTL_S, atomicAmountSchema, caseLabelSchema, hex32Schema, ruleSchema } from '@risksir/core';
import type { Approval, PaymentAttempt, RiskEvidence } from '@risksir/core';
import { SCENARIOS } from '../agent/runner.js';
import type { ScenarioName } from '../agent/runner.js';
import { LifecycleError, approveCandidate, createCandidate, replayCandidate, rollbackPolicy } from '../policy/lifecycle.js';
import type { Store } from '../store/store.js';
import type { AttemptResult } from '../x402/gate.js';

/**
 * Owner HTTP API (SPEC section 19). Hackathon-grade but real authentication (INV-026): EVERY route under /api requires
 * `Authorization: Bearer <OWNER_CONSOLE_TOKEN>`, compared in constant time; an unauthenticated request learns nothing
 * about which routes exist. The buyer agent has no route here and holds no owner token. Bodies are validated with zod.
 * Localhost only (OPERATIONAL_GUARDRAILS section 9): the CLI binds 127.0.0.1.
 */
export interface ApiDeps {
  store: Store;
  orgId: string;
  ownerToken: string;
  now?: () => Date;
  newId?: () => string;
  /** Continues an attempt awaiting approval (fresh live screen, re-evaluation, PAY only). Wired with the live gate in M-010. */
  resumeApproval?: (attemptId: string, approvalId: string) => Promise<AttemptResult>;
  /** Runs a named demo scenario within the live limits. Wired in M-010/M-011. */
  runScenario?: (name: ScenarioName) => Promise<AttemptResult>;
}

/** Every registered route, for tests and docs. Authentication is applied to the whole /api router before any of them. */
export const ROUTES = [
  ['GET', '/api/state'],
  ['GET', '/api/policies'],
  ['GET', '/api/attempts'],
  ['GET', '/api/attempts/:id'],
  ['POST', '/api/agent/run'],
  ['GET', '/api/cases'],
  ['POST', '/api/cases/:id/label'],
  ['GET', '/api/candidates'],
  ['POST', '/api/candidates'],
  ['POST', '/api/candidates/:id/replay'],
  ['POST', '/api/candidates/:id/approve'],
  ['GET', '/api/reports/:hash'],
  ['POST', '/api/policy/rollback'],
  ['POST', '/api/approvals'],
  ['GET', '/api/audit'],
] as const;

export const TIER_LABEL = 'Risksir tier (policy threshold ADR-017), not an Intercepta verdict';

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();
/** Constant-time comparison of two strings of any length (both are hashed to a fixed length first). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

const MIN_TOKEN_LENGTH = 16;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

const labelBody = z.strictObject({ label: caseLabelSchema, rationale: z.string().trim().min(1).max(500) });
const candidateBody = z.strictObject({
  rules: z.array(ruleSchema).max(50),
  defaultAction: z.enum(['HOLD', 'ASK_HUMAN', 'DENY']),
  rationale: z.string().max(1000),
  originatingCaseIds: z.array(z.string().min(1)).max(50),
});
const approveBody = z.strictObject({ reportHash: hex32Schema });
const rollbackBody = z.strictObject({ toVersion: z.number().int().min(1) });
const runBody = z.strictObject({ scenario: z.enum(Object.keys(SCENARIOS) as [ScenarioName, ...ScenarioName[]]) });
const approvalBody = z.strictObject({ attemptId: z.string().min(1), quoteHash: hex32Schema, maxAmountAtomic: atomicAmountSchema.optional() });

const presentEvidence = (e: RiskEvidence | null) => (e ? { ...e, tierLabel: TIER_LABEL } : null);

function presentResult(r: AttemptResult) {
  return {
    attemptId: r.attempt.attemptId,
    status: r.attempt.status,
    action: r.decision?.action ?? null,
    reasons: r.decision?.reasons.map((x) => x.code) ?? [],
    signerCalls: r.attempt.signerCalls,
    settlement: r.outcome?.settlementStatus ?? 'none',
    delivery: r.outcome?.deliveryStatus ?? null,
    txHash: r.outcome?.txHash ?? null,
  };
}

export function createOwnerApi(deps: ApiDeps): Express {
  if (deps.ownerToken.length < MIN_TOKEN_LENGTH) throw new Error(`OWNER_CONSOLE_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
  const { store, orgId } = deps;
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? randomUUID;

  const app = express();
  app.disable('x-powered-by');
  const api = express.Router();

  // 1. Authentication first, for the whole router, before any body is parsed or any route is matched (INV-026).
  api.use((req: Request, res: Response, next: NextFunction) => {
    const header = req.header('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match || !safeEqual((match[1] as string).trim(), deps.ownerToken)) {
      res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'unauthorised' });
      return;
    }
    next();
  });
  api.use(express.json({ limit: '64kb' }));

  const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
    const r = schema.safeParse(body);
    if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), 'BAD_REQUEST');
    return r.data;
  };
  const handler = (fn: (req: Request, res: Response) => unknown | Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };

  api.get('/state', handler((_req, res) => {
    const active = store.getActivePolicy(orgId);
    const attempts = store.listAttempts(orgId);
    res.json({
      orgId,
      network: 'eip155:84532',
      activePolicy: active && { policyVersion: active.policyVersion, policyHash: active.policyHash, profile: active.profile, defaultAction: active.defaultAction, rules: active.rules },
      signerCallsTotal: store.totalSignerCalls(orgId),
      attempts: attempts.length,
      awaitingApproval: attempts.filter((a) => a.status === 'awaiting_approval').length,
      cases: store.listCases(orgId).length,
    });
  }));

  api.get('/policies', handler((_req, res) => {
    res.json({ versions: store.listPolicyVersions(orgId), activeVersion: store.getActivePolicyVersion(orgId) });
  }));

  const summary = (a: PaymentAttempt) => {
    const decision = a.decisionId ? store.getDecision(a.decisionId) : null;
    return { attemptId: a.attemptId, status: a.status, policyVersion: a.policyVersion, action: decision?.action ?? null, signerCalls: a.signerCalls, createdAt: a.createdAt, payTo: a.quote?.payTo ?? null, amountAtomic: a.quote?.amountAtomic ?? null };
  };
  api.get('/attempts', handler((_req, res) => void res.json({ attempts: store.listAttempts(orgId).map(summary) })));

  api.get('/attempts/:id', handler((req, res) => {
    const attempt = store.getAttempt(String(req.params.id));
    if (!attempt || attempt.orgId !== orgId) throw new HttpError(404, 'attempt not found', 'NOT_FOUND');
    const decision = attempt.decisionId ? store.getDecision(attempt.decisionId) : null;
    const evidence = attempt.evidenceId ? store.getEvidence(attempt.evidenceId) : null;
    const permit = store.getLatestPermit(attempt.attemptId);
    res.json({
      attempt,
      decision,
      evidence: presentEvidence(evidence),
      outcome: store.getOutcomeForAttempt(attempt.attemptId),
      permit: permit && { permitId: permit.permitId, status: permit.status, expiresAt: permit.expiresAt },
      // the signer section appears only if the signer was called: no signer timestamp is ever invented (SPEC section 20)
      signer: attempt.signerCalls > 0 ? { calls: attempt.signerCalls, invokedAt: attempt.signerInvokedAt } : { calls: 0, invokedAt: null },
      audit: store.listAudit().filter((e) => e.refs.attemptId === attempt.attemptId),
    });
  }));

  api.post('/agent/run', handler(async (req, res) => {
    const { scenario } = parse(runBody, req.body);
    if (!deps.runScenario) throw new HttpError(501, 'no scenario runner is wired in this process', 'NOT_IMPLEMENTED');
    res.json(presentResult(await deps.runScenario(scenario)));
  }));

  api.get('/cases', handler((_req, res) => void res.json({ cases: store.listCases(orgId) })));

  api.post('/cases/:id/label', handler((req, res) => {
    const body = parse(labelBody, req.body);
    const id = String(req.params.id);
    if (!store.getCase(id)) throw new HttpError(404, 'case not found', 'NOT_FOUND');
    res.json(store.appendLabel(id, { label: body.label, labelledBy: 'owner', rationale: body.rationale, at: now().toISOString() }));
  }));

  api.get('/candidates', handler((_req, res) => void res.json({ candidates: store.listCandidates(orgId) })));

  api.post('/candidates', handler((req, res) => {
    const body = parse(candidateBody, req.body);
    res.status(201).json(createCandidate(store, orgId, { ...body, generatedBy: 'owner' }, { now, newId }));
  }));

  api.post('/candidates/:id/replay', handler((req, res) => {
    res.json(replayCandidate(store, orgId, String(req.params.id), { now, newId }));
  }));

  api.post('/candidates/:id/approve', handler((req, res) => {
    const { reportHash } = parse(approveBody, req.body);
    // The only approver identity is the authenticated owner: nothing in the body can name someone else (INV-016).
    res.json(approveCandidate(store, orgId, String(req.params.id), reportHash, 'owner', { now, newId }));
  }));

  api.get('/reports/:hash', handler((req, res) => {
    const report = store.getReport(String(req.params.hash));
    if (!report) throw new HttpError(404, 'report not found', 'NOT_FOUND');
    res.json(report);
  }));

  api.post('/policy/rollback', handler((req, res) => {
    const { toVersion } = parse(rollbackBody, req.body);
    res.json(rollbackPolicy(store, orgId, toVersion, 'owner', { now, newId }));
  }));

  api.post('/approvals', handler(async (req, res) => {
    const body = parse(approvalBody, req.body);
    const attempt = store.getAttempt(body.attemptId);
    if (!attempt || attempt.orgId !== orgId) throw new HttpError(404, 'attempt not found', 'NOT_FOUND');
    if (attempt.status !== 'awaiting_approval') throw new HttpError(409, `attempt is ${attempt.status}, not awaiting approval`, 'NOT_AWAITING');
    const at = now();
    if (attempt.policyVersion !== store.getActivePolicyVersion(orgId)) {
      store.expireAttempt(attempt.attemptId, 'POLICY_CHANGED', at.toISOString());
      throw new HttpError(409, 'the active policy changed: the attempt expired', 'POLICY_CHANGED');
    }
    if (attempt.awaitingApprovalUntil !== null && at.getTime() >= Date.parse(attempt.awaitingApprovalUntil)) {
      store.expireAttempt(attempt.attemptId, 'APPROVAL_EXPIRED', at.toISOString());
      throw new HttpError(409, 'the approval window elapsed: the attempt expired', 'APPROVAL_EXPIRED');
    }
    // The owner approves exactly the quote shown to them: the hash they send must equal the stored one (INV-005, INV-028).
    if (attempt.quoteHash !== body.quoteHash) throw new HttpError(409, 'quoteHash does not match the attempt quote', 'QUOTE_MISMATCH');
    const approval: Approval = {
      approvalId: newId(),
      attemptId: attempt.attemptId,
      quoteHash: attempt.quoteHash,
      policyVersion: attempt.policyVersion as number,
      maxAmountAtomic: body.maxAmountAtomic ?? (attempt.quote?.amountAtomic as string),
      approvedAt: at.toISOString(),
      expiresAt: new Date(at.getTime() + APPROVAL_TTL_S * 1000).toISOString(),
      status: 'active',
    };
    store.saveApproval(approval);
    if (!deps.resumeApproval) {
      res.status(201).json({ approval, resumed: false });
      return;
    }
    res.status(201).json({ approval, resumed: true, result: presentResult(await deps.resumeApproval(attempt.attemptId, approval.approvalId)) });
  }));

  api.get('/audit', handler((_req, res) => void res.json({ events: store.listAudit() })));

  app.use('/api', api);
  app.use((_req, res) => void res.status(404).json({ error: 'not found' }));

  // Error mapping: no stack, no message from unexpected errors (they could contain internals).
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message, code: err.code });
    if (err instanceof LifecycleError) {
      const status = err.code === 'CANDIDATE_NOT_FOUND' ? 404 : err.code === 'CANDIDATE_INVALID' || err.code === 'APPROVER_REQUIRED' ? 400 : 409;
      return void res.status(status).json({ error: err.message, code: err.code });
    }
    if (typeof err === 'object' && err !== null && (err as { type?: string }).type === 'entity.parse.failed') return void res.status(400).json({ error: 'invalid JSON body', code: 'BAD_REQUEST' });
    if (typeof err === 'object' && err !== null && (err as { type?: string }).type === 'entity.too.large') return void res.status(413).json({ error: 'body too large' });
    console.error(`owner-api: unexpected ${err instanceof Error ? err.name : 'error'}`);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
