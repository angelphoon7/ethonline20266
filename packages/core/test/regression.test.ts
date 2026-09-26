import { describe, expect, it } from 'vitest';
import { REGRESSION_ENGINE_VERSION, computeMetrics, demoCandidates, demoPolicyV1, exposureOf, hashReport, replayCase, runRegression, sealPolicy, sealReport } from '../src/index.js';
import type { CaseLabel, Metric, PaymentCase, Provenance, Tier } from '../src/index.js';
import { T0, T1, caseInput, evidenceInput } from './fixtures.js';

const v1 = demoPolicyV1();
const [candA, candB, candC] = demoCandidates(v1).map((c) => c.policy) as [typeof v1, typeof v1, typeof v1];

interface Spec {
  id: string;
  label: CaseLabel;
  firstTime: boolean;
  amount: string;
  tier?: Tier;
  provenance?: Provenance;
  budget?: string;
}

function mk(spec: Spec): PaymentCase {
  const tier = spec.tier ?? 'CLEAR';
  const provenance = spec.provenance ?? 'controlled_variant';
  const evidence = evidenceInput({
    evidenceId: `ev-${spec.id}`,
    provenance,
    tier,
    providerScore: tier === 'BLOCK' ? 100 : tier === 'CLEAR' ? 0 : tier === 'WARN' ? 35 : null,
    reasons: tier === 'BLOCK' ? ['known_scammer'] : [],
    unavailable: tier === 'UNAVAILABLE' ? 'MALFORMED' : null,
  });
  const revisions = [{ revision: 1, label: 'unknown', labelledBy: 'seed_script', rationale: 'seed', at: T0 }];
  if (spec.label !== 'unknown') revisions.push({ revision: 2, label: spec.label, labelledBy: 'owner', rationale: 'owner label', at: T1 });
  const base = caseInput({ caseId: spec.id, provenance, evidence, label: spec.label, labelRevisions: revisions });
  return { ...base, quote: { ...base.quote, amountAtomic: spec.amount }, context: { firstTimeCounterparty: spec.firstTime, periodBudgetRemainingAtomic: spec.budget ?? '500000' } };
}

/** Hand-computed dataset (see the expected numbers below). */
const dataset: PaymentCase[] = [
  mk({ id: 'c1', label: 'bad', firstTime: true, amount: '80000' }),
  mk({ id: 'c2', label: 'bad', firstTime: true, amount: '40000' }),
  mk({ id: 'c3', label: 'good', firstTime: true, amount: '10000' }),
  mk({ id: 'c4', label: 'good', firstTime: false, amount: '50000' }),
  mk({ id: 'c5', label: 'good', firstTime: true, amount: '50000' }),
  mk({ id: 'c6', label: 'unknown', firstTime: true, amount: '60000' }),
  mk({ id: 'c7', label: 'bad', firstTime: false, amount: '10000', tier: 'BLOCK' }),
];

const byName = (metrics: Metric[]) => Object.fromEntries(metrics.map((m) => [m.name, `${m.numerator}/${m.denominator}`]));

