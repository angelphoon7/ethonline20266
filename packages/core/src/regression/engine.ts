import { hashDataset } from '../fingerprint.js';
import { countProvenance } from '../provenance.js';
import { validateCandidate } from '../policy/candidate.js';
import { paymentCaseSchema } from '../types.js';
import type { CaseResult, PaymentCase, PaymentPolicy, UnsealedReport } from '../types.js';
import { computeMetrics } from './metrics.js';
import { replayCase } from './replay.js';

export const REGRESSION_ENGINE_VERSION = 'regression/1.0.0';

export interface RegressionInput {
  baseline: PaymentPolicy;
  candidate: PaymentPolicy;
  cases: readonly PaymentCase[];
}

/**
 * Replays a candidate policy against a labelled dataset (SPEC section 13). Pure and deterministic: identical inputs give
 * an identical report and therefore an identical `reportHash` once sealed with `sealReport`. It has no signer, clock,
 * network or randomness. A candidate that fails `validateCandidate` cannot be replayed.
 */
export function runRegression(input: RegressionInput): UnsealedReport {
  const validation = validateCandidate(input.candidate, input.baseline);
  if (!validation.ok) throw new Error(`invalid candidate: ${validation.errors.join('; ')}`);

  const cases = input.cases.map((c) => paymentCaseSchema.parse(c)).sort((a, b) => (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0));
  const datasetHash = hashDataset(cases); // also rejects duplicate case ids

  const caseResults: CaseResult[] = cases.map((c) => ({
    caseId: c.caseId,
    provenance: c.provenance,
    label: c.label,
    baseline: replayCase(input.baseline, c),
    candidate: replayCase(input.candidate, c),
  }));

  return {
    candidateHash: input.candidate.policyHash,
    baselineHash: input.baseline.policyHash,
    datasetHash,
    engineVersion: REGRESSION_ENGINE_VERSION,
    caseResults,
    metrics: computeMetrics(caseResults),
    provenanceMix: countProvenance(cases),
  };
}
