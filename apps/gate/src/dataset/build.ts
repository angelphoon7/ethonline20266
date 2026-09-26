import { z } from 'zod';
import {
  BASE_SEPOLIA_NETWORK,
  BASE_SEPOLIA_USDC,
  DEMO_ORG_ID,
  DEMO_SERVICE_BASE,
  addressSchema,
  atomicAmountSchema,
  paymentCaseSchema,
} from '@risksir/core';
import type { CaseLabel, PaymentCase, Provenance, RiskEvidence } from '@risksir/core';
import { QUICK_SCAN_MAPPING_VERSION, quickScanMapper } from '../intercepta/mapping.js';

/**
 * Builds the labelled regression dataset (SPEC section 13, 07 section 15) from STORED evidence only: recorded real_live
 * Intercepta responses named by a manifest, controlled variants derived from those stored snapshots, and a few labelled
 * synthetic cases. Deterministic: the same inputs always give the same cases. Nothing here screens or reads a clock.
 */
export const manifestSchema = z.strictObject({
  note: z.string(),
  entries: z.array(
    z.strictObject({
      caseId: z.string().min(1),
      file: z.string().min(1),
      attemptId: z.string().min(1),
      amountAtomic: atomicAmountSchema,
      path: z.string().min(1),
      firstTimeCounterparty: z.boolean(),
      periodBudgetRemainingAtomic: atomicAmountSchema,
      recordedAction: z.enum(['PAY', 'CAP', 'HOLD', 'ASK_HUMAN', 'DENY']),
      signerCalled: z.boolean(),
      label: z.enum(['good', 'bad', 'unknown']),
      rationale: z.string().min(1),
    }),
  ),
});
export type Manifest = z.infer<typeof manifestSchema>;

export interface RecordedResponse {
  timestamp: string;
  endpoint: string;
  address: string;
  httpStatus: number | null;
  provenance: string;
  body: unknown;
}

export interface DatasetInputs {
  manifest: Manifest;
  /** Recorded responses keyed by file name. */
  recorded: Readonly<Record<string, RecordedResponse>>;
  /** The labelled synthetic fixture for the unobserved WARN band. */
  syntheticWarn: RecordedResponse;
}

const CV_TIME = (n: number) => `2026-09-26T15:00:${String(n).padStart(2, '0')}.000Z`;
const QUOTE_BASE = { network: BASE_SEPOLIA_NETWORK, asset: BASE_SEPOLIA_USDC, service: 'report' } as const;

function evidenceFrom(rec: RecordedResponse, over: { evidenceId: string; provenance: Provenance; rawId: string | null; capturedAt: string }): RiskEvidence {
  const mapped = quickScanMapper(rec.body);
  if (!mapped) throw new Error(`recorded body for ${rec.address} is not understood by the quick-scan mapper`);
  return {
    evidenceId: over.evidenceId,
    rawId: over.rawId,
    provenance: over.provenance,
    address: addressSchema.parse(rec.address),
    tier: mapped.tier,
    providerScore: mapped.providerScore,
    reasons: mapped.reasons,
    unavailable: null,
    capturedAt: over.capturedAt,
    mappingVersion: QUICK_SCAN_MAPPING_VERSION,
  };
}

interface CaseSeed {
  caseId: string;
  provenance: Provenance;
  attemptId: string | null;
  fixtureId: string | null;
  payTo: string;
  path: string;
  amountAtomic: string;
  firstTime: boolean;
  budget: string;
  evidence: RiskEvidence;
  recorded: PaymentCase['recorded'];
  label: CaseLabel;
  rationale: string;
  createdAt: string;
}

function caseFrom(seed: CaseSeed): PaymentCase {
  const revisions: PaymentCase['labelRevisions'] = [{ revision: 1, label: 'unknown', labelledBy: 'seed_script', rationale: 'seeded without a label', at: seed.createdAt }];
  if (seed.label !== 'unknown') revisions.push({ revision: 2, label: seed.label, labelledBy: 'seed_script', rationale: seed.rationale, at: seed.createdAt });
  return paymentCaseSchema.parse({
    caseId: seed.caseId,
    orgId: DEMO_ORG_ID,
    provenance: seed.provenance,
    attemptId: seed.attemptId,
    fixtureId: seed.fixtureId,
    quote: { ...QUOTE_BASE, amountAtomic: seed.amountAtomic, payTo: seed.payTo, resourceUrl: `${DEMO_SERVICE_BASE}${seed.path}` },
    context: { firstTimeCounterparty: seed.firstTime, periodBudgetRemainingAtomic: seed.budget },
    evidence: seed.evidence,
    recorded: seed.recorded,
    label: seed.label,
    labelRevisions: revisions,
    createdAt: seed.createdAt,
  });
}

