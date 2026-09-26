/**
 * Exports the evidence shown by the public showcase site (`apps/site`) from the local case store and the recorded
 * fixtures into REDACTED JSON files under `apps/site/public/data/`. Run: pnpm export:site
 *
 * Read-only: no network, no signer, no Intercepta call, no environment variables. Only fields the page displays are kept:
 * never request headers, keys, raw signatures or the full typed data. Every trace carries the time it was recorded; the site
 * labels all of them "Recorded from a live run", never live.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_ORG_ID } from '../packages/core/src/index.js';
import type { PaymentAttempt } from '../packages/core/src/index.js';
import { CHAIN } from '../apps/gate/src/chain.js';
import { Store } from '../apps/gate/src/store/store.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const outDir = join(root, 'apps', 'site', 'public', 'data');

/** The recorded attempts each scene shows (ids from docs/evidence/M-004b_* and docs/evidence/M-010_v2_run.json). */
const SCENES = {
  pass: { prefix: '7b94ea6c', title: 'Scene 2: successful payment', evidenceDoc: 'docs/evidence/M-004b_traces.json' },
  block: { prefix: '2f05c880', title: 'Scene 3: Intercepta-driven deny', evidenceDoc: 'docs/evidence/M-004b_traces.json' },
  v2: { prefix: '3faa35f6', title: 'Scene 5: policy v2 changes a new payment', evidenceDoc: 'docs/evidence/M-010_v2_run.json' },
  v1: { prefix: '26540d40', title: 'Scene 5: policy v1 on a new payment after rollback', evidenceDoc: 'docs/evidence/M-010_v2_run.json' },
} as const;
type SceneKey = keyof typeof SCENES;

const store = new Store(join(root, 'data', 'risksir.db'));

function attemptByPrefix(prefix: string): PaymentAttempt {
  const matches = store.listAttempts(DEMO_ORG_ID).filter((a) => a.attemptId.startsWith(prefix));
  if (matches.length !== 1) throw new Error(`expected exactly one attempt starting with ${prefix}, found ${matches.length}`);
  return matches[0] as PaymentAttempt;
}

/** The provider response fields the page shows, copied from the stored raw body. */
function returnedFields(body: unknown): { toxicScore: number | null; traits: { name: string; risk: number | null; description: string | null }[]; fieldNames: string[] } {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const traits = Array.isArray(b.traits) ? b.traits : [];
  return {
    toxicScore: typeof b.toxicScore === 'number' ? b.toxicScore : null,
    traits: traits
      .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
      .map((t) => ({
        name: String(t.name ?? ''),
        risk: typeof t.risk === 'number' ? t.risk : null,
        description: typeof t.description === 'string' ? t.description.slice(0, 240) : null,
      })),
    fieldNames: Object.keys(b).sort(),
  };
}

function trace(key: SceneKey) {
  const scene = SCENES[key];
  const attempt = attemptByPrefix(scene.prefix);
  const decision = attempt.decisionId ? store.getDecision(attempt.decisionId) : null;
  const evidence = attempt.evidenceId ? store.getEvidence(attempt.evidenceId) : null;
  const raw = evidence?.rawId ? store.getRaw(evidence.rawId) : null;
  const outcome = store.getOutcomeForAttempt(attempt.attemptId);
  if (!attempt.quote || !decision || !evidence) throw new Error(`attempt ${attempt.attemptId} has no quote, decision or evidence`);
  if (evidence.provenance !== 'real_live') throw new Error(`attempt ${attempt.attemptId}: evidence provenance is ${evidence.provenance}, not real_live; not exported as a recorded live run`);
  const signerCalls = attempt.signerCalls;
  return {
    scene: key,
    title: scene.title,
    /** When the live Intercepta call for this attempt returned: the time of the recorded live run. */
    recordedAt: attempt.interceptaReturnedAt ?? evidence.capturedAt,
    attemptId: attempt.attemptId,
    status: attempt.status,
    quote: {
      amountAtomic: attempt.quote.amountAtomic,
      network: attempt.quote.network,
      asset: attempt.quote.asset,
      payTo: attempt.quote.payTo,
      resourcePath: new URL(attempt.quote.resourceUrl).pathname,
    },
    quoteHash: attempt.quoteHash,
    evidence: {
      provenance: evidence.provenance,
      screenedAddress: evidence.address,
      capturedAt: evidence.capturedAt,
      endpoint: raw ? new URL(raw.endpoint).origin + new URL(raw.endpoint).pathname.replace(evidence.address, '{address}').replace(evidence.address.toLowerCase(), '{address}') : null,
      httpStatus: raw?.httpStatus ?? null,
      latencyMs: raw?.latencyMs ?? null,
      returned: returnedFields(raw?.body),
      tier: evidence.tier,
      providerScore: evidence.providerScore,
      mappingVersion: evidence.mappingVersion,
    },
    decision: {
      policyVersion: decision.policyVersion,
      policyHash: decision.policyHash,
      action: decision.action,
      reasons: decision.reasons.map((r) => r.code),
      authorisedMaxAtomic: decision.authorisedMaxAtomic,
      signerEligible: decision.signerEligible,
    },
    signer: { calls: signerCalls, invokedAt: signerCalls > 0 ? attempt.signerInvokedAt : null },
    settlement: {
      status: outcome?.settlementStatus ?? 'none',
      delivery: outcome?.deliveryStatus ?? null,
      txHash: outcome?.txHash ?? null,
      basescan: outcome?.txHash ? CHAIN.basescanTx(outcome.txHash) : null,
    },
    source: scene.evidenceDoc,
  };
}

