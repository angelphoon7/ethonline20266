import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEMO_SERVICE_BASE, demoCandidates, demoPolicyV1, demoProfile, hashDataset, paymentCaseSchema, replayCase, runRegression, sealReport } from '@risksir/core';
import type { Metric, PaymentCase } from '@risksir/core';
import { buildDataset, loadDataset, manifestSchema } from '../src/dataset/index.js';
import { Store } from '../src/store/store.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const cases = loadDataset(root);
const byId = (id: string) => cases.find((c) => c.caseId === id) as PaymentCase;

const v1 = demoPolicyV1(demoProfile(DEMO_SERVICE_BASE));
const [candA, candB, candC] = demoCandidates(v1).map((c) => c.policy) as [typeof v1, typeof v1, typeof v1];
const metricsOf = (m: Metric[]) => Object.fromEntries(m.map((x) => [x.name, `${x.numerator}/${x.denominator}`]));

// T-012 / T-013 / AC-009 / AC-015: a labelled, provenance-honest dataset built from stored evidence only.
describe('labelled dataset', () => {
  it('has 19 cases with the documented provenance mix, all valid', () => {
    expect(cases).toHaveLength(19);
    const mix = cases.reduce<Record<string, number>>((m, c) => ({ ...m, [c.provenance]: (m[c.provenance] ?? 0) + 1 }), {});
    expect(mix).toEqual({ real_live: 4, controlled_variant: 11, synthetic: 4 });
    for (const c of cases) expect(paymentCaseSchema.safeParse(c).success).toBe(true);
  });

  it('is deterministic: building twice gives the same dataset hash', () => {
    expect(hashDataset(loadDataset(root))).toBe(hashDataset(cases));
  });

  it('real_live cases use only real_live evidence that traces to a recorded file, and never anything else', () => {
    const real = cases.filter((c) => c.provenance === 'real_live');
    expect(real.map((c) => c.caseId)).toEqual(['real-01-block-risky', 'real-02-pay-safe', 'real-03-block-risky', 'real-04-pay-safe']);
    for (const c of real) {
      expect(c.evidence.provenance).toBe('real_live');
      expect(c.evidence.rawId).toMatch(/^2026-09-26T.*\.json$/);
      expect(c.attemptId).toMatch(/^[0-9a-f-]{36}$/);
      expect(c.recorded).not.toBeNull();
    }
    expect(byId('real-01-block-risky').evidence).toMatchObject({ tier: 'BLOCK', providerScore: 100, reasons: ['known_scammer', 'attack_money_target'] });
    expect(byId('real-02-pay-safe').evidence).toMatchObject({ tier: 'CLEAR', providerScore: 0, reasons: [] });
    expect(byId('real-02-pay-safe').recorded).toEqual({ action: 'PAY', policyVersion: 1, signerCalled: true });
    expect(byId('real-01-block-risky').recorded).toEqual({ action: 'DENY', policyVersion: 1, signerCalled: false });
  });

  it('no non-real case carries real_live evidence, and synthetic/controlled evidence is labelled as such', () => {
    for (const c of cases.filter((x) => x.provenance !== 'real_live')) {
      expect(c.evidence.provenance).toBe(c.provenance);
      expect(c.attemptId).toBeNull();
      expect(c.recorded).toBeNull();
    }
  });

  it('controlled variants copy the stored real snapshot (tier, score, reasons) and only change context', () => {
    const realSafe = byId('real-02-pay-safe').evidence;
    const cv = byId('cv-05-known-50000');
    expect(cv.evidence).toMatchObject({ tier: realSafe.tier, providerScore: realSafe.providerScore, reasons: realSafe.reasons, address: realSafe.address });
    expect(cv.context.firstTimeCounterparty).toBe(false);
    const realRisky = byId('real-01-block-risky').evidence;
    expect(byId('cv-10-risky-known-10000').evidence).toMatchObject({ tier: 'BLOCK', reasons: realRisky.reasons });
  });

  it('synthetic cases come from the labelled WARN fixture and an UNAVAILABLE snapshot', () => {
    expect(byId('syn-01-warn-known-30000').evidence).toMatchObject({ tier: 'WARN', provenance: 'synthetic', reasons: ['non_kyc_transfers'] });
    expect(byId('syn-04-unavailable-20000').evidence).toMatchObject({ tier: 'UNAVAILABLE', unavailable: 'TIMEOUT', provenance: 'synthetic' });
  });

  it('labels: good/bad/unknown counts and append-only revisions; the incident case awaits the owner', () => {
    const count = (l: string) => cases.filter((c) => c.label === l).length;
    expect([count('good'), count('bad'), count('unknown')]).toEqual([9, 6, 4]);
    expect(byId('cv-01-incident-80000').label).toBe('unknown');
    expect(byId('cv-01-incident-80000').labelRevisions).toHaveLength(1);
    expect(byId('cv-07-incident-60000').labelRevisions.map((r) => [r.revision, r.label, r.labelledBy])).toEqual([[1, 'unknown', 'seed_script'], [2, 'bad', 'seed_script']]);
  });

  it('refuses a manifest entry that points at a missing or non-real recorded file', () => {
    const manifest = manifestSchema.parse(JSON.parse(readFileSync(join(root, 'fixtures', 'cases', 'real_live_manifest.json'), 'utf8')));
    const synth = JSON.parse(readFileSync(join(root, 'fixtures', 'intercepta', 'synthetic', 'quick-scan-warn-midband.json'), 'utf8'));
    expect(() => buildDataset({ manifest, recorded: {}, syntheticWarn: synth })).toThrow(/missing/);
    const fake = { [manifest.entries[0]!.file]: { timestamp: '2026-09-26T00:00:00.000Z', endpoint: 'x', address: `0x${'11'.repeat(20)}`, httpStatus: 200, provenance: 'synthetic', body: { toxicScore: 0, traits: [] } } };
    expect(() => buildDataset({ manifest, recorded: fake, syntheticWarn: synth })).toThrow(/not real_live/);
  });
});