export function buildDataset(inputs: DatasetInputs): PaymentCase[] {
  const cases: PaymentCase[] = [];

  // 1. real_live: exactly as observed, evidence from the recorded response.
  const realByPath = new Map<string, RecordedResponse>();
  for (const e of inputs.manifest.entries) {
    const rec = inputs.recorded[e.file];
    if (!rec) throw new Error(`recorded file ${e.file} is missing`);
    if (rec.provenance !== 'real_live') throw new Error(`recorded file ${e.file} is not real_live`);
    if (!realByPath.has(e.path)) realByPath.set(e.path, rec);
    cases.push(
      caseFrom({
        caseId: e.caseId,
        provenance: 'real_live',
        attemptId: e.attemptId,
        fixtureId: null,
        payTo: rec.address,
        path: e.path,
        amountAtomic: e.amountAtomic,
        firstTime: e.firstTimeCounterparty,
        budget: e.periodBudgetRemainingAtomic,
        evidence: evidenceFrom(rec, { evidenceId: `ev-${e.caseId}`, provenance: 'real_live', rawId: e.file, capturedAt: rec.timestamp }),
        recorded: { action: e.recordedAction, policyVersion: 1, signerCalled: e.signerCalled },
        label: e.label,
        rationale: e.rationale,
        createdAt: rec.timestamp,
      }),
    );
  }

  // 2. controlled variants: the stored SAFE (CLEAR) and RISKY (BLOCK) snapshots with a changed amount, history or budget.
  const safe = realByPath.get('report/safe');
  const risky = realByPath.get('report/risky');
  if (!safe || !risky) throw new Error('the manifest needs at least one real SAFE and one real RISKY response');
  let n = 0;
  const variant = (id: string, source: RecordedResponse, path: string, over: { amount: string; firstTime: boolean; label: CaseLabel; rationale: string; budget?: string }) => {
    n += 1;
    const at = CV_TIME(n);
    cases.push(
      caseFrom({
        caseId: id,
        provenance: 'controlled_variant',
        attemptId: null,
        fixtureId: id,
        payTo: source.address,
        path,
        amountAtomic: over.amount,
        firstTime: over.firstTime,
        budget: over.budget ?? '500000',
        evidence: evidenceFrom(source, { evidenceId: `ev-${id}`, provenance: 'controlled_variant', rawId: null, capturedAt: at }),
        recorded: null,
        label: over.label,
        rationale: over.rationale,
        createdAt: at,
      }),
    );
  };
  const clearNote = 'CLEAR is not proof of merchant honesty';
  variant('cv-01-incident-80000', safe, 'report/safe', { amount: '80000', firstTime: true, label: 'unknown', rationale: `pending incident: the owner labels it (${clearNote})` });
  variant('cv-02-first-10000', safe, 'report/safe', { amount: '10000', firstTime: true, label: 'good', rationale: 'controlled: a small legitimate first payment' });
  variant('cv-03-first-20000', safe, 'report/safe', { amount: '20000', firstTime: true, label: 'good', rationale: 'controlled: a legitimate first payment below the review band' });
  variant('cv-04-first-30000', safe, 'report/safe', { amount: '30000', firstTime: true, label: 'good', rationale: 'controlled: a legitimate first payment at the band boundary' });
  variant('cv-05-known-50000', safe, 'report/safe', { amount: '50000', firstTime: false, label: 'good', rationale: 'controlled: a repeat payment to a known counterparty' });
  variant('cv-06-known-100000', safe, 'report/safe', { amount: '100000', firstTime: false, label: 'good', rationale: 'controlled: a repeat payment at the per-payment cap' });
  variant('cv-07-incident-60000', safe, 'report/safe', { amount: '60000', firstTime: true, label: 'bad', rationale: `controlled incident: the merchant did not deliver (${clearNote})` });
  variant('cv-08-incident-90000', safe, 'report/safe', { amount: '90000', firstTime: true, label: 'bad', rationale: `controlled incident: the merchant did not deliver (${clearNote})` });
  variant('cv-09-first-40000', safe, 'report/safe', { amount: '40000', firstTime: true, label: 'unknown', rationale: 'controlled: outcome not yet known' });
  variant('cv-10-risky-known-10000', risky, 'report/risky', { amount: '10000', firstTime: true, label: 'bad', rationale: 'controlled: known-risk snapshot (known_scammer); label from provider evidence' });
  variant('cv-11-lowbudget-50000', safe, 'report/safe', { amount: '50000', firstTime: false, label: 'good', rationale: 'controlled: legitimate payment delayed by a nearly exhausted period budget', budget: '10000' });

  // 3. synthetic: the WARN band (never observed live) and an unavailable screen. Labelled synthetic, never shown as real.
  const synAddress = inputs.syntheticWarn.address;
  const synEvidence = (id: string, at: string): RiskEvidence => evidenceFrom(inputs.syntheticWarn, { evidenceId: `ev-${id}`, provenance: 'synthetic', rawId: null, capturedAt: at });
  const synthetic = (id: string, over: { amount: string; firstTime: boolean; label: CaseLabel; rationale: string; evidence?: RiskEvidence }) => {
    n += 1;
    const at = CV_TIME(n);
    cases.push(
      caseFrom({
        caseId: id,
        provenance: 'synthetic',
        attemptId: null,
        fixtureId: id,
        payTo: synAddress,
        path: 'report/safe',
        amountAtomic: over.amount,
        firstTime: over.firstTime,
        budget: '500000',
        evidence: over.evidence ?? synEvidence(id, at),
        recorded: null,
        label: over.label,
        rationale: over.rationale,
        createdAt: at,
      }),
    );
  };
  synthetic('syn-01-warn-known-30000', { amount: '30000', firstTime: false, label: 'good', rationale: 'synthetic: WARN band, known counterparty' });
  synthetic('syn-02-warn-first-80000', { amount: '80000', firstTime: true, label: 'unknown', rationale: 'synthetic: WARN band, large first payment' });
  synthetic('syn-03-warn-first-40000', { amount: '40000', firstTime: true, label: 'bad', rationale: 'synthetic: WARN band incident' });
  n += 0;
  const unavailableAt = CV_TIME(n + 1);
  synthetic('syn-04-unavailable-20000', {
    amount: '20000',
    firstTime: false,
    label: 'unknown',
    rationale: 'synthetic: the screen was unavailable',
    evidence: { ...synEvidence('syn-04-unavailable-20000', unavailableAt), tier: 'UNAVAILABLE', providerScore: null, reasons: [], unavailable: 'TIMEOUT' },
  });

  return cases.sort((a, b) => (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0));
}
