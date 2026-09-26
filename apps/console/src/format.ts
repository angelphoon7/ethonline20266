/** Display helpers only. Money is never computed with floats: atomic units are integer strings (USDC has 6 decimals). */
export function formatUsdc(atomic: string | null): string {
  if (atomic === null) return 'n/a';
  if (!/^(0|[1-9][0-9]*)$/.test(atomic)) return atomic;
  const v = BigInt(atomic);
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${frac === '' ? whole.toString() : `${whole}.${frac}`} USDC`;
}

export const basescanTx = (hash: string): string => `https://sepolia.basescan.org/tx/${hash}`;

export const shortHash = (h: string | null, n = 8): string => (h ? `${h.slice(0, 2 + n)}…${h.slice(-6)}` : 'n/a');

export const timeOf = (iso: string | null): string => (iso ? iso.replace('T', ' ').replace('Z', ' UTC') : 'n/a');

/** The wording required next to every tier (SPEC section 10, ADR-017, ADR-023). */
export const TIER_LABEL = 'Risksir tier (policy threshold ADR-017), not an Intercepta verdict';

export const METRIC_LABELS: Record<string, string> = {
  bad_cases_prevented: 'Bad cases prevented',
  bad_value_prevented: 'Bad value prevented',
  bad_value_remaining: 'Bad value remaining',
  good_cases_changed: 'Good cases changed',
  good_value_delayed_or_denied: 'Good value delayed or denied',
  human_reviews_added: 'Human reviews added',
  auto_approval_rate: 'Auto-approved',
  hold_rate: 'Held',
  deny_rate: 'Denied',
  bad_cases_weakened: 'Bad cases weakened',
};

/** Metrics whose numerator and denominator are atomic USDC sums rather than counts. */
export const VALUE_METRICS = new Set(['bad_value_prevented', 'bad_value_remaining', 'good_value_delayed_or_denied']);
