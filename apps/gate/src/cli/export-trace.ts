/**
 * Prints every stored decision trace as JSON: quote, Intercepta evidence with provenance and timestamps, policy version,
 * action and reasons, signer-call ledger, settlement and delivery. Read-only; secrets are never stored, so none appear.
 * Run: corepack pnpm trace:export > docs/evidence/<file>.json
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_ORG_ID } from '@risksir/core';
import { CHAIN } from '../chain.js';
import { Store } from '../store/store.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const store = new Store(join(root, 'data', 'risksir.db'));
const traces = store
  .listAttempts(DEMO_ORG_ID)
  .reverse()
  .map((attempt) => {
    const decision = attempt.decisionId ? store.getDecision(attempt.decisionId) : null;
    const evidence = attempt.evidenceId ? store.getEvidence(attempt.evidenceId) : null;
    const outcome = store.getOutcomeForAttempt(attempt.attemptId);
    return {
      attemptId: attempt.attemptId,
      status: attempt.status,
      policyVersion: attempt.policyVersion,
      quote: attempt.quote,
      quoteHash: attempt.quoteHash,
      evidence: evidence && {
        provenance: evidence.provenance,
        tier: evidence.tier,
        providerScore: evidence.providerScore,
        reasons: evidence.reasons,
        capturedAt: evidence.capturedAt,
        mappingVersion: evidence.mappingVersion,
        address: evidence.address,
      },
      decision: decision && { decisionId: decision.decisionId, action: decision.action, reasons: decision.reasons, signerEligible: decision.signerEligible, status: decision.status },
      timestamps: {
        interceptaRequestedAt: attempt.interceptaRequestedAt,
        interceptaReturnedAt: attempt.interceptaReturnedAt,
        decidedAt: attempt.decidedAt,
        signerInvokedAt: attempt.signerInvokedAt,
        settledAt: attempt.settledAt,
      },
      signerCalls: store.signerCallCount(attempt.attemptId),
      settlement: outcome?.settlementStatus ?? 'none',
      delivery: outcome?.deliveryStatus ?? null,
      txHash: outcome?.txHash ?? null,
      basescan: outcome?.txHash ? CHAIN.basescanTx(outcome.txHash) : null,
    };
  });
console.log(JSON.stringify(traces, null, 2));
store.close();
