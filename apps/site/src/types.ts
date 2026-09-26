/** Shapes written by `scripts/export-site-data.ts` (redacted: only fields the page shows). */
export interface SiteTrace {
  scene: string;
  title: string;
  recordedAt: string;
  attemptId: string;
  status: string;
  quote: { amountAtomic: string; network: string; asset: string; payTo: string; resourcePath: string };
  quoteHash: string;
  evidence: {
    provenance: string;
    screenedAddress: string;
    capturedAt: string;
    endpoint: string | null;
    httpStatus: number | null;
    latencyMs: number | null;
    returned: { toxicScore: number | null; traits: { name: string; risk: number | null; description: string | null }[]; fieldNames: string[] };
    tier: string;
    providerScore: number | null;
    mappingVersion: string;
  };
  decision: { policyVersion: number; policyHash: string; action: string; reasons: string[]; authorisedMaxAtomic: string | null; signerEligible: boolean };
  signer: { calls: number; invokedAt: string | null };
  settlement: { status: string; delivery: string | null; txHash: string | null; basescan: string | null };
  source: string;
}

export interface SiteMetric {
  name: string;
  numerator: string;
  denominator: string;
}

export interface SiteCandidate {
  key: 'A' | 'B';
  candidateId: string;
  rationale: string;
  rule: { ruleId: string; description: string; action: string } | null;
  reportHash: string;
  metrics: SiteMetric[];
  provenanceMix: Record<string, number>;
  engineVersion: string;
  datasetHash: string;
  generatedAt: string;
}

export interface SiteRegression {
  scene: 'regression';
  title: string;
  recordedAt: string;
  candidates: SiteCandidate[];
  approved: { candidate: 'A' | 'B'; reportHash: string; policyVersion: number; policyHash: string; approvedBy: string; approvedAt: string };
  caveat: string;
  source: string;
}

export interface SiteV2 {
  scene: 'v2';
  title: string;
  v2: SiteTrace;
  v1AfterRollback: SiteTrace;
}

export interface SiteData {
  pass: SiteTrace;
  block: SiteTrace;
  regression: SiteRegression;
  v2: SiteV2;
}
