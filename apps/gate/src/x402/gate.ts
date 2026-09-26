import { randomUUID } from 'node:crypto';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import {
  APPROVAL_TTL_S,
  DECISION_TTL_S,
  decisionSchema,
  evaluateFailClosed,
  evaluateLocalFailClosed,
  formatAtomic,
  hashQuote,
} from '@risksir/core';
import type {
  Approval,
  AuditEvent,
  AuditType,
  Decision,
  EvaluateResult,
  PaymentAttempt,
  PaymentOutcome,
  ReasonCode,
  RiskEvidence,
} from '@risksir/core';
import type { ScreenResult } from '../intercepta/client.js';
import type { ProtectedSigner } from '../signer/public.js';
import type { Store } from '../store/store.js';
import { canonicalQuoteFrom } from './quote.js';

/**
 * The buyer gate: real 402 -> canonical quote -> LOCAL checks (no Intercepta call) -> LIVE Intercepta screen of the
 * exact payTo -> policy decision -> atomic budget reservation -> signing permit -> protected signer -> settlement record.
 * It runs inside the SDK's onBeforePaymentCreation hook, which fires after requirement selection and BEFORE any signing
 * (verified in the installed @x402/core 2.27.0 source); the protected signer independently refuses without an armed
 * permit (ADR-015, ADR-019). An `ASK_HUMAN` result parks the attempt in `awaiting_approval` (ADR-020).
 */
export interface BuyerTask {
  agentId: string;
  taskId: string;
  url: string;
  /** Service/task id used by policy predicates; chosen by the gate's typed scope, never by the seller. */
  service: string;
}

export interface GateDeps {
  orgId: string;
  store: Store;
  screen: (address: string) => Promise<ScreenResult>;
  signer: ProtectedSigner;
  now?: () => Date;
  newId?: () => string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  log?: (line: string) => void;
  /** Test seam: runs after the gate registers its own pre-sign hook, so tests can add adversarial hooks. Unused in production. */
  configureClient?: (client: x402Client) => void;
}

export interface AttemptResult {
  attempt: PaymentAttempt;
  decision: Decision | null;
  evidence: RiskEvidence | null;
  outcome: PaymentOutcome | null;
  response: { status: number; body: unknown } | null;
  /** True when Risksir refused to sign (HOLD/DENY/pending/CAP-below/expired/etc.). */
  blocked: boolean;
  /** True when the attempt is parked in `awaiting_approval` (ASK_HUMAN pending). */
  awaitingApproval: boolean;
}

type ResponseInfo = AttemptResult['response'];

const reasonText = (d: Decision): string => `${d.action}:${d.reasons.map((r) => r.code).join(',')}`;