// T-012 (AC-011, INV-013): every metric has the exact numerator and denominator from the SPEC section 13 definitions.
describe('replay of one case (exposure model)', () => {
  it('PAY and eligible CAP expose the amount; HOLD, DENY, CAP below quote and pending ASK_HUMAN expose nothing', () => {
    expect(exposureOf({ action: 'PAY', signerEligible: true }, 5n)).toBe(5n);
    expect(exposureOf({ action: 'CAP', signerEligible: true }, 5n)).toBe(5n);
    for (const r of [
      { action: 'CAP', signerEligible: false },
      { action: 'HOLD', signerEligible: false },
      { action: 'DENY', signerEligible: false },
      { action: 'ASK_HUMAN', signerEligible: false },
    ] as const) {
      expect(exposureOf(r, 5n)).toBe(0n);
    }
  });

  it('replays under the production evaluate using only the stored snapshot', () => {
    const incident = dataset[0]!;
    expect(replayCase(v1, incident)).toEqual({ action: 'PAY', reasons: ['RULE_MATCHED'], exposureAtomic: '80000' });
    expect(replayCase(candA, incident)).toMatchObject({ action: 'HOLD', exposureAtomic: '0' });
    expect(replayCase(candB, incident)).toEqual({ action: 'CAP', reasons: ['RULE_MATCHED', 'CAP_BELOW_QUOTE'], exposureAtomic: '0' });
    expect(replayCase(candC, incident)).toMatchObject({ action: 'ASK_HUMAN', exposureAtomic: '0' });
  });

  it('a known-risk (BLOCK) snapshot is DENY under every policy, so it has no baseline exposure', () => {
    const risky = dataset[6]!;
    for (const p of [v1, candA, candB, candC]) expect(replayCase(p, risky)).toMatchObject({ action: 'DENY', exposureAtomic: '0' });
  });

  it('an UNAVAILABLE snapshot replays as HOLD and never as a pass', () => {
    expect(replayCase(v1, mk({ id: 'cu', label: 'unknown', firstTime: false, amount: '20000', tier: 'UNAVAILABLE' }))).toMatchObject({ action: 'HOLD', exposureAtomic: '0' });
  });

  it('a case with too little budget replays as HOLD (context predicate, same evidence)', () => {
    expect(replayCase(v1, mk({ id: 'cb', label: 'good', firstTime: false, amount: '50000', budget: '10000' }))).toMatchObject({ action: 'HOLD', reasons: ['PERIOD_CAP_EXCEEDED'] });
  });
});

describe('regression metrics (hand-computed)', () => {
  it('candidate B (cap first payments): security gain with limited friction', () => {
    const r = runRegression({ baseline: v1, candidate: candB, cases: dataset });
    expect(byName(r.metrics)).toEqual({
      bad_cases_prevented: '2/2',
      bad_value_prevented: '120000/120000',
      bad_value_remaining: '0/120000',
      good_cases_changed: '1/3',
      good_value_delayed_or_denied: '50000/110000',
      human_reviews_added: '0/7',
      auto_approval_rate: '2/7',
      hold_rate: '0/7',
      deny_rate: '1/7',
      bad_cases_weakened: '0/3',
    });
  });

  it('candidate A (hold every first-time counterparty) disrupts more legitimate payments', () => {
    const m = byName(runRegression({ baseline: v1, candidate: candA, cases: dataset }).metrics);
    expect(m).toMatchObject({ bad_cases_prevented: '2/2', good_cases_changed: '2/3', good_value_delayed_or_denied: '60000/110000', hold_rate: '5/7', auto_approval_rate: '1/7' });
  });

  it('candidate C (ask a human) adds review load', () => {
    const m = byName(runRegression({ baseline: v1, candidate: candC, cases: dataset }).metrics);
    expect(m).toMatchObject({ human_reviews_added: '4/7', good_cases_changed: '1/3', bad_cases_prevented: '2/2' });
  });

  it('matches an independent naive oracle for every candidate', () => {
    for (const cand of [candA, candB, candC]) {
      const report = runRegression({ baseline: v1, candidate: cand, cases: dataset });
      const results = report.caseResults;
      let badPrev = 0, badBase = 0, good = 0, goodChanged = 0, ask = 0;
      let badValPrev = 0n, badValBase = 0n, goodValLost = 0n, goodValBase = 0n;
      for (const r of results) {
        const b = BigInt(r.baseline.exposureAtomic);
        const c = BigInt(r.candidate.exposureAtomic);
        if (r.label === 'bad') {
          badValBase += b;
          if (b > c) badValPrev += b - c;
          if (b > 0n) {
            badBase++;
            if (c === 0n) badPrev++;
          }
        }
        if (r.label === 'good') {
          good++;
          goodValBase += b;
          if (b > c) goodValLost += b - c;
          if (r.candidate.action !== r.baseline.action || b !== c) goodChanged++;
        }
        if (r.candidate.action === 'ASK_HUMAN') ask++;
        if (r.baseline.action === 'ASK_HUMAN') ask--;
      }
      const m = byName(report.metrics);
      expect(m.bad_cases_prevented).toBe(`${badPrev}/${badBase}`);
      expect(m.bad_value_prevented).toBe(`${badValPrev}/${badValBase}`);
      expect(m.good_cases_changed).toBe(`${goodChanged}/${good}`);
      expect(m.good_value_delayed_or_denied).toBe(`${goodValLost}/${goodValBase}`);
      expect(m.human_reviews_added).toBe(`${ask}/${results.length}`);
    }
  });

  it('reports a bad case that a candidate newly exposes as weakened (07 section 5, question 5)', () => {
    // baseline v1 is strict (holds first-time counterparties); the candidate v2 drops that rule, exposing the bad case
    const strict = sealPolicy({ policyVersion: 1, parentVersion: null, profile: v1.profile, rules: [{ ruleId: 'S1', description: 'hold first-time', when: [{ kind: 'firstTimeCounterparty', value: true }], then: { action: 'HOLD' } }, ...v1.rules], defaultAction: 'HOLD' });
    const looser = sealPolicy({ policyVersion: 2, parentVersion: 1, profile: v1.profile, rules: v1.rules, defaultAction: 'HOLD' });
    const m = byName(runRegression({ baseline: strict, candidate: looser, cases: [mk({ id: 'w1', label: 'bad', firstTime: true, amount: '80000' })] }).metrics);
    expect(m.bad_cases_weakened).toBe('1/1');
    expect(m.bad_cases_prevented).toBe('0/0'); // nothing was exposed before, so nothing can be "prevented"
    expect(m.bad_value_prevented).toBe('0/0'); // a weakened policy never reports negative prevention
    expect(m.bad_value_remaining).toBe('80000/0');
  });
});

