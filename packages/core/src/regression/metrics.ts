import { formatAtomic, parseAtomic } from '../money.js';
import type { CaseResult, Metric } from '../types.js';
import { isEligibleReplay } from './replay.js';

/**
 * The 07 section 16 metrics, each with its numerator and denominator, computed from case results at run time
 * (INV-013). `unknown` labels are excluded from every prevention and friction metric; they only count in the rates
 * over all cases. Numerators and denominators are integer strings (counts, or atomic sums); nothing is a ratio.
 */
export function computeMetrics(results: readonly CaseResult[]): Metric[] {
  const bad = results.filter((r) => r.label === 'bad');
  const good = results.filter((r) => r.label === 'good');
  const sum = (rs: readonly CaseResult[], pick: (r: CaseResult) => bigint) => rs.reduce((t, r) => t + pick(r), 0n);
  const base = (r: CaseResult) => parseAtomic(r.baseline.exposureAtomic);
  const cand = (r: CaseResult) => parseAtomic(r.candidate.exposureAtomic);
  const reduction = (r: CaseResult) => (base(r) > cand(r) ? base(r) - cand(r) : 0n);
  const count = (rs: readonly CaseResult[], pred: (r: CaseResult) => boolean) => BigInt(rs.filter(pred).length);
  const all = BigInt(results.length);

  const badExposedBefore = bad.filter((r) => base(r) > 0n);
  const changed = (r: CaseResult) => r.candidate.action !== r.baseline.action || r.candidate.exposureAtomic !== r.baseline.exposureAtomic;
  const askCount = (rs: readonly CaseResult[], side: 'baseline' | 'candidate') => count(rs, (r) => r[side].action === 'ASK_HUMAN');

  const m = (name: Metric['name'], numerator: bigint, denominator: bigint): Metric => ({
    name,
    numerator: numerator.toString(10),
    denominator: formatAtomic(denominator),
  });

  return [
    m('bad_cases_prevented', count(badExposedBefore, (r) => cand(r) === 0n), BigInt(badExposedBefore.length)),
    m('bad_value_prevented', sum(bad, reduction), sum(bad, base)),
    m('bad_value_remaining', sum(bad, cand), sum(bad, base)),
    m('good_cases_changed', count(good, changed), BigInt(good.length)),
    m('good_value_delayed_or_denied', sum(good, reduction), sum(good, base)),
    m('human_reviews_added', askCount(results, 'candidate') - askCount(results, 'baseline'), all),
    m('auto_approval_rate', count(results, (r) => isEligibleReplay(r.candidate)), all),
    m('hold_rate', count(results, (r) => r.candidate.action === 'HOLD'), all),
    m('deny_rate', count(results, (r) => r.candidate.action === 'DENY'), all),
    m('bad_cases_weakened', count(bad, (r) => base(r) === 0n && cand(r) > 0n), BigInt(bad.length)),
  ];
}