export function createGate(deps: GateDeps) {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? randomUUID;
  const log = deps.log ?? (() => undefined);
  const { store } = deps;
  const iso = () => now().toISOString();

  /** Shared by a first attempt and an approval resume (`approval` set, attempt already `awaiting_approval`). */
  async function execute(attemptId: string, task: BuyerTask, approval: Approval | null): Promise<AttemptResult> {
    const resuming = approval !== null;
    const state: { decision: Decision | null; evidence: RiskEvidence | null } = { decision: null, evidence: null };

    /** Always re-reads the stored attempt: the signer path owns signerCalls, signerInvokedAt and status `signed`. */
    const save = (patch: Partial<PaymentAttempt>): PaymentAttempt => {
      const next = { ...(store.getAttempt(attemptId) as PaymentAttempt), ...patch };
      store.saveAttempt(next);
      return next;
    };
    const fail = (code: ReasonCode, message: string) => save({ status: 'failed', failure: { code, message } });
    const audit = (type: AuditType, refs: AuditEvent['refs'], payload: unknown) =>
      store.appendAudit({ at: iso(), actor: 'system', type, refs, payload });

    const finish = (blocked: boolean, resp: ResponseInfo = null): AttemptResult => {
      const attempt = store.getAttempt(attemptId) as PaymentAttempt;
      const outcome = store.getOutcomeForAttempt(attemptId);
      const result: AttemptResult = {
        attempt,
        decision: state.decision ? store.getDecision(state.decision.decisionId) : null,
        evidence: state.evidence,
        outcome,
        response: resp,
        blocked,
        awaitingApproval: attempt.status === 'awaiting_approval',
      };
      log(
        `attempt=${attemptId} status=${attempt.status} action=${result.decision?.action ?? '-'} ` +
          `signerCalls=${attempt.signerCalls} settlement=${outcome?.settlementStatus ?? 'none'} ` +
          `delivery=${outcome?.deliveryStatus ?? 'n/a'} tx=${outcome?.txHash ?? '-'}`,
      );
      return result;
    };

    const recordAmbiguous = (message: string, resp: ResponseInfo = null): AttemptResult => {
      const at = iso();
      store.saveOutcome({
        outcomeId: newId(),
        attemptId,
        settlementStatus: 'ambiguous',
        txHash: null,
        facilitatorRef: null,
        deliveryStatus: 'unknown',
        httpStatus: resp?.status ?? null,
        observedAt: at,
      });
      if (store.getReservationForAttempt(attemptId)?.status === 'reserved') store.markReconciling(attemptId);
      save({ status: 'submitted', submittedAt: at });
      audit('PaymentSubmitted', { attemptId }, { attemptId, ambiguous: true });
      save({ status: 'ambiguous', failure: { code: 'SIGNER_REFUSED', message } });
      return finish(false, resp);
    };

    const policy = store.getActivePolicy(deps.orgId);
    if (!policy) {
      fail('ENGINE_ERROR', 'no active policy');
      return finish(true);
    }
    if (!policy.profile.allowedServices.some((prefix) => task.url.startsWith(prefix))) {
      fail('SERVICE_NOT_ALLOWED', 'resource is not in the allowed services');
      return finish(true);
    }

    const attemptSigner = deps.signer.forAttempt(attemptId);
    const client = new x402Client();
    client.register('eip155:*', new ExactEvmScheme(attemptSigner));
    client.setSpendControls({ maxAmountPerPayment: '$0.10' });

    /** Records a Decision (superseding a previous open one on a resume) and moves the attempt to `decided`. */
    const recordDecision = (
      quoteHash: `0x${string}`,
      evidenceId: string | null,
      result: Pick<EvaluateResult, 'action' | 'reasons' | 'authorisedMaxAtomic' | 'signerEligible' | 'approvalId'>,
      decidedAt: Date,
    ): Decision => {
      const prior = store.getAttempt(attemptId)?.decisionId;
      const priorDecision = prior ? store.getDecision(prior) : null;
      if (priorDecision && priorDecision.status === 'open') store.saveDecision({ ...priorDecision, status: 'superseded' });
      const decision = decisionSchema.parse({
        decisionId: newId(),
        attemptId,
        quoteHash,
        policyVersion: policy.policyVersion,
        policyHash: policy.policyHash,
        evidenceId,
        action: result.action,
        reasons: result.reasons,
        authorisedMaxAtomic: result.authorisedMaxAtomic,
        signerEligible: result.signerEligible,
        approvalId: result.approvalId,
        decidedAt: decidedAt.toISOString(),
        expiresAt: new Date(decidedAt.getTime() + DECISION_TTL_S * 1000).toISOString(),
        status: 'open',
      });
      store.saveDecision(decision);
      state.decision = decision;
      save({ status: 'decided', decisionId: decision.decisionId, policyVersion: policy.policyVersion, decidedAt: decidedAt.toISOString() });
      audit(
        'PolicyDecided',
        { attemptId, decisionId: decision.decisionId, ...(evidenceId ? { evidenceId } : {}), policyVersion: policy.policyVersion },
        { attemptId, action: decision.action, reasons: decision.reasons, signerEligible: decision.signerEligible },
      );
      return decision;
    };

    /** A non-eligible decision either parks the attempt (ASK_HUMAN) or ends it. */
    const conclude = (decision: Decision, decidedAt: Date) => {
      if (decision.action === 'ASK_HUMAN') {
        const current = store.getAttempt(attemptId);
        const until = resuming && current?.awaitingApprovalUntil ? current.awaitingApprovalUntil : new Date(decidedAt.getTime() + APPROVAL_TTL_S * 1000).toISOString();
        save({ status: 'awaiting_approval', awaitingApprovalUntil: until });
      } else {
        fail(decision.reasons[0]?.code ?? 'ENGINE_ERROR', reasonText(decision));
      }
      return { abort: true as const, reason: reasonText(decision) };
    };

    client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
      const quote = canonicalQuoteFrom(selectedRequirements, { requestedUrl: task.url, attemptId });
      if (!quote) {
        fail('QUOTE_INVALID', 'selected requirement is not a valid quote');
        return { abort: true as const, reason: 'QUOTE_INVALID' };
      }
      const quoteHash = hashQuote(quote);
      if (approval && approval.quoteHash !== quoteHash) {
        // The resumed 402 differs from the quote the owner approved (INV-005, INV-028).
        save({ quote, quoteHash });
        fail('QUOTE_MUTATED', 'the resumed quote differs from the approved quote');
        return { abort: true as const, reason: 'QUOTE_MUTATED' };
      }
      save({ ...(resuming ? {} : { status: 'quoted' as const }), quote, quoteHash, quotedAt: iso() });
      audit('QuoteSelected', { attemptId }, { attemptId, quoteHash });

      // Stage A (ADR-022): local checks run BEFORE any Intercepta call. A rejected quote costs no live call.
      const localResult = evaluateLocalFailClosed(policy, quote);
      if (localResult) {
        const decidedAt = now();
        return conclude(recordDecision(quoteHash, null, localResult, decidedAt), decidedAt);
      }

      save({ interceptaRequestedAt: iso() });
      audit('RiskScreenRequested', { attemptId }, { attemptId, address: quote.payTo });
      const screened = await deps.screen(quote.payTo);
      if (screened.raw) store.saveRaw(screened.raw);
      store.saveEvidence(screened.evidence);
      state.evidence = screened.evidence;
      save({ ...(resuming ? {} : { status: 'screened' as const }), evidenceId: screened.evidence.evidenceId, interceptaReturnedAt: iso() });
      audit(
        screened.evidence.tier === 'UNAVAILABLE' ? 'RiskScreenUnavailable' : 'RiskScreenReturned',
        { attemptId, evidenceId: screened.evidence.evidenceId },
        { attemptId, tier: screened.evidence.tier, unavailable: screened.evidence.unavailable },
      );

      const decidedAt = now();
      const budget = store.periodBudgetRemaining({
        orgId: deps.orgId,
        periodCapAtomic: policy.profile.periodCapAtomic,
        periodSeconds: policy.profile.periodSeconds,
        nowIso: decidedAt.toISOString(),
      });
      let result = evaluateFailClosed({
        policy,
        quote,
        quoteHash,
        evidence: screened.evidence,
        context: {
          firstTimeCounterparty: store.isFirstTimeCounterparty(deps.orgId, quote.payTo),
          service: task.service,
          periodBudgetRemainingAtomic: formatAtomic(budget),
        },
        approval,
        now: decidedAt.toISOString(),
      });

      if (result.signerEligible) {
        // One serialised transaction re-checks used + amount <= cap (INV-007). A failed reservation downgrades the decision to HOLD.
        const reserved = store.reserve({
          reservationId: newId(),
          orgId: deps.orgId,
          attemptId,
          amountAtomic: quote.amountAtomic,
          periodCapAtomic: policy.profile.periodCapAtomic,
          periodSeconds: policy.profile.periodSeconds,
          nowIso: decidedAt.toISOString(),
          ttlSeconds: 300,
        });
        if (!reserved.ok) {
          result = { action: 'HOLD', reasons: [{ code: reserved.reason, ruleId: null }], authorisedMaxAtomic: null, signerEligible: false, approvalId: null };
        }
      }

      const decision = recordDecision(quoteHash, screened.evidence.evidenceId, result, decidedAt);
      if (!decision.signerEligible) return conclude(decision, decidedAt);

      // Arm the single-use signing permit (ADR-019); an approval is consumed when it leads to a permit.
      store.armPermit({
        permitId: newId(),
        attemptId,
        decisionId: decision.decisionId,
        quote,
        quoteHash,
        policyVersion: policy.policyVersion,
        armedAt: decidedAt.toISOString(),
        expiresAt: decision.expiresAt,
        status: 'armed',
      });
      if (decision.approvalId) store.consumeApproval(decision.approvalId);
      return undefined;
    });

    deps.configureClient?.(client);

    const httpClient = new x402HTTPClient(client);
    const paidFetch = wrapFetchWithPayment(deps.fetchImpl ?? fetch, httpClient);

    let response: Response | null = null;
    let thrown: unknown = null;
    try {
      response = await paidFetch(task.url, { method: 'GET', signal: AbortSignal.timeout(deps.requestTimeoutMs ?? 30_000) });
    } catch (err) {
      thrown = err;
    }

    const signed = (store.getAttempt(attemptId)?.signerCalls ?? 0) > 0;

    if (thrown !== null && !signed) {
      // No signature was produced: a hold/deny/pending/refusal/parse failure. Nothing was paid; free any reservation.
      const status = store.getAttempt(attemptId)?.status;
      if (status !== 'failed' && status !== 'awaiting_approval') {
        fail(state.decision ? 'SIGNER_REFUSED' : 'QUOTE_INVALID', (thrown as Error).message);
      }
      if (store.getReservationForAttempt(attemptId)?.status === 'reserved') store.releaseReservation(attemptId);
      return finish(true);
    }

    if (thrown !== null) {
      // Signed but the request then errored: settlement is unknown. Keep the reservation until reconciled (INV-014).
      return recordAmbiguous(`request failed after signing: ${(thrown as Error).message}`);
    }

    const res = response as Response;
    if (!signed) {
      // The resource never asked for payment, so there was no decision. Nothing to record as paid.
      fail('QUOTE_INVALID', `resource returned ${res.status} without requesting payment`);
      return finish(false);
    }

    let parsed: Awaited<ReturnType<typeof httpClient.processResponse>>;
    try {
      parsed = await httpClient.processResponse(res);
    } catch (err) {
      // Unreadable paid response: settlement is unknown. Keep the reservation until reconciled.
      return recordAmbiguous(`unreadable response after signing: ${(err as Error).message}`, { status: res.status, body: null });
    }
    const resp: ResponseInfo = { status: res.status, body: parsed.body };
    const observedAt = iso();
    const header = parsed.paymentStatus === 'settled' ? (parsed.header as { transaction?: string; success?: boolean } | undefined) : undefined;

    if (header?.success && /^0x[0-9a-fA-F]{64}$/.test(header.transaction ?? '')) {
      const received = res.ok && parsed.body !== null && parsed.body !== undefined;
      store.saveOutcome({
        outcomeId: newId(),
        attemptId,
        settlementStatus: 'settled',
        txHash: header.transaction as `0x${string}`,
        facilitatorRef: null,
        deliveryStatus: received ? 'received' : 'not_received',
        httpStatus: res.status,
        observedAt,
      });
      store.commitReservation(attemptId, store.getReservationForAttempt(attemptId)?.amountAtomic ?? '0');
      save({ status: 'submitted', submittedAt: observedAt });
      audit('PaymentSubmitted', { attemptId }, { attemptId });
      save({ status: 'settled', settledAt: observedAt });
      audit('SettlementObserved', { attemptId, txHash: header.transaction as `0x${string}` }, { attemptId, kind: 'settled' });
      audit('ResourceReturned', { attemptId }, { attemptId, delivery: received ? 'received' : 'not_received', status: res.status });
      return finish(false, resp);
    }

    if (parsed.paymentStatus === 'payment_required') {
      // The resource server rejected the payment at verification, so it was not settled: release the reservation.
      store.saveOutcome({ outcomeId: newId(), attemptId, settlementStatus: 'failed', txHash: null, facilitatorRef: null, deliveryStatus: 'not_received', httpStatus: res.status, observedAt });
      store.releaseReservation(attemptId);
      save({ status: 'submitted', submittedAt: observedAt });
      audit('PaymentSubmitted', { attemptId }, { attemptId });
      fail('SIGNER_REFUSED', 'payment rejected by the resource server');
      return finish(false, resp);
    }

    // settle_failed, or a paid retry without a settlement header: unknown. Keep the reservation until reconciled.
    return recordAmbiguous(`payment status ${parsed.paymentStatus}`, resp);
  }

  async function run(task: BuyerTask): Promise<AttemptResult> {
    const attemptId = newId();
    store.saveAttempt({
      attemptId,
      orgId: deps.orgId,
      agentId: task.agentId,
      taskId: task.taskId,
      resourceUrl: task.url,
      status: 'created',
      quote: null,
      quoteHash: null,
      policyVersion: null,
      evidenceId: null,
      decisionId: null,
      signerCalls: 0,
      createdAt: iso(),
      quotedAt: null,
      interceptaRequestedAt: null,
      interceptaReturnedAt: null,
      decidedAt: null,
      awaitingApprovalUntil: null,
      signerInvokedAt: null,
      submittedAt: null,
      settledAt: null,
      failure: null,
    });
    return execute(attemptId, task, null);
  }

  /**
   * Resumes an attempt parked in `awaiting_approval` with an owner approval (SPEC section 9, ADR-020, INV-028):
   * the approval must bind this attempt and the current policy version and be unexpired, the resumed 402 must hash to the
   * approved quote, a fresh live screen is made and the decision is re-evaluated under the current active policy.
   * Only a PAY result reserves, arms a permit and signs. Expiry or a policy change makes the attempt `expired`.
   */
  async function resumeWithApproval(attemptId: string, approvalId: string, task: BuyerTask): Promise<AttemptResult> {
    const attempt = store.getAttempt(attemptId);
    if (!attempt || attempt.status !== 'awaiting_approval') throw new Error('attempt is not awaiting approval');
    if (task.url !== attempt.resourceUrl) throw new Error('resume task does not match the attempt resource');
    const approval = store.getApproval(approvalId);
    if (!approval || approval.attemptId !== attemptId) throw new Error('approval does not bind this attempt');
    if (approval.status !== 'active') throw new Error(`approval is ${approval.status}`);

    const at = iso();
    const activeVersion = store.getActivePolicyVersion(deps.orgId);
    const expired =
      Date.parse(at) >= Date.parse(approval.expiresAt) || (attempt.awaitingApprovalUntil !== null && Date.parse(at) >= Date.parse(attempt.awaitingApprovalUntil));
    if (activeVersion !== approval.policyVersion || activeVersion !== attempt.policyVersion) {
      store.expireApproval(approvalId);
      store.expireAttempt(attemptId, 'POLICY_CHANGED', at);
      return finishExpired(attemptId);
    }
    if (expired) {
      store.expireApproval(approvalId);
      store.expireAttempt(attemptId, 'APPROVAL_EXPIRED', at);
      return finishExpired(attemptId);
    }
    return execute(attemptId, task, approval);
  }

  function finishExpired(attemptId: string): AttemptResult {
    const attempt = store.getAttempt(attemptId) as PaymentAttempt;
    log(`attempt=${attemptId} status=${attempt.status} signerCalls=${attempt.signerCalls} reason=${attempt.failure?.code ?? '-'}`);
    return {
      attempt,
      decision: attempt.decisionId ? store.getDecision(attempt.decisionId) : null,
      evidence: attempt.evidenceId ? store.getEvidence(attempt.evidenceId) : null,
      outcome: store.getOutcomeForAttempt(attemptId),
      response: null,
      blocked: true,
      awaitingApproval: false,
    };
  }

  /** Expires attempts whose approval window has elapsed without an approval. Returns the expired attempt ids. */
  function expireOverdue(): string[] {
    const at = iso();
    const expired: string[] = [];
    for (const a of store.listAttempts(deps.orgId)) {
      if (a.status === 'awaiting_approval' && a.awaitingApprovalUntil !== null && Date.parse(at) >= Date.parse(a.awaitingApprovalUntil)) {
        store.expireAttempt(a.attemptId, 'APPROVAL_EXPIRED', at);
        expired.push(a.attemptId);
      }
    }
    return expired;
  }

  return { run, resumeWithApproval, expireOverdue };
}

export type Gate = ReturnType<typeof createGate>;