describe('baseline replay of the dataset under policy v1', () => {
  const action = (id: string) => replayCase(v1, byId(id));

  it('reproduces what really happened for the four real attempts', () => {
    expect(action('real-01-block-risky')).toMatchObject({ action: 'DENY', reasons: ['EVIDENCE_BLOCK'] });
    expect(action('real-03-block-risky')).toMatchObject({ action: 'DENY' });
    expect(action('real-02-pay-safe')).toMatchObject({ action: 'PAY', exposureAtomic: '50000' });
    expect(action('real-04-pay-safe')).toMatchObject({ action: 'PAY', exposureAtomic: '50000' });
    for (const c of cases.filter((x) => x.provenance === 'real_live')) expect(replayCase(v1, c).action).toBe(c.recorded?.action);
  });

  it('shows the incident: v1 pays it; A holds, B caps it below the quote, C asks a human', () => {
    const inc = byId('cv-01-incident-80000');
    expect(replayCase(v1, inc)).toMatchObject({ action: 'PAY', exposureAtomic: '80000' });
    expect(replayCase(candA, inc)).toMatchObject({ action: 'HOLD', exposureAtomic: '0' });
    expect(replayCase(candB, inc)).toMatchObject({ action: 'CAP', reasons: ['RULE_MATCHED', 'CAP_BELOW_QUOTE'], exposureAtomic: '0' });
    expect(replayCase(candC, inc)).toMatchObject({ action: 'ASK_HUMAN', exposureAtomic: '0' });
  });

  it('covers HOLD (budget, unavailable), ASK_HUMAN (WARN) and DENY (BLOCK) baselines', () => {
    expect(action('cv-11-lowbudget-50000')).toMatchObject({ action: 'HOLD', reasons: ['PERIOD_CAP_EXCEEDED'] });
    expect(action('syn-04-unavailable-20000')).toMatchObject({ action: 'HOLD', reasons: ['EVIDENCE_UNAVAILABLE'] });
    expect(action('syn-02-warn-first-80000')).toMatchObject({ action: 'ASK_HUMAN' });
    expect(action('syn-01-warn-known-30000')).toMatchObject({ action: 'PAY' });
    expect(action('cv-10-risky-known-10000')).toMatchObject({ action: 'DENY' });
  });
});