function regression() {
  const approved = store.listPolicyVersions(DEMO_ORG_ID).filter((v) => v.approvedReportHash !== null && v.approvedBy === 'owner').at(-1);
  if (!approved?.approvedReportHash) throw new Error('no owner-approved policy version with a report');
  const reports = store.listReports(DEMO_ORG_ID);
  const out = (key: 'A' | 'B') => {
    // The demo candidates are v1 plus one rule placed first (A1 / B1); a candidate's report is bound to its policy hash.
    const candidate = store.listCandidates(DEMO_ORG_ID).filter((c) => c.policy.rules[0]?.ruleId === `${key}1`).at(-1);
    if (!candidate) throw new Error(`candidate ${key} not found`);
    const report = reports.filter((r) => r.candidateHash === candidate.policy.policyHash).at(-1);
    if (!report) throw new Error(`no stored report for candidate ${key}`);
    const rule = candidate.policy.rules[0];
    return {
      key,
      candidateId: candidate.candidateId,
      rationale: candidate.rationale,
      rule: rule ? { ruleId: rule.ruleId, description: rule.description, action: rule.then.action } : null,
      reportHash: report.reportHash,
      metrics: report.metrics.map((m) => ({ name: m.name, numerator: m.numerator, denominator: m.denominator })),
      provenanceMix: report.provenanceMix,
      engineVersion: report.engineVersion,
      datasetHash: report.datasetHash,
      generatedAt: report.generatedAt,
    };
  };
  const a = out('A');
  const b = out('B');
  const approvedKey = b.reportHash === approved.approvedReportHash ? 'B' : a.reportHash === approved.approvedReportHash ? 'A' : null;
  if (!approvedKey) throw new Error('the approved report belongs to neither A nor B');
  return {
    scene: 'regression',
    title: 'Scene 4: regression over labelled cases',
    recordedAt: approved.approvedAt,
    candidates: [a, b],
    approved: { candidate: approvedKey, reportHash: approved.approvedReportHash, policyVersion: approved.policyVersion, policyHash: approved.policyHash, approvedBy: approved.approvedBy, approvedAt: approved.approvedAt },
    caveat: 'Counterfactual replay of stored evidence on labelled cases. It is not a measure of real prevented loss.',
    source: 'docs/evidence/M-010_v2_run.json',
  };
}

mkdirSync(outDir, { recursive: true });
const write = (name: string, data: unknown) => writeFileSync(join(outDir, name), JSON.stringify(data, null, 2) + '\n');
const pass = trace('pass');
const block = trace('block');
const v2 = trace('v2');
const v1 = trace('v1');
write('scene2-pass.json', pass);
write('scene3-block.json', block);
write('scene4-regression.json', regression());
write('scene5-v2.json', { scene: 'v2', title: 'Scene 5: a new payment under policy v2', v2, v1AfterRollback: v1 });
console.log(JSON.stringify({ wrote: ['scene2-pass', 'scene3-block', 'scene4-regression', 'scene5-v2'].map((n) => `apps/site/public/data/${n}.json`), pass: [pass.decision.action, pass.signer.calls], block: [block.decision.action, block.signer.calls], v2: [v2.decision.action, v2.signer.calls], v1: [v1.decision.action, v1.signer.calls] }));
store.close();
