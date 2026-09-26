import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { canonicalJson } from './canonical.js';
import {
  canonicalQuoteSchema,
  paymentCaseSchema,
  paymentPolicySchema,
  regressionReportSchema,
  unsealedPolicySchema,
  unsealedReportSchema,
} from './types.js';
import type {
  Hex32,
  PaymentCase,
  PaymentPolicy,
  RegressionReport,
  UnsealedPolicy,
  UnsealedReport,
} from './types.js';

/**
 * The single canonical hashing module (SPEC section 8, CLAUDE.md section 7). Nothing else hashes quotes,
 * policies, datasets or reports. Hash = sha256( utf8(domainTag + "\n" + canonicalJson) ), as 0x + lowercase hex.
 */
export const DOMAIN_TAGS = {
  quote: 'risksir/quote/v1',
  policy: 'risksir/policy/v1',
  dataset: 'risksir/dataset/v1',
  report: 'risksir/report/v1',
} as const;

export function sha256Tagged(domainTag: string, canonical: string): Hex32 {
  return `0x${createHash('sha256').update(`${domainTag}\n${canonical}`, 'utf8').digest('hex')}`;
}

/**
 * Quote fingerprint. Covers scheme, network, asset, amount, payTo, resource URL, attemptId and validity.
 * Input is re-parsed so addresses are lowercased, the URL is normalised and the amount is validated:
 * a changed field always changes the hash, a differently-cased address never does (INV-005).
 */
export function hashQuote(quote: z.input<typeof canonicalQuoteSchema>): Hex32 {
  const q = canonicalQuoteSchema.parse(quote);
  return sha256Tagged(
    DOMAIN_TAGS.quote,
    canonicalJson({
      scheme: q.scheme,
      network: q.network,
      asset: q.asset,
      amountAtomic: q.amountAtomic,
      payTo: q.payTo,
      resourceUrl: q.resourceUrl,
      attemptId: q.attemptId,
      maxTimeoutSeconds: q.maxTimeoutSeconds,
    }),
  );
}

/** Policy hash over version numbers, profile, rules and default action; never over `policyHash` itself. */
export function hashPolicy(policy: UnsealedPolicy | PaymentPolicy): Hex32 {
  const p = unsealedPolicySchema.parse({
    policyVersion: policy.policyVersion,
    parentVersion: policy.parentVersion,
    profile: policy.profile,
    rules: policy.rules,
    defaultAction: policy.defaultAction,
  });
  return sha256Tagged(DOMAIN_TAGS.policy, canonicalJson(p));
}

export function sealPolicy(policy: UnsealedPolicy): PaymentPolicy {
  return paymentPolicySchema.parse({ ...policy, policyHash: hashPolicy(policy) });
}

export function verifyPolicyHash(policy: PaymentPolicy): boolean {
  return hashPolicy(policy) === policy.policyHash;
}

/** Dataset hash over the cases exactly as evaluated (including label revisions), sorted by caseId. */
export function hashDataset(cases: readonly PaymentCase[]): Hex32 {
  const parsed = cases.map((c) => paymentCaseSchema.parse(c));
  const ids = parsed.map((c) => c.caseId);
  if (new Set(ids).size !== ids.length) throw new Error('hashDataset: duplicate caseId');
  parsed.sort((a, b) => (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0));
  return sha256Tagged(DOMAIN_TAGS.dataset, canonicalJson(parsed));
}

/** Report hash excludes `reportId`, `generatedAt` and `reportHash`, so identical inputs give an identical hash. */
export function hashReport(report: UnsealedReport | RegressionReport): Hex32 {
  const r = unsealedReportSchema.parse({
    candidateHash: report.candidateHash,
    baselineHash: report.baselineHash,
    datasetHash: report.datasetHash,
    engineVersion: report.engineVersion,
    caseResults: report.caseResults,
    metrics: report.metrics,
    provenanceMix: report.provenanceMix,
  });
  return sha256Tagged(DOMAIN_TAGS.report, canonicalJson(r));
}

export function sealReport(report: UnsealedReport, identity: { reportId: string; generatedAt: string }): RegressionReport {
  return regressionReportSchema.parse({ ...report, ...identity, reportHash: hashReport(report) });
}