// AC-010, AC-011: two or more candidates replayed; metrics are computed, with denominators, from these records.
describe('regression over the dataset', () => {
  const run = (cand: typeof v1, data = cases) => runRegression({ baseline: v1, candidate: cand, cases: data });

  it('candidate B (hand-computed): prevents every exposed bad case with limited friction', () => {
    expect(metricsOf(run(candB).metrics)).toEqual({
      bad_cases_prevented: '3/3',
      bad_value_prevented: '190000/190000',
      bad_value_remaining: '0/190000',
      good_cases_changed: '2/9',
      good_value_delayed_or_denied: '80000/340000',
      human_reviews_added: '-1/19',
      auto_approval_rate: '6/19',
      hold_rate: '2/19',
      deny_rate: '3/19',
      bad_cases_weakened: '0/6',
    });
  });

  it('candidate A is blunt: same prevention, more legitimate disruption and more holds', () => {
    const a = metricsOf(run(candA).metrics);
    const b = metricsOf(run(candB).metrics);
    expect(a.bad_cases_prevented).toBe('3/3');
    expect(a.good_cases_changed).toBe('4/9');
    expect(a.good_value_delayed_or_denied).toBe('110000/340000');
    expect(a.hold_rate).toBe('12/19');
    expect(Number(a.good_value_delayed_or_denied!.split('/')[0])).toBeGreaterThan(Number(b.good_value_delayed_or_denied!.split('/')[0]));
  });

  it('candidate C adds human reviews instead of blocking outright', () => {
    const c = metricsOf(run(candC).metrics);
    expect(c.bad_cases_prevented).toBe('3/3');
    expect(c.human_reviews_added).toMatch(/^\d+\/19$/);
    expect(Number(c.human_reviews_added!.split('/')[0])).toBeGreaterThan(0);
  });

  it('the owner labelling the incident changes the metrics and the report hash (metrics come from the data)', () => {
    const store = new Store(':memory:');
    for (const c of cases) store.saveCase(c);
    const before = sealReport(run(candB, store.listCases('org-exampleco')), { reportId: 'r1', generatedAt: '2026-09-26T16:00:00.000Z' });
    store.appendLabel('cv-01-incident-80000', { label: 'bad', labelledBy: 'owner', rationale: 'incident: merchant took the payment and delivered nothing', at: '2026-09-26T16:00:01.000Z' });
    const relabelled = store.listCases('org-exampleco');
    const after = sealReport(run(candB, relabelled), { reportId: 'r2', generatedAt: '2026-09-26T16:00:02.000Z' });
    expect(metricsOf(before.metrics).bad_cases_prevented).toBe('3/3');
    expect(metricsOf(after.metrics).bad_cases_prevented).toBe('4/4'); // the incident is now a bad case that v1 exposed and B prevents
    expect(metricsOf(after.metrics).bad_value_prevented).toBe('270000/270000');
    expect(after.reportHash).not.toBe(before.reportHash);
    expect(after.datasetHash).not.toBe(before.datasetHash);
    expect(store.getCase('cv-01-incident-80000')?.labelRevisions.map((r) => r.labelledBy)).toEqual(['seed_script', 'owner']);
    store.close();
  });

  it('cases survive persistence with provenance and labels intact', () => {
    const store = new Store(':memory:');
    for (const c of cases) store.saveCase(c);
    const back = store.listCases('org-exampleco');
    expect(back).toHaveLength(19);
    expect(hashDataset(back)).toBe(hashDataset(cases));
    expect(back.filter((c) => c.provenance === 'real_live')).toHaveLength(4);
    store.close();
  });
});