// T-013 (INV-013): unknown labels are excluded from prevention and friction metrics, and only counted in the rates.
describe('unknown labels', () => {
  it('do not enter any bad/good denominator, but do enter the rate metrics', () => {
    const onlyKnown = dataset.filter((c) => c.label !== 'unknown');
    const withUnknown = runRegression({ baseline: v1, candidate: candB, cases: dataset });
    const without = runRegression({ baseline: v1, candidate: candB, cases: onlyKnown });
    const a = byName(withUnknown.metrics);
    const b = byName(without.metrics);
    for (const k of ['bad_cases_prevented', 'bad_value_prevented', 'bad_value_remaining', 'good_cases_changed', 'good_value_delayed_or_denied', 'bad_cases_weakened']) {
      expect(a[k]).toBe(b[k]);
    }
    expect(a.auto_approval_rate).toBe('2/7');
    expect(b.auto_approval_rate).toBe('2/6'); // the rate denominator counts the unknown case
    expect(a.human_reviews_added?.split('/')[1]).toBe('7');
  });
});

// T-014 (AC-011, AC-032, INV-023): deterministic; the metrics come from the data.
describe('determinism and metrics-from-data', () => {
  const id = { reportId: 'r-1', generatedAt: T0 };

  it('identical inputs give an identical report and reportHash, independent of case order and of reportId/generatedAt', () => {
    const r1 = sealReport(runRegression({ baseline: v1, candidate: candB, cases: dataset }), id);
    const r2 = sealReport(runRegression({ baseline: v1, candidate: candB, cases: [...dataset].reverse() }), { reportId: 'r-2', generatedAt: T1 });
    expect(r1.reportHash).toBe(r2.reportHash);
    expect(r1.caseResults.map((c) => c.caseId)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']);
    expect(hashReport(r1)).toBe(r1.reportHash);
    expect(r1.engineVersion).toBe(REGRESSION_ENGINE_VERSION);
  });

  it('mutating one case changes the metrics and the report hash (nothing is hard-coded)', () => {
    const before = sealReport(runRegression({ baseline: v1, candidate: candB, cases: dataset }), id);
    const mutated = dataset.map((c) => (c.caseId === 'c5' ? { ...c, quote: { ...c.quote, amountAtomic: '20000' } } : c));
    const after = sealReport(runRegression({ baseline: v1, candidate: candB, cases: mutated }), id);
    expect(byName(after.metrics).good_cases_changed).toBe('0/3'); // c5 now falls below the 30000 band: unchanged
    expect(byName(before.metrics).good_cases_changed).toBe('1/3');
    expect(after.reportHash).not.toBe(before.reportHash);
    expect(after.datasetHash).not.toBe(before.datasetHash);
  });

  it('relabelling a case changes the dataset hash and the metrics', () => {
    const relabelled = dataset.map((c) =>
      c.caseId === 'c3' ? { ...c, label: 'bad' as const, labelRevisions: [...c.labelRevisions, { revision: c.labelRevisions.length + 1, label: 'bad' as const, labelledBy: 'owner' as const, rationale: 'x', at: T1 }] } : c,
    );
    const a = runRegression({ baseline: v1, candidate: candA, cases: dataset });
    const b = runRegression({ baseline: v1, candidate: candA, cases: relabelled });
    expect(b.datasetHash).not.toBe(a.datasetHash);
    expect(byName(b.metrics).bad_cases_prevented).toBe('3/3');
  });

  it('is bound to the candidate, baseline and dataset hashes and records every provenance in the mix', () => {
    const mix = dataset.concat(mk({ id: 'p1', label: 'good', firstTime: false, amount: '10000', provenance: 'synthetic' }));
    const r = runRegression({ baseline: v1, candidate: candB, cases: mix });
    expect(r).toMatchObject({ candidateHash: candB.policyHash, baselineHash: v1.policyHash });
    expect(r.provenanceMix).toEqual({ real_live: 0, sponsor_fixture: 0, controlled_variant: 7, synthetic: 1 });
    expect(r.caseResults.find((c) => c.caseId === 'p1')?.provenance).toBe('synthetic'); // never relabelled
  });

  it('does not mutate its inputs', () => {
    const frozen = JSON.stringify({ v1, candB, dataset });
    runRegression({ baseline: v1, candidate: candB, cases: dataset });
    expect(JSON.stringify({ v1, candB, dataset })).toBe(frozen);
  });

  it('rejects an invalid candidate, a duplicate case id and a malformed case', () => {
    expect(() => runRegression({ baseline: v1, candidate: v1, cases: dataset })).toThrow(/invalid candidate/); // same version, not a candidate
    expect(() => runRegression({ baseline: v1, candidate: candB, cases: [dataset[0]!, dataset[0]!] })).toThrow(/duplicate/);
    expect(() => runRegression({ baseline: v1, candidate: candB, cases: [{ ...dataset[0]!, provenance: 'live' as never }] })).toThrow();
  });

  it('an empty dataset yields zero denominators, never a division or a fabricated value', () => {
    const m = byName(runRegression({ baseline: v1, candidate: candB, cases: [] }).metrics);
    for (const v of Object.values(m)) expect(v).toBe('0/0');
  });
});

describe('computeMetrics is a pure function of case results', () => {
  it('returns the ten metrics in the SPEC order', () => {
    expect(computeMetrics([]).map((m) => m.name)).toEqual([
      'bad_cases_prevented', 'bad_value_prevented', 'bad_value_remaining', 'good_cases_changed', 'good_value_delayed_or_denied',
      'human_reviews_added', 'auto_approval_rate', 'hold_rate', 'deny_rate', 'bad_cases_weakened',
    ]);
  });
});
