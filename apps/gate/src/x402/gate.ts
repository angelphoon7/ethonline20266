import { randomUUID } from 'node:crypto';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { DECISION_TTL_S, decisionSchema, evaluateFailClosed, formatAtomic, hashQuote } from '@risksir/core';
import type { Decision, PaymentAttempt, PaymentOutcome, ReasonCode, RiskEvidence } from '@risksir/core';
import type { ScreenResult } from '../intercepta/client.js';
import type { ProtectedSigner } from '../signer/public.js';
import type { Store } from '../store/store.js';
import { canonicalQuoteFrom } from './quote.js';

/**
 * The buyer gate: real 402 -> canonical quote -> LIVE Intercepta screen of the exact payTo -> policy decision ->
 * atomic budget reservation -> protected signer -> settlement record. It runs inside the SDK's
 * onBeforePaymentCreation hook, which fires after requirement selection and BEFORE any signing (verified in the
 * installed @x402/core 2.27.0 source); the protected signer independently refuses without a bound decision (ADR-015).
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
}

type ResponseInfo = AttemptResult['response'];

const reasonText = (d: Decision): string => `${d.action}:${d.reasons.map((r) => r.code).join(',')}`;

export function createGate(deps: GateDeps) {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? randomUUID;
  const log = deps.log ?? (() => undefined);
  const { store } = deps;
  const iso = () => now().toISOString();

  async function run(task: BuyerTask): Promise<AttemptResult> {
    const attemptId = newId();
    const state: { decision: Decision | null; evidence: RiskEvidence | null } = { decision: null, evidence: null };

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
      signerInvokedAt: null,
      submittedAt: null,
      settledAt: null,
      failure: null,
    });

    /** Always re-reads the stored attempt: the signer path owns signerCalls, signerInvokedAt and status `signed`. */
    const save = (patch: Partial<PaymentAttempt>): PaymentAttempt => {
      const next = { ...(store.getAttempt(attemptId) as PaymentAttempt), ...patch };
      store.saveAttempt(next);
      return next;
    };
    const fail = (code: ReasonCode, message: string) => save({ status: 'failed', failure: { code, message } });

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

    client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
      const quote = canonicalQuoteFrom(selectedRequirements, { requestedUrl: task.url, attemptId });
      if (!quote) {
        fail('QUOTE_INVALID', 'selected requirement is not a valid quote');
        return { abort: true as const, reason: 'QUOTE_INVALID' };
      }
      const quoteHash = hashQuote(quote);
      save({ status: 'quoted', quote, quoteHash, quotedAt: iso() });

      // Every parseable quote is screened live, even one a local check will deny, so every Decision carries evidence (INV-009).
      save({ interceptaRequestedAt: iso() });
      const screened = await deps.screen(quote.payTo);
      if (screened.raw) store.saveRaw(screened.raw);
      store.saveEvidence(screened.evidence);
      state.evidence = screened.evidence;
      save({ status: 'screened', evidenceId: screened.evidence.evidenceId, interceptaReturnedAt: iso() });

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
        approval: null,
        now: decidedAt.toISOString(),
      });

      if (result.signerEligible) {
        // Reserve atomically (serialised) before any signer call (INV-007). A failed reservation downgrades the decision to HOLD.
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

      const decision = decisionSchema.parse({
        decisionId: newId(),
        attemptId,
        quoteHash,
        policyVersion: policy.policyVersion,
        policyHash: policy.policyHash,
        evidenceId: screened.evidence.evidenceId,
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

      if (!decision.signerEligible) {
        fail(decision.reasons[0]?.code ?? 'ENGINE_ERROR', reasonText(decision));
        return { abort: true as const, reason: reasonText(decision) };
      }
      attemptSigner.authorise(decision.decisionId);
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
      // No signature was produced: a hold/deny/refusal/parse failure. Nothing was paid; free any reservation.
      if (store.getAttempt(attemptId)?.status !== 'failed') {
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
      store.commitReservation(attemptId, (store.getAttempt(attemptId)?.quote?.amountAtomic ?? '0'));
      save({ status: 'submitted', submittedAt: observedAt });
      save({ status: 'settled', settledAt: observedAt });
      return finish(false, resp);
    }

    if (parsed.paymentStatus === 'payment_required') {
      // The resource server rejected the payment at verification, so it was not settled: release the reservation.
      store.saveOutcome({ outcomeId: newId(), attemptId, settlementStatus: 'failed', txHash: null, facilitatorRef: null, deliveryStatus: 'not_received', httpStatus: res.status, observedAt });
      store.releaseReservation(attemptId);
      save({ status: 'submitted', submittedAt: observedAt });
      fail('SIGNER_REFUSED', 'payment rejected by the resource server');
      return finish(false, resp);
    }

    // settle_failed, or a paid retry without a settlement header: unknown. Keep the reservation until reconciled.
    return recordAmbiguous(`payment status ${parsed.paymentStatus}`, resp);
  }

  return { run };
}

export type Gate = ReturnType<typeof createGate>;
